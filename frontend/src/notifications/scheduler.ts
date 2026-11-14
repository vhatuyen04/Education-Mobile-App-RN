import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import * as authApi from '../api/auth';
import { appendInbox, rememberUnseen, getInbox } from './inbox';

type CompoundBefore = { days?: number; hours?: number; minutes?: number };

const KEY_ENABLED = 'notif_enabled';
const KEY_EVENT_BEFORE = 'notif_event_before_v4';
const KEY_GOAL_BEFORE = 'notif_goal_before_v4';
const KEY_STEP_BEFORE = 'notif_step_before_v4';

const KEY_EVENT_ID = 'notif_event_id';
const KEY_GOAL_DUE_ID = 'notif_goal_due_id';
const KEY_STEP_DUE_ID = 'notif_step_due_id';
const KEY_LAST_AUTO_SCHEDULE_MS = 'notif_last_auto_schedule_ms_v1';
const KEY_PENDING = 'notif_pending_reminders_v1';

const DEFAULT_EVENT_BEFORE: CompoundBefore = { minutes: 30 };
const DEFAULT_GOAL_BEFORE: CompoundBefore = { days: 1 };
const DEFAULT_STEP_BEFORE: CompoundBefore = { hours: 3 };

function clampBefore(v: CompoundBefore): CompoundBefore {
  const days = Math.max(0, Math.floor(Number(v?.days ?? 0)));
  const hours = Math.max(0, Math.floor(Number(v?.hours ?? 0)));
  const minutes = Math.max(0, Math.floor(Number(v?.minutes ?? 0)));
  if (!days && !hours && !minutes) return { minutes: 0 };
  return { ...(days ? { days } : null), ...(hours ? { hours } : null), ...(minutes ? { minutes } : null) } as any;
}

function compoundToMs(v: CompoundBefore) {
  const x = clampBefore(v);
  return (Number(x.days ?? 0) * 24 * 60 + Number(x.hours ?? 0) * 60 + Number(x.minutes ?? 0)) * 60 * 1000;
}

function beforeToAnnouncement(v: CompoundBefore) {
  const x = clampBefore(v);
  if (x.days) return `${x.days} day${x.days === 1 ? '' : 's'} before`;
  if (x.hours) return `${x.hours} hour${x.hours === 1 ? '' : 's'} before`;
  if (x.minutes) return `${x.minutes} minute${x.minutes === 1 ? '' : 's'} before`;
  return 'At the scheduled time';
}

async function cancelAnyIfExists(key: string) {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return;

  // NotificationSettingsScreen may store a JSON array of IDs for the same key.
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      await Promise.all(
        parsed.map(async (id: any) => {
          if (!id) return;
          try {
            await Notifications.cancelScheduledNotificationAsync(String(id));
          } catch {
          }
        })
      );
      await AsyncStorage.removeItem(key);
      return;
    }
  } catch {
  }

  // Fallback: treat as single ID.
  try {
    await Notifications.cancelScheduledNotificationAsync(raw);
  } catch {
  }
  await AsyncStorage.removeItem(key);
}

type PendingReminder = {
  id: string;
  fireAt: number;
  title: string;
  body: string;
  data: Record<string, any>;
  osId?: string | null;
};

const HORIZON_MS = 21 * 24 * 60 * 60 * 1000;
const LOOKBACK_MS = 12 * 60 * 60 * 1000;

function reminderContent(item: PendingReminder): Notifications.NotificationContentInput {
  return {
    title: item.title,
    body: item.body,
    data: item.data,
    ...(Platform.OS === 'android' ? { channelId: 'default' } : null),
  } as Notifications.NotificationContentInput;
}

async function readPending(): Promise<PendingReminder[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PENDING);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item: any) => item && typeof item.id === 'string' && Number.isFinite(Number(item.fireAt)));
  } catch {
    return [];
  }
}

async function writePending(items: PendingReminder[]) {
  await AsyncStorage.setItem(KEY_PENDING, JSON.stringify(items));
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  } catch {
  }
}

