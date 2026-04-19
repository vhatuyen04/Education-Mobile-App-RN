import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import * as authApi from '../api/auth';

type CompoundBefore = { days?: number; hours?: number; minutes?: number };

const KEY_ENABLED = 'notif_enabled';
const KEY_EVENT_BEFORE = 'notif_event_before_v4';
const KEY_GOAL_BEFORE = 'notif_goal_before_v4';
const KEY_STEP_BEFORE = 'notif_step_before_v4';

const KEY_EVENT_ID = 'notif_event_id';
const KEY_GOAL_DUE_ID = 'notif_goal_due_id';
const KEY_STEP_DUE_ID = 'notif_step_due_id';
const KEY_LAST_AUTO_SCHEDULE_MS = 'notif_last_auto_schedule_ms_v1';

const DEFAULT_EVENT_BEFORE: CompoundBefore = { minutes: 30 };
const DEFAULT_GOAL_BEFORE: CompoundBefore = { days: 1 };
const DEFAULT_STEP_BEFORE: CompoundBefore = { hours: 3 };

function clampBefore(v: CompoundBefore): CompoundBefore {
  const days = Math.max(0, Math.floor(Number(v?.days ?? 0)));
  const hours = Math.max(0, Math.floor(Number(v?.hours ?? 0)));
  const minutes = Math.max(0, Math.floor(Number(v?.minutes ?? 0)));
  if (!days && !hours && !minutes) return { minutes: 1 };
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
  return `${x.minutes ?? 0} minute${(x.minutes ?? 0) === 1 ? '' : 's'} before`;
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

async function scheduleAt(key: string, when: Date, content: Notifications.NotificationContentInput) {
  await cancelAnyIfExists(key);
  const t = when.getTime();
  if (!Number.isFinite(t)) return;
  if (t <= Date.now() + 1000) return;
  const id = await Notifications.scheduleNotificationAsync({
    content,
    trigger: { type: 'date', date: when, channelId: 'default' } as any,
  });
  await AsyncStorage.setItem(key, id);
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

export async function autoScheduleRemindersFromDashboard(dash: authApi.DashboardResponse | null | undefined) {
  try {
    const enabled = await AsyncStorage.getItem(KEY_ENABLED);
    if (enabled !== '1') return;

    const [eventBefore, goalBefore, stepBefore] = await Promise.all([
      readBefore(KEY_EVENT_BEFORE, DEFAULT_EVENT_BEFORE),
      readBefore(KEY_GOAL_BEFORE, DEFAULT_GOAL_BEFORE),
      readBefore(KEY_STEP_BEFORE, DEFAULT_STEP_BEFORE),
    ]);

    if (!dash) return;

    if (dash.nextEvent?.startAt) {
      const start = new Date(dash.nextEvent.startAt);
      const when = new Date(start.getTime() - compoundToMs(eventBefore));
      await scheduleAt(KEY_EVENT_ID, when, {
        title: 'Upcoming event',
        body: `${beforeToAnnouncement(eventBefore)}: ${dash.nextEvent.title}`,
      });
    } else {
      await cancelAnyIfExists(KEY_EVENT_ID);
    }

    if (dash.nextGoal?.dueAt) {
      const due = new Date(dash.nextGoal.dueAt);
      if (!Number.isNaN(due.getTime())) {
        const when = new Date(due.getTime() - compoundToMs(goalBefore));
        await scheduleAt(KEY_GOAL_DUE_ID, when, {
          title: 'Goal reminder',
          body: `${beforeToAnnouncement(goalBefore)}: ${dash.nextGoal.title}`,
        });
      } else {
        await cancelAnyIfExists(KEY_GOAL_DUE_ID);
      }
    } else {
      await cancelAnyIfExists(KEY_GOAL_DUE_ID);
    }

    const dueSteps = (dash.todaySteps ?? [])
      .filter(s => !s.doneToday)
      .map(s => {
        const due = s.dueAt
          ? new Date(String(s.dueAt))
          : nextOccurrenceFromRepeat({ repeat: s.repeat, repeatDay: s.repeatDay, repeatMonth: s.repeatMonth }) ||
            new Date(new Date().setHours(23, 59, 59, 999));
        return { ...s, due };
      })
      .filter(s => s.due instanceof Date && !Number.isNaN((s.due as Date).getTime()))
      .sort((a, b) => (a.due as Date).getTime() - (b.due as Date).getTime());

    const nextStep = dueSteps[0] ?? null;
    if (nextStep) {
      const dueMs = (nextStep.due as Date).getTime();
      const when = new Date(dueMs - compoundToMs(stepBefore));
      await scheduleAt(KEY_STEP_DUE_ID, when, {
        title: 'Deadline soon',
        body: `${beforeToAnnouncement(stepBefore)}: ${String((nextStep as any).text ?? '')}`,
      });
    } else {
      await cancelAnyIfExists(KEY_STEP_DUE_ID);
    }
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
    const dash = await authApi.getDashboard(token);
    await autoScheduleRemindersFromDashboard(dash);
    await AsyncStorage.setItem(KEY_LAST_AUTO_SCHEDULE_MS, String(now));
  } catch {
  }
}
