import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { colors } from '../theme/colors';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import { getFailedGoalsMap, type FailedReason } from '../motivation/failedGoals';

type Goal = authApi.GoalItem;

function displayGoalTitle(raw: string) {
  const first = String(raw ?? '').split(/\r?\n/)[0] ?? '';
  const idx = first.toLowerCase().indexOf('steps:');
  const cleaned = (idx >= 0 ? first.slice(0, idx) : first).trim();
  return cleaned || 'Untitled goal';
}

function isExpiredDueAt(dueAt: string | null | undefined) {
  if (!dueAt) return false;
  const t = new Date(dueAt).getTime();
  return Number.isFinite(t) && t > 0 && t < Date.now();
}

export function GoalsDetailsScreen() {
  const nav = useNavigation<any>();
  const { state } = useAuth();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [failedMap, setFailedMap] = useState<Record<string, FailedReason>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;
    setLoading(true);
    try {
      const [resp, fm] = await Promise.all([authApi.listGoals(token, { includeDeleted: true }), getFailedGoalsMap()]);
      setGoals(resp.goals ?? []);
      setFailedMap(fm);
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

  const computed = useMemo(() => {
    const total = goals.length;
    const completed = goals.filter(g => g.completed).length;

    const failed = goals.filter(g => {
      if (g.completed) return false;
      const r = failedMap[g.id];
      if (r) return true;
      return isExpiredDueAt(g.dueAt);
    }).length;

    const active = total - completed - failed;

    return { total, completed, failed, active };
  }, [failedMap, goals]);

  const rows = useMemo(() => {
    const existing = goals.filter(g => !g.deletedAt);

    return existing
      .slice()
      .sort((a, b) => {
        const aT = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
        const bT = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
        if (Number.isFinite(aT) && Number.isFinite(bT) && aT !== bT) return aT - bT;
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return displayGoalTitle(a.title).localeCompare(displayGoalTitle(b.title));
      });
  }, [goals]);

  function statusForGoal(g: Goal) {
    if (g.completed) return { label: 'Completed', reason: null as string | null };
    const r = failedMap[g.id] ?? (isExpiredDueAt(g.dueAt) ? 'expired' : null);
    if (r) return { label: 'Failed', reason: r === 'gave_up' ? 'Gave up' : 'Expired' };
    return { label: 'Active', reason: null as string | null };
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.hTitle}>Goals details</Text>
          <Pressable onPress={() => nav.goBack()} style={({ pressed }) => [styles.iconBtn, pressed ? { opacity: 0.85 } : null]}>
            <Text style={styles.iconText}>←</Text>
          </Pressable>
        </View>

        <Card>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Summary</Text>
            <Badge>{loading ? 'Loading…' : `${computed.total} goals`}</Badge>
          </View>
          <View style={{ height: 10 }} />
          <Text style={styles.meta}>Total goals: {computed.total}</Text>
          <Text style={styles.meta}>Active: {computed.active}</Text>
          <Text style={styles.meta}>Completed: {computed.completed}</Text>
          <Text style={styles.meta}>Failed: {computed.failed}</Text>
        </Card>

        <Card>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>All goals</Text>
            <Badge>{rows.length}</Badge>
          </View>

          <View style={{ height: 10 }} />

          {rows.length === 0 ? <Text style={styles.meta}>No goals.</Text> : null}

          <View style={{ gap: 10 }}>
            {rows.map(g => {
              const st = statusForGoal(g);
              return (
                <Pressable
                  key={g.id}
                  onPress={() => nav.navigate('GoalDetail', { id: g.id, title: g.title })}
                  style={({ pressed }) => [styles.item, pressed ? { opacity: 0.85 } : null]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{displayGoalTitle(g.title)}</Text>
                    <Text style={styles.meta}>
                      {st.label}
                      {st.reason ? ` · ${st.reason}` : ''}
                      {g.dueAt ? ` · Due: ${new Date(g.dueAt).toLocaleDateString()}` : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
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
    justifyContent: 'space-between',
    gap: 12,
  },
  hTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    color: colors.text,
    fontSize: 18,
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
  meta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
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
});
