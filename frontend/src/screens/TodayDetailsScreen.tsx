import React, { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Pill } from '../components/Pill';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import { applyStepToggle } from '../motivation/progress';
import { messageForProgressEvent } from '../motivation/messages';
import { getFailedGoalsMap, type FailedReason } from '../motivation/failedGoals';

type ItemType = 'event' | 'goal' | 'step';

type Item = {
  id: string;
  type: ItemType;
  name: string;
  meta: string;
  seriesId?: string | null;
  goalId?: string;
  goalTitle?: string;
  doneToday?: boolean;
};

export function TodayDetailsScreen() {
  const nav = useNavigation();

  const { state } = useAuth();
  const [dash, setDash] = useState<authApi.DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failedMap, setFailedMap] = useState<Record<string, FailedReason>>({});

  const [confirm, setConfirm] = useState<{ open: boolean; item?: Item }>({ open: false });

  const refresh = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;

    setLoading(true);
    try {
      const [resp, fm] = await Promise.all([authApi.getDashboard(token), getFailedGoalsMap()]);
      setDash(resp);
      setFailedMap(fm);
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [state.accessToken]);

  function isExpiredDueAt(dueAt: string | null | undefined) {
    if (!dueAt) return false;
    const t = new Date(dueAt).getTime();
    if (!Number.isFinite(t) || t <= 0) return false;
    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    const due0 = new Date(t);
    due0.setHours(0, 0, 0, 0);
    return due0.getTime() < today0.getTime();
  }

  function isFailedGoal(goalId: string, dueAt: string | null | undefined) {
    const r = failedMap[String(goalId)];
    if (r === 'gave_up') return true;
    if (isExpiredDueAt(dueAt)) return true;
    return false;
  }

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

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
    const startTxt = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const endTxt = end ? end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
    return endTxt ? `${startTxt} – ${endTxt}` : startTxt;
  }

  const items = useMemo<Item[]>(() => {
    const events = (dash?.todayEvents ?? []).map(e => ({
      id: e.id,
      type: 'event' as const,
      name: e.repeat ? `${e.title} (${e.repeat})` : e.title,
      meta: formatTimeRange(e.startAt, e.endAt),
      seriesId: (e as any).seriesId ?? null,
    }));

    const allowedGoals = (dash?.todayGoals ?? []).filter(g => {
      if (isExpiredDueAt(g.dueAt)) return false;
      return !isFailedGoal(String(g.id), g.dueAt);
    });

    const goals = allowedGoals.map(g => ({
      id: g.id,
      type: 'goal' as const,
      name: g.title,
      meta: g.dueAt ? formatDueBadge(g.dueAt) : 'No due date',
    }));

    const steps = (dash?.todaySteps ?? [])
      .filter(s => {
        const goalId = String(s.goalId);
        const r = failedMap[goalId];
        if (r === 'gave_up') return false;
        return true;
      })
      .map(s => ({
        id: s.id,
        goalId: s.goalId,
        goalTitle: s.goalTitle,
        type: 'step' as const,
        name: s.text,
        meta: s.dueAt ? formatDueBadge(s.dueAt) : s.repeat ? `Repeat: ${s.repeat}` : 'Step',
        doneToday: s.doneToday,
      }));

    return [...events, ...goals, ...steps];
  }, [dash?.todayEvents, dash?.todayGoals, dash?.todaySteps, failedMap]);

  const confirmText = useMemo(() => {
    if (!confirm.item) return 'Are you sure you want to delete this item?';
    return confirm.item.type === 'event'
      ? 'Are you sure you want to delete this event?'
      : 'Are you sure you want to delete this goal?';
  }, [confirm.item]);

  function requestDelete(item: Item) {
    setConfirm({ open: true, item });
  }

  function closeConfirm() {
    setConfirm({ open: false });
  }

  async function deleteConfirmed() {
    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }
    if (!confirm.item) return;
    if (confirm.item.type !== 'event') {
      toast('Delete goal (todo)');
      closeConfirm();
      return;
    }

    try {
      const scope = confirm.item.seriesId ? 'series' : 'single';
      await authApi.deleteEvent(token, confirm.item.id, { scope });
      toast('Deleted');
      closeConfirm();
      await refresh();
    } catch (e: any) {
      toast(String(e?.message ?? 'Delete failed'));
    }
  }

  async function toggleStepDone(item: Item) {
    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }
    if (item.type !== 'step' || !item.goalId) return;

    try {
      const localEv = await applyStepToggle({ done: !item.doneToday });
      await authApi.toggleGoalStepCompletion(token, {
        goalId: item.goalId,
        stepId: item.id,
        dateIso: new Date().toISOString(),
        done: !item.doneToday,
      });
      await refresh();
      toast(messageForProgressEvent(localEv));
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed'));
    }
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hTitle}>Details (Todo today)</Text>
            <View style={styles.hSub}>
              <Pill dot>Events & goals today</Pill>
              {loading ? <Pill>Loading…</Pill> : null}
            </View>
          </View>
          <Pressable
            onPress={() => (nav as any).goBack()}
            style={({ pressed }) => [styles.iconBtn, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={styles.iconText}>←</Text>
          </Pressable>
        </View>

        <Card>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>List of events today</Text>
          </View>

          <View style={{ height: 10 }} />

          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 10 }} nestedScrollEnabled>
            {items.length === 0 ? (
              <Text style={styles.meta}>Nothing planned for today.</Text>
            ) : (
              items.map(item => (
                <View key={`${item.type}_${item.id}`} style={styles.item}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={styles.meta}>{item.meta}</Text>
                  </View>

                  <View style={styles.actions}>
                    {item.type === 'step' ? (
                      <Button title={item.doneToday ? 'Done' : 'Do'} small onPress={() => toggleStepDone(item)} />
                    ) : null}

                    {item.type === 'step' ? (
                      <Button
                        title="Detail"
                        small
                        onPress={() =>
                          item.goalId ? (nav as any).navigate('GoalDetail', { id: item.goalId, title: item.goalTitle ?? 'Goal detail' }) : null
                        }
                      />
                    ) : null}

                    {item.type === 'goal' ? (
                      <Button title="Detail" small onPress={() => (nav as any).navigate('GoalDetail', { id: item.id, title: item.name })} />
                    ) : item.type === 'event' ? (
                      <Button
                        title="Detail"
                        small
                        onPress={() => (nav as any).navigate('Tabs', { screen: 'Calendar', params: { openEventId: item.id } })}
                      />
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </Card>
      </ScrollView>

      <Modal visible={confirm.open} transparent animationType="fade" onRequestClose={closeConfirm}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeConfirm} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Confirm delete</Text>
              <Pressable onPress={closeConfirm} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.confirmText}>{confirmText}</Text>
            <View style={styles.divider} />
            <View style={styles.confirmRow}>
              <Button title="No" onPress={closeConfirm} />
              <Button title="Yes" variant="danger" onPress={deleteConfirmed} />
            </View>
          </View>
        </View>
      </Modal>
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
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  hSub: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
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
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 14,
  },
  name: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 16,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  close: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  confirmText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 12,
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
});
