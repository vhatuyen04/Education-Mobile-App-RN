import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Pill } from '../components/Pill';
import { colors } from '../theme/colors';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import { getLocalProgress } from '../motivation/progress';
import { appendScorePoint, type ScorePoint } from '../motivation/scoreHistory';
import { getFailedGoalsMap, type FailedReason } from '../motivation/failedGoals';
import { Button } from '../components/Button';

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

function TrendChart({ data }: { data: ScorePoint[] }) {
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
  const [scoreHistory, setScoreHistory] = useState<ScorePoint[]>([]);

  const refresh = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;

    setLoading(true);
    try {
      const [goalsResp, lp, dash, fm] = await Promise.all([
        authApi.listGoals(token, { includeDeleted: true }),
        getLocalProgress(),
        authApi.getDashboard(token),
        getFailedGoalsMap(),
      ]);
      setGoals(goalsResp.goals ?? []);
      setFailedMap(fm);
      setGoalStreakDays(lp.goalStreakDays ?? 0);
      setLevel(lp.level ?? 1);

      const nextScore = dash?.score ?? 0;
      setScore(nextScore);

      const hist = await appendScorePoint(nextScore);
      setScoreHistory(hist);
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

  const summary = useMemo(() => {
    const now = Date.now();
    const existing = goals.filter(g => !g.deletedAt);
    const total = existing.length;
    const completed = existing.filter(g => g.completed).length;
    const failed = existing.filter(g => {
      if (g.completed) return false;
      const reason = failedMap[g.id];
      if (reason) return true;
      if (!g.dueAt) return false;
      const t = new Date(g.dueAt).getTime();
      return Number.isFinite(t) && t > 0 && t < now;
    }).length;
    const active = existing.length - completed - failed;
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
          <Text style={styles.meta}>Total goals: {summary.total}</Text>
          <Text style={styles.meta}>Completed goals: {summary.completed}</Text>
          <Text style={styles.meta}>Active goals: {summary.active}</Text>
          <Text style={styles.meta}>Failed goals: {summary.failed}</Text>
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
