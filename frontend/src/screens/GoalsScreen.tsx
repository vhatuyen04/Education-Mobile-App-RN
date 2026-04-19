import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import type { RootStackParamList } from '../navigation/types';
import { applyGoalCompletedBonus } from '../motivation/progress';
import { messageForCustomGoalCompleted, messageForProgressEvent } from '../motivation/messages';
import { isAppGoal, markAppGoal, unmarkAppGoal } from '../motivation/appGoals';
import { getLocalProgress, setLocalProgress } from '../motivation/progress';
import { appendScorePoint } from '../motivation/scoreHistory';
import { appendInbox } from '../notifications/inbox';
import { getFailedGoalsMap, markFailedGoal, type FailedReason, unmarkFailedGoal } from '../motivation/failedGoals';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Goal = authApi.GoalItem;

export function GoalsScreen() {
  const nav = useNavigation<Nav>();
  const { state } = useAuth();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(false);
  const [smartGoalIds, setSmartGoalIds] = useState<Set<string>>(new Set());
  const [failedMap, setFailedMap] = useState<Record<string, FailedReason>>({});

  const failedGoals = useMemo(() => {
    return goals.filter(g => {
      if (g.deletedAt) return false;
      if (g.completed) return false;
      if (g.failedAt) return true;
      const reason = failedMap[g.id];
      return !!reason;
    });
  }, [failedMap, goals]);

  const activeGoals = useMemo(() => {
    const failedIds = new Set(failedGoals.map(g => g.id));
    return goals.filter(g => !g.deletedAt && !g.completed && !failedIds.has(g.id));
  }, [failedGoals, goals]);

  const activeCount = useMemo(() => activeGoals.length, [activeGoals.length]);
  const completedCount = useMemo(() => goals.filter(g => g.completed).length, [goals]);
  const completedGoals = useMemo(() => goals.filter(g => !g.deletedAt && g.completed), [goals]);
  const [confirm, setConfirm] = useState<{
    open: boolean;
    goal?: Goal;
    action?: 'delete' | 'complete' | 'quit';
    xpLoss?: number;
  }>({ open: false });

  const SMARTGOAL_QUIT_XP_LOSS = 50;

  function displayGoalTitle(raw: string) {
    const first = String(raw ?? '').split(/\r?\n/)[0] ?? '';
    const idx = first.toLowerCase().indexOf('steps:');
    const cleaned = (idx >= 0 ? first.slice(0, idx) : first).trim();
    return cleaned || 'Untitled goal';
  }

  const refresh = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;

    setLoading(true);
    try {
      const fm = await getFailedGoalsMap();
      const resp = await authApi.listGoals(token, { includeDeleted: true, includeFailed: true });
      const list = resp.goals ?? [];
      setGoals(list);

      const now = Date.now();
      for (const g of list) {
        if (g.completed) continue;
        if (g.deletedAt) continue;
        if (g.failedAt) continue;
        if (!g.dueAt) continue;
        const t = new Date(g.dueAt).getTime();
        if (!Number.isFinite(t) || t <= 0) continue;
        if (t >= now) continue;

        try {
          await authApi.failGoal(token, g.id, { reason: 'EXPIRED' });
        } catch {
          // ignore
        }

        if (!fm[g.id]) {
          fm[g.id] = 'expired';
          await markFailedGoal(g.id, 'expired');
          await appendInbox({
            id: `goal_expired_${g.id}`,
            receivedAt: Date.now(),
            title: 'Goal expired',
            body: `${displayGoalTitle(g.title)} has expired.`,
            data: { type: 'goal_expired', goalId: g.id },
          });
        }
      }

      setFailedMap(fm);

      const inferredIds = await Promise.all(
        list.map(async g => {
          const already = await isAppGoal(g.id);
          if (already) return g.id;

          const desc = String(g.description ?? '').toLowerCase();
          if (desc.includes('ai recommended goal') || desc.includes('smartgoal')) {
            await markAppGoal(g.id);
            return g.id;
          }
          return null;
        })
      );

      const ids = new Set<string>(inferredIds.filter(Boolean) as string[]);
      setSmartGoalIds(ids);
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [state.accessToken]);

  async function applySmartGoalXpLoss(goalId: string, xpLoss: number) {
    if (xpLoss <= 0) return;
    const app = await isAppGoal(goalId);
    if (!app) return;
    const p = await getLocalProgress();
    const nextXp = Math.max(0, Number(p.xp ?? 0) - xpLoss);
    await setLocalProgress({ ...p, xp: nextXp });
  }

  async function requestComplete(g: Goal) {
    try {
      const key = `goal_complete_confirmed_v1_${String(g.id ?? '').trim() || 'new'}`;
      const raw = await AsyncStorage.getItem(key);
      if (raw === '1') {
        await completeGoal(g);
        return;
      }
    } catch {
    }
    setConfirm({ open: true, goal: g, action: 'complete' });
  }

  async function requestQuit(g: Goal) {
    const app = await isAppGoal(g.id);
    setConfirm({ open: true, goal: g, action: 'quit', xpLoss: app ? SMARTGOAL_QUIT_XP_LOSS : 0 });
  }

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  function openGoal(g: Goal) {
    nav.navigate('GoalDetail', { id: g.id, title: g.title });
  }

  function goalTypeLabel(g: Goal) {
    return smartGoalIds.has(g.id) ? 'SmartGoal' : 'Custom';
  }

  async function completeGoal(g: Goal) {
    if (loading) return;
    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }

    setLoading(true);
    try {
      const app = await isAppGoal(g.id);
      if (app) {
        setConfirm({ open: false });
        nav.navigate('SmartGoalProof', {
          goalId: g.id,
          goalTitle: g.title,
          requirementText: (g as any).requirement ?? null,
        });
        return;
      }
      await authApi.updateGoal(token, g.id, { completed: true });

      const msg = messageForCustomGoalCompleted();
      toast(msg);

      await refresh();
    } catch (e: any) {
      toast(String(e?.message ?? 'Complete failed'));
    } finally {
      setLoading(false);
    }
  }

  function requestDelete(g: Goal) {
    setConfirm({ open: true, goal: g, action: 'delete', xpLoss: 0 });
  }

  function closeConfirm() {
    setConfirm({ open: false });
  }

  async function confirmAction() {
    if (!confirm.goal || !confirm.action) return;
    if (loading) return;
    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }

    setLoading(true);
    try {
      if (confirm.action === 'complete') {
        try {
          const key = `goal_complete_confirmed_v1_${String(confirm.goal.id ?? '').trim() || 'new'}`;
          await AsyncStorage.setItem(key, '1');
        } catch {
        }
        await completeGoal(confirm.goal);
        closeConfirm();
        return;
      }

      if (confirm.action === 'quit') {
        await authApi.failGoal(token, confirm.goal.id, { reason: 'GAVE_UP' });
        await markFailedGoal(confirm.goal.id, 'gave_up');
        await applySmartGoalXpLoss(confirm.goal.id, Number(confirm.xpLoss ?? 0));
        setFailedMap(prev => ({ ...prev, [confirm.goal!.id]: 'gave_up' }));
        toast('Moved to Failed');
        closeConfirm();
        await refresh();
        return;
      }

      const app = await isAppGoal(confirm.goal.id);
      await authApi.deleteGoal(token, confirm.goal.id);
      await unmarkFailedGoal(confirm.goal.id);
      if (app) {
        await unmarkAppGoal(confirm.goal.id);
        const p = await getLocalProgress();
        await setLocalProgress({ ...p, goalStreakDays: 0, lastGoalCompletedYmd: null });
      }
      await refresh();
      toast('Deleted');
      closeConfirm();
    } catch (e: any) {
      toast(String(e?.message ?? 'Action failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.hTitle}>Goals</Text>
          </View>
        </View>

        <Card>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>List of goals</Text>
            <Badge>
              {activeCount} active · {completedCount} completed
            </Badge>
          </View>

          <View style={{ height: 10 }} />

          <View style={{ gap: 10 }}>
            {loading ? <Text style={styles.meta}>Loading…</Text> : null}
            {!loading && goals.filter(g => !g.deletedAt).length === 0 ? <Text style={styles.meta}>No goals yet.</Text> : null}

            {!loading && activeGoals.length > 0 ? <Text style={styles.sectionTitle}>Active goals</Text> : null}
            {activeGoals.map(g => (
              <Pressable
                key={g.id}
                onPress={() => openGoal(g)}
                style={({ pressed }) => [styles.item, pressed ? { opacity: 0.85 } : null]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{displayGoalTitle(g.title)}</Text>
                  <Text style={styles.meta}>Completed: {g.progressPct}% steps</Text>
                </View>

                <View style={styles.goalActions}>
                  <Badge>{goalTypeLabel(g)}</Badge>
                  <Pressable
                    onPress={e => {
                      e.stopPropagation();
                      requestComplete(g);
                    }}
                    style={({ pressed }) => [styles.tinyBtn, pressed ? { opacity: 0.85 } : null]}
                  >
                    <Text style={styles.tinyBtnText}>✓</Text>
                  </Pressable>

                  <Pressable
                    onPress={e => {
                      e.stopPropagation();
                      void requestQuit(g);
                    }}
                    style={({ pressed }) => [styles.tinyBtn, pressed ? { opacity: 0.85 } : null]}
                  >
                    <Text style={styles.tinyBtnText}>✕</Text>
                  </Pressable>
                </View>
              </Pressable>
            ))}

            {!loading && failedGoals.length > 0 ? <Text style={styles.sectionTitle}>Failed goals</Text> : null}
            {failedGoals.map(g => (
              <Pressable
                key={g.id}
                onPress={() => openGoal(g)}
                style={({ pressed }) => [styles.item, pressed ? { opacity: 0.85 } : null]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{displayGoalTitle(g.title)}</Text>
                  <Text style={styles.meta}>Reason: {failedMap[g.id] === 'gave_up' ? 'Gave up' : 'Expired'}</Text>
                </View>

                <View style={styles.goalActions}>
                  <Badge>{goalTypeLabel(g)}</Badge>
                  <Pressable
                    onPress={e => {
                      e.stopPropagation();
                      requestDelete(g);
                    }}
                    style={({ pressed }) => [styles.tinyBtn, styles.tinyDanger, pressed ? { opacity: 0.85 } : null]}
                  >
                    <Text style={[styles.tinyBtnText, { color: '#1a0a0f' }]}>🗑</Text>
                  </Pressable>
                </View>
              </Pressable>
            ))}

            {!loading && completedGoals.length > 0 ? <Text style={styles.sectionTitle}>Completed goals</Text> : null}
            {completedGoals.map(g => (
              <Pressable
                key={g.id}
                onPress={() => openGoal(g)}
                style={({ pressed }) => [styles.item, pressed ? { opacity: 0.85 } : null]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{displayGoalTitle(g.title)}</Text>
                  <Text style={styles.meta}>Completed: {g.progressPct}% steps</Text>
                </View>

                <View style={styles.goalActions}>
                  <Badge>{goalTypeLabel(g)}</Badge>
                  <Pressable
                    onPress={e => {
                      e.stopPropagation();
                      requestDelete(g);
                    }}
                    style={({ pressed }) => [styles.tinyBtn, styles.tinyDanger, pressed ? { opacity: 0.85 } : null]}
                  >
                    <Text style={[styles.tinyBtnText, { color: '#1a0a0f' }]}>🗑</Text>
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </View>

        </Card>
      </ScrollView>

      <Pressable
        onPress={() => nav.navigate('GoalDetail', { title: 'New goal' })}
        style={({ pressed }) => [styles.fab, pressed ? { opacity: 0.9 } : null]}
      >
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <Modal visible={confirm.open} transparent animationType="fade" onRequestClose={closeConfirm}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeConfirm} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>
                {confirm.action === 'complete' ? 'Confirm complete' : confirm.action === 'quit' ? 'Confirm quit' : 'Confirm delete'}
              </Text>
              <Pressable onPress={closeConfirm} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            {confirm.action === 'complete' ? (
              <Text style={styles.confirmText}>Are you sure you completed this goal?</Text>
            ) : confirm.action === 'quit' ? (
              <Text style={styles.confirmText}>
                Are you sure you want to quit this goal?
                {confirm.xpLoss ? ` You will lose ${confirm.xpLoss} XP.` : ''}
              </Text>
            ) : (
              <Text style={styles.confirmText}>
                Do you want to remove this goal from the screen?
              </Text>
            )}
            <View style={styles.divider} />
            <View style={styles.rowEnd}>
              <Button title="No" onPress={closeConfirm} />
              <Button
                title="Yes"
                variant={confirm.action === 'complete' ? 'primary' : 'danger'}
                onPress={confirmAction}
              />
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
  sectionTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 6,
  },
  goalActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  tinyBtn: {
    width: 32,
    height: 28,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tinyDanger: {
    backgroundColor: colors.danger,
    borderColor: 'transparent',
  },
  tinyBtnText: {
    color: colors.text,
    fontWeight: '900',
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
    fontSize: 22,
    fontWeight: '900',
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
  rowEnd: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    alignItems: 'center',
  },
});