async function notificationPermissionGranted() {
  try {
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    return !!perm.granted;
  } catch {
    return false;
  }
}

export async function flushDueReminders() {
  const now = Date.now();
  const pending = await readPending();
  if (!pending.length) return;
  const inbox = await getInbox();
  const seen = new Set(inbox.map(item => item.id));

  const keep: PendingReminder[] = [];
  for (const item of pending) {
    if (item.fireAt > now) {
      keep.push(item);
      continue;
    }
    if (item.fireAt < now - LOOKBACK_MS) {
      if (item.osId) {
        try {
          await Notifications.cancelScheduledNotificationAsync(item.osId);
        } catch {
        }
      }
      continue;
    }
    if (!seen.has(item.id)) {
      const inserted = await appendInbox({
        id: item.id,
        receivedAt: item.fireAt,
        title: item.title,
        body: item.body,
        data: item.data,
      });
      if (inserted) await rememberUnseen(item.id);
      seen.add(item.id);
    }
    if (item.osId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(item.osId);
      } catch {
      }
    }
  }
  await writePending(keep);
}

function nextOccurrenceFromRepeat(params: { repeat?: string | null; repeatDay?: number | null; repeatMonth?: number | null }): Date | null {
  const repeat = String(params.repeat ?? '').trim().toLowerCase();
  const now = new Date();
  if (!repeat) return null;

  if (repeat === 'daily') {
    const d = new Date(now);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  if (repeat === 'weekly') {
    const target = params.repeatDay;
    if (target === null || target === undefined) return null;
    const t = Number(target);
    if (!Number.isFinite(t) || t < 0 || t > 6) return null;
    const d = new Date(now);
    const diff = (t - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (diff === 0 ? 7 : diff));
    d.setHours(23, 59, 59, 999);
    return d;
  }

  if (repeat === 'monthly') {
    const target = params.repeatDay;
    if (target === null || target === undefined) return null;
    const day = Number(target);
    if (!Number.isFinite(day) || day < 1 || day > 31) return null;
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1, Math.min(day, 28));
    d.setHours(23, 59, 59, 999);
    return d;
  }

  if (repeat === 'yearly') {
    const m = params.repeatMonth;
    const day = params.repeatDay;
    if (m === null || m === undefined || day === null || day === undefined) return null;
    const mm = Number(m);
    const dd = Number(day);
    if (!Number.isFinite(mm) || !Number.isFinite(dd)) return null;
    const d = new Date(now);
    d.setFullYear(d.getFullYear() + 1, Math.max(0, mm - 1), Math.min(dd, 28));
    d.setHours(23, 59, 59, 999);
    return d;
  }

  return null;
}

async function readBefore(key: string, fallback: CompoundBefore): Promise<CompoundBefore> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    return clampBefore(parsed as any);
  } catch {
    return fallback;
  }
}

function withinWindow(fireAt: number, now: number) {
  return fireAt >= now - LOOKBACK_MS && fireAt <= now + HORIZON_MS;
}

function makeReminder(params: {
  kind: 'event' | 'goal' | 'step';
  entityId: string;
  fireAt: number;
  title: string;
  body: string;
  ownerUserId: string;
  extra?: Record<string, any>;
}): PendingReminder {
  const id = `rem_${params.kind}_${params.entityId}_${params.fireAt}`;
  return {
    id,
    fireAt: params.fireAt,
    title: params.title,
    body: params.body,
    data: {
      inboxId: id,
      ownerUserId: params.ownerUserId,
      kind: params.kind,
      scheduledForMs: params.fireAt,
      ...params.extra,
    },
  };
}

