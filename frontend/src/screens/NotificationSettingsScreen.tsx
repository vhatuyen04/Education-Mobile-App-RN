import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Pill } from '../components/Pill';
import { colors } from '../theme/colors';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';

const KEY_ENABLED = 'notif_enabled';
const KEY_DAILY_TIME = 'notif_daily_time';
const KEY_DAILY_ID = 'notif_daily_id';
const KEY_EVENT_ID = 'notif_event_id';
const KEY_GOAL_DUE_ID = 'notif_goal_due_id';
const KEY_STEP_DUE_ID = 'notif_step_due_id';
const KEY_EVENT_OFFSET_MIN = 'notif_event_offset_min';
const KEY_GOAL_OFFSET_DAYS = 'notif_goal_offset_days';
const KEY_STEP_OFFSET_HOURS = 'notif_step_offset_hours';
const KEY_EVENT_OFFSET_VALUE = 'notif_event_offset_value';
const KEY_EVENT_OFFSET_UNIT = 'notif_event_offset_unit';
const KEY_GOAL_OFFSET_VALUE = 'notif_goal_offset_value';
const KEY_GOAL_OFFSET_UNIT = 'notif_goal_offset_unit';
const KEY_STEP_OFFSET_VALUE = 'notif_step_offset_value';
const KEY_STEP_OFFSET_UNIT = 'notif_step_offset_unit';
const KEY_EVENT_OFFSETS = 'notif_event_offsets_v3';
const KEY_GOAL_OFFSETS = 'notif_goal_offsets_v3';
const KEY_STEP_OFFSETS = 'notif_step_offsets_v3';
const KEY_EVENT_BEFORE = 'notif_event_before_v4';
const KEY_GOAL_BEFORE = 'notif_goal_before_v4';
const KEY_STEP_BEFORE = 'notif_step_before_v4';

type OffsetUnit = 'minutes' | 'hours' | 'days';

type CompoundBefore = { days: number; hours: number; minutes: number };

const DEFAULT_EVENT_OFFSET_VALUE = 30;
const DEFAULT_GOAL_OFFSET_VALUE = 1;
const DEFAULT_STEP_OFFSET_VALUE = 3;
 

function clampCompoundBefore(v: CompoundBefore): CompoundBefore {
  const n = (x: any) => {
    const raw = Number(x);
    return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  };
  return { days: n(v.days), hours: n(v.hours), minutes: n(v.minutes) };
}

function compoundToMs(v: CompoundBefore) {
  const x = clampCompoundBefore(v);
  return x.days * 24 * 60 * 60 * 1000 + x.hours * 60 * 60 * 1000 + x.minutes * 60 * 1000;
}

function beforeToAnnouncement(v: CompoundBefore) {
  const x = clampCompoundBefore(v);
  const d = x.days;
  const h = x.hours;
  const m = x.minutes;

  if (d === 0 && h === 0 && m === 0) return 'Current';

  const parts: string[] = [];
  if (d > 0) parts.push(`${d} day${d === 1 ? '' : 's'}`);

  // If days exist, always include hours, even when 0.
  // If days don't exist, include hours only when > 0.
  if (d > 0) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  else if (h > 0) parts.push(`${h} hour${h === 1 ? '' : 's'}`);

  // Minutes included only when > 0.
  if (m > 0) parts.push(`${m} minute${m === 1 ? '' : 's'}`);

  return `In ${parts.join(' ')}`;
}

function parseCompoundBefore(raw: string | null): CompoundBefore | null {
  if (!raw) return null;
  try {
    const x = JSON.parse(raw);
    if (!x || typeof x !== 'object') return null;
    return clampCompoundBefore({ days: x.days ?? 0, hours: x.hours ?? 0, minutes: x.minutes ?? 0 });
  } catch {
    return null;
  }
}

async function ensurePermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) {
    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
        });
      } catch {
      }
    }
    return true;
  }

  const req = await Notifications.requestPermissionsAsync();
  const ok = !!req.granted;
  if (ok && Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    } catch {
    }
  }
  return ok;
}

