import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Pill } from '../components/Pill';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import * as authApi from '../api/auth';
import { goalSuccessMessage } from '../motivation/completionMessage';
import { isAppGoal, markAppGoal, unmarkAppGoal } from '../motivation/appGoals';
import { getFailedReason, type FailedReason } from '../motivation/failedGoals';
import { appendScorePoint } from '../motivation/scoreHistory';
import type { RootStackParamList } from '../navigation/types';
import { ScheduleField } from '../components/ScheduleField';
import { SchedulePickerModal } from '../components/SchedulePickerModal';
import { legacyScheduleNote, parseScheduleShortText, scheduleDraftError, scheduleToShortText, stepDateAfterGoalError, stepOutsideActiveRangeError, storedScheduleError } from '../utils/stepSchedule';
import { compactScheduleLabel, scheduleRange } from '../utils/schedulePicker';
import { civilLabel, deadlineError, deadlineRetryMessage, utcMidnightIsoFromCivilText } from '../utils/recurrence';
import { DELETE_STEP_MESSAGE, readDurationMinutes, schedulePhrase } from '../utils/stepLifecycle';
import { autoScheduleRemindersForSignedInUser } from '../notifications/scheduler';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'GoalDetail'>;

function stripLegacyStepsFromGoalTitle(raw: string): string {
  const s = String(raw ?? '');
  const idx = s.toLowerCase().indexOf('steps:');
  return (idx >= 0 ? s.slice(0, idx) : s).trim();
}

function shownDuration(value: string): string | null {
  const minutes = readDurationMinutes(value);
  return typeof minutes === 'number' ? `${minutes} min` : null;
}

