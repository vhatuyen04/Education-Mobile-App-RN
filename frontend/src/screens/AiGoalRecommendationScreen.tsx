import { readDurationMinutes } from '../utils/stepLifecycle';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Pill } from '../components/Pill';
import { ScheduleField } from '../components/ScheduleField';
import { SchedulePickerModal } from '../components/SchedulePickerModal';
import { colors } from '../theme/colors';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import * as authApi from '../api/auth';
import { getRecommendation, removeRecommendation, upsertRecommendation } from '../ai/recommendations';
import { removeInboxItemsByRecoId } from '../notifications/inbox';
import { markAppGoal } from '../motivation/appGoals';
import { previewRewardsForDeadline } from '../motivation/deadlineDifficulty';
import { deadlineError, deadlineRetryMessage, utcMidnightIsoFromCivilText } from '../utils/recurrence';
import { parseScheduleShortText as parseStoredSchedule } from '../utils/stepSchedule';
import { scheduleRange } from '../utils/schedulePicker';
import { recommendationScheduleDrafts, recommendationStepFields } from '../ai/recommendationSchedules';

type RouteParams = { id: string };

type UiStep = {
  durationMinutes?: number;
  id: string;
  text: string;
  description: string;
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

function parseNamedDayList(raw: string, parseOne: (token: string) => number | null): number[] | null {
  const days: number[] = [];
  for (const token of raw.split(',')) {
    const day = parseOne(token);
    if (day == null || days.includes(day)) return null;
    days.push(day);
  }
  days.sort((left, right) => left - right);
  return days.length ? days : null;
}

function parseWeekdayToken(token: string): number | null {
  const t = token.trim().toLowerCase();
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
  if (t in map) return map[t];
  const n = Number(t);
  if (Number.isFinite(n) && n >= 0 && n <= 6) return n;
  return null;
}

function scheduleToShortText(s?: authApi.AiGoalStepSchedule & { customDates?: string[] | null }) {
  if (!s || s.type === 'none') return '';
  if (s.type === 'repeat' && String(s.repeat ?? '').trim().toLowerCase() === 'custom') {
    const dates = (s.customDates ?? []).map(date => String(date).trim()).filter(Boolean);
    return dates.length ? `custom:${dates.join(',')}` : '';
  }
  if (s.type === 'once') return `once:${s.due}`;
  const r = (s.repeat ?? '').trim();
  const rLower = r.toLowerCase();
  if (rLower === 'daily') return 'daily';
  if (rLower === 'weekly') {
    const days = s.repeatDays?.length ? s.repeatDays : s.repeatDay !== undefined ? [s.repeatDay] : [];
    const names = [...days].sort((left, right) => ((left + 6) % 7) - ((right + 6) % 7)).map(day => formatWeekday(day)).filter(Boolean);
    return names.length ? `weekly:${names.join(',')}` : 'weekly';
  }
  if (rLower === 'monthly') {
    const days = s.repeatDays?.length ? [...s.repeatDays].sort((left, right) => left - right) : s.repeatDay !== undefined ? [s.repeatDay] : [];
    return days.length ? `monthly:${days.join(',')}` : 'monthly';
  }
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
    const days = parseNamedDayList(raw.slice(7), parseWeekdayToken);
    if (!days) return { type: 'repeat', repeat: 'weekly' };
    return { type: 'repeat', repeat: 'weekly', repeatDay: days[0], ...(days.length > 1 ? { repeatDays: days } : null) };
  }

  if (lower === 'monthly') return { type: 'repeat', repeat: 'monthly' };
  if (lower.startsWith('monthly:')) {
    const days = parseNamedDayList(raw.slice(8), token => {
      const day = Number(token);
      return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
    });
    if (!days) return { type: 'repeat', repeat: 'monthly' };
    return { type: 'repeat', repeat: 'monthly', repeatDay: days[0], ...(days.length > 1 ? { repeatDays: days } : null) };
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

  return { type: 'none' };
}

function recommendationSchedule(text: string): authApi.AiGoalStepSchedule {
  const stored = parseStoredSchedule(text);
  if (stored.repeat === 'custom') {
    return { type: 'repeat', repeat: 'custom', customDates: stored.customDates ?? [] } as authApi.AiGoalStepSchedule;
  }
  return parseScheduleShortText(text);
}

export function AiGoalRecommendationScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { state } = useAuth();
  const { settings } = useSettings();

  const recoId = String((route.params as RouteParams | undefined)?.id ?? '');

  const [loading, setLoading] = useState(false);
  const [rec, setRec] = useState<Awaited<ReturnType<typeof getRecommendation>>>(null);

  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [deadlineDraft, setDeadlineDraft] = useState('');
  const [stepsDraft, setStepsDraft] = useState<UiStep[]>([]);
  const [scheduleEditId, setScheduleEditId] = useState<string | null>(null);
  const shownRewards = useMemo(() => {
    const score = Number((rec?.suggestion as any)?.difficultyScore);
    const points = Number((rec?.suggestion as any)?.pointsAwarded);
    const xp = Number((rec?.suggestion as any)?.xpAwarded);
    const suggested = String(rec?.suggestion?.deadline ?? '');
    if (!rec || !Number.isFinite(score) || !Number.isFinite(points) || !Number.isFinite(xp)) return null;
    return previewRewardsForDeadline({
      difficultyScore: score,
      pointsAwarded: points,
      xpAwarded: xp,
      suggestedDeadline: suggested,
      chosenDeadline: deadlineDraft.trim() || suggested,
    });
  }, [deadlineDraft, rec]);
  const shownRankingEligible = rec?.suggestion.rankingEligible === true;

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
    setDescriptionDraft(String((rec.suggestion as any)?.description ?? '').trim());
    setDeadlineDraft(String(rec.suggestion?.deadline ?? ''));
    const baseSteps = (rec.suggestion?.steps ?? []).map(s => ({
      id: makeId(),
      text: String(s.text ?? ''),
      description: String(s.description ?? ''),
      durationMinutes: s.durationMinutes,
      scheduleText: scheduleToShortText(s.schedule),
    }));
    setStepsDraft(baseSteps);
  }, [rec?.id]);

  const steps = useMemo(() => rec?.suggestion?.steps ?? [], [rec]);

  const scheduleDrafts = recommendationScheduleDrafts(stepsDraft, deadlineDraft);

  function validateEdits() {
    const deadlineProblem = !deadlineDraft.trim() ? deadlineRetryMessage() : deadlineError(deadlineDraft);
    const dueIso = deadlineProblem ? null : utcMidnightIsoFromCivilText(deadlineDraft);
    if (!dueIso) {
      toast(deadlineProblem ?? deadlineRetryMessage());
      return null;
    }
    const invalid = recommendationScheduleDrafts(stepsDraft, deadlineDraft).find(step => step.scheduleError);
    if (invalid) {
      toast(invalid.scheduleError ?? 'Check the step schedule.');
      return null;
    }
    return dueIso;
  }

  async function saveEdits() {
    if (!rec || !validateEdits()) return;

    const nextSteps: authApi.AiGoalStep[] = scheduleDrafts
      .map(s => ({
        text: s.text.trim(),
        description: s.description.trim() || undefined,
        durationMinutes: s.durationMinutes,
        schedule: recommendationSchedule(s.scheduleText),
      }))
      .filter(s => s.text);

    const nextRec = {
      ...rec,
      contextSummary: descriptionDraft,
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

    const dueIso = validateEdits();
    if (!dueIso || loading) return;

    const nextRec = {
      ...rec,
      contextSummary: descriptionDraft,
      suggestion: {
        ...rec.suggestion,
        deadline: deadlineDraft.trim(),
        steps: scheduleDrafts
          .map(s => ({
            text: s.text.trim(),
            description: s.description.trim() || undefined,
            durationMinutes: s.durationMinutes,
            schedule: recommendationSchedule(s.scheduleText),
          }))
          .filter(s => s.text),
      },
    };
    await upsertRecommendation(nextRec);
    setRec(nextRec);

    setLoading(true);
    try {
      const created = await authApi.createGoal(token, {
        title,
        description: descriptionDraft.trim() ? descriptionDraft.trim() : null,
        rankField: rec.suggestion.field,
        requirement: String((rec.suggestion as any).requirement ?? '').trim() || null,
        expectation: String((rec.suggestion as any).expectation ?? '').trim() || null,
        dueAt: dueIso,
        difficultyScore: (rec.suggestion as any).difficultyScore,
        difficultyConfidence: (rec.suggestion as any).difficultyConfidence,
        difficultyReason: (rec.suggestion as any).difficultyReason,
        pointsAwarded: (rec.suggestion as any).pointsAwarded,
        xpAwarded: (rec.suggestion as any).xpAwarded,
        suggestionToken: rec.suggestion.suggestionToken,
      });

      const goalId = created.goal.id;
      try {
        await markAppGoal(goalId);
        for (const [order, step] of nextRec.suggestion.steps.entries()) {
          await authApi.createGoalStep(token, goalId, {
            text: step.text,
            order,
            description: step.description ?? null,
            durationMinutes: step.durationMinutes,
            ...recommendationStepFields(step.schedule),
          });
        }
      } catch (stepError) {
        await authApi.deleteGoal(token, goalId).catch(() => undefined);
        throw stepError;
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
          <Pressable onPress={() => nav.goBack()} hitSlop={10} style={styles.backBtn}>
            <Text style={styles.backBtnText}>←</Text>
          </Pressable>
        </View>

        <Card>
          <Text style={styles.goalTitle}>{rec.suggestion.title}</Text>
          <View style={{ height: 10 }} />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pill>Field: {rec.suggestion.field}</Pill>
            <Pill>Deadline: {deadlineDraft.trim() || rec.suggestion.deadline}</Pill>
            {shownRewards ? <Pill>Points: {shownRewards.pointsAwarded}</Pill> : null}
            {shownRewards ? <Pill>XP: {shownRewards.xpAwarded}</Pill> : null}
            <Pill>{shownRankingEligible ? 'Eligible' : 'Non eligible'}</Pill>
          </View>

          <View style={{ height: 12 }} />
          <Text style={styles.label}>Description</Text>
          <Text style={styles.muted}>{descriptionDraft.trim() || '—'}</Text>

          {shownRankingEligible && settings.rankingMode ? (
            <>
              <View style={{ height: 12 }} />
              <Text style={styles.label}>Ranking requirement</Text>
              <Text style={styles.muted}>{String(rec.suggestion.requirement ?? '').trim() || '—'}</Text>
            </>
          ) : String(rec.suggestion.expectation ?? '').trim() ? (
            <>
              <View style={{ height: 12 }} />
              <Text style={styles.label}>Expectation</Text>
              <Text style={styles.muted}>{String(rec.suggestion.expectation ?? '').trim()}</Text>
            </>
          ) : null}

          <View style={{ height: 12 }} />
          <Text style={styles.label}>Deadline</Text>
          <TextInput value={deadlineDraft} onChangeText={setDeadlineDraft} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} style={styles.input} />
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Steps</Text>
          <View style={{ height: 10 }} />
          {stepsDraft.length === 0 ? <Text style={styles.muted}>No steps.</Text> : null}
          {scheduleDrafts.map((s, idx) => (
            <View key={s.id} style={styles.stepEditRow}>
              <Text style={styles.stepNum}>{idx + 1}.</Text>
              <View style={{ flex: 1, gap: 8 }}>
                <Text style={styles.label}>Title</Text>
                <TextInput
                  value={s.text}
                  onChangeText={t => setStepsDraft(prev => prev.map(p => (p.id === s.id ? { ...p, text: t } : p)))}
                  placeholder="What will you do?"
                  placeholderTextColor={colors.muted}
                  multiline
                  style={styles.input}
                />
                <Text style={styles.label}>Description</Text>
                <TextInput
                  value={s.description}
                  onChangeText={t => setStepsDraft(prev => prev.map(p => (p.id === s.id ? { ...p, description: t } : p)))}
                  placeholder="Optional detail"
                  placeholderTextColor={colors.muted}
                  multiline
                  style={styles.input}
                />
                <Text style={styles.label}>Duration (minutes)</Text>
                <TextInput
                  value={s.durationMinutes?.toString() ?? ''}
                  onChangeText={value => {
                    const minutes = readDurationMinutes(value);
                    if (minutes === 'invalid' || (minutes != null && minutes > 2147483647)) return;
                    setStepsDraft(prev => prev.map(step => step.id === s.id ? { ...step, durationMinutes: minutes ?? undefined } : step));
                  }}
                  keyboardType="number-pad"
                  placeholder="Optional"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
                <ScheduleField value={s.scheduleText} onPress={() => setScheduleEditId(s.id)} />
                {s.scheduleError ? <Text style={{ color: colors.danger }}>{s.scheduleError}</Text> : null}
              </View>
              <Pressable onPress={() => setStepsDraft(prev => prev.filter(p => p.id !== s.id))} hitSlop={10} style={styles.stepRemove}>
                <Text style={styles.stepRemoveText}>🗑</Text>
              </Pressable>
            </View>
          ))}

          <View style={{ height: 10 }} />
          <Button title={'+ Add step'} full onPress={() => setStepsDraft(prev => [...prev, { id: makeId(), text: 'New step', description: '', scheduleText: '' }])} />
        </Card>

        <View style={{ gap: 10 }}>
          <Button title="Save changes" full onPress={saveEdits} />
          <Button title={loading ? 'Accepting…' : 'Accept & add to my goals'} variant="primary" full onPress={accept} />
          <Button title="Reject" full onPress={reject} />
        </View>
      </ScrollView>
      <SchedulePickerModal
        visible={scheduleEditId != null}
        initialText={stepsDraft.find(step => step.id === scheduleEditId)?.scheduleText ?? ''}
        range={scheduleRange(deadlineDraft.trim() || rec.suggestion.deadline || null)}
        onCancel={() => setScheduleEditId(null)}
        onConfirm={text => {
          const editing = scheduleDrafts.find(step => step.id === scheduleEditId);
          if (editing?.scheduleError && /^once:/i.test(editing.scheduleText) && !text.trim()) {
            toast('Choose a valid replacement date for this step.');
            return;
          }
          if (editing) {
            setStepsDraft(prev => prev.map(step => (step.id === editing.id ? { ...step, scheduleText: text } : step)));
          }
          setScheduleEditId(null);
        }}
      />
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
  backBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
  },
  backBtnText: {
    color: colors.text,
    fontWeight: '900',
    fontSize: 16,
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
  stepRemove: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.surface2,
  },
  stepRemoveText: {
    color: colors.danger,
    fontWeight: '900',
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