function daysUntil(date: Date) {
  const dayMs = 24 * 60 * 60 * 1000;
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const d0 = new Date(date);
  d0.setHours(0, 0, 0, 0);
  return Math.round((d0.getTime() - today0.getTime()) / dayMs);
}

function nextOccurrenceFromRepeat(opts: {
  repeat: string | null;
  repeatDay: number | null;
  repeatMonth: number | null;
}): Date | null {
  const repeat = String(opts.repeat ?? '').trim().toLowerCase();
  if (!repeat) return null;

  const now = new Date();
  const base = new Date(now);
  base.setSeconds(0, 0);

  // Default fire time for step reminders (end of day) to mirror once:YYYY-MM-DD parsing.
  const endOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };

  if (repeat === 'daily') {
    const t = endOfDay(base);
    return t.getTime() > now.getTime() ? t : endOfDay(new Date(base.getTime() + 24 * 60 * 60 * 1000));
  }

  if (repeat === 'weekly') {
    const dow = opts.repeatDay;
    if (dow === null || dow === undefined || !Number.isFinite(Number(dow))) return null;
    const target = Number(dow);
    if (target < 0 || target > 6) return null;

    const today = base.getDay();
    let delta = (target - today + 7) % 7;
    const cand = new Date(base);
    cand.setDate(cand.getDate() + delta);
    const t = endOfDay(cand);
    if (t.getTime() <= now.getTime()) {
      const next = new Date(cand);
      next.setDate(next.getDate() + 7);
      return endOfDay(next);
    }
    return t;
  }

  if (repeat === 'monthly') {
    const day = opts.repeatDay;
    if (day === null || day === undefined || !Number.isFinite(Number(day))) return null;
    const targetDay = Math.max(1, Math.min(31, Number(day)));

    const cand = new Date(base.getFullYear(), base.getMonth(), targetDay);
    const t = endOfDay(cand);
    if (t.getTime() > now.getTime()) return t;
    const next = new Date(base.getFullYear(), base.getMonth() + 1, targetDay);
    return endOfDay(next);
  }

  if (repeat === 'yearly') {
    const m = opts.repeatMonth;
    const d = opts.repeatDay;
    if (m === null || m === undefined || d === null || d === undefined) return null;
    const mm = Number(m);
    const dd = Number(d);
    if (!Number.isFinite(mm) || !Number.isFinite(dd)) return null;
    if (mm < 1 || mm > 12) return null;
    if (dd < 1 || dd > 31) return null;

    const cand = new Date(base.getFullYear(), mm - 1, dd);
    const t = endOfDay(cand);
    if (t.getTime() > now.getTime()) return t;
    const next = new Date(base.getFullYear() + 1, mm - 1, dd);
    return endOfDay(next);
  }

  return null;
}

async function cancelIfExists(key: string) {
  const id = await AsyncStorage.getItem(key);
  if (id) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // ignore
    }
    await AsyncStorage.removeItem(key);
  }
}

async function cancelAnyIfExists(key: string) {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      await Promise.all(
        parsed.map(async (id: any) => {
          if (!id) return;
          try {
            await Notifications.cancelScheduledNotificationAsync(String(id));
          } catch {
            // ignore
          }
        })
      );
      await AsyncStorage.removeItem(key);
      return;
    }
  } catch {
    // ignore
  }

  // fallback to single ID
  await cancelIfExists(key);
}

async function scheduleAt(key: string, when: Date, content: { title: string; body: string }) {
  if (!(when instanceof Date) || Number.isNaN(when.getTime())) return;
  if (when.getTime() <= Date.now() + 15_000) return; // ignore too-soon / past

  await cancelIfExists(key);
  const id = await Notifications.scheduleNotificationAsync({
    content,
    trigger: { type: 'date', date: when, channelId: 'default' } as any,
  });
  await AsyncStorage.setItem(key, id);
}

