import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Pill } from '../components/Pill';
import { colors } from '../theme/colors';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import { getRecommendation, setRecommendationStatus } from '../ai/recommendations';

type RouteParams = { id: string };

function parseDeadlineToISOEndOfDay(v: string): string | null {
  const raw = String(v ?? '').trim();
  if (!raw) return null;

  // Accept ISO or YYYY-MM-DD.
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parts = raw.slice(0, 10);
    const m = parts.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (Number.isNaN(d.getTime())) return null;
      d.setHours(23, 59, 59, 999);
      return d.toISOString();
    }
  }

  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(23, 59, 59, 999);
  return dt.toISOString();
}

export function AiGoalRecommendationScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { state } = useAuth();

  const recoId = String((route.params as RouteParams | undefined)?.id ?? '');

  const [loading, setLoading] = useState(false);
  const [rec, setRec] = useState<Awaited<ReturnType<typeof getRecommendation>>>(null);

  const load = useCallback(async () => {
    if (!recoId) return;
    const r = await getRecommendation(recoId);
    setRec(r);
  }, [recoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const steps = useMemo(() => rec?.suggestion?.steps ?? [], [rec]);

  async function accept() {
    if (!rec) return;
    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }

    const title = String(rec.suggestion?.title ?? '').trim();
    if (!title) {
      toast('Missing goal title');
      return;
    }

    const dueIso = parseDeadlineToISOEndOfDay(String(rec.suggestion?.deadline ?? ''));
    if (!dueIso) {
      toast('Missing/invalid deadline');
      return;
    }

    if (loading) return;
    setLoading(true);
    try {
      const created = await authApi.createGoal(token, {
        title,
        description: 'AI recommended goal',
        dueAt: dueIso,
      });

      const goalId = created.goal.id;

      for (let i = 0; i < steps.length; i += 1) {
        const s = steps[i];
        const text = String(s.text ?? '').trim();
        if (!text) continue;

        const body: any = { text, order: i };
        if (s.schedule?.type === 'once') {
          const d = parseDeadlineToISOEndOfDay(s.schedule.due);
          body.dueAt = d;
        } else if (s.schedule?.type === 'repeat') {
          body.repeat = s.schedule.repeat;
          body.repeatDay = s.schedule.repeatDay ?? null;
          body.repeatMonth = s.schedule.repeatMonth ?? null;
        }
        await authApi.createGoalStep(token, goalId, body);
      }

      await setRecommendationStatus(rec.id, 'accepted');
      toast('Goal added');
      nav.goBack();
    } catch (e: any) {
      toast(String(e?.message ?? 'Accept failed'));
    } finally {
      setLoading(false);
    }
  }

  async function reject() {
    if (!rec) return;
    await setRecommendationStatus(rec.id, 'rejected');
    toast('Rejected');
    nav.goBack();
  }

  if (!rec) {
    return (
      <Screen>
        <Card>
          <Text style={styles.muted}>Recommendation not found.</Text>
          <View style={{ height: 10 }} />
          <Button title="Back" full onPress={() => nav.goBack()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>SmartGoal recommendation</Text>
          <Button title="Back" small onPress={() => nav.goBack()} />
        </View>

        <Card>
          <Text style={styles.goalTitle}>{rec.suggestion.title}</Text>
          <View style={{ height: 10 }} />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pill>Field: {rec.suggestion.field}</Pill>
            <Pill>Deadline: {rec.suggestion.deadline}</Pill>
            <Pill>Status: {rec.status}</Pill>
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Steps</Text>
          <View style={{ height: 10 }} />
          {steps.length === 0 ? <Text style={styles.muted}>No steps.</Text> : null}
          {steps.map((s, idx) => (
            <View key={`${idx}_${s.text}`} style={styles.stepRow}>
              <Text style={styles.stepNum}>{idx + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepText}>{s.text}</Text>
                {s.schedule && s.schedule.type !== 'none' ? (
                  <Text style={styles.mutedSmall}>
                    {s.schedule.type === 'once'
                      ? `Once: ${s.schedule.due}`
                      : `Repeat: ${s.schedule.repeat}${s.schedule.repeatDay != null ? `, day=${s.schedule.repeatDay}` : ''}${
                          s.schedule.repeatMonth != null ? `, month=${s.schedule.repeatMonth}` : ''
                        }`}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </Card>

        <View style={{ gap: 10 }}>
          <Button title={loading ? 'Accepting…' : 'Accept & add to my goals'} variant="primary" full onPress={accept} />
          <Button title="Reject" full onPress={reject} />
        </View>

        {rec.contextSummary ? (
          <Card>
            <Text style={styles.sectionTitle}>Why this was suggested</Text>
            <View style={{ height: 10 }} />
            <Text style={styles.mutedSmall}>{rec.contextSummary}</Text>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 90,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  goalTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  muted: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  mutedSmall: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  stepRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  stepNum: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '900',
    width: 22,
  },
  stepText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
});