async function scheduleReminderList(items: PendingReminder[]) {
  const previous = await readPending();
  for (const item of previous) {
    if (!item.osId) continue;
    try {
      await Notifications.cancelScheduledNotificationAsync(item.osId);
    } catch {
    }
  }
  await cancelAnyIfExists(KEY_EVENT_ID);
  await cancelAnyIfExists(KEY_GOAL_DUE_ID);
  await cancelAnyIfExists(KEY_STEP_DUE_ID);

  if (!items.length) {
    await writePending([]);
    return;
  }

  const allowed = await notificationPermissionGranted();
  if (allowed) await ensureAndroidChannel();
  const now = Date.now();
  const next: PendingReminder[] = [];
  for (const item of items) {
    if (!withinWindow(item.fireAt, now)) continue;
    let osId: string | null = null;
    if (allowed && item.fireAt > now) {
      try {
        osId = await Notifications.scheduleNotificationAsync({
          content: reminderContent(item),
          trigger: { type: 'date', date: new Date(item.fireAt) } as any,
        });
      } catch {
        osId = null;
      }
    }
    next.push({ ...item, osId });
  }
  await writePending(next);
  await flushDueReminders();
}

export async function autoScheduleRemindersFromDashboard(dash: authApi.DashboardResponse | null | undefined) {
  try {
    const enabled = await AsyncStorage.getItem(KEY_ENABLED);
    if (enabled !== '1') {
      await scheduleReminderList([]);
      return;
    }
    let ownerUserId = '';
    try {
      const rawUser = await SecureStore.getItemAsync('auth_user');
      const user = rawUser ? JSON.parse(rawUser) : null;
      ownerUserId = String(user?.id ?? '').trim();
    } catch {
      ownerUserId = '';
    }
    const [eventBefore, goalBefore, stepBefore] = await Promise.all([
      readBefore(KEY_EVENT_BEFORE, DEFAULT_EVENT_BEFORE),
      readBefore(KEY_GOAL_BEFORE, DEFAULT_GOAL_BEFORE),
      readBefore(KEY_STEP_BEFORE, DEFAULT_STEP_BEFORE),
    ]);
    const reminders: PendingReminder[] = [];
    const eventSeen = new Set<string>();
    const eventAnn = beforeToAnnouncement(eventBefore);
    const events = [...(dash?.todayEvents ?? [])];
    if (dash?.nextEvent) events.push(dash.nextEvent as any);
    for (const event of events) {
      const id = String(event?.id ?? '');
      const title = String(event?.title ?? '');
      const start = new Date(String(event?.startAt ?? ''));
      if (!id || !title || eventSeen.has(id) || Number.isNaN(start.getTime())) continue;
      eventSeen.add(id);
      const fireAt = start.getTime() - compoundToMs(eventBefore);
      reminders.push(makeReminder({
        kind: 'event',
        entityId: id,
        fireAt,
        title: 'Upcoming event',
        body: `${eventAnn}: ${title}`,
        ownerUserId,
        extra: { eventId: id },
      }));
    }
    if (dash?.nextGoal?.dueAt) {
      const due = new Date(dash.nextGoal.dueAt);
      if (!Number.isNaN(due.getTime())) {
        const fireAt = due.getTime() - compoundToMs(goalBefore);
        reminders.push(makeReminder({
          kind: 'goal',
          entityId: dash.nextGoal.id,
          fireAt,
          title: 'Goal reminder',
          body: `${beforeToAnnouncement(goalBefore)}: ${dash.nextGoal.title}`,
          ownerUserId,
          extra: { goalId: dash.nextGoal.id },
        }));
      }
    }
    for (const step of dash?.todaySteps ?? []) {
      if (step.doneToday) continue;
      const due = step.dueAt
        ? new Date(String(step.dueAt))
        : nextOccurrenceFromRepeat({ repeat: step.repeat, repeatDay: step.repeatDay, repeatMonth: step.repeatMonth });
      if (!due || Number.isNaN(due.getTime())) continue;
      const fireAt = due.getTime() - compoundToMs(stepBefore);
      reminders.push(makeReminder({
        kind: 'step',
        entityId: step.id,
        fireAt,
        title: 'Step reminder',
        body: `${beforeToAnnouncement(stepBefore)}: ${step.text}`,
        ownerUserId,
        extra: { stepId: step.id, goalId: step.goalId },
      }));
    }
    await scheduleReminderList(reminders.slice(0, 60));
  } catch {
  }
}