async function scheduleManyAt(key: string, items: Array<{ when: Date; content: { title: string; body: string } }>) {
  const now = Date.now();
  const valid = items
    .filter(x => x.when instanceof Date && !Number.isNaN(x.when.getTime()))
    .filter(x => x.when.getTime() > now + 15_000);

  await cancelAnyIfExists(key);

  if (!valid.length) {
    await AsyncStorage.removeItem(key);
    return;
  }

  const ids: string[] = [];
  for (const it of valid) {
    const id = await Notifications.scheduleNotificationAsync({
      content: it.content,
      trigger: { type: 'date', date: it.when, channelId: 'default' } as any,
    });
    ids.push(id);
  }

  await AsyncStorage.setItem(key, JSON.stringify(ids));
}

function getTriggerFireTimeMs(trigger: any, now: Date): number | null {
  if (!trigger) return null;

  // Date trigger: { type: 'date', date: number|string|Date }
  if (trigger.date !== undefined && trigger.date !== null) {
    const raw = trigger.date;
    const d = raw instanceof Date ? raw : new Date(typeof raw === 'number' ? raw : String(raw));
    return !Number.isNaN(d.getTime()) ? d.getTime() : null;
  }

  // Calendar trigger: { type: 'calendar', hour, minute, repeats }
  if (typeof trigger.hour === 'number' && typeof trigger.minute === 'number') {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), trigger.hour, trigger.minute, 0, 0);
    const fire = candidate.getTime() > now.getTime() ? candidate : new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
    return fire.getTime();
  }

  // timeInterval trigger: { type: 'timeInterval', seconds, repeats }
  if (typeof trigger.seconds === 'number' && trigger.seconds > 0 && !trigger.repeats) {
    // We don't know scheduling start precisely; fall back to unknown.
    return null;
  }

  return null;
}

