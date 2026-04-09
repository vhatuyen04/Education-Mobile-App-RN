import React, { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
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
import { messageForProgressEvent } from '../motivation/messages';
import { isAppGoal, unmarkAppGoal } from '../motivation/appGoals';
import { getLocalProgress, setLocalProgress } from '../motivation/progress';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Goal = authApi.GoalItem;

export function GoalsScreen() {
  const nav = useNavigation<Nav>();
  const { state } = useAuth();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(false);

  const activeCount = useMemo(() => goals.filter(g => !g.completed).length, [goals]);
  const [confirm, setConfirm] = useState<{ open: boolean; goal?: Goal }>({ open: false });

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
      const resp = await authApi.listGoals(token);
      setGoals(resp.goals);
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

  function openGoal(g: Goal) {
    nav.navigate('GoalDetail', { id: g.id, title: g.title });
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
      const before = await authApi.getDashboard(token);
      await authApi.updateGoal(token, g.id, { completed: true });
      const after = await authApi.getDashboard(token);
      await refresh();

      const scoreDelta = (after?.score ?? 0) - (before?.score ?? 0);
      const app = await isAppGoal(g.id);
      if (app) {
        const localEv = await applyGoalCompletedBonus();
        const msg = messageForProgressEvent(localEv);
        toast(scoreDelta > 0 ? `${msg} +${scoreDelta} points.` : msg);
      } else {
        toast(scoreDelta > 0 ? `Completed. +${scoreDelta} points.` : 'Completed.');
      }
    } catch (e: any) {
      toast(String(e?.message ?? 'Complete failed'));
    } finally {
      setLoading(false);
    }
  }

  function requestDelete(g: Goal) {
    setConfirm({ open: true, goal: g });
  }

  function closeConfirm() {
    setConfirm({ open: false });
  }

  async function deleteConfirmed() {
    if (!confirm.goal) return;
    if (loading) return;
    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }

    setLoading(true);
    try {
      const app = await isAppGoal(confirm.goal.id);
      await authApi.deleteGoal(token, confirm.goal.id);
      if (app) {
        await unmarkAppGoal(confirm.goal.id);
        const p = await getLocalProgress();
        await setLocalProgress({ ...p, goalStreakDays: 0, lastGoalCompletedYmd: null });
      }
      await refresh();
      toast('Deleted');
      closeConfirm();
    } catch (e: any) {
      toast(String(e?.message ?? 'Delete failed'));
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
            <Badge>{activeCount} active</Badge>
          </View>

          <View style={{ height: 10 }} />

          <View style={{ gap: 10 }}>
            {loading ? (
              <Text style={styles.meta}>Loading…</Text>
            ) : goals.length === 0 ? (
              <Text style={styles.meta}>No goals yet.</Text>
            ) : (
              goals.map(g => (
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
                  <Pressable
                    onPress={e => {
                      e.stopPropagation();
                      completeGoal(g);
                    }}
                    style={({ pressed }) => [styles.tinyBtn, pressed ? { opacity: 0.85 } : null]}
                  >
                    <Text style={styles.tinyBtnText}>✓</Text>
                  </Pressable>

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
              ))
            )}
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
              <Text style={styles.sheetTitle}>Confirm delete</Text>
              <Pressable onPress={closeConfirm} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.confirmText}>Are you sure you want to delete this goal? (You may lose points in that category.)</Text>
            <View style={styles.divider} />
            <View style={styles.rowEnd}>
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
