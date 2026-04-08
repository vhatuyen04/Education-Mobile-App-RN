import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Pill } from '../components/Pill';
import { colors } from '../theme/colors';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import { getRecommendation, removeRecommendation, upsertRecommendation } from '../ai/recommendations';
import { removeInboxItemsByRecoId } from '../notifications/inbox';

type RouteParams = { id: string };

type UiStep = {
  id: string;
  text: string;
  scheduleText: string;
};

function makeId() {
  return `rs_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatWeekday(d: number | undefined) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (d === undefined || d === null) return '';
  const idx = Number(d);
  if (!Number.isFinite(idx) || idx < 0 || idx > 6) return '';
  return days[idx];
}

function parseWeekdayToken(token: string): number | null {
  const t = token.trim().toLowerCase();
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
  if (t in map) return map[t];
  const n = Number(t);
  if (Number.isFinite(n) && n >= 0 && n <= 6) return n;
  return null;
}

function scheduleToShortText(s?: authApi.AiGoalStepSchedule) {
  if (!s || s.type === 'none') return '';
  if (s.type === 'once') return `once:${s.due}`;
  const r = (s.repeat ?? '').trim();
  const rLower = r.toLowerCase();
  if (rLower === 'daily') return 'daily';
  if (rLower === 'weekly') return s.repeatDay !== undefined ? `weekly:${formatWeekday(s.repeatDay) || String(s.repeatDay)}` : 'weekly';
  if (rLower === 'monthly') return s.repeatDay !== undefined ? `monthly:${String(s.repeatDay)}` : 'monthly';
  if (rLower === 'yearly') {
    const mm = s.repeatMonth !== undefined ? String(s.repeatMonth).padStart(2, '0') : '';
    const dd = s.repeatDay !== undefined ? String(s.repeatDay).padStart(2, '0') : '';
    return mm && dd ? `yearly:${mm}-${dd}` : 'yearly';
  }
  return `repeat:${r}`;
}

function parseScheduleShortText(input: string): authApi.AiGoalStepSchedule {
  const raw = String(input ?? '').trim();
  if (!raw) return { type: 'none' };

  const lower = raw.toLowerCase();
  if (lower.startsWith('once:')) {
    const due = raw.slice(5).trim();
    return { type: 'once', due };
  }

  if (lower === 'daily') return { type: 'repeat', repeat: 'daily' };

  if (lower === 'weekly') return { type: 'repeat', repeat: 'weekly' };
  if (lower.startsWith('weekly:')) {
    const tok = raw.slice(7).trim();
    const dow = parseWeekdayToken(tok);
    return { type: 'repeat', repeat: 'weekly', ...(dow !== null ? { repeatDay: dow } : null) } as any;
  }

  if (lower === 'monthly') return { type: 'repeat', repeat: 'monthly' };
  if (lower.startsWith('monthly:')) {
    const tok = raw.slice(8).trim();
    const day = Number(tok);
    return { type: 'repeat', repeat: 'monthly', ...(Number.isFinite(day) ? { repeatDay: day } : null) } as any;
  }

  if (lower === 'yearly') return { type: 'repeat', repeat: 'yearly' };
  if (lower.startsWith('yearly:')) {
    const tok = raw.slice(7).trim();
    const m = tok.match(/^(\d{1,2})\s*[-/.,]\s*(\d{1,2})$/);
    if (m) {
      const month = Number(m[1]);
      const day = Number(m[2]);
      return {
        type: 'repeat',
        repeat: 'yearly',
        ...(Number.isFinite(month) ? { repeatMonth: month } : null),
        ...(Number.isFinite(day) ? { repeatDay: day } : null),
      } as any;
    }
    return { type: 'repeat', repeat: 'yearly' };
  }

  if (lower.startsWith('repeat:')) {
    const repeat = raw.slice(7).trim();
    return repeat ? { type: 'repeat', repeat } : { type: 'none' };
  }

  return { type: 'repeat', repeat: raw };
}

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

  const [deadlineDraft, setDeadlineDraft] = useState('');
  const [stepsDraft, setStepsDraft] = useState<UiStep[]>([]);

  const load = useCallback(async () => {
    if (!recoId) return;
    const r = await getRecommendation(recoId);
    setRec(r);
  }, [recoId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!rec) return;
    setDeadlineDraft(String(rec.suggestion?.deadline ?? ''));
    setStepsDraft(
      (rec.suggestion?.steps ?? []).map(s => ({
        id: makeId(),
        text: String(s.text ?? ''),
        scheduleText: scheduleToShortText(s.schedule),
      }))
    );
  }, [rec?.id]);

  const steps = useMemo(() => rec?.suggestion?.steps ?? [], [rec]);

  async function saveEdits() {
    if (!rec) return;

    const nextSteps: authApi.AiGoalStep[] = stepsDraft
      .map(s => ({
        text: s.text.trim(),
        schedule: parseScheduleShortText(s.scheduleText),
      }))
      .filter(s => s.text);

    const nextRec = {
      ...rec,
      suggestion: {
        ...rec.suggestion,
        deadline: deadlineDraft.trim(),
        steps: nextSteps,
      },
    };

    await upsertRecommendation(nextRec);
    setRec(nextRec);
    toast('Saved');
  }

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

      await removeRecommendation(rec.id);
      await removeInboxItemsByRecoId(rec.id);
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
    await removeRecommendation(rec.id);
    await removeInboxItemsByRecoId(rec.id);
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
          </View>

          <View style={{ height: 12 }} />
          <Text style={styles.label}>Edit deadline</Text>
          <TextInput value={deadlineDraft} onChangeText={setDeadlineDraft} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} style={styles.input} />
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Steps</Text>
          <View style={{ height: 10 }} />
          {stepsDraft.length === 0 ? <Text style={styles.muted}>No steps.</Text> : null}
          {stepsDraft.map((s, idx) => (
            <View key={s.id} style={styles.stepEditRow}>
              <Text style={styles.stepNum}>{idx + 1}.</Text>
              <View style={{ flex: 1, gap: 8 }}>
                <TextInput
                  value={s.text}
                  onChangeText={t => setStepsDraft(prev => prev.map(p => (p.id === s.id ? { ...p, text: t } : p)))}
                  placeholder="Step"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
                <TextInput
                  value={s.scheduleText}
                  onChangeText={t => setStepsDraft(prev => prev.map(p => (p.id === s.id ? { ...p, scheduleText: t } : p)))}
                  placeholder="daily | weekly:1 | monthly:15 | yearly:01-15 | once:2027-01-01"
                  placeholderTextColor={colors.muted}
                  style={styles.inputSmall}
                />
              </View>
              <View style={{ gap: 8 }}>
                <Button title="Remove" small onPress={() => setStepsDraft(prev => prev.filter(p => p.id !== s.id))} />
              </View>
            </View>
          ))}

          <View style={{ height: 10 }} />
          <Button title={'+ Add step'} full onPress={() => setStepsDraft(prev => [...prev, { id: makeId(), text: 'New step', scheduleText: '' }])} />
        </Card>

        <View style={{ gap: 10 }}>
          <Button title="Save changes" full onPress={saveEdits} />
          <Button title={loading ? 'Accepting…' : 'Accept & add to my goals'} variant="primary" full onPress={accept} />
          <Button title="Reject" full onPress={reject} />
        </View>
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
  label: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  input: {
    width: '100%',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontWeight: '800',
  },
  inputSmall: {
    width: '100%',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontWeight: '800',
    fontSize: 12,
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
  stepEditRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    alignItems: 'flex-start',
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