export async function autoScheduleRemindersForSignedInUser(opts?: { minIntervalMs?: number }) {
  try {
    const minIntervalMs = Number(opts?.minIntervalMs ?? 60_000);
    const lastRaw = await AsyncStorage.getItem(KEY_LAST_AUTO_SCHEDULE_MS);
    const last = lastRaw ? Number(lastRaw) : 0;
    const now = Date.now();
    if (Number.isFinite(last) && last > 0 && now - last < minIntervalMs) return;

    const token = await SecureStore.getItemAsync('auth_access_token');
    if (!token) return;
    const enabled = await AsyncStorage.getItem(KEY_ENABLED);
    if (enabled !== '1') {
      await autoScheduleRemindersFromDashboard(null);
      return;
    }
    const dash = await authApi.getDashboard(token);
    const horizon = new Date(now + HORIZON_MS);
    const [eventResp, goalResp] = await Promise.all([
      authApi.listEvents(token, { from: new Date(now).toISOString(), to: horizon.toISOString() }).catch(() => ({ events: [] as authApi.EventItem[] })),
      authApi.listGoals(token).catch(() => ({ goals: [] as authApi.GoalItem[] })),
    ]);
    const activeGoals = (goalResp.goals ?? [])
      .filter(goal => !goal.completed && !goal.failedAt && !goal.deletedAt)
      .slice(0, 20);
    const doneStepIds = new Set((dash.todaySteps ?? []).filter(step => step.doneToday).map(step => step.id));
    const stepGroups = await Promise.all(
      activeGoals.map(goal => authApi.listGoalSteps(token, goal.id).then(resp => ({ goal, steps: resp.steps ?? [] })).catch(() => ({ goal, steps: [] as authApi.GoalStepItem[] })))
    );
    const merged: authApi.DashboardResponse = {
      ...dash,
      todayEvents: eventResp.events?.length ? eventResp.events : dash.todayEvents,
      nextEvent: dash.nextEvent,
      todaySteps: stepGroups.flatMap(({ goal, steps }) =>
        steps.map(step => {
          const rawDue = step.dueAt ? new Date(step.dueAt) : null;
          const repeatDue = !rawDue || rawDue.getTime() <= Date.now()
            ? nextOccurrenceFromRepeat({ repeat: step.repeat, repeatDay: step.repeatDay, repeatMonth: step.repeatMonth })
            : null;
          const due = repeatDue ?? rawDue;
          return {
            id: step.id,
            goalId: goal.id,
            goalTitle: goal.title,
            text: step.text,
            dueAt: due ? due.toISOString() : null,
            repeat: (step.repeat ?? null) as any,
            repeatDay: step.repeatDay ?? null,
            repeatMonth: step.repeatMonth ?? null,
            doneToday: doneStepIds.has(step.id),
          };
        })
      ),
    };
    const extraGoals = activeGoals.filter(goal => goal.id !== dash.nextGoal?.id && !!goal.dueAt);
    await autoScheduleRemindersFromDashboard(merged);
    if (extraGoals.length) {
      const pending = await readPending();
      let ownerUserId = '';
      try {
        const rawUser = await SecureStore.getItemAsync('auth_user');
        const user = rawUser ? JSON.parse(rawUser) : null;
        ownerUserId = String(user?.id ?? '').trim();
      } catch {
        ownerUserId = '';
      }
      const goalBefore = await readBefore(KEY_GOAL_BEFORE, DEFAULT_GOAL_BEFORE);
      const additions = extraGoals.map(goal => {
        const due = new Date(String(goal.dueAt));
        return makeReminder({
          kind: 'goal',
          entityId: goal.id,
          fireAt: due.getTime() - compoundToMs(goalBefore),
          title: 'Goal reminder',
          body: `${beforeToAnnouncement(goalBefore)}: ${goal.title}`,
          ownerUserId,
          extra: { goalId: goal.id },
        });
      });
      const combined = [...pending, ...additions].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index).slice(0, 60);
      await scheduleReminderList(combined);
    }
    await AsyncStorage.setItem(KEY_LAST_AUTO_SCHEDULE_MS, String(now));
  } catch {
  }
}