function makeId() {
  return `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toYmdLocal(d: Date) {
  return civilLabel(d);
}

type UiStep = {
  id: string;
  serverId?: string;
  text: string;
  description: string;
  scheduleText: string;
  scheduleBaseline: string;
  scheduleWarning: string | null;
  preserveStoredSchedule: boolean;
  durationText: string;
  archivedAt: string | null;
};

export function GoalDetailScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<R>();
  const { state } = useAuth();
  const { settings } = useSettings();

  const goalId = route.params?.id;
  const initialTitle = stripLegacyStepsFromGoalTitle(route.params?.title || 'New goal');

  const [title, setTitle] = useState(initialTitle);
  const [desc, setDesc] = useState('');
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [requirement, setRequirement] = useState<string>('');
  const [expectation, setExpectation] = useState('');
  const [pointsAwarded, setPointsAwarded] = useState<number | null>(null);
  const [xpAwarded, setXpAwarded] = useState<number | null>(null);
  const [difficultyScore, setDifficultyScore] = useState<number | null>(null);
  const [rankingEligible, setRankingEligible] = useState(false);
  const [rankingReason, setRankingReason] = useState<string | null>(null);
  const [requirementSource, setRequirementSource] = useState<'USER' | 'AI' | null>(null);
  const [rankingProofStatus, setRankingProofStatus] = useState<authApi.SmartGoalProofStatus | null>(null);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [steps, setSteps] = useState<UiStep[]>([]);
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [isSmartGoal, setIsSmartGoal] = useState(false);
  const [failedReason, setFailedReason] = useState<FailedReason | null>(null);

  const [deadlineModalOpen, setDeadlineModalOpen] = useState(false);
  const [deadlineDraft, setDeadlineDraft] = useState('');

  const [completeConfirmOpen, setCompleteConfirmOpen] = useState(false);
  const [stepConfirmOpen, setStepConfirmOpen] = useState(false);
  const [deleteStepId, setDeleteStepId] = useState<string | null>(null);
  const [scheduleEditId, setScheduleEditId] = useState<string | null>(null);

  const completeConfirmKey = useMemo(() => {
    const id = String(goalId ?? '').trim();
    return `goal_complete_confirmed_v1_${id || 'new'}`;
  }, [goalId]);

  const deadlineLabel = useMemo(() => {
    if (!dueAt) return 'None';
    const d = new Date(dueAt);
    if (!Number.isFinite(d.getTime())) return 'None';
    return d.toLocaleDateString();
  }, [dueAt]);

  const statusLabel = useMemo(() => {
    if (completed) return { label: 'Completed', reason: null as string | null };
    const isExpired = (() => {
      if (!dueAt) return false;
      const t = new Date(dueAt).getTime();
      return Number.isFinite(t) && t > 0 && t < Date.now();
    })();

    const effectiveReason: FailedReason | null = failedReason ?? (isExpired ? 'expired' : null);
    if (effectiveReason) {
      return {
        label: 'Failed',
        reason: effectiveReason === 'gave_up' ? 'Gave up' : 'Expired',
      };
    }
    return { label: 'Active', reason: null as string | null };
  }, [completed, dueAt, failedReason]);

  const stepCount = useMemo(() => steps.filter(s => s.text.trim()).length, [steps]);

  const refresh = useCallback(async () => {
    if (!goalId) return;
    const token = state.accessToken;
    if (!token) return;
    try {
      const app = await isAppGoal(goalId);
      setIsSmartGoal(app);

      const fr = await getFailedReason(goalId);

      const resp = await authApi.getGoal(token, goalId);
      const serverIsAi = resp.goal.requirementSource === 'AI';
      if (app && !serverIsAi) await unmarkAppGoal(goalId);
      if (!app && serverIsAi) await markAppGoal(goalId);
      setIsSmartGoal(serverIsAi);
      const serverFailedReason: FailedReason | null = resp.goal.failedAt
        ? (resp.goal.failedReason === 'GAVE_UP' ? 'gave_up' : 'expired')
        : null;
      setFailedReason(fr ?? serverFailedReason);
      setTitle(stripLegacyStepsFromGoalTitle(resp.goal.title));
      const rawDesc = resp.goal.description ?? '';
      if (serverIsAi && (!rawDesc || rawDesc.toLowerCase().includes('ai recommended goal'))) {
        setDesc('SmartGoal recommended goal');
      } else {
        setDesc(rawDesc);
      }
      setDueAt(resp.goal.dueAt ?? null);
      setRequirement(String(resp.goal.requirement ?? ''));
      setExpectation(String(resp.goal.expectation ?? ''));
      setRequirementSource(resp.goal.requirementSource ?? null);
      setRankingEligible(resp.goal.rankingEligible === true);
      setRankingReason(resp.goal.rankingEligibilityReason ?? null);
      setDifficultyScore(typeof resp.goal.difficultyScore === 'number' ? resp.goal.difficultyScore : null);
      if (resp.goal.requirementSource === 'AI') {
        setPointsAwarded(typeof resp.goal.pointsAwarded === 'number' ? resp.goal.pointsAwarded : null);
        setXpAwarded(typeof resp.goal.xpAwarded === 'number' ? resp.goal.xpAwarded : null);
      } else {
        setPointsAwarded(null);
        setXpAwarded(null);
      }
      if (resp.goal.completed && resp.goal.rankingEligible === true) {
        const latest = await authApi.getLatestSmartGoalProofAttempt(token, goalId);
        setRankingProofStatus(latest.attempt?.status ?? null);
      } else {
        setRankingProofStatus(null);
      }
      setDeadlineDraft(resp.goal.dueAt ? toYmdLocal(new Date(resp.goal.dueAt)) : '');
      setCompleted(!!resp.goal.completed);
      setCompletedAt(resp.goal.completedAt ?? null);
      const stepResp = await authApi.listGoalSteps(token, goalId);
      const uiSteps: UiStep[] = stepResp.steps.map(s => ({
        id: makeId(),
        serverId: s.id,
        text: s.text,
        description: s.description ?? '',
        scheduleText: scheduleToShortText(s),
        scheduleBaseline: scheduleToShortText(s),
        scheduleWarning: legacyScheduleNote(s),
        preserveStoredSchedule: !!legacyScheduleNote(s),
        durationText: s.durationMinutes ? String(s.durationMinutes) : '',
        archivedAt: s.archivedAt ?? null,
      }));
      setSteps(uiSteps);
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to load'));
    }
  }, [goalId, state.accessToken]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  function addStep() {
    if (completed) return;
    setSteps(prev => [...prev, { id: makeId(), text: 'New step', description: '', scheduleText: '', scheduleBaseline: '', scheduleWarning: null, preserveStoredSchedule: false, durationText: '', archivedAt: null }]);
  }

  function removeStep(id: string) {
    if (completed) return;
    setSteps(prev => prev.filter(s => s.id !== id));
  }

  function setStepText(id: string, text: string) {
    if (completed) return;
    setSteps(prev => prev.map(s => (s.id === id ? { ...s, text } : s)));
  }

  function setStepDescription(id: string, description: string) {
    if (completed) return;
    setSteps(prev => prev.map(s => (s.id === id ? { ...s, description } : s)));
  }

  function setStepScheduleText(id: string, scheduleText: string) {
    if (completed) return;
    setSteps(prev => prev.map(s => (s.id === id ? { ...s, scheduleText, scheduleWarning: legacyScheduleNote(parseScheduleShortText(scheduleText)) } : s)));
  }

  function setStepDuration(id: string, durationText: string) {
    if (completed) return;
    setSteps(prev => prev.map(s => (s.id === id ? { ...s, durationText } : s)));
  }

  function openDeadlineEditor() {
    if (completed) return;
    if (isSmartGoal) return;
    setDeadlineDraft(dueAt ? toYmdLocal(new Date(dueAt)) : '');
    setDeadlineModalOpen(true);
  }

  function closeDeadlineEditor() {
    setDeadlineModalOpen(false);
  }

  function applyDeadlineDraft() {
    const raw = String(deadlineDraft ?? '').trim();
    if (!raw) {
      setDueAt(null);
      closeDeadlineEditor();
      return;
    }
    const error = deadlineError(raw);
    if (error) {
      toast(error);
      return;
    }
    const iso = utcMidnightIsoFromCivilText(raw);
    if (!iso) {
      toast(deadlineRetryMessage());
      return;
    }
    setDueAt(iso);
    closeDeadlineEditor();
  }

  async function saveImpl(opts: { finish: boolean }) {
    if (saving) return;
    if (completed) {
      toast('Completed goals cannot be edited');
      return;
    }
    const t = stripLegacyStepsFromGoalTitle(title);
    if (!t) {
      toast('Goal name is required');
      return;
    }

    if (!isSmartGoal && dueAt) {
      const dueCivil = civilLabel(new Date(dueAt));
      const error = !Number.isFinite(new Date(dueAt).getTime()) ? deadlineRetryMessage() : deadlineError(dueCivil);
      if (error) {
        toast(error);
        return;
      }
    }

    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }

    for (const s of steps) {
      if (!s.text.trim() || s.serverId) continue;
      if (readDurationMinutes(s.durationText) === 'invalid') {
        toast('Duration must be a positive number of minutes');
        return;
      }
      const parsedSchedule = parseScheduleShortText(s.scheduleText);
      const scheduleError = scheduleDraftError(s.scheduleText) ?? storedScheduleError(parsedSchedule) ?? stepDateAfterGoalError(parsedSchedule.dueAt, dueAt) ?? stepOutsideActiveRangeError(parsedSchedule, dueAt);
      const unchangedLegacy = !!s.serverId && s.preserveStoredSchedule && s.scheduleText.trim() === s.scheduleBaseline.trim();
      if (scheduleError && !unchangedLegacy) {
        toast(scheduleError);
        return;
      }
    }

    setSaving(true);
    let createdGoalId: string | null = null;
    try {
      let effectiveGoalId = goalId;
      const wasNew = !effectiveGoalId;
      if (effectiveGoalId) {
        if (!isSmartGoal) {
          await authApi.updateGoal(token, effectiveGoalId, {
            title: t,
            description: desc.trim() ? desc : null,
            requirement: requirement.trim() ? requirement.trim() : null,
            dueAt: dueAt ? dueAt : null,
          });
        }
      } else {
        const created = await authApi.createGoal(token, {
          title: t,
          description: desc.trim() ? desc : null,
          requirement: requirement.trim() ? requirement.trim() : null,
          ...(isSmartGoal ? null : { dueAt: dueAt ? dueAt : undefined }),
        });
        createdGoalId = created.goal.id;
        effectiveGoalId = created.goal.id;

        // Explicitly treat goals created from this screen as user custom goals.
        await unmarkAppGoal(effectiveGoalId);
      }

      const serverSteps = effectiveGoalId ? await authApi.listGoalSteps(token, effectiveGoalId) : { steps: [] as authApi.GoalStepItem[] };

      const updatedSteps = steps.map(s => ({ ...s }));

      const currentServerIds = new Set(steps.map(s => s.serverId).filter(Boolean) as string[]);
      for (const s of serverSteps.steps) {
        if (!currentServerIds.has(s.id)) {
          await authApi.deleteGoalStep(token, { goalId: effectiveGoalId!, stepId: s.id });
        }
      }

      for (let i = 0; i < steps.length; i++) {
        const s = updatedSteps[i];
        const text = s.text.trim();
        if (!text || s.serverId) continue;
        const schedule = parseScheduleShortText(s.scheduleText);
        const description = s.description.trim() ? s.description.trim() : null;
        const minutes = readDurationMinutes(s.durationText);
        const created = await authApi.createGoalStep(token, effectiveGoalId!, {
          text,
          description,
          order: i,
          durationMinutes: minutes === 'invalid' ? null : minutes,
          ...schedule,
        });
        s.serverId = created.step.id;
        s.archivedAt = null;
      }

      setSteps(updatedSteps);

      if (opts.finish && effectiveGoalId && !wasNew) {
        const updated = await authApi.updateGoal(token, effectiveGoalId, { completed: true });

        try {
          const dash = await authApi.getDashboard(token);
          await appendScorePoint(dash.score ?? 0);
        } catch {
          // ignore
        }

        toast(goalSuccessMessage(updated.rewardsApplied?.xp ?? 0));
      } else {
        toast('Saved');
      }
      void autoScheduleRemindersForSignedInUser({ minIntervalMs: 0 });
      nav.goBack();
    } catch (e: any) {
      if (createdGoalId) await authApi.deleteGoal(token, createdGoalId).catch(() => undefined);
      toast(String(e?.message ?? 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    const fresh = steps.filter(step => !step.serverId && step.text.trim());
    if (fresh.length) {
      setStepConfirmOpen(true);
      return;
    }
    await saveImpl({ finish: false });
  }

  async function confirmDeleteStep() {
    const localId = deleteStepId;
    const step = steps.find(item => item.id === localId);
    setDeleteStepId(null);
    if (!step) return;
    if (!step.serverId) {
      setSteps(prev => prev.filter(item => item.id !== step.id));
      return;
    }
    const token = state.accessToken;
    if (!token || !goalId) return;
    try {
      await authApi.deleteGoalStep(token, { goalId, stepId: step.serverId });
      setSteps(prev => prev.map(item => (item.id === step.id ? { ...item, archivedAt: new Date().toISOString() } : item)));
      toast('Step archived');
    } catch (error: any) {
      toast(String(error?.message ?? 'Could not delete the step'));
    }
  }

  async function finish() {
    if (!goalId) return;
    try {
      const raw = await AsyncStorage.getItem(completeConfirmKey);
      if (raw === '1') {
        await saveImpl({ finish: true });
        return;
      }
    } catch {
    }

    setCompleteConfirmOpen(true);
  }

  async function confirmComplete() {
    setCompleteConfirmOpen(false);
    try {
      await AsyncStorage.setItem(completeConfirmKey, '1');
    } catch {
    }
    await saveImpl({ finish: true });
  }

  const rankingWindowClosed = completedAt != null && Date.now() > new Date(completedAt).getTime() + 3 * 24 * 60 * 60 * 1000;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hTitle}>Goal detail</Text>
            <View style={styles.hSub}>
              <Pill dot>Edit</Pill>
              <Pill>Steps</Pill>
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
          <View style={[styles.field, { marginTop: 0 }]}>
            <Text style={styles.label}>Goal name</Text>
            {isSmartGoal ? (
              <Text style={styles.input}>{title}</Text>
            ) : (
              <TextInput
                value={title}
                onChangeText={setTitle}
                editable={!completed}
                placeholder=""
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Deadline</Text>
            <Pressable
              onPress={openDeadlineEditor}
              style={({ pressed }) => [styles.deadlinePill, pressed && !completed && !isSmartGoal ? { opacity: 0.85 } : null]}
            >
              <Text style={styles.deadlineText}>{deadlineLabel}</Text>
            </Pressable>
            {!completed && !isSmartGoal ? <Text style={styles.meta}>Tap to edit (YYYY-MM-DD)</Text> : null}
          </View>

          {requirementSource === 'AI' && (typeof pointsAwarded === 'number' || typeof xpAwarded === 'number') ? (
            <View style={styles.field}>
              <Text style={styles.label}>Rewards</Text>
              <View style={styles.hSub}>
                {typeof pointsAwarded === 'number' ? <Pill>Points: {pointsAwarded}</Pill> : null}
                {typeof xpAwarded === 'number' ? <Pill>XP: {xpAwarded}</Pill> : null}
              </View>
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.label}>Status</Text>
            <View style={styles.statusRow}>
              <View style={styles.statusPill}>
                <Text style={styles.statusText}>{statusLabel.label}</Text>
              </View>
              {statusLabel.reason ? <Text style={styles.meta}>Reason: {statusLabel.reason}</Text> : null}
            </View>
          </View>

          {completed && requirementSource === 'AI' && rankingEligible && !failedReason ? (
            <View style={styles.field}>
              <Text style={styles.label}>Ranking</Text>
              <Text style={styles.meta}>Difficulty: {difficultyScore ?? '—'}</Text>
              <Text style={styles.meta}>Potential ranking points: {pointsAwarded ?? '—'}</Text>
              <Text style={styles.meta}>{rankingReason || 'This goal can be submitted for ranking.'}</Text>
              {rankingProofStatus === 'APPROVED' ? <Text style={styles.meta}>Ranking points were awarded for this goal.</Text> : null}
              {rankingProofStatus === 'PENDING_REVIEW' ? <Text style={styles.meta}>Ranking proof is waiting for admin review. Completion and XP stay as they are.</Text> : null}
              {rankingProofStatus === 'REJECTED' || rankingProofStatus === 'NEEDS_CLARIFICATION' ? <Text style={styles.meta}>The last proof was rejected. Completion and XP were not changed.</Text> : null}
              {settings.rankingMode && rankingProofStatus !== 'APPROVED' && rankingProofStatus !== 'PENDING_REVIEW' && !rankingWindowClosed ? (
                <View style={{ marginTop: 8 }}>
                  <Button
                    title="Submit for Ranking"
                    onPress={() => {
                      if (!goalId) return;
                      nav.navigate('SmartGoalProof', { goalId, goalTitle: title, requirementText: requirement });
                    }}
                  />
                </View>
              ) : null}
              {rankingWindowClosed && rankingProofStatus !== 'APPROVED' ? <Text style={styles.meta}>The 3-day ranking deadline has passed.</Text> : null}
              <Text style={styles.meta}>Ranking is optional. Skipping it keeps this goal completed and keeps the XP already awarded.</Text>
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              value={desc}
              onChangeText={setDesc}
              editable={!completed && !isSmartGoal}
              placeholder="Describe your goal..."
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
            />
          </View>

          {isSmartGoal ? (
            expectation.trim() ? (
              <View style={styles.field}>
                <Text style={styles.label}>Expectation</Text>
                <Text style={styles.meta}>{expectation.trim()}</Text>
              </View>
            ) : null
          ) : (
            <View style={styles.field}>
              <Text style={styles.label}>Expectation (Optional)</Text>
              <TextInput
                value={requirement}
                onChangeText={setRequirement}
                placeholder="What does finishing this goal look like?"
                placeholderTextColor={colors.muted}
                editable
                style={styles.input}
                multiline
              />
            </View>
          )}

          <View style={styles.divider} />

          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Steps</Text>
            <Badge>
              {stepCount}
            </Badge>
          </View>

          <View style={{ marginTop: 10 }}>
            <View style={{ gap: 10 }}>
              {steps.map((s, idx) => (
                <View key={s.id} style={styles.stepRow}>
                  <View style={styles.stepMain}>
                    <Text style={styles.stepLabel}>{s.archivedAt ? 'Archived' : `Step ${idx + 1}`}</Text>
                    {s.serverId ? (
                      <Pressable onPress={() => goalId ? nav.navigate('StepDetail', { goalId, stepId: s.serverId! }) : undefined}>
                        <Text style={styles.stepInput}>{s.text}</Text>
                        {s.description ? <Text style={styles.meta}>{s.description}</Text> : null}
                        <Text style={styles.meta}>{schedulePhrase({ ...parseScheduleShortText(s.scheduleText), scheduleText: s.scheduleText })}</Text>
                        {shownDuration(s.durationText) ? <Text style={styles.meta}>{shownDuration(s.durationText)}</Text> : null}
                        {s.archivedAt ? <Text style={styles.meta}>History is read only</Text> : null}
                      </Pressable>
                    ) : (
                      <>
                        <Text style={[styles.stepLabel, { marginTop: 6 }]}>Title</Text>
                        <TextInput value={s.text} onChangeText={t2 => setStepText(s.id, t2)} editable={!completed} placeholderTextColor={colors.muted} multiline textAlignVertical="top" style={styles.stepInput} />
                        <Text style={[styles.stepLabel, { marginTop: 6 }]}>Description</Text>
                        <TextInput value={s.description} onChangeText={t2 => setStepDescription(s.id, t2)} editable={!completed} placeholder="Optional" placeholderTextColor={colors.muted} multiline textAlignVertical="top" style={styles.stepInput} />
                        <ScheduleField value={s.scheduleText} onPress={() => setScheduleEditId(s.id)} editable={!completed} />
                        <Text style={[styles.stepLabel, { marginTop: 6 }]}>Minutes (optional)</Text>
                        <TextInput value={s.durationText} onChangeText={t2 => setStepDuration(s.id, t2)} editable={!completed} placeholder="25" placeholderTextColor={colors.muted} keyboardType="number-pad" style={styles.stepScheduleInput} />
                        {s.scheduleWarning ? <Text style={[styles.stepLabel, { marginTop: 4 }]}>{s.scheduleWarning}</Text> : null}
                        <Text style={styles.meta}>{[s.text.trim() || 'Untitled', s.description.trim() || 'No description', compactScheduleLabel(s.scheduleText), shownDuration(s.durationText)].filter(Boolean).join(' · ')}</Text>
                      </>
                    )}
                  </View>

                  {!completed && !s.archivedAt ? (
                    <Pressable onPress={() => (s.serverId ? setDeleteStepId(s.id) : removeStep(s.id))} hitSlop={10} style={styles.stepTrash}>
                      <Text style={{ color: colors.danger, fontWeight: '900' }}>🗑</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          </View>

          <View style={{ height: 10 }} />
          {!completed && !failedReason ? (
            <View style={{ gap: 10 }}>
              <Button title={'+ Add step'} full onPress={addStep} />
              <Button title={'Save'} full onPress={save} />
              {goalId ? <Button title={'Complete goal'} variant="primary" full onPress={finish} /> : null}
            </View>
          ) : null}
        </Card>
      </ScrollView>

      <Modal visible={stepConfirmOpen} transparent animationType="fade" onRequestClose={() => setStepConfirmOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setStepConfirmOpen(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Save new steps</Text>
            <Text style={styles.meta}>These fields stay as entered. Replacing a saved step later archives it and starts a new one.</Text>
            {steps.filter(step => !step.serverId && step.text.trim()).map(step => (
              <Text key={step.id} style={styles.meta}>{[step.text.trim(), step.description.trim() || 'No description', compactScheduleLabel(step.scheduleText), shownDuration(step.durationText)].filter(Boolean).join(' · ')}</Text>
            ))}
            <View style={styles.rowEnd}>
              <Button title="Cancel" onPress={() => setStepConfirmOpen(false)} />
              <Button title="Save" variant="primary" onPress={() => { setStepConfirmOpen(false); void saveImpl({ finish: false }); }} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={deleteStepId != null} transparent animationType="fade" onRequestClose={() => setDeleteStepId(null)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDeleteStepId(null)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Delete step</Text>
            <Text style={styles.meta}>{DELETE_STEP_MESSAGE}</Text>
            <View style={styles.rowEnd}>
              <Button title="Cancel" onPress={() => setDeleteStepId(null)} />
              <Button title="Delete" variant="danger" onPress={() => void confirmDeleteStep()} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={completeConfirmOpen} transparent animationType="fade" onRequestClose={() => setCompleteConfirmOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setCompleteConfirmOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Confirm complete</Text>
              <Pressable onPress={() => setCompleteConfirmOpen(false)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.meta}>Are you sure you completed this goal?</Text>
            <View style={styles.divider} />
            <View style={styles.rowEnd}>
              <Button title="No" onPress={() => setCompleteConfirmOpen(false)} />
              <Button title="Yes" variant="primary" onPress={confirmComplete} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={deadlineModalOpen} transparent animationType="fade" onRequestClose={closeDeadlineEditor}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDeadlineEditor} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Edit deadline</Text>
              <Pressable onPress={closeDeadlineEditor} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.meta}>Enter a date (YYYY-MM-DD). Past dates are not allowed.</Text>
            <View style={{ height: 10 }} />
            <TextInput
              value={deadlineDraft}
              onChangeText={setDeadlineDraft}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.muted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.divider} />
            <View style={styles.rowEnd}>
              <Button title="Clear" onPress={() => {
                setDeadlineDraft('');
                setDueAt(null);
                closeDeadlineEditor();
              }} />
              <Button title="Save" variant="primary" onPress={applyDeadlineDraft} />
            </View>
          </View>
        </View>
      </Modal>
      <SchedulePickerModal
        visible={scheduleEditId != null}
        initialText={steps.find(step => step.id === scheduleEditId)?.scheduleText ?? ''}
        range={scheduleRange(dueAt)}
        onCancel={() => setScheduleEditId(null)}
        onConfirm={text => {
          if (scheduleEditId) setStepScheduleText(scheduleEditId, text);
          setScheduleEditId(null);
        }}
      />
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
    gap: 12,
  },
  hTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  hSub: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
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
  meta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  deadlinePill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deadlineText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
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
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 12,
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
  stepRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 14,
  },
  stepMain: {
    flex: 1,
    minWidth: 0,
  },
  stepLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  stepInput: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    paddingVertical: 6,
    paddingHorizontal: 0,
    minHeight: 40,
  },
  stepScheduleInput: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.text,
    fontWeight: '800',
    marginTop: 6,
  },
  stepTrash: {
    paddingHorizontal: 6,
    paddingVertical: 6,
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
  rowEnd: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    alignItems: 'center',
  },
});
