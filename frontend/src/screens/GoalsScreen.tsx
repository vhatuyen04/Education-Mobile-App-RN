import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { toast } from '../utils/toast';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Goal = {
  id: string;
  title: string;
  completedPct: number;
};

export function GoalsScreen() {
  const nav = useNavigation<Nav>();

  const [goals, setGoals] = useState<Goal[]>([
    { id: 'g1', title: 'Challenge LoL', completedPct: 58 },
    { id: 'g2', title: '6.5 IELTS', completedPct: 70 },
    { id: 'g3', title: 'Thesis writing', completedPct: 24 },
    { id: 'g4', title: 'Run 20km/week', completedPct: 45 },
    { id: 'g5', title: 'Learn Flutter', completedPct: 62 },
    { id: 'g6', title: 'No sugar week', completedPct: 10 },
    { id: 'g7', title: 'Read 12 books', completedPct: 33 },
    { id: 'g8', title: 'Meditate daily', completedPct: 58 },
  ]);

  const activeCount = useMemo(() => goals.length, [goals.length]);
  const [confirm, setConfirm] = useState<{ open: boolean; goal?: Goal }>({ open: false });

  function openGoal(g: Goal) {
    nav.navigate('GoalDetail', { id: g.id, title: g.title });
  }

  function completeGoal(g: Goal) {
    toast('Complete (demo)');
  }

  function requestDelete(g: Goal) {
    setConfirm({ open: true, goal: g });
  }

  function closeConfirm() {
    setConfirm({ open: false });
  }

  function deleteConfirmed() {
    if (!confirm.goal) return;
    setGoals(prev => prev.filter(x => x.id !== confirm.goal!.id));
    toast('Deleted (demo)');
    closeConfirm();
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
            {goals.map(g => (
              <Pressable
                key={g.id}
                onPress={() => openGoal(g)}
                style={({ pressed }) => [styles.item, pressed ? { opacity: 0.85 } : null]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{g.title}</Text>
                  <Text style={styles.meta}>Completed: {g.completedPct}% steps</Text>
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