export function NotificationSettingsScreen() {
  const nav = useNavigation<any>();
  const { state } = useAuth();

  const [enabled, setEnabled] = useState<boolean>(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const [eventBefore, setEventBefore] = useState<CompoundBefore>({ days: 0, hours: 0, minutes: 30 });
  const [goalBefore, setGoalBefore] = useState<CompoundBefore>({ days: 1, hours: 0, minutes: 0 });
  const [stepBefore, setStepBefore] = useState<CompoundBefore>({ days: 0, hours: 3, minutes: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [
        en,
        dailyId,
        evOff,
        goalOff,
        stepOff,
        evVal,
        evUnit,
        goalVal,
        goalUnit,
        stepVal,
        stepUnit,
        evList,
        goalList,
        stepList,
        evBeforeRaw,
        goalBeforeRaw,
        stepBeforeRaw,
      ] = await Promise.all([
        AsyncStorage.getItem(KEY_ENABLED),
        AsyncStorage.getItem(KEY_DAILY_ID),
        AsyncStorage.getItem(KEY_EVENT_OFFSET_MIN),
        AsyncStorage.getItem(KEY_GOAL_OFFSET_DAYS),
        AsyncStorage.getItem(KEY_STEP_OFFSET_HOURS),
        AsyncStorage.getItem(KEY_EVENT_OFFSET_VALUE),
        AsyncStorage.getItem(KEY_EVENT_OFFSET_UNIT),
        AsyncStorage.getItem(KEY_GOAL_OFFSET_VALUE),
        AsyncStorage.getItem(KEY_GOAL_OFFSET_UNIT),
        AsyncStorage.getItem(KEY_STEP_OFFSET_VALUE),
        AsyncStorage.getItem(KEY_STEP_OFFSET_UNIT),
        AsyncStorage.getItem(KEY_EVENT_OFFSETS),
        AsyncStorage.getItem(KEY_GOAL_OFFSETS),
        AsyncStorage.getItem(KEY_STEP_OFFSETS),
        AsyncStorage.getItem(KEY_EVENT_BEFORE),
        AsyncStorage.getItem(KEY_GOAL_BEFORE),
        AsyncStorage.getItem(KEY_STEP_BEFORE),
      ]);

      setEnabled(en === '1');

      // Daily check-in is no longer used; cancel any legacy scheduled notification.
      if (dailyId) {
        try {
          await Notifications.cancelScheduledNotificationAsync(String(dailyId));
        } catch {
          // ignore
        }
        await AsyncStorage.removeItem(KEY_DAILY_ID);
      }
      await AsyncStorage.removeItem(KEY_DAILY_TIME);

      const perm = await Notifications.getPermissionsAsync();
      const granted = !!perm.granted;
      setPermissionGranted(granted);

      const v4Ev = parseCompoundBefore(evBeforeRaw);
      const v4Goal = parseCompoundBefore(goalBeforeRaw);
      const v4Step = parseCompoundBefore(stepBeforeRaw);
      if (v4Ev) setEventBefore(v4Ev);
      if (v4Goal) setGoalBefore(v4Goal);
      if (v4Step) setStepBefore(v4Step);

      const validUnit = (u: any): u is OffsetUnit => u === 'minutes' || u === 'hours' || u === 'days';
      const legacyOne = (v: any, u: any, fallback: { value: number; unit: OffsetUnit }, legacyNumeric: any, legacyUnit: OffsetUnit): { value: number; unit: OffsetUnit } => {
        const vv = Number(v);
        const uu = (u as OffsetUnit) || null;
        if (Number.isFinite(vv) && vv >= 0 && validUnit(uu)) return { value: Math.floor(vv), unit: uu };
        if (legacyNumeric !== null && legacyNumeric !== undefined) {
          const x = Number(legacyNumeric);
          if (Number.isFinite(x) && x >= 0) return { value: Math.floor(x), unit: legacyUnit };
        }
        return fallback;
      };

      // Migrate from v3 list or v2 single-unit to compound (only if v4 not present)
      if (!v4Ev) {
        let migrated: CompoundBefore | null = null;
        try {
          const parsed = JSON.parse(evList ?? 'null');
          const first = Array.isArray(parsed) ? parsed[0] : null;
          if (first && (first.unit === 'minutes' || first.unit === 'hours' || first.unit === 'days')) {
            const vv = Number(first.value);
            if (Number.isFinite(vv) && vv >= 0) {
              migrated = first.unit === 'days' ? { days: Math.floor(vv), hours: 0, minutes: 0 } : first.unit === 'hours' ? { days: 0, hours: Math.floor(vv), minutes: 0 } : { days: 0, hours: 0, minutes: Math.floor(vv) };
            }
          }
        } catch {
          // ignore
        }
        if (!migrated) {
          const one = legacyOne(evVal, evUnit, { value: DEFAULT_EVENT_OFFSET_VALUE, unit: 'minutes' }, evOff, 'minutes');
          migrated = one.unit === 'days' ? { days: one.value, hours: 0, minutes: 0 } : one.unit === 'hours' ? { days: 0, hours: one.value, minutes: 0 } : { days: 0, hours: 0, minutes: one.value };
        }
        setEventBefore(clampCompoundBefore(migrated));
      }

      if (!v4Goal) {
        let migrated: CompoundBefore | null = null;
        try {
          const parsed = JSON.parse(goalList ?? 'null');
          const first = Array.isArray(parsed) ? parsed[0] : null;
          if (first && (first.unit === 'minutes' || first.unit === 'hours' || first.unit === 'days')) {
            const vv = Number(first.value);
            if (Number.isFinite(vv) && vv >= 0) {
              migrated = first.unit === 'days' ? { days: Math.floor(vv), hours: 0, minutes: 0 } : first.unit === 'hours' ? { days: 0, hours: Math.floor(vv), minutes: 0 } : { days: 0, hours: 0, minutes: Math.floor(vv) };
            }
          }
        } catch {
          // ignore
        }
        if (!migrated) {
          const one = legacyOne(goalVal, goalUnit, { value: DEFAULT_GOAL_OFFSET_VALUE, unit: 'days' }, goalOff, 'days');
          migrated = one.unit === 'days' ? { days: one.value, hours: 0, minutes: 0 } : one.unit === 'hours' ? { days: 0, hours: one.value, minutes: 0 } : { days: 0, hours: 0, minutes: one.value };
        }
        setGoalBefore(clampCompoundBefore(migrated));
      }

      if (!v4Step) {
        let migrated: CompoundBefore | null = null;
        try {
          const parsed = JSON.parse(stepList ?? 'null');
          const first = Array.isArray(parsed) ? parsed[0] : null;
          if (first && (first.unit === 'minutes' || first.unit === 'hours' || first.unit === 'days')) {
            const vv = Number(first.value);
            if (Number.isFinite(vv) && vv >= 0) {
              migrated = first.unit === 'days' ? { days: Math.floor(vv), hours: 0, minutes: 0 } : first.unit === 'hours' ? { days: 0, hours: Math.floor(vv), minutes: 0 } : { days: 0, hours: 0, minutes: Math.floor(vv) };
            }
          }
        } catch {
          // ignore
        }
        if (!migrated) {
          const one = legacyOne(stepVal, stepUnit, { value: DEFAULT_STEP_OFFSET_VALUE, unit: 'hours' }, stepOff, 'hours');
          migrated = one.unit === 'days' ? { days: one.value, hours: 0, minutes: 0 } : one.unit === 'hours' ? { days: 0, hours: one.value, minutes: 0 } : { days: 0, hours: 0, minutes: one.value };
        }
        setStepBefore(clampCompoundBefore(migrated));
      }

      const isEnabled = en === '1';
      if (isEnabled && granted) {
        // Daily check-in reminders intentionally removed.
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canEnable = !loading;

  const save = useCallback(
    async (nextEnabled: boolean) => {
      await AsyncStorage.setItem(KEY_ENABLED, nextEnabled ? '1' : '0');
    },
    []
  );

  const saveOffsets = useCallback(async (v: { eventMin: number; goalDays: number; stepHours: number }) => {
    await AsyncStorage.setItem(KEY_EVENT_OFFSET_MIN, String(v.eventMin));
    await AsyncStorage.setItem(KEY_GOAL_OFFSET_DAYS, String(v.goalDays));
    await AsyncStorage.setItem(KEY_STEP_OFFSET_HOURS, String(v.stepHours));
  }, []);

  const saveOffsetsV2 = useCallback(
    async (v: {
      event: { value: number; unit: OffsetUnit };
      goal: { value: number; unit: OffsetUnit };
      step: { value: number; unit: OffsetUnit };
    }) => {
      await AsyncStorage.setItem(KEY_EVENT_OFFSET_VALUE, String(v.event.value));
      await AsyncStorage.setItem(KEY_EVENT_OFFSET_UNIT, v.event.unit);
      await AsyncStorage.setItem(KEY_GOAL_OFFSET_VALUE, String(v.goal.value));
      await AsyncStorage.setItem(KEY_GOAL_OFFSET_UNIT, v.goal.unit);
      await AsyncStorage.setItem(KEY_STEP_OFFSET_VALUE, String(v.step.value));
      await AsyncStorage.setItem(KEY_STEP_OFFSET_UNIT, v.step.unit);

      // Keep writing legacy keys for older code paths
      await saveOffsets({
        eventMin: v.event.unit === 'minutes' ? v.event.value : v.event.unit === 'hours' ? v.event.value * 60 : v.event.value * 24 * 60,
        goalDays: v.goal.unit === 'days' ? v.goal.value : v.goal.unit === 'hours' ? Math.ceil(v.goal.value / 24) : Math.ceil(v.goal.value / (24 * 60)),
        stepHours: v.step.unit === 'hours' ? v.step.value : v.step.unit === 'days' ? v.step.value * 24 : Math.ceil(v.step.value / 60),
      });
    },
    [saveOffsets]
  );

  const saveBeforeV4 = useCallback(
    async (v: { event: CompoundBefore; goal: CompoundBefore; step: CompoundBefore }) => {
      await AsyncStorage.setItem(KEY_EVENT_BEFORE, JSON.stringify(clampCompoundBefore(v.event)));
      await AsyncStorage.setItem(KEY_GOAL_BEFORE, JSON.stringify(clampCompoundBefore(v.goal)));
      await AsyncStorage.setItem(KEY_STEP_BEFORE, JSON.stringify(clampCompoundBefore(v.step)));

      // Keep writing older keys so older builds don't break completely
      await saveOffsetsV2({
        event: { value: clampCompoundBefore(v.event).minutes || DEFAULT_EVENT_OFFSET_VALUE, unit: 'minutes' },
        goal: { value: clampCompoundBefore(v.goal).days || DEFAULT_GOAL_OFFSET_VALUE, unit: 'days' },
        step: { value: clampCompoundBefore(v.step).hours || DEFAULT_STEP_OFFSET_VALUE, unit: 'hours' },
      });
    },
    [saveOffsetsV2]
  );

  const cancelRuleNotifications = useCallback(async () => {
    await Promise.all([cancelAnyIfExists(KEY_EVENT_ID), cancelAnyIfExists(KEY_GOAL_DUE_ID), cancelAnyIfExists(KEY_STEP_DUE_ID)]);
  }, []);

  const scheduleRuleNotifications = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;

    const dash = await authApi.getDashboard(token);

    // (1) Event reminder: 30 minutes before nextEvent.startAt
    if (dash.nextEvent?.startAt) {
      const ev = dash.nextEvent;
      const start = new Date(dash.nextEvent.startAt);
      const ms = compoundToMs(eventBefore);
      const ann = beforeToAnnouncement(eventBefore);
      await scheduleManyAt(KEY_EVENT_ID, [
        {
          when: new Date(start.getTime() - ms),
          content: {
            title: 'Upcoming event',
            body: `${ann}: ${ev.title}`,
          },
        },
      ]);
    } else {
      await cancelAnyIfExists(KEY_EVENT_ID);
    }

    // (2) Goal reminder (relative to nextGoal.dueAt)
    if (dash.nextGoal?.dueAt) {
      const goal = dash.nextGoal;
      const due = new Date(dash.nextGoal.dueAt);
      if (!Number.isNaN(due.getTime())) {
        const ann = beforeToAnnouncement(goalBefore);
        await scheduleManyAt(KEY_GOAL_DUE_ID, [
          {
            when: new Date(due.getTime() - compoundToMs(goalBefore)),
            content: { title: 'Goal reminder', body: `${ann}: ${goal.title}` },
          },
        ]);
      } else {
        await cancelAnyIfExists(KEY_GOAL_DUE_ID);
      }
    } else {
      await cancelAnyIfExists(KEY_GOAL_DUE_ID);
    }

    // (3) Step deadline reminder: 3 hours before the earliest due step (not doneToday)
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
      const ms = compoundToMs(stepBefore);
      const ann = beforeToAnnouncement(stepBefore);
      await scheduleManyAt(KEY_STEP_DUE_ID, [
        {
          when: new Date(dueMs - ms),
          content: {
            title: 'Deadline soon',
            body: `${ann}: ${nextStep.text}`,
          },
        },
      ]);
    } else {
      await cancelAnyIfExists(KEY_STEP_DUE_ID);
    }
  }, [eventBefore, goalBefore, state.accessToken, stepBefore]);

  useEffect(() => {
    if (!enabled) return;
    if (!permissionGranted) return;
    if (!state.accessToken) return;
    void (async () => {
      try {
        await scheduleRuleNotifications();
      } catch {
      }
    })();
  }, [enabled, permissionGranted, scheduleRuleNotifications, state.accessToken]);

  const toggleEnabled = useCallback(
    async (value: boolean) => {
      setEnabled(value);

      try {
        if (value) {
          const ok = await ensurePermission();
          setPermissionGranted(ok);

          if (!ok) {
            setEnabled(false);
            toast('Notification permission is required.');
            await save(false);
            return;
          }

          await save(true);
          try {
            await scheduleRuleNotifications();
          } catch (e: any) {
            throw new Error(String(e?.message ?? 'Failed to schedule reminders'));
          }
          toast('Notifications enabled.');
        } else {
          await save(false);
          await cancelRuleNotifications();
          toast('Notifications disabled.');
        }
      } catch (e: any) {
        toast(String(e?.message ?? 'Failed to update notifications'));
      }
    },
    [cancelRuleNotifications, save, scheduleRuleNotifications]
  );

  const setBeforeSafe = useCallback(
    async (next: { event?: CompoundBefore; goal?: CompoundBefore; step?: CompoundBefore }) => {
      const ev = clampCompoundBefore(next.event ?? eventBefore);
      const goal = clampCompoundBefore(next.goal ?? goalBefore);
      const step = clampCompoundBefore(next.step ?? stepBefore);
      setEventBefore(ev);
      setGoalBefore(goal);
      setStepBefore(step);

      await saveBeforeV4({ event: ev, goal, step });

      if (enabled) {
        await scheduleRuleNotifications();
      }
    },
    [enabled, eventBefore, goalBefore, saveBeforeV4, scheduleRuleNotifications, stepBefore]
  );

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.hTitle}>Notifications</Text>
          <Pressable onPress={() => nav.goBack()} style={({ pressed }) => [styles.iconBtn, pressed ? { opacity: 0.85 } : null]}>
            <Text style={styles.iconText}>←</Text>
          </Pressable>
        </View>

        <Card>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Enable reminders</Text>
            </View>
            <Switch value={enabled} onValueChange={toggleEnabled} disabled={!canEnable || loading} />
          </View>

          {permissionGranted === false ? (
            <View style={{ height: 10 }}>
              <Text style={styles.muted12}>Permission denied. Enable notifications in system settings.</Text>
            </View>
          ) : null}
        </Card>

        <Card>
          <Button
            title="Send test notification"
            full
            onPress={async () => {
              const ok = await ensurePermission();
              setPermissionGranted(ok);
              if (!ok) {
                toast('Notification permission is required.');
                return;
              }
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: 'Test notification',
                  body: 'This is a test reminder from the app.',
                },
                trigger: { type: 'timeInterval', seconds: 2, repeats: false, channelId: 'default' } as any,
              });
              toast('Test notification scheduled (2s)');
            }}
          />

          <View style={{ height: 10 }} />
        </Card>

        <Card>
          <Button
            title="Test goal due tomorrow (60s)"
            full
            onPress={async () => {
              try {
                const ok = await ensurePermission();
                setPermissionGranted(ok);
                if (!ok) {
                  toast('Notification permission is required.');
                  return;
                }

                const token = state.accessToken;
                if (!token) {
                  toast('Not signed in');
                  return;
                }

                const dash = await authApi.getDashboard(token);
                const goal = dash.nextGoal;
                const due = goal?.dueAt ? new Date(goal.dueAt) : null;
                if (!due || Number.isNaN(due.getTime()) || daysUntil(due) !== 1) {
                  toast('Next goal is not due tomorrow.');
                  return;
                }

                await scheduleManyAt(KEY_GOAL_DUE_ID, [
                  {
                    when: new Date(Date.now() + 60_000),
                    content: {
                      title: 'Goal due tomorrow',
                      body: `${goal?.title ?? 'Your goal'}`,
                    },
                  },
                ]);
                toast('Goal reminder scheduled (60s).');
              } catch (e: any) {
                toast(String(e?.message ?? 'Failed to schedule goal reminder'));
              }
            }}
          />
        </Card>

        <Card>
          <Text style={styles.cardTitle}>Send reminder</Text>
          <View style={{ height: 10 }} />

          <Text style={styles.muted12}>Event reminder (before start)</Text>
          <View style={{ height: 8 }} />
          <View style={styles.beforeRow}>
            <View style={styles.beforeField}>
              <Text style={styles.beforeLabel}>Days</Text>
              <TextInput
                value={String(eventBefore.days)}
                onChangeText={t => {
                  const n = Number(t.replace(/[^0-9]/g, ''));
                  if (Number.isFinite(n)) void setBeforeSafe({ event: { ...eventBefore, days: n } });
                }}
                keyboardType="number-pad"
                style={styles.beforeInput}
              />
            </View>
            <View style={styles.beforeField}>
              <Text style={styles.beforeLabel}>Hours</Text>
              <TextInput
                value={String(eventBefore.hours)}
                onChangeText={t => {
                  const n = Number(t.replace(/[^0-9]/g, ''));
                  if (Number.isFinite(n)) void setBeforeSafe({ event: { ...eventBefore, hours: n } });
                }}
                keyboardType="number-pad"
                style={styles.beforeInput}
              />
            </View>
            <View style={styles.beforeField}>
              <Text style={styles.beforeLabel}>Minutes</Text>
              <TextInput
                value={String(eventBefore.minutes)}
                onChangeText={t => {
                  const n = Number(t.replace(/[^0-9]/g, ''));
                  if (Number.isFinite(n)) void setBeforeSafe({ event: { ...eventBefore, minutes: n } });
                }}
                keyboardType="number-pad"
                style={styles.beforeInput}
              />
            </View>
          </View>

          <View style={{ height: 12 }} />
          <Text style={styles.muted12}>Goal reminder (before due date)</Text>
          <View style={{ height: 8 }} />
          <View style={styles.beforeRow}>
            <View style={styles.beforeField}>
              <Text style={styles.beforeLabel}>Days</Text>
              <TextInput
                value={String(goalBefore.days)}
                onChangeText={t => {
                  const n = Number(t.replace(/[^0-9]/g, ''));
                  if (Number.isFinite(n)) void setBeforeSafe({ goal: { ...goalBefore, days: n } });
                }}
                keyboardType="number-pad"
                style={styles.beforeInput}
              />
            </View>
            <View style={styles.beforeField}>
              <Text style={styles.beforeLabel}>Hours</Text>
              <TextInput
                value={String(goalBefore.hours)}
                onChangeText={t => {
                  const n = Number(t.replace(/[^0-9]/g, ''));
                  if (Number.isFinite(n)) void setBeforeSafe({ goal: { ...goalBefore, hours: n } });
                }}
                keyboardType="number-pad"
                style={styles.beforeInput}
              />
            </View>
            <View style={styles.beforeField}>
              <Text style={styles.beforeLabel}>Minutes</Text>
              <TextInput
                value={String(goalBefore.minutes)}
                onChangeText={t => {
                  const n = Number(t.replace(/[^0-9]/g, ''));
                  if (Number.isFinite(n)) void setBeforeSafe({ goal: { ...goalBefore, minutes: n } });
                }}
                keyboardType="number-pad"
                style={styles.beforeInput}
              />
            </View>
          </View>

          <View style={{ height: 12 }} />
          <Text style={styles.muted12}>Step reminder (before deadline)</Text>
          <View style={{ height: 8 }} />
          <View style={styles.beforeRow}>
            <View style={styles.beforeField}>
              <Text style={styles.beforeLabel}>Days</Text>
              <TextInput
                value={String(stepBefore.days)}
                onChangeText={t => {
                  const n = Number(t.replace(/[^0-9]/g, ''));
                  if (Number.isFinite(n)) void setBeforeSafe({ step: { ...stepBefore, days: n } });
                }}
                keyboardType="number-pad"
                style={styles.beforeInput}
              />
            </View>
            <View style={styles.beforeField}>
              <Text style={styles.beforeLabel}>Hours</Text>
              <TextInput
                value={String(stepBefore.hours)}
                onChangeText={t => {
                  const n = Number(t.replace(/[^0-9]/g, ''));
                  if (Number.isFinite(n)) void setBeforeSafe({ step: { ...stepBefore, hours: n } });
                }}
                keyboardType="number-pad"
                style={styles.beforeInput}
              />
            </View>
            <View style={styles.beforeField}>
              <Text style={styles.beforeLabel}>Minutes</Text>
              <TextInput
                value={String(stepBefore.minutes)}
                onChangeText={t => {
                  const n = Number(t.replace(/[^0-9]/g, ''));
                  if (Number.isFinite(n)) void setBeforeSafe({ step: { ...stepBefore, minutes: n } });
                }}
                keyboardType="number-pad"
                style={styles.beforeInput}
              />
            </View>
          </View>

          <View style={{ height: 12 }} />
          <Text style={styles.muted12}>All reminders are scheduled relative to their due/start times using the offset you select.</Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 14,
    paddingBottom: 40,
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  hTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  muted12: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  beforeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  beforeField: {
    flex: 1,
  },
  beforeLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  beforeInput: {
    width: '100%',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontWeight: '800',
  },
  offsetInput: {
    minWidth: 54,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontWeight: '800',
  },
});
