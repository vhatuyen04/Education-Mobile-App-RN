import { readDurationMinutes } from '../utils/stepLifecycle';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '../theme/colors';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { Pill } from './Pill';
import { Step } from './StepEditorList';
import { ScheduleField } from './ScheduleField';
import { SchedulePickerModal } from './SchedulePickerModal';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import * as authApi from '../api/auth';
import { markAppGoal } from '../motivation/appGoals';
import { previewRewardsForDeadline } from '../motivation/deadlineDifficulty';
import { deadlineRetryMessage, realCivilDate } from '../utils/recurrence';
import { parseScheduleShortText as parseStoredSchedule, scheduleDraftError, stepDateAfterGoalError, stepOutsideActiveRangeError, storedScheduleError } from '../utils/stepSchedule';
import { scheduleRange } from '../utils/schedulePicker';
import { preparePlannerDraft, scheduleToShortText } from './aiPlannerDraft';
import { resolvePlannerDeadline } from './aiPlannerDeadline';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

function normStepText(t: unknown) {
  return String(t ?? '')
    // Strip common invisible/format characters that make a step look blank.
    .replace(
      /[\u00A0\u180E\u2000-\u200F\u202A-\u202E\u202F\u205F\u2060\u2066-\u2069\u200B\u200C\u200D\u2007\u3000\u2800\u3164\uFEFF]/g,
      ' '
    )
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type PlannerStep = Step & { durationMinutes?: number; schedule?: authApi.AiGoalStepSchedule; scheduleText?: string; description?: string };

function plannerStepWrite(step: PlannerStep, order: number): { error: string | null; body: any } {
  const text = step.text.trim();
  const description = String(step.description ?? '').trim() || null;
  const scheduleText = String(step.scheduleText ?? '').trim();
  const stored = scheduleText ? parseStoredSchedule(scheduleText) : null;
  const schedule = scheduleText ? parseScheduleShortText(scheduleText) : (step.schedule ?? { type: 'none' });
  const body: any = { text, order, description, durationMinutes: step.durationMinutes };
  if (stored?.repeat === 'custom') {
    body.repeat = 'custom';
    body.customDates = stored.customDates ?? [];
  } else if (schedule.type === 'once') {
    const due = parseYmd(schedule.due);
    if (due) {
      due.setHours(23, 59, 59, 999);
      body.dueAt = due.toISOString();
    }
  } else if (schedule.type === 'repeat') {
    body.repeat = schedule.repeat ?? null;
    body.repeatDay = schedule.repeatDay ?? null;
    body.repeatMonth = schedule.repeatMonth ?? null;
    body.repeatDays = schedule.repeatDays ?? null;
  }
  const error =
    (scheduleText ? scheduleDraftError(scheduleText) : null) ??
    storedScheduleError({
      dueAt: body.dueAt ?? null,
      repeat: body.repeat ?? null,
      repeatDay: body.repeatDay ?? null,
      repeatMonth: body.repeatMonth ?? null,
      customDates: body.customDates ?? null,
    });
  return { error, body };
}

function sanitizePlannerSteps(input: PlannerStep[]) {
  return input.map(step => ({ ...step, text: normStepText(step.text) })).filter(step => step.text);
}

function makeId() {
  return `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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

function parseScheduleShortText(input: string): authApi.AiGoalStepSchedule {
  const raw = String(input ?? '').trim();
  if (!raw) return { type: 'none' };

  // Reject the placeholder/template string format ("daily | weekly:Mon | ...").
  if (/[|｜¦∣]/.test(raw)) return { type: 'none' };

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
      return { type: 'repeat', repeat: 'yearly', ...(Number.isFinite(month) ? { repeatMonth: month } : null), ...(Number.isFinite(day) ? { repeatDay: day } : null) } as any;
    }
    return { type: 'repeat', repeat: 'yearly' };
  }

  return { type: 'none' };
}

function parseYmd(raw: string): Date | null {
  const text = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const civil = realCivilDate(text);
  if (!civil) return null;
  const [year, month, day] = civil.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function plannerDeadlineMessage(kind: 'missing' | 'invalid' | 'past'): string {
  if (kind === 'missing') return 'Please enter a deadline (or mention it in your plan like “in 6 weeks”).';
  if (kind === 'past') return 'The deadline is in the past. Enter today or a later date.';
  return deadlineRetryMessage();
}

export function AiPlannerModal({ visible, onClose, onSaved }: Props) {
  const { state } = useAuth();
  const { settings } = useSettings();
  const [planText, setPlanText] = useState('');
  const [deadline, setDeadline] = useState('');
  const [intensity, setIntensity] = useState<'Light' | 'Normal' | 'Hard'>('Normal');

  const [aiHelp, setAiHelp] = useState<{ message: string; questions: string[] } | null>(null);
  const [dirty, setDirty] = useState(false);

  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);

  const [goalTitle, setGoalTitle] = useState('');
  const [goalDescription, setGoalDescription] = useState('');
  const [goalField, setGoalField] = useState<'Sport' | 'Academy' | 'Entertainment'>('Academy');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [goalRequirement, setGoalRequirement] = useState('');
  const [goalExpectation, setGoalExpectation] = useState('');
  const [goalDifficultyScore, setGoalDifficultyScore] = useState<number | null>(null);
  const [goalDifficultyConfidence, setGoalDifficultyConfidence] = useState<number | null>(null);
  const [goalDifficultyReason, setGoalDifficultyReason] = useState<string | null>(null);
  const [goalSuggestionToken, setGoalSuggestionToken] = useState<string | null>(null);
  const [goalPointsAwarded, setGoalPointsAwarded] = useState<number | null>(null);
  const [goalXpAwarded, setGoalXpAwarded] = useState<number | null>(null);
  const [goalRankingEligible, setGoalRankingEligible] = useState(false);
  const [steps, setSteps] = useState<PlannerStep[]>([]);
  const [scheduleEditId, setScheduleEditId] = useState<string | null>(null);

  const shownRewards = useMemo(() => {
    if (typeof goalDifficultyScore !== 'number' || typeof goalPointsAwarded !== 'number' || typeof goalXpAwarded !== 'number') return null;
    return previewRewardsForDeadline({
      difficultyScore: goalDifficultyScore,
      pointsAwarded: goalPointsAwarded,
      xpAwarded: goalXpAwarded,
      suggestedDeadline: goalDeadline,
      chosenDeadline: goalDeadline,
    });
  }, [goalDeadline, goalDifficultyScore, goalPointsAwarded, goalXpAwarded]);
  const shownRankingEligible = goalRankingEligible;

  const templates = useMemo(
    () => [
      { label: 'Study plan', text: 'Study plan: I want to study ___ for ___ weeks.' },
      { label: 'Fitness plan', text: 'Fitness plan: I want to improve ___ in ___ weeks.' },
      { label: 'Thesis plan', text: 'Thesis plan: I want to finish chapter ___ by ___.' },
      { label: 'Balanced week', text: 'Balanced week: I need to balance study, sport and rest. I want 1 main goal and small daily tasks.' },
    ],
    []
  );

  function resetGenerated(clearPlan = false) {
    if (clearPlan) {
      setPlanText('');
      setDeadline('');
      setIntensity('Normal');
    }
    setGenerated(false);
    setGoalTitle('');
    setGoalDescription('');
    setGoalField('Academy');
    setGoalDeadline(clearPlan ? '' : deadline);
    setGoalRequirement('');
    setGoalExpectation('');
    setGoalDifficultyScore(null);
    setGoalDifficultyConfidence(null);
    setGoalDifficultyReason(null);
    setGoalSuggestionToken(null);
    setGoalPointsAwarded(null);
    setGoalXpAwarded(null);
    setGoalRankingEligible(false);
    setSteps([]);
    setAiHelp(null);
    setDirty(false);
  }

  const closeModal = useCallback(() => {
    setScheduleEditId(null);
    onClose();
  }, [onClose]);

  function insertTemplate(t: string) {
    setPlanText(t);
    setAiHelp(null);
    if (generated) setDirty(true);
  }

  function addStep() {
    setSteps(prev => [...prev, { id: makeId(), text: 'New step', description: '', scheduleText: '', schedule: { type: 'none' } }]);
  }

  function removeStep(id: string) {
    setSteps(prev => prev.filter(s => s.id !== id));
  }

  async function generate() {
    if (!planText.trim()) {
      toast('Please describe your plan first');
      return;
    }

    const selected = resolvePlannerDeadline(deadline);
    if (selected.kind !== 'resolved' && selected.kind !== 'missing') {
      toast(plannerDeadlineMessage(selected.kind));
      return;
    }

    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }

    setGenerated(false);
    setAiHelp(null);
    setDirty(false);
    setLoading(true);

    try {
      const body = { prompt: planText.trim(), intensity, deadline: selected.kind === 'resolved' ? selected.civil + 'T00:00:00.000Z' : undefined };
      let resp = await authApi.aiSuggestGoal(token, body);
      if (!resp.ok && resp.planDeadline && selected.kind === 'resolved') {
        const planDate = resp.planDeadline;
        const choice = await new Promise<string | null>(resolve => Alert.alert('Choose deadline',
          'Your description and Deadline field give different dates. Which should the goal use?', [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
            { text: 'Description: ' + planDate, onPress: () => resolve(planDate) },
            { text: 'Field: ' + selected.civil, onPress: () => resolve(selected.civil) },
          ], { cancelable: true, onDismiss: () => resolve(null) }));
        if (!choice) return;
        resp = await authApi.aiSuggestGoal(token, { ...body, deadline: choice + 'T00:00:00.000Z', deadlineConfirmed: true });
      }
      if (!resp.ok) {
        setAiHelp({ message: resp.message, questions: resp.questions ?? [] });
        return;
      }

      setGoalTitle(resp.suggestion.title);
      setGoalDescription(String(resp.suggestion.description ?? '').trim());
      setGoalField(resp.suggestion.field);
      const draft = preparePlannerDraft(resp.suggestion);
      const effectiveDeadline = draft.deadline;
      setDeadline(previous => previous === deadline && previous.trim() ? effectiveDeadline : previous);
      setGoalDeadline(effectiveDeadline);
      setGoalRequirement(resp.suggestion.requirement || '');
      setGoalExpectation(resp.suggestion.expectation || '');
      setGoalDifficultyScore(typeof resp.suggestion.difficultyScore === 'number' ? resp.suggestion.difficultyScore : null);
      setGoalDifficultyConfidence(typeof resp.suggestion.difficultyConfidence === 'number' ? resp.suggestion.difficultyConfidence : null);
      setGoalDifficultyReason(resp.suggestion.difficultyReason || null);
      setGoalSuggestionToken(resp.suggestion.suggestionToken || null);
      setGoalPointsAwarded(typeof resp.suggestion.pointsAwarded === 'number' ? resp.suggestion.pointsAwarded : null);
      setGoalXpAwarded(typeof resp.suggestion.xpAwarded === 'number' ? resp.suggestion.xpAwarded : null);
      setGoalRankingEligible(resp.suggestion.rankingEligible === true);
      const mapped = draft.steps.map(step => ({ ...step, id: makeId() }));
      const sanitized = sanitizePlannerSteps(mapped);
      setSteps(sanitized);
      setGenerated(true);
      setDirty(false);
      toast('SmartGoal suggestion ready');
    } catch (e: any) {
      toast(String(e?.message ?? 'AI failed'));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    const title = goalTitle.trim();
    const nonEmptySteps = sanitizePlannerSteps(steps);
    if (!title) {
      toast('Goal title is required');
      return;
    }

    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }

    const stepWrites = nonEmptySteps
      .map((step, order) => plannerStepWrite(step, order))
      .filter(step => step.body.text);
    for (const step of stepWrites) {
      if (step.error) {
        toast(step.error);
        return;
      }
    }

    if (loading) return;
    setLoading(true);
    try {
      if (deadline.trim() && deadline.trim() !== goalDeadline) {
        toast('Regenerate the plan to use the edited deadline.');
        return;
      }
      const resolved = resolvePlannerDeadline(goalDeadline);
      if (resolved.kind !== 'resolved') {
        toast(plannerDeadlineMessage(resolved.kind));
        return;
      }
      const dueIso = resolved.dueAt;
      for (const step of stepWrites) {
        const later = stepDateAfterGoalError(step.body?.dueAt, dueIso) ?? stepOutsideActiveRangeError(step.body ?? {}, dueIso);
        if (later) {
          toast(later);
          return;
        }
      }

      const created = await authApi.createGoal(token, {
        title,
        description: goalDescription.trim() ? goalDescription.trim() : null,
        requirement: goalRequirement.trim() ? goalRequirement.trim() : null,
        expectation: goalExpectation.trim() ? goalExpectation.trim() : null,
        rankField: goalField,
        dueAt: dueIso,
        difficultyScore: goalDifficultyScore ?? undefined,
        difficultyConfidence: goalDifficultyConfidence ?? undefined,
        difficultyReason: goalDifficultyReason ?? undefined,
        pointsAwarded: goalPointsAwarded ?? undefined,
        xpAwarded: goalXpAwarded ?? undefined,
        suggestionToken: goalSuggestionToken ?? undefined,
      });

      const goalId = created.goal.id;
      try {
        await markAppGoal(goalId);
        for (const step of stepWrites) {
          await authApi.createGoalStep(token, goalId, step.body);
        }
      } catch (stepError) {
        await authApi.deleteGoal(token, goalId).catch(() => undefined);
        throw stepError;
      }

      toast('Saved');
      onSaved?.();
      resetGenerated(true);
      onClose();
    } catch (e: any) {
      toast(String(e?.message ?? 'Save failed'));
    } finally {
      setLoading(false);
    }
  }

  const editingStep = steps.find(step => step.id === scheduleEditId);
  const scheduleDeadline = goalDeadline || null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={closeModal}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeModal} />

        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>SmartGoal Planner</Text>
            <Pressable onPress={closeModal} hitSlop={10}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.mutedSmall}>Describe your plan. SmartGoal will suggest 1 goal and a checklist. Requirement is determined completely by the SmartGoal app.</Text>
            <Text style={[styles.mutedSmall, { marginTop: 8 }]}>
              Describe your goal, activities, and any timing requirements. You can also enter a deadline below in YYYY-MM-DD format.
            </Text>
            <Text style={[styles.mutedSmall, { marginTop: 8 }]}>
              If a suggested goal is eligible for ranking, you can later submit a video to prove the achievement and compete on the ranking board. You can still complete the goal without ranking.
            </Text>

            <View style={styles.field}>
              <Text style={styles.label}>Your plan</Text>
              <TextInput
                value={planText}
                onChangeText={t => {
                  setPlanText(t);
                  setAiHelp(null);
                  if (generated) setDirty(true);
                }}
                placeholder="Example: I want to prepare for database exam in 3 weeks."
                placeholderTextColor={colors.muted}
                multiline
                style={styles.textarea}
              />
            </View>

            <View style={styles.chipsRow}>
              {templates.map(t => (
                <Pressable key={t.label} onPress={() => insertTemplate(t.text)} style={styles.chip}>
                  <Text style={styles.chipText}>{t.label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Deadline</Text>
                <TextInput
                  value={deadline}
                  onChangeText={t => {
                    setDeadline(t);
                    setAiHelp(null);
                    if (generated) setDirty(true);
                  }}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
                <Text style={[styles.mutedSmall, { marginTop: 6 }]}>Example: 2027-01-01</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Intensity</Text>
                <View style={styles.selectRow}>
                  {(['Light', 'Normal', 'Hard'] as const).map(v => (
                    <Pressable
                      key={v}
                      onPress={() => {
                        setIntensity(v);
                        setAiHelp(null);
                        if (generated) setDirty(true);
                      }}
                      style={[styles.selectOpt, intensity === v ? styles.selectOptOn : null]}
                    >
                      <Text style={[styles.selectText, intensity === v ? styles.selectTextOn : null]}>{v}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

            <View style={{ height: 10 }} />
            <Button title={generated ? 'Regenerate' : 'Generate suggestions'} variant="primary" full onPress={generate} />
            <View style={{ height: 8 }} />
            <Button title="Clear" full onPress={() => resetGenerated(true)} />

            {loading ? <Text style={[styles.mutedSmall, { marginTop: 10 }]}>Thinking…</Text> : null}

            {generated && dirty ? (
              <Text style={[styles.mutedSmall, { marginTop: 10 }]}>Plan updated. Tap Regenerate to update the goal.</Text>
            ) : null}

            {aiHelp ? (
              <Card style={{ marginTop: 12 }}>
                <Text style={[styles.cardTitle, { marginBottom: 6 }]}>AI needs more info</Text>
                <Text style={styles.mutedSmall}>{aiHelp.message}</Text>
                {aiHelp.questions?.length ? (
                  <View style={{ marginTop: 10, gap: 6 }}>
                    {aiHelp.questions.map((q, i) => (
                      <Text key={`${i}_${q}`} style={styles.mutedSmall}>
                        {i + 1}. {q}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </Card>
            ) : null}

            {generated ? (
              <View style={{ marginTop: 12, gap: 12 }}>
                <Card>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>Suggested goal</Text>
                  </View>

                  <View style={[styles.field, { marginTop: 10 }]}
                  >
                    <Text style={styles.label}>Goal title</Text>
                    <Text style={styles.stepItemText}>{goalTitle}</Text>
                  </View>

                  {goalDescription.trim() ? (
                    <View style={[styles.field, { marginTop: 10 }]}>
                      <Text style={styles.label}>Description</Text>
                      <Text style={styles.mutedSmall}>{goalDescription.trim()}</Text>
                    </View>
                  ) : null}

                  {shownRankingEligible && settings.rankingMode ? (
                    <View style={[styles.field, { marginTop: 10 }]}>
                      <Text style={styles.label}>Ranking requirement</Text>
                      <Text style={styles.mutedSmall}>{goalRequirement || '—'}</Text>
                    </View>
                  ) : goalExpectation.trim() ? (
                    <View style={[styles.field, { marginTop: 10 }]}>
                      <Text style={styles.label}>Expectation</Text>
                      <Text style={styles.mutedSmall}>{goalExpectation.trim()}</Text>
                    </View>
                  ) : null}

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <Pill>Field: {goalField}</Pill>
                    <Pill>Deadline: {goalDeadline || '—'}</Pill>
                    {shownRewards ? <Pill>Points: {shownRewards.pointsAwarded}</Pill> : null}
                    {shownRewards ? <Pill>XP: {shownRewards.xpAwarded}</Pill> : null}
                    <Pill>{shownRankingEligible ? 'Eligible' : 'Non eligible'}</Pill>
                  </View>
                </Card>

                <Card>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>Steps</Text>
                    <Badge>{steps.length} steps</Badge>
                  </View>

                  <View style={{ marginTop: 10 }}>
                    <View style={{ gap: 10 }}>
                      {steps.map((s, idx) => (
                        <View key={s.id} style={styles.stepItemRow}>
                          <View style={styles.stepHead}>
                            <Text style={styles.stepLabel}>Step {idx + 1}</Text>
                            <Pressable onPress={() => removeStep(s.id)} hitSlop={10} style={styles.stepRemove}>
                              <Text style={styles.stepRemoveText}>🗑</Text>
                            </Pressable>
                          </View>
                          <Text style={styles.stepLabel}>Title</Text>
                          <TextInput
                            value={s.text}
                            onChangeText={t => {
                              setSteps(prev => prev.map(p => (p.id === s.id ? { ...p, text: t } : p)));
                            }}
                            placeholder="What will you do?"
                            placeholderTextColor={colors.muted}
                            multiline
                            style={styles.input}
                          />
                          <Text style={styles.stepLabel}>Description</Text>
                          <TextInput
                            value={s.description ?? ''}
                            onChangeText={t => {
                              setSteps(prev => prev.map(p => (p.id === s.id ? { ...p, description: t } : p)));
                            }}
                            placeholder="Optional detail"
                            placeholderTextColor={colors.muted}
                            multiline
                            style={styles.input}
                          />
                          <Text style={styles.stepLabel}>Duration (minutes)</Text>
                          <TextInput
                            value={s.durationMinutes?.toString() ?? ''}
                            onChangeText={value => {
                              const minutes = readDurationMinutes(value);
                              if (minutes === 'invalid' || (minutes != null && minutes > 2147483647)) return;
                              setSteps(prev => prev.map(step => step.id === s.id ? { ...step, durationMinutes: minutes ?? undefined } : step));
                            }}
                            keyboardType="number-pad"
                            placeholder="Optional"
                            placeholderTextColor={colors.muted}
                            style={styles.input}
                          />
                          <ScheduleField
                            value={s.scheduleText ?? scheduleToShortText(s.schedule)}
                            onPress={() => setScheduleEditId(s.id)}
                          />
                        </View>
                      ))}
                    </View>
                  </View>

                  <View style={{ height: 10 }} />
                  <Button title={'+ Add step'} full onPress={addStep} />
                </Card>

                <View style={{ gap: 8 }}>
                  <Button title={'Save'} variant="primary" full onPress={save} />
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
      <SchedulePickerModal
        visible={visible && scheduleEditId != null}
        initialText={editingStep?.scheduleText ?? scheduleToShortText(editingStep?.schedule)}
        range={scheduleRange(scheduleDeadline)}
        onCancel={() => setScheduleEditId(null)}
        onConfirm={text => {
          if (scheduleEditId) {
            setSteps(prev => prev.map(step => (
              step.id === scheduleEditId
                ? { ...step, scheduleText: text, schedule: parseScheduleShortText(text) }
                : step
            )));
          }
          setScheduleEditId(null);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingTop: 12,
    height: '90%',
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  close: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  mutedSmall: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  field: {
    marginTop: 10,
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 6,
  },
  textarea: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    borderRadius: 14,
    padding: 10,
    color: colors.text,
    fontWeight: '800',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: colors.text,
    fontWeight: '900',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
  },
  chipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  row2: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  selectRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectOpt: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
  },
  selectOptOn: {
    backgroundColor: colors.primary,
    borderColor: 'transparent',
  },
  selectText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  selectTextOn: {
    color: '#06101f',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  hint: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  stepRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 14,
  },
  stepRowDone: {
    opacity: 0.92,
  },
  stepCheck: {
    width: 18,
    height: 18,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCheckOn: {
    backgroundColor: colors.success,
    borderColor: 'transparent',
  },
  stepCheckMark: {
    color: colors.surface,
    fontWeight: '900',
    fontSize: 12,
    lineHeight: 12,
  },
  stepLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  stepText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
  stepItemRow: {
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 14,
  },
  stepHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepNum: {
    color: colors.muted,
    fontWeight: '900',
    width: 20,
    textAlign: 'right',
    paddingTop: 1,
  },
  stepItemText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  stepTextCol: {
    flex: 1,
    minWidth: 0,
  },
  stepScheduleCol: {
    gap: 6,
    alignItems: 'flex-end',
    flexShrink: 1,
    maxWidth: 170,
  },
  stepScheduleInput: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    minWidth: 120,
    maxWidth: 170,
    flexShrink: 1,
  },
  stepRemove: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  stepRemoveText: {
    color: colors.danger,
    fontWeight: '900',
  },
});
