import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { Pressable } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Pill } from '../components/Pill';
import { colors } from '../theme/colors';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import { getFailedGoalsMap, type FailedReason } from '../motivation/failedGoals';
import { countVisibleGoals } from '../motivation/goalSummary';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';

type Goal = authApi.GoalItem;

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function fmtDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
}

function TrendChart({ data }: { data: authApi.ScoreHistoryPoint[] }) {
  const normalized = useMemo(() => {
    const cleaned = (Array.isArray(data) ? data : [])
      .map(d => ({ ts: Number((d as any).ts ?? 0), score: Number((d as any).score ?? 0) }))
      .filter(d => Number.isFinite(d.ts) && d.ts > 0 && Number.isFinite(d.score))
      .sort((a, b) => a.ts - b.ts);
    return cleaned.slice(-24);
  }, [data]);

  const W = 320;
  const H = 148;
  const padX = 18;
  const padY = 18;
  const max = Math.max(1, ...normalized.map(d => d.score));
  const coords = normalized.map((d, i) => {
    const n = normalized.length;
    const x = n === 1 ? W / 2 : padX + ((W - padX * 2) * i) / (n - 1);
    const y = padY + (1 - clamp01(d.score / max)) * (H - padY * 2);
    return { x, y, ts: d.ts, v: d.score };
  });
  const segments = coords.slice(1).map((cur, i) => {
    const prev = coords[i];
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    return {
      left: (prev.x + cur.x) / 2 - length / 2,
      top: (prev.y + cur.y) / 2 - 1.5,
      width: length,
      angle: `${Math.atan2(dy, dx)}rad`,
    };
  });
  const first = coords[0];
  const last = coords[coords.length - 1];

  return (
    <View style={{ width: W }}>
      <View style={[styles.chart, { width: W, height: H }]}>
        <View style={[styles.chartGrid, { top: padY }]} />
        <View style={[styles.chartGrid, { top: H / 2 }]} />
        <View style={[styles.chartGrid, { top: H - padY }]} />
        <Text style={[styles.axisScore, { top: padY - 8 }]}>{max}</Text>
        <Text style={[styles.axisScore, { top: H - padY - 8 }]}>0</Text>
        {segments.map((segment, idx) => (
          <View
            key={`seg_${idx}`}
            style={[
              styles.trendLine,
              {
                left: segment.left,
                top: segment.top,
                width: segment.width,
                transform: [{ rotate: segment.angle }],
              },
            ]}
          />
        ))}
        {last ? <View style={[styles.dot, { left: last.x - 5, top: last.y - 5 }]} /> : null}
      </View>
      <View style={styles.trendFooter}>
        <Text style={styles.meta}>{first ? fmtDate(first.ts) : ''}</Text>
        <Text style={styles.trendLatest}>{last ? `Latest ${last.v}` : ''}</Text>
        <Text style={styles.meta}>{last && last !== first ? fmtDate(last.ts) : ''}</Text>
      </View>
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
  const route = useRoute<any>();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollY = useRef(0);
  const proofSectionY = useRef(0);
  const didFocusProofs = useRef(false);
  const holdScroll = useRef(false);
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
        authApi.listGoals(token, { includeDeleted: true, includeFailed: true }),
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

  const scrollToProofsOnce = useCallback(() => {
    if (!route.params?.focusProofs || didFocusProofs.current || proofSectionY.current <= 0) return;
    didFocusProofs.current = true;
    scrollRef.current?.scrollTo({ y: Math.max(0, proofSectionY.current - 8), animated: false });
  }, [route.params?.focusProofs]);

  const keepScrollPlace = useCallback(() => {
    const y = scrollY.current;
    holdScroll.current = true;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: false });
    });
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y, animated: false });
    }, 60);
  }, []);

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

  function deleteProof(goalId: string, attemptId: string) {
    const token = state.accessToken;
    if (!token) return;
    Alert.alert('Delete proof', 'Remove this uploaded proof from your history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await authApi.deleteSmartGoalProofAttempt(token, goalId, attemptId);
              setProofs(prev => prev.filter(item => item.id !== attemptId));
              keepScrollPlace();
            } catch (e: any) {
              toast(String(e?.message ?? 'Failed to delete'));
            }
          })();
        },
      },
    ]);
  }

  function clearGoalProofs(goalId: string, goalName: string) {
    const token = state.accessToken;
    if (!token) return;
    Alert.alert('Clear goal proofs', `Remove every uploaded proof for ${goalName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await authApi.deleteSmartGoalProofsForGoal(token, goalId);
              setProofs(prev => prev.filter(item => item.goalId !== goalId));
              keepScrollPlace();
            } catch (e: any) {
              toast(String(e?.message ?? 'Failed to clear'));
            }
          })();
        },
      },
    ]);
  }

  const counts = useMemo(() => countVisibleGoals(goals, failedMap), [failedMap, goals]);

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        scrollEventThrottle={16}
        onScroll={event => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        }}
        onContentSizeChange={() => {
          if (route.params?.focusProofs && !didFocusProofs.current) {
            scrollToProofsOnce();
            return;
          }
          if (!holdScroll.current) return;
          holdScroll.current = false;
          scrollRef.current?.scrollTo({ y: scrollY.current, animated: false });
        }}
      >
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

        <View
          onLayout={event => {
            proofSectionY.current = event.nativeEvent.layout.y;
            scrollToProofsOnce();
          }}
          style={{ gap: 12 }}
        >
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Proof uploaded</Text>
            <Text style={styles.meta}>{proofsByGoal.length}</Text>
          </View>

          {proofsByGoal.length === 0 ? (
            <Card>
              <Text style={styles.meta}>No proofs uploaded yet.</Text>
            </Card>
          ) : null}

          {proofsByGoal.map(g => {
            const goalName = goalTitleById[g.goalId] ?? 'Goal';
            const expanded = !!expandedGoals[g.goalId];
            const visible = expanded ? g.attempts : [g.primary];
            const canToggle = g.attempts.length > 1;

            return (
              <Card key={g.goalId} style={styles.goalProofCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <Text style={styles.goalProofTitle} numberOfLines={2}>
                    {goalName}
                  </Text>
                  <Button title="Clear goal" small variant="danger" onPress={() => clearGoalProofs(g.goalId, goalName)} />
                </View>

                {canToggle ? (
                  <View style={{ marginTop: 8, alignItems: 'flex-start' }}>
                    <Button
                      title={expanded ? 'Show less' : `Show more (${g.attempts.length - 1})`}
                      small
                      onPress={() => {
                        keepScrollPlace();
                        setExpandedGoals(prev => ({ ...prev, [g.goalId]: !expanded }));
                      }}
                    />
                  </View>
                ) : null}

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
                    <View key={p.id} style={styles.proofRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <Text style={styles.meta} numberOfLines={1}>
                          Proof: {String(p.id).slice(0, 8)}
                        </Text>
                        <Badge>{statusLabel}</Badge>
                      </View>

                      {p.aiFeedback ? <Text style={styles.meta}>Comment: {p.aiFeedback}</Text> : <Text style={styles.meta}>Comment: —</Text>}
                      <Text style={styles.meta}>
                        Verified by: {p.reviewedBy === 'AI' ? 'AI' : p.reviewedBy === 'admin' ? 'Admin' : '—'}
                      </Text>

                      <View style={{ marginTop: 8, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                        {p.proofUrl ? <Button title="View" small onPress={() => void openProof({ id: p.id, goalId: g.goalId })} /> : null}
                        <Button title="Delete" small variant="danger" onPress={() => deleteProof(g.goalId, p.id)} />
                      </View>
                      {p.proofUrl ? null : <Text style={styles.meta}>No video uploaded.</Text>}
                    </View>
                  );
                })}
              </Card>
            );
          })}
        </View>
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
  goalProofCard: {
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    backgroundColor: colors.surface2,
  },
  goalProofTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  proofRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
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
  trendLine: {
    position: 'absolute',
    height: 3,
    borderRadius: 2,
    backgroundColor: '#f0c56b',
  },
  trendFooter: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trendLatest: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  axisScore: {
    position: 'absolute',
    left: 4,
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
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
