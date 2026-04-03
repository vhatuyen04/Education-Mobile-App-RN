import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function HomeScreen() {
  const nav = useNavigation<Nav>();
  const { state } = useAuth();
  const [aiOpen, setAiOpen] = useState(false);

  const [dash, setDash] = useState<authApi.DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const today = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
    return days[new Date().getDay()];
  }, []);

  const refresh = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;

    setLoading(true);
    try {
      const resp = await authApi.getDashboard(token);
      setDash(resp);
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [state.accessToken]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const score = dash?.score ?? 0;
  const tasksPlanned = dash?.tasksPlanned ?? 0;
  const nextGoal = dash?.nextGoal ?? null;
  const nextEvent = dash?.nextEvent ?? null;
  const todayEvents = dash?.todayEvents ?? [];
  const todayGoals = dash?.todayGoals ?? [];

  function displayGoalTitle(raw: string) {
    const first = String(raw ?? '').split(/\r?\n/)[0] ?? '';
    return first.trim() || 'Untitled goal';
  }

  function formatDueBadge(dueAt: string | null) {
    if (!dueAt) return 'No due date';
    const due = new Date(dueAt);
    const ms = due.getTime() - Date.now();
    const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
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
                <Text style={styles.bold}>{tasksPlanned}</Text> {tasksPlanned === 1 ? 'task' : 'tasks'} planned
              </Pill>
              {loading ? <Pill>Loading…</Pill> : null}
            </View>
          </View>

          <Pressable
            onPress={() => toast('No notifications in prototype')}
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
            </Card>
          </Pressable>

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

          <Card>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>Todo today</Text>
              <Badge>
                <Text style={styles.bold}>{todayEvents.length + todayGoals.length}</Text> items
              </Badge>
            </View>

            <View style={{ marginTop: 10, gap: 10 }}>
              {todayEvents.length === 0 && todayGoals.length === 0 ? (
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
                        <Button title="Detail" small onPress={() => toast('Event details (todo)')} />
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
                </>
              )}
            </View>

            <View style={{ height: 10 }} />
            <Button title="Details" full onPress={() => nav.navigate('TodayDetails')} />
          </Card>
        </View>
      </ScrollView>

      <AiPlannerModal visible={aiOpen} onClose={() => setAiOpen(false)} onSaved={refresh} />

      <Pressable onPress={() => setAiOpen(true)} style={({ pressed }) => [styles.fab, pressed ? { opacity: 0.9 } : null]}>
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
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 16,
  },
  cardTitleRow: {
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
