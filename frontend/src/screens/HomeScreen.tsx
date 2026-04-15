import React, { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Pill } from '../components/Pill';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { ProgressBar } from '../components/ProgressBar';
import { toast } from '../utils/toast';
import { AiPlannerModal } from '../components/AiPlannerModal';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import type { RootStackParamList } from '../navigation/types';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { clearInbox, getInbox, removeInboxItem } from '../notifications/inbox';
import * as Notifications from 'expo-notifications';
import { listRecommendations, upsertRecommendation } from '../ai/recommendations';
import { getLocalProgress, type LocalProgress } from '../motivation/progress';
import { getFailedGoalsMap, type FailedReason } from '../motivation/failedGoals';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function HomeScreen() {
  const nav = useNavigation<Nav>();
  const { state } = useAuth();
  const [aiOpen, setAiOpen] = useState(false);

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifItems, setNotifItems] = useState<Array<{ id: string; title: string; body: string; receivedAt: number; data?: any }>>([]);

  const loadInbox = useCallback(async () => {
    setNotifLoading(true);
    try {
      const items = await getInbox();
      setNotifItems(items);
    } finally {
      setNotifLoading(false);
    }
  }, []);

  const [dash, setDash] = useState<authApi.DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [localProgress, setLocalProgress] = useState<LocalProgress | null>(null);
  const [failedMap, setFailedMap] = useState<Record<string, FailedReason>>({});

  const today = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
    return days[new Date().getDay()];
  }, []);

  const refresh = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;

    setLoading(true);
    try {
      const [resp, fm] = await Promise.all([authApi.getDashboard(token), getFailedGoalsMap()]);
      setDash(resp);
      setFailedMap(fm);
      const lp = await getLocalProgress();
      setLocalProgress(lp);
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [state.accessToken]);

  const createAiRecoFromBehavior = useCallback(async () => {
    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }

    try {
      const goalsResp = await authApi.listGoals(token);
      const goals = goalsResp.goals ?? [];

      const stepsByGoal: Array<{ goalId: string; goalTitle: string; completed: boolean; dueAt: string | null; steps: authApi.GoalStepItem[] }> = [];
      for (const g of goals.slice(0, 12)) {
        const stepResp = await authApi.listGoalSteps(token, g.id);
        stepsByGoal.push({
          goalId: g.id,
          goalTitle: g.title,
          completed: !!g.completed,
          dueAt: g.dueAt ?? null,
          steps: stepResp.steps ?? [],
        });
      }

      const todaySteps = dash?.todaySteps ?? [];
      const todayDone = todaySteps.filter(s => s.doneToday).length;
      const todayTotal = todaySteps.length;

      const summaryLines: string[] = [];
      summaryLines.push(`Score=${dash?.score ?? 0}, tasksPlanned=${dash?.tasksPlanned ?? 0}`);
      summaryLines.push(`Today steps done=${todayDone}/${todayTotal}`);
      summaryLines.push('Goals snapshot:');
      for (const g of stepsByGoal) {
        const stepCount = g.steps.length;
        const due = g.dueAt ? `due=${g.dueAt}` : 'no-due';
        summaryLines.push(`- ${g.completed ? '[Completed]' : '[Active]'} ${g.goalTitle} (${due}, steps=${stepCount})`);
        for (const s of g.steps.slice(0, 8)) {
          const sched = s.dueAt ? `once:${s.dueAt.slice(0, 10)}` : s.repeat ? `repeat:${s.repeat}` : 'none';
          summaryLines.push(`  * ${s.text} [${sched}]`);
        }
      }

      const contextSummary = summaryLines.join('\n');
      const prevRecos = await listRecommendations();
      const recent = prevRecos
        .filter(r => r.status === 'pending' || r.status === 'accepted' || r.status === 'rejected')
        .slice(0, 5);
      const avoidLines: string[] = [];
      if (recent.length) {
        avoidLines.push('Do NOT repeat the following previously recommended goals (choose a different goal topic and different steps):');
        for (const r of recent) {
          const t = String(r.suggestion?.title ?? '').trim();
          const stepTxt = (r.suggestion?.steps ?? [])
            .slice(0, 6)
            .map(s => String(s.text ?? '').trim())
            .filter(Boolean)
            .join(' | ');
          if (t) avoidLines.push(`- ${t}${stepTxt ? ` (steps: ${stepTxt})` : ''}`);
        }
      }

      const prompt =
        'You are a goal coach. Based on the user behavior summary below, suggest ONE new goal with steps. ' +
        'The goal should be realistic and aligned with past completion patterns. Prefer measurable steps. ' +
        'The suggestion should be novel compared to recent recommendations.\n\n' +
        contextSummary +
        (avoidLines.length ? `\n\n${avoidLines.join('\n')}` : '');

      // Let backend AI decide the deadline; we omit deadline here.
      const ai = await authApi.aiSuggestGoal(token, { prompt, intensity: 'Normal' });
      if (!ai.ok) {
        toast(ai.message || 'AI needs more info');
        return;
      }

      const recoId = `reco_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      await upsertRecommendation({
        id: recoId,
        createdAt: Date.now(),
        status: 'pending',
        suggestion: ai.suggestion,
        contextSummary,
      });

      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'SmartGoal recommend a new goal',
          body: ai.suggestion.title,
          data: { type: 'ai_goal_reco', recoId },
        },
        trigger: null,
      });

      toast('SmartGoal recommendation created');
      await loadInbox();
    } catch (e: any) {
      toast(String(e?.message ?? 'AI recommendation failed'));
    }
  }, [dash?.score, dash?.tasksPlanned, dash?.todaySteps, loadInbox, state.accessToken]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const score = dash?.score ?? 0;
  const tasksPlanned = dash?.tasksPlanned ?? 0;
  function isExpiredDueAt(dueAt: string | null | undefined) {
    if (!dueAt) return false;
    const t = new Date(dueAt).getTime();
    return Number.isFinite(t) && t > 0 && t < Date.now();
  }

  const nextGoal = useMemo(() => {
    const g = dash?.nextGoal ?? null;
    if (!g) return null;
    if (isExpiredDueAt(g.dueAt)) return null;
    return g;
  }, [dash?.nextGoal]);
  const nextEvent = dash?.nextEvent ?? null;
  const level = localProgress?.level ?? 1;
  const goalStreakDays = localProgress?.goalStreakDays ?? 0;
  const todayEvents = dash?.todayEvents ?? [];
  const todayGoals = useMemo(() => {
    return (dash?.todayGoals ?? []).filter(g => {
      if (isExpiredDueAt(g.dueAt)) return false;
      const r = failedMap[String(g.id)];
      return !r;
    });
  }, [dash?.todayGoals, failedMap]);
  const todaySteps = useMemo(() => {
    const steps = dash?.todaySteps ?? [];
    const allowedGoalIds = new Set(todayGoals.map(g => String(g.id)));
    return steps.filter(s => allowedGoalIds.has(String(s.goalId)));
  }, [dash?.todaySteps, todayGoals]);

  const stepsByGoal = useMemo(() => {
    const map = new Map<string, { goalTitle: string; steps: typeof todaySteps }>();
    for (const s of todaySteps) {
      const key = String(s.goalId);
      const prev = map.get(key);
      if (prev) {
        prev.steps.push(s);
      } else {
        map.set(key, { goalTitle: s.goalTitle, steps: [s] });
      }
    }
    return Array.from(map.entries()).map(([goalId, v]) => ({ goalId, goalTitle: v.goalTitle, steps: v.steps }));
  }, [todaySteps]);

  function stepMeta(s: (typeof todaySteps)[number]) {
    if (s.dueAt) return formatDueBadge(s.dueAt);
    if (s.repeat) return `Repeat: ${s.repeat}`;
    return 'Step';
  }

  function displayGoalTitle(raw: string) {
    const first = String(raw ?? '').split(/\r?\n/)[0] ?? '';
    const idx = first.toLowerCase().indexOf('steps:');
    const cleaned = (idx >= 0 ? first.slice(0, idx) : first).trim();
    return cleaned || 'Untitled goal';
  }

  function formatDueBadge(dueAt: string | null) {
    if (!dueAt) return 'No due date';
    const due = new Date(dueAt);
    if (Number.isNaN(due.getTime())) return 'Due date';

    const dayMs = 1000 * 60 * 60 * 24;
    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    const due0 = new Date(due);
    due0.setHours(0, 0, 0, 0);
    const days = Math.round((due0.getTime() - today0.getTime()) / dayMs);
    if (Number.isNaN(days)) return 'Due date';
    if (days < 0) return 'Overdue';
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    if (days < 7) return `Due in ${days} days`;
    const weeks = Math.ceil(days / 7);
    return `Due in ${weeks} weeks`;
  }

  function formatTimeRange(startAt: string, endAt: string | null) {
    const start = new Date(startAt);
    const end = endAt ? new Date(endAt) : null;
    const startTxt = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endTxt = end ? end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
    return endTxt ? `${startTxt} – ${endTxt}` : startTxt;
  }

  function formatDateRange(startAt: string, endAt: string | null) {
    const start = new Date(startAt);
    const end = endAt ? new Date(endAt) : null;
    const startDate = start.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
    if (!end) return startDate;
    const endDate = end.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
    return startDate === endDate ? startDate : `${startDate} – ${endDate}`;
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hTitle}>Today</Text>
            <View style={styles.hSub}>
              <Pill dot>{today}</Pill>
              <Pill>
                Score: <Text style={styles.bold}>{score}</Text>
              </Pill>
              <Pill>
                Level: <Text style={styles.bold}>{level}</Text>
              </Pill>
              <Pill>
                Goal streak: <Text style={styles.bold}>{goalStreakDays}</Text>
              </Pill>
              <Pill>
                <Text style={styles.bold}>{tasksPlanned}</Text> {tasksPlanned === 1 ? 'task' : 'tasks'} planned
              </Pill>
              {loading ? <Pill>Loading…</Pill> : null}
            </View>
          </View>

          <Pressable
            onPress={() => {
              setNotifOpen(true);
              void loadInbox();
            }}
            style={({ pressed }) => [styles.iconBtn, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={styles.iconText}>🔔</Text>
          </Pressable>
        </View>

        <View style={{ gap: 12 }}>
          <Pressable
            onPress={() => {
              if (!nextGoal) return;
              nav.navigate('GoalDetail', { id: nextGoal.id, title: nextGoal.title });
            }}
          >
            <Card>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>Next goal</Text>
                <Badge>{nextGoal ? formatDueBadge(nextGoal.dueAt) : 'No goals'}</Badge>
              </View>

              <View style={{ marginTop: 10 }}>
                {nextGoal ? (
                  <View style={styles.titleLine}>
                    <Text style={styles.goalName}>{displayGoalTitle(nextGoal.title)}</Text>
                  </View>
                ) : (
                  <Text style={styles.muted12}>No goals yet. Create one to see it here.</Text>
                )}
              </View>

              {nextGoal ? (
                <View style={{ marginTop: 10 }}>
                  <ProgressBar value={nextGoal.progressPct ?? 0} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                    <Text style={styles.muted12}>Overall: {(nextGoal.progressPct ?? 0).toFixed(2)}%</Text>
                    <Text style={styles.muted12}>
                      Today: {nextGoal.todayPct === null || nextGoal.todayPct === undefined ? '—' : `${nextGoal.todayPct.toFixed(2)}%`}
                    </Text>
                  </View>
                </View>
              ) : null}
            </Card>
          </Pressable>

          <Pressable
            onPress={() => {
              if (!nextEvent) return;
              (nav as any).navigate('Tabs', { screen: 'Calendar', params: { openEventId: nextEvent.id, openEventStartAt: nextEvent.startAt } });
            }}
          >
            <Card>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>Next event</Text>
                <Badge>{nextEvent?.repeat ?? 'Upcoming'}</Badge>
              </View>

              <View style={[styles.row, { marginTop: 10 }]}>
                {nextEvent ? (
                  <>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.eventTitle}>{nextEvent.title}</Text>
                      <Text style={styles.muted12}>{formatDateRange(nextEvent.startAt, nextEvent.endAt)}</Text>
                      <Text style={styles.muted12}>{formatTimeRange(nextEvent.startAt, nextEvent.endAt)}</Text>
                    </View>
                  </>
                ) : (
                  <View style={{ flex: 1 }}>
                    <Text style={styles.muted12}>No upcoming events.</Text>
                  </View>
                )}
              </View>
            </Card>
          </Pressable>

          <Card>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>Todo today</Text>
              <Badge>
                <Text style={styles.bold}>{todayEvents.length + todayGoals.length + todaySteps.length}</Text> items
              </Badge>
            </View>

            <View style={{ marginTop: 10, gap: 10 }}>
              {todayEvents.length === 0 && todayGoals.length === 0 && todaySteps.length === 0 ? (
                <Text style={styles.muted12}>Nothing planned for today.</Text>
              ) : (
                <>
                  {todayEvents.map(e => (
                    <View key={e.id} style={styles.item}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemName}>{e.title}</Text>
                        <Text style={styles.itemMeta}>{formatTimeRange(e.startAt, e.endAt)}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Button
                          title="Detail"
                          small
                          onPress={() => (nav as any).navigate('Tabs', { screen: 'Calendar', params: { openEventId: e.id } })}
                        />
                      </View>
                    </View>
                  ))}

                  {todayGoals.map(g => (
                    <View key={g.id} style={styles.item}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemName}>{displayGoalTitle(g.title)}</Text>
                        <Text style={styles.itemMeta}>{g.dueAt ? formatDueBadge(g.dueAt) : 'No due date'}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Button
                          title="Detail"
                          small
                          onPress={() => nav.navigate('GoalDetail', { id: g.id, title: g.title })}
                        />
                      </View>
                    </View>
                  ))}

                  {stepsByGoal.map(g => (
                    <View key={g.goalId} style={styles.item}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemName}>{displayGoalTitle(g.goalTitle)}</Text>
                        <Text style={styles.itemMeta}>{g.steps.length} step{g.steps.length === 1 ? '' : 's'} today</Text>
                        <View style={{ marginTop: 8, gap: 6 }}>
                          {g.steps.slice(0, 3).map(s => (
                            <Text key={s.id} style={styles.itemMeta}>
                              - {s.text}
                            </Text>
                          ))}
                          {g.steps.length > 3 ? <Text style={styles.itemMeta}>- …</Text> : null}
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Button title="Detail" small onPress={() => nav.navigate('GoalDetail', { id: g.goalId, title: g.goalTitle })} />
                      </View>
                    </View>
                  ))}
                </>
              )}
            </View>

            <View style={{ height: 10 }} />
            <Button title="Details" full onPress={() => nav.navigate('TodayDetails')} />
          </Card>
        </View>
      </ScrollView>

      <AiPlannerModal visible={aiOpen} onClose={() => setAiOpen(false)} onSaved={refresh} />

      <Modal visible={notifOpen} animationType="slide" transparent onRequestClose={() => setNotifOpen(false)}>
        <View style={styles.notifOverlay}>
          <View style={styles.notifModal}>
            <View style={styles.notifHeader}>
              <Text style={styles.notifTitle}>Notifications</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title="New goal" small onPress={createAiRecoFromBehavior} />
                <Button
                  title="Clear"
                  small
                  onPress={async () => {
                    await clearInbox();
                    setNotifItems([]);
                  }}
                />
                <Button title="Close" small onPress={() => setNotifOpen(false)} />
              </View>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
              {notifLoading ? <Text style={styles.notifEmpty}>Loading…</Text> : null}
              {!notifLoading && notifItems.length === 0 ? <Text style={styles.notifEmpty}>No notifications yet.</Text> : null}
              {notifItems.map(n => (
                <Pressable
                  key={n.id}
                  onPress={() => {
                    const d: any = n.data;
                    if (d?.type === 'ai_goal_reco' && d?.recoId) {
                      setNotifOpen(false);
                      (nav as any).navigate('AiGoalRecommendation', { id: String(d.recoId) });
                    }
                  }}
                  style={({ pressed }) => [styles.notifItem, pressed ? { opacity: 0.9 } : null]}
                >
                  <View style={styles.notifItemTopRow}>
                    <Text style={styles.notifItemTitle}>{n.title}</Text>
                    <Button
                      title="Delete"
                      small
                      onPress={async () => {
                        await removeInboxItem(n.id);
                        setNotifItems(prev => prev.filter(x => x.id !== n.id));
                      }}
                    />
                  </View>
                  {n.body ? <Text style={styles.notifItemBody}>{n.body}</Text> : null}
                  <Text style={styles.notifItemWhen}>{new Date(n.receivedAt).toLocaleString()}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Pressable
        onPress={() => setAiOpen(true)}
        accessibilityLabel="Open SmartGoal Planner"
        style={({ pressed }) => [styles.fab, pressed ? { opacity: 0.9 } : null]}
      >
        <Text style={styles.fabText}>✨</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 14,
    paddingBottom: 120,
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  hTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '900',
  },
  hSub: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  bold: {
    color: colors.text,
    fontWeight: '900',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  iconText: {
    fontSize: 22,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  notifOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-start',
    paddingTop: 70,
    paddingHorizontal: 12,
  },
  notifModal: {
    backgroundColor: colors.bg,
    borderRadius: 18,
    padding: 16,
    maxHeight: '75%',
  },
  notifHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  notifTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  notifEmpty: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 12,
  },
  notifItem: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
    marginTop: 12,
  },
  notifItemTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  notifItemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  notifItemBody: {
    marginTop: 6,
    color: colors.text,
    fontSize: 12,
  },
  notifItemWhen: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 12,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  goalName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  muted12: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  eventTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  item: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 14,
  },
  itemName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  itemMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 84,
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: {
    fontSize: 20,
    fontWeight: '900',
  },
});
