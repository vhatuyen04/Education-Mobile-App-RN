import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';

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

type DailyTime = { hour: number; minute: number };

function pad2(v: number) {
  return String(v).padStart(2, '0');
}

function formatTime(t: DailyTime) {
  return `${pad2(t.hour)}:${pad2(t.minute)}`;
}

function parseTime(s: string | null): DailyTime | null {
  if (!s) return null;
  const m = /^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$/.exec(s);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  return { hour, minute };
}

async function ensurePermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  const req = await Notifications.requestPermissionsAsync();
  return !!req.granted;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
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
  const [dailyTime, setDailyTime] = useState<DailyTime>({ hour: 20, minute: 0 });
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const timePresets: DailyTime[] = useMemo(
    () => [
      { hour: 8, minute: 0 },
      { hour: 12, minute: 0 },
      { hour: 18, minute: 0 },
      { hour: 20, minute: 0 },
      { hour: 21, minute: 0 },
    ],
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [en, t, dailyId] = await Promise.all([
        AsyncStorage.getItem(KEY_ENABLED),
        AsyncStorage.getItem(KEY_DAILY_TIME),
        AsyncStorage.getItem(KEY_DAILY_ID),
      ]);

      setEnabled(en === '1');

      const parsed = parseTime(t);
      if (parsed) setDailyTime(parsed);

      const perm = await Notifications.getPermissionsAsync();
      const granted = !!perm.granted;
      setPermissionGranted(granted);

      const isEnabled = en === '1';
      if (isEnabled && granted && !dailyId) {
        const fallback = parseTime(t) ?? { hour: 20, minute: 0 };
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Daily check-in',
            body: "What’s your plan for today? Open the app to see your goals and schedule.",
          },
          trigger: { type: 'calendar', hour: fallback.hour, minute: fallback.minute, repeats: true, channelId: 'default' } as any,
        });
        await AsyncStorage.setItem(KEY_DAILY_ID, id);
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
    async (nextEnabled: boolean, nextTime: DailyTime) => {
      await AsyncStorage.setItem(KEY_ENABLED, nextEnabled ? '1' : '0');
      await AsyncStorage.setItem(KEY_DAILY_TIME, formatTime(nextTime));
    },
    []
  );

  const cancelDaily = useCallback(async () => {
    const id = await AsyncStorage.getItem(KEY_DAILY_ID);
    if (id) {
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
      } catch {
        // ignore
      }
      await AsyncStorage.removeItem(KEY_DAILY_ID);
    }
  }, []);

  const cancelRuleNotifications = useCallback(async () => {
    await Promise.all([cancelIfExists(KEY_EVENT_ID), cancelIfExists(KEY_GOAL_DUE_ID), cancelIfExists(KEY_STEP_DUE_ID)]);
  }, []);

  const scheduleDaily = useCallback(
    async (t: DailyTime) => {
      await cancelDaily();

      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Daily check-in',
          body: "What’s your plan for today? Open the app to see your goals and schedule.",
        },
        trigger: { type: 'calendar', hour: t.hour, minute: t.minute, repeats: true, channelId: 'default' } as any,
      });

      await AsyncStorage.setItem(KEY_DAILY_ID, id);
    },
    [cancelDaily]
  );

  const scheduleRuleNotifications = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;

    const dash = await authApi.getDashboard(token);

    // (1) Event reminder: 30 minutes before nextEvent.startAt
    if (dash.nextEvent?.startAt) {
      const start = new Date(dash.nextEvent.startAt);
      const when = new Date(start.getTime() - 30 * 60 * 1000);
      await scheduleAt(KEY_EVENT_ID, when, {
        title: 'Upcoming event',
        body: `In 30 minutes: ${dash.nextEvent.title}`,
      });
    } else {
      await cancelIfExists(KEY_EVENT_ID);
    }

    // (2) Goal due tomorrow reminder (based on nextGoal.dueAt)
    if (dash.nextGoal?.dueAt) {
      const due = new Date(dash.nextGoal.dueAt);
      const now = new Date();
      if (!Number.isNaN(due.getTime()) && daysUntil(due) === 1) {
        // Prefer the user's reminder time today. If already passed, schedule soon so the user still gets the reminder.
        const t = dailyTime;
        const preferred = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.hour, t.minute, 0, 0);
        const when = preferred.getTime() > now.getTime() ? preferred : new Date(now.getTime() + 60_000);

        await scheduleAt(KEY_GOAL_DUE_ID, when, {
          title: 'Goal due tomorrow',
          body: `${dash.nextGoal.title}`,
        });
      } else {
        await cancelIfExists(KEY_GOAL_DUE_ID);
      }
    } else {
      await cancelIfExists(KEY_GOAL_DUE_ID);
    }

    // (3) Step deadline reminder: 3 hours before the earliest due step (not doneToday)
    const dueSteps = (dash.todaySteps ?? [])
      .filter(s => !s.doneToday)
      .map(s => {
        const due = s.dueAt ? new Date(String(s.dueAt)) : nextOccurrenceFromRepeat({ repeat: s.repeat, repeatDay: s.repeatDay, repeatMonth: s.repeatMonth });
        return { ...s, due };
      })
      .filter(s => s.due instanceof Date && !Number.isNaN((s.due as Date).getTime()))
      .sort((a, b) => (a.due as Date).getTime() - (b.due as Date).getTime());

    const nextStep = dueSteps[0] ?? null;
    if (nextStep) {
      const when = new Date((nextStep.due as Date).getTime() - 3 * 60 * 60 * 1000);
      await scheduleAt(KEY_STEP_DUE_ID, when, {
        title: 'Deadline soon',
        body: `3 hours left: ${nextStep.text}`,
      });
    } else {
      await cancelIfExists(KEY_STEP_DUE_ID);
    }
  }, [dailyTime, state.accessToken]);

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
            await save(false, dailyTime);
            await cancelDaily();
            return;
          }

          await save(true, dailyTime);
          await scheduleDaily(dailyTime);
          await scheduleRuleNotifications();
          toast('Notifications enabled.');
        } else {
          await save(false, dailyTime);
          await cancelDaily();
          await cancelRuleNotifications();
          toast('Notifications disabled.');
        }
      } catch (e: any) {
        toast(String(e?.message ?? 'Failed to update notifications'));
      }
    },
    [cancelDaily, cancelRuleNotifications, dailyTime, save, scheduleDaily, scheduleRuleNotifications]
  );

  const pickTime = useCallback(
    async (t: DailyTime) => {
      setDailyTime(t);

      try {
        await save(enabled, t);
        if (enabled) {
          const ok = await ensurePermission();
          setPermissionGranted(ok);
          if (!ok) {
            setEnabled(false);
            toast('Notification permission is required.');
            await save(false, t);
            await cancelDaily();
            return;
          }

          await scheduleDaily(t);
          await scheduleRuleNotifications();
          toast('Reminder time updated.');
        }
      } catch (e: any) {
        toast(String(e?.message ?? 'Failed to update reminder time'));
      }
    },
    [cancelDaily, enabled, save, scheduleDaily, scheduleRuleNotifications]
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
              <Text style={styles.muted12}>Daily check-in reminder.</Text>
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
          <Text style={styles.cardTitle}>Reminder time</Text>
          <View style={{ height: 10 }} />

          <View style={styles.pillsRow}>
            {timePresets.map((t) => {
              const active = t.hour === dailyTime.hour && t.minute === dailyTime.minute;
              return (
                <Pressable key={formatTime(t)} onPress={() => void pickTime(t)}>
                  <Pill dot={active}>{formatTime(t)}</Pill>
                </Pressable>
              );
            })}
          </View>

          <View style={{ height: 12 }} />
          <Text style={styles.muted12}>Current: {formatTime(dailyTime)}</Text>

          <View style={{ height: 10 }} />
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
          <Button
            title="Reschedule reminders now"
            full
            onPress={async () => {
              try {
                const ok = await ensurePermission();
                setPermissionGranted(ok);
                if (!ok) {
                  toast('Notification permission is required.');
                  return;
                }
                await scheduleRuleNotifications();
                toast('Reminders rescheduled.');
              } catch (e: any) {
                toast(String(e?.message ?? 'Failed to reschedule reminders'));
              }
            }}
          />

          <View style={{ height: 10 }} />
          <Button
            title="Debug: show scheduled notifications"
            full
            onPress={async () => {
              try {
                const all = await Notifications.getAllScheduledNotificationsAsync();
                const now = new Date();

                const next = all
                  .map(n => getTriggerFireTimeMs((n as any).trigger, now))
                  .filter((x): x is number => typeof x === 'number')
                  .sort((a, b) => a - b)[0];

                const nextText = next ? new Date(next).toLocaleString() : 'unknown';
                const counts = all.reduce(
                  (acc: Record<string, number>, n) => {
                    const t: any = n.trigger;
                    const key = String(t?.type ?? (t?.date ? 'date' : t?.hour != null ? 'calendar' : 'unknown'));
                    acc[key] = (acc[key] ?? 0) + 1;
                    return acc;
                  },
                  {}
                );
                const summary = Object.entries(counts)
                  .map(([k, v]) => `${k}:${v}`)
                  .join(', ');

                const lines = all
                  .slice(0, 4)
                  .map(n => {
                    const t: any = (n as any).trigger;
                    const fire = getTriggerFireTimeMs(t, now);
                    const fireTxt = fire ? new Date(fire).toLocaleString() : 'unknown';
                    const title = String((n as any).content?.title ?? '');
                    const type = String(t?.type ?? 'unknown');
                    return `${type} | ${fireTxt} | ${title}`.trim();
                  })
                  .filter(Boolean)
                  .join('\n');

                toast(`Scheduled: ${all.length} (${summary}). Next: ${nextText}${lines ? `\n${lines}` : ''}`);
              } catch (e: any) {
                toast(String(e?.message ?? 'Failed to read scheduled notifications'));
              }
            }}
          />

          <View style={{ height: 10 }} />
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
                const due = dash.nextGoal?.dueAt ? new Date(dash.nextGoal.dueAt) : null;
                if (!due || Number.isNaN(due.getTime()) || daysUntil(due) !== 1) {
                  toast('Next goal is not due tomorrow.');
                  return;
                }

                await scheduleAt(KEY_GOAL_DUE_ID, new Date(Date.now() + 60_000), {
                  title: 'Goal due tomorrow',
                  body: `${dash.nextGoal.title}`,
                });
                toast('Goal reminder scheduled (60s).');
              } catch (e: any) {
                toast(String(e?.message ?? 'Failed to schedule goal reminder'));
              }
            }}
          />
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
});
