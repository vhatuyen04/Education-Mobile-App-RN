import React, { useCallback, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Pill } from '../components/Pill';
import { colors } from '../theme/colors';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import { getFailedGoalsMap, type FailedReason } from '../motivation/failedGoals';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';

type Goal = authApi.GoalItem;

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
}

function TrendChart({ data }: { data: authApi.ScoreHistoryPoint[] }) {
  const normalized = useMemo(() => {
    const cleaned = (Array.isArray(data) ? data : [])
      .map(d => ({ ts: Number((d as any).ts ?? 0), score: Number((d as any).score ?? 0) }))
      .filter(d => Number.isFinite(d.ts) && d.ts > 0 && Number.isFinite(d.score));
    return cleaned.slice(-30);
  }, [data]);

  const scores = useMemo(() => normalized.map(d => d.score), [normalized]);
  const max = useMemo(() => Math.max(1, ...scores, 1), [scores]);
  const range = useMemo(() => max + Math.max(1, Math.ceil(max * 0.2)), [max]);

  // Render area constants
  const W = 320;
  const H = 140;
  const padX = 10;
  const padY = 12;

  const coords = useMemo(() => {
    if (normalized.length === 0) return [] as Array<{ x: number; y: number; ts: number; v: number }>;
    const n = normalized.length;
    const dx = n <= 1 ? 0 : (W - padX * 2) / (n - 1);
    return normalized.map((d, i) => {
      const x = n === 1 ? W / 2 : padX + dx * i;
      const norm = clamp01(d.score / range);
      const y = padY + (1 - norm) * (H - padY * 2);
      return { x, y, ts: d.ts, v: d.score };
    });
  }, [H, W, normalized, range]);

  const bottomY = H - padY;

  const stepSegs = useMemo(() => {
    const h: Array<{ left: number; top: number; width: number }> = [];
    const v: Array<{ left: number; top: number; height: number }> = [];
    if (coords.length === 0) return { h, v };

    // Start from baseline (0) at the left, move to first point x, then rise to its y.
    const first = coords[0];
    h.push({ left: padX, top: bottomY - 1, width: Math.max(1, first.x - padX) });
    v.push({ left: first.x - 1, top: Math.min(first.y, bottomY), height: Math.max(1, bottomY - first.y) });

    // Then step through points: horizontal at previous y, then vertical to next y.
    for (let i = 1; i < coords.length; i += 1) {
      const prev = coords[i - 1];
      const cur = coords[i];
      h.push({ left: prev.x, top: prev.y - 1, width: Math.max(1, cur.x - prev.x) });
      const top = Math.min(prev.y, cur.y);
      const height = Math.abs(cur.y - prev.y);
      v.push({ left: cur.x - 1, top, height: Math.max(1, height) });
    }

    // Flat line to the right edge at last y.
    const last = coords[coords.length - 1];
    h.push({ left: last.x, top: last.y - 1, width: Math.max(1, W - padX - last.x) });

    return { h, v };
  }, [W, bottomY, coords, padX]);

  const lastLabel = coords[coords.length - 1] ?? null;
  const firstLabel = coords[0] ?? null;
  const isSingle = coords.length === 1;

  const BADGE_W = 28;
  const BADGE_H = 18;
  const LABEL_H = 26;

  return (
    <View style={{ width: W, height: H + LABEL_H }}>
      <View style={[styles.chart, { width: W, height: H, position: 'absolute', left: 0, top: 0 }]}>
        <View style={styles.chartGrid} />
        <View style={[styles.chartGrid, { top: '33%' }]} />
        <View style={[styles.chartGrid, { top: '66%' }]} />

        {stepSegs.h.map((s, idx) => (
          <View key={`h_${idx}`} style={[styles.hLine, { left: s.left, top: s.top, width: s.width }]} />
        ))}
        {stepSegs.v.map((s, idx) => (
          <View key={`v_${idx}`} style={[styles.vLine, { left: s.left, top: s.top, height: s.height }]} />
        ))}

        {coords.map((p, idx) => (
          <View key={`pt_${idx}`}>
            <View style={[styles.dot, { left: p.x - 4, top: p.y - 4 }]} />
            <View
              style={[
                styles.pointBadge,
                {
                  left: Math.min(W - BADGE_W - 2, Math.max(2, p.x - BADGE_W / 2)),
                  top: Math.min(H - BADGE_H - 2, Math.max(2, p.y - BADGE_H - 8)),
                },
              ]}
            >
              <Text style={styles.pointBadgeText}>{p.v}</Text>
            </View>
          </View>
        ))}
      </View>

      {coords.map((p, idx) => (
        <Text
          key={`xl_${idx}`}
          style={[
            styles.pointTimeLabel,
            {
              left: Math.min(W - 60, Math.max(0, p.x - 30)),
              top: H + 2,
              width: 60,
            },
          ]}
          numberOfLines={2}
        >
          {fmtDate(p.ts)}
          {'\n'}
          {fmtTime(p.ts)}
        </Text>
      ))}
    </View>
  );
}

function GoalBar({ label, value01, meta }: { label: string; value01: number; meta: string }) {
  const pct = Math.round(clamp01(value01) * 100);
  return (
    <View style={styles.barRow}>
      <View style={styles.barHead}>
        <Text style={styles.barLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.barMeta}>{meta}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

export function ProgressScreen() {
  const nav = useNavigation<any>();
  const { state } = useAuth();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(false);
  const [failedMap, setFailedMap] = useState<Record<string, FailedReason>>({});

  const [score, setScore] = useState(0);
  const [goalStreakDays, setGoalStreakDays] = useState(0);
  const [level, setLevel] = useState(1);
  const [scoreHistory, setScoreHistory] = useState<authApi.ScoreHistoryPoint[]>([]);

  const [proofs, setProofs] = useState<Array<(authApi.SmartGoalProofAttempt & { goalId: string })>>([]);
  const [expandedGoals, setExpandedGoals] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;

    setLoading(true);
    try {
      const [goalsResp, dash, fm, proofResp] = await Promise.all([
        authApi.listGoals(token, { includeDeleted: true }),
        authApi.getDashboard(token),
        getFailedGoalsMap(),
        authApi.listMySmartGoalProofAttempts(token),
      ]);
      setGoals(goalsResp.goals ?? []);
      setFailedMap(fm);
      setProofs((proofResp as any)?.attempts ?? []);
      setGoalStreakDays(dash?.goalStreakDays ?? 0);
      setLevel(dash?.level ?? 1);

      const nextScore = dash?.score ?? 0;
      setScore(nextScore);

      try {
        await authApi.appendMyScoreHistoryPoint(token, { score: nextScore, ts: Date.now() });
      } catch {
        // ignore
      }

      const histResp = await authApi.getMyScoreHistory(token);
      setScoreHistory(histResp.points ?? []);
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [state.accessToken]);

  const openProof = useCallback(
    async (attempt: { id: string; goalId: string }) => {
      const token = state.accessToken;
      if (!token) return;
      try {
        const resp = await authApi.presignMySmartGoalProofView(token, attempt.goalId, attempt.id);
        const ok = await Linking.canOpenURL(resp.url);
        if (!ok) {
          toast('Cannot open URL');
          return;
        }
        await Linking.openURL(resp.url);
      } catch (e: any) {
        toast(String(e?.message ?? 'Failed to open'));
      }
    },
    [state.accessToken]
  );

  const goalTitleById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const g of goals) {
      if (g?.id) m[g.id] = String(g.title ?? '').trim() || 'Untitled goal';
    }
    return m;
  }, [goals]);

  const proofsByGoal = useMemo(() => {
    const attemptTs = (p: any) => {
      const t1 = p?.createdAt ? new Date(p.createdAt).getTime() : 0;
      const t2 = p?.updatedAt ? new Date(p.updatedAt).getTime() : 0;
      const t = Math.max(t1, t2);
      return Number.isFinite(t) ? t : 0;
    };

    const by: Record<string, Array<(authApi.SmartGoalProofAttempt & { goalId: string }) & { _ts: number }>> = {};
    for (const p of proofs ?? []) {
      const gid = String((p as any)?.goalId ?? '');
      if (!gid) continue;
      const item = { ...(p as any), _ts: attemptTs(p) };
      by[gid] = by[gid] ?? [];
      by[gid].push(item);
    }

    const groups = Object.entries(by)
      .map(([goalId, items]) => {
        const sorted = [...items].sort((a, b) => b._ts - a._ts);
        const approved = sorted.filter(s => s.status === 'APPROVED');
        const primary = approved.length > 0 ? approved[0] : sorted[0];
        return { goalId, primary, attempts: sorted };
      })
      .sort((a, b) => (b.primary?._ts ?? 0) - (a.primary?._ts ?? 0));

    return groups;
  }, [proofs]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const counts = useMemo(() => {
    const total = goals.filter(g => !g.deletedAt).length;
    const completed = goals.filter(g => g.completed).length;
    const failed = goals.filter(g => {
      if (g.completed) return false;
      if (g.failedAt) return true;
      const reason = failedMap[g.id];
      if (reason) return true;
      if (!g.dueAt) return false;
      const t = new Date(g.dueAt).getTime();
      return Number.isFinite(t) && t > 0 && t < Date.now();
    }).length;
    const active = total - completed - failed;
    return { total, completed, active, failed };
  }, [failedMap, goals]);

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hTitle}>Progress</Text>
            <View style={styles.hSub}>
              <Pill dot>Achievements</Pill>
              <Pill>
                Score: <Text style={styles.bold}>{score}</Text>
              </Pill>
              <Pill>
                Goal streak: <Text style={styles.bold}>{goalStreakDays}</Text>
              </Pill>
              <Pill>
                Level: <Text style={styles.bold}>{level}</Text>
              </Pill>
              {loading ? <Pill>Loading…</Pill> : null}
            </View>
          </View>

          <Pressable
            onPress={() => nav.goBack()}
            style={({ pressed }) => [styles.iconBtn, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={styles.iconText}>←</Text>
          </Pressable>
        </View>

        <Card>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Trend</Text>
          </View>
          <View style={{ height: 10 }} />
          {scoreHistory.length === 0 ? (
            <Text style={styles.meta}>No progress data yet.</Text>
          ) : (
            <View style={{ alignItems: 'center' }}>
              <TrendChart data={scoreHistory} />
              <View style={{ height: 10 }} />
              <Text style={styles.meta}>Score over time</Text>
            </View>
          )}
        </Card>

        <Card>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Overview</Text>
            <Button title="Detail" small onPress={() => nav.navigate('GoalsDetails')} />
          </View>
          <View style={{ height: 10 }} />
          <Text style={styles.meta}>Total goals: {counts.total}</Text>
          <Text style={styles.meta}>Completed goals: {counts.completed}</Text>
          <Text style={styles.meta}>Active goals: {counts.active}</Text>
          <Text style={styles.meta}>Failed goals: {counts.failed}</Text>
        </Card>

        <Card>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Proof uploaded</Text>
            <Text style={styles.meta}>{proofsByGoal.length}</Text>
          </View>
          <View style={{ height: 10 }} />

          {proofsByGoal.length === 0 ? <Text style={styles.meta}>No proofs uploaded yet.</Text> : null}

          {proofsByGoal.map(g => {
            const goalName = goalTitleById[g.goalId] ?? 'Goal';
            const expanded = !!expandedGoals[g.goalId];
            const visible = expanded ? g.attempts : [g.primary];
            const canToggle = g.attempts.length > 1;

            return (
              <View key={g.goalId} style={{ marginTop: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <Text style={styles.completedItem} numberOfLines={1}>
                    {goalName}
                  </Text>

                  {canToggle ? (
                    <Button
                      title={expanded ? 'Hide' : `Show more (${g.attempts.length - 1})`}
                      small
                      onPress={() => setExpandedGoals(prev => ({ ...prev, [g.goalId]: !expanded }))}
                    />
                  ) : null}
                </View>

                {visible.map(p => {
                  const statusLabel =
                    p.status === 'PENDING_REVIEW'
                      ? 'Reviewing'
                      : p.status === 'APPROVED'
                        ? 'Accepted'
                        : p.status === 'REJECTED'
                          ? 'Rejected'
                          : 'Pending upload';

                  return (
                    <View key={p.id} style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <Text style={styles.meta} numberOfLines={1}>
                          Proof: {String(p.id).slice(0, 8)}
                        </Text>
                        <Badge>{statusLabel}</Badge>
                      </View>

                      {p.aiFeedback ? <Text style={styles.meta}>Comment: {p.aiFeedback}</Text> : <Text style={styles.meta}>Comment: —</Text>}

                      {p.proofUrl ? (
                        <View style={{ marginTop: 8, alignItems: 'flex-start' }}>
                          <Button title="View" small onPress={() => void openProof({ id: p.id, goalId: g.goalId })} />
                        </View>
                      ) : (
                        <Text style={styles.meta}>No video uploaded.</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })}
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
  barRow: {
    gap: 6,
  },
  completedItem: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  chart: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
  },
  chartGrid: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  lineSeg: {
    position: 'absolute',
    height: 2,
    backgroundColor: '#d6b35f',
  },
  vLine: {
    position: 'absolute',
    width: 2,
    backgroundColor: '#d6b35f',
  },
  hLine: {
    position: 'absolute',
    height: 2,
    backgroundColor: '#d6b35f',
  },
  dot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#ffd27a',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  axisLabel: {
    position: 'absolute',
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  pointTimeLabel: {
    position: 'absolute',
    color: colors.muted,
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 10,
  },
  valuePill: {
    position: 'absolute',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  valueText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  pointBadge: {
    position: 'absolute',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  pointBadgeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '900',
  },
  barHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  barLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  barMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  track: {
    height: 10,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: colors.line,
  },
  fill: {
    height: '100%',
    backgroundColor: colors.success,
  },
});
