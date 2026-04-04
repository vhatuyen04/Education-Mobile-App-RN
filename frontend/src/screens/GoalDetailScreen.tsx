import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Pill } from '../components/Pill';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'GoalDetail'>;

function stripLegacyStepsFromGoalTitle(raw: string): string {
  const s = String(raw ?? '');
  const idx = s.toLowerCase().indexOf('steps:');
  return (idx >= 0 ? s.slice(0, idx) : s).trim();
}

function makeId() {
  return `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

type UiStep = {
  id: string;
  serverId?: string;
  text: string;
  scheduleText: string;
};

function formatWeekday(d: number | null | undefined) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (d === null || d === undefined) return '';
  const idx = Number(d);
  if (!Number.isFinite(idx) || idx < 0 || idx > 6) return '';
  return days[idx];
}

function scheduleToShortText(step: authApi.GoalStepItem): string {
  if (step.dueAt) {
    const d = new Date(step.dueAt);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `once:${y}-${m}-${day}`;
  }
  const repeat = (step.repeat ?? '').trim().toLowerCase();
  if (!repeat) return '';
  if (repeat === 'daily') return 'daily';
  if (repeat === 'weekly') return step.repeatDay !== null && step.repeatDay !== undefined ? `weekly:${formatWeekday(step.repeatDay) || String(step.repeatDay)}` : 'weekly';
  if (repeat === 'monthly') return step.repeatDay !== null && step.repeatDay !== undefined ? `monthly:${String(step.repeatDay)}` : 'monthly';
  if (repeat === 'yearly') {
    if (step.repeatMonth && step.repeatDay) {
      return `yearly:${String(step.repeatMonth).padStart(2, '0')}-${String(step.repeatDay).padStart(2, '0')}`;
    }
    return 'yearly';
  }
  return `repeat:${step.repeat}`;
}

function parseWeekdayToken(token: string): number | null {
  const t = token.trim().toLowerCase();
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
  if (t in map) return map[t];
  const n = Number(t);
  if (Number.isFinite(n) && n >= 0 && n <= 6) return n;
  return null;
}

function parseScheduleShortText(input: string): {
  dueAt?: string | null;
  repeat?: string | null;
  repeatDay?: number | null;
  repeatMonth?: number | null;
} {
  const raw = String(input ?? '').trim();
  if (!raw) return { dueAt: null, repeat: null, repeatDay: null, repeatMonth: null };
  const lower = raw.toLowerCase();

  if (lower.startsWith('once:')) {
    const due = raw.slice(5).trim();
    const m = due.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { dueAt: null, repeat: null, repeatDay: null, repeatMonth: null };
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
    return { dueAt: d.toISOString(), repeat: null, repeatDay: null, repeatMonth: null };
  }

  if (lower === 'daily') return { dueAt: null, repeat: 'daily', repeatDay: null, repeatMonth: null };

  if (lower === 'weekly') return { dueAt: null, repeat: 'weekly', repeatDay: null, repeatMonth: null };
  if (lower.startsWith('weekly:')) {
    const tok = raw.slice(7).trim();
    const dow = parseWeekdayToken(tok);
    return { dueAt: null, repeat: 'weekly', repeatDay: dow, repeatMonth: null };
  }

  if (lower === 'monthly') return { dueAt: null, repeat: 'monthly', repeatDay: null, repeatMonth: null };
  if (lower.startsWith('monthly:')) {
    const tok = raw.slice(8).trim();
    const day = Number(tok);
    return { dueAt: null, repeat: 'monthly', repeatDay: Number.isFinite(day) ? day : null, repeatMonth: null };
  }

  if (lower === 'yearly') return { dueAt: null, repeat: 'yearly', repeatDay: null, repeatMonth: null };
  if (lower.startsWith('yearly:')) {
    const tok = raw.slice(7).trim();
    const m = tok.match(/^(\d{1,2})\s*[-/.,]\s*(\d{1,2})$/);
    if (!m) return { dueAt: null, repeat: 'yearly', repeatDay: null, repeatMonth: null };
    const month = Number(m[1]);
    const day = Number(m[2]);
    return {
      dueAt: null,
      repeat: 'yearly',
      repeatMonth: Number.isFinite(month) ? month : null,
      repeatDay: Number.isFinite(day) ? day : null,
    };
  }

  if (lower.startsWith('repeat:')) {
    const repeat = raw.slice(7).trim();
    return { dueAt: null, repeat: repeat || null, repeatDay: null, repeatMonth: null };
  }

  return { dueAt: null, repeat: raw, repeatDay: null, repeatMonth: null };
}

export function GoalDetailScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<R>();
  const { state } = useAuth();

  const goalId = route.params?.id;
  const initialTitle = stripLegacyStepsFromGoalTitle(route.params?.title || 'New goal');

  const [title, setTitle] = useState(initialTitle);
  const [desc, setDesc] = useState('');
  const [steps, setSteps] = useState<UiStep[]>([]);
  const [saving, setSaving] = useState(false);

  const stepCount = useMemo(() => steps.filter(s => s.text.trim()).length, [steps]);

  const refresh = useCallback(async () => {
    if (!goalId) return;
    const token = state.accessToken;
    if (!token) return;
    try {
      const resp = await authApi.getGoal(token, goalId);
      setTitle(stripLegacyStepsFromGoalTitle(resp.goal.title));
      setDesc(resp.goal.description ?? '');
      const stepResp = await authApi.listGoalSteps(token, goalId);
      const uiSteps: UiStep[] = stepResp.steps.map(s => ({
        id: makeId(),
        serverId: s.id,
        text: s.text,
        scheduleText: scheduleToShortText(s),
      }));
      setSteps(uiSteps.length ? uiSteps : [{ id: makeId(), text: 'New step', scheduleText: '' }]);
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
    setSteps(prev => [...prev, { id: makeId(), text: 'New step', scheduleText: '' }]);
  }

  function removeStep(id: string) {
    setSteps(prev => prev.filter(s => s.id !== id));
  }

  function setStepText(id: string, text: string) {
    setSteps(prev => prev.map(s => (s.id === id ? { ...s, text } : s)));
  }

  function setStepScheduleText(id: string, scheduleText: string) {
    setSteps(prev => prev.map(s => (s.id === id ? { ...s, scheduleText } : s)));
  }

  async function save() {
    if (saving) return;
    const t = stripLegacyStepsFromGoalTitle(title);
    const stepTexts = steps.map(s => s.text.trim()).filter(Boolean);
    if (!t) {
      toast('Goal name is required');
      return;
    }
    if (stepTexts.length === 0) {
      toast('Please add at least 1 step');
      return;
    }

    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }

    setSaving(true);
    try {
      let effectiveGoalId = goalId;
      if (effectiveGoalId) {
        await authApi.updateGoal(token, effectiveGoalId, { title: t, description: desc.trim() ? desc : null });
      } else {
        const created = await authApi.createGoal(token, { title: t, description: desc.trim() ? desc : null });
        effectiveGoalId = created.goal.id;
      }

      const serverSteps = effectiveGoalId ? await authApi.listGoalSteps(token, effectiveGoalId) : { steps: [] as authApi.GoalStepItem[] };
      const existingById = new Map(serverSteps.steps.map(s => [s.id, s] as const));

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
        if (!text) continue;
        const schedule = parseScheduleShortText(s.scheduleText);

        if (s.serverId && existingById.has(s.serverId)) {
          await authApi.updateGoalStep(
            token,
            { goalId: effectiveGoalId!, stepId: s.serverId },
            { text, order: i, ...schedule }
          );
        } else {
          const created = await authApi.createGoalStep(token, effectiveGoalId!, { text, order: i, ...schedule });
          s.serverId = created.step.id;
        }
      }

      setSteps(updatedSteps);

      toast('Saved');
      nav.goBack();
    } catch (e: any) {
      toast(String(e?.message ?? 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

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
            <TextInput value={title} onChangeText={setTitle} placeholder="" placeholderTextColor={colors.muted} style={styles.input} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              value={desc}
              onChangeText={setDesc}
              placeholder="Describe your goal..."
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
            />
          </View>

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
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stepLabel}>Step {idx + 1}</Text>
                    <TextInput
                      value={s.text}
                      onChangeText={t2 => setStepText(s.id, t2)}
                      placeholder=""
                      placeholderTextColor={colors.muted}
                      multiline
                      textAlignVertical="top"
                      style={styles.stepInput}
                    />

                    <Text style={[styles.stepLabel, { marginTop: 6 }]}>Schedule</Text>
                    <TextInput
                      value={s.scheduleText}
                      onChangeText={t2 => setStepScheduleText(s.id, t2)}
                      placeholder="daily | weekly:Mon | monthly:15 | yearly:01-15 | once:2027-01-01"
                      placeholderTextColor={colors.muted}
                      style={styles.stepScheduleInput}
                    />
                  </View>

                  <Pressable onPress={() => removeStep(s.id)} hitSlop={10} style={styles.stepTrash}>
                    <Text style={{ color: colors.danger, fontWeight: '900' }}>🗑</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>

          <View style={{ height: 10 }} />
          <Button title={'+ Add step'} full onPress={addStep} />

          <View style={styles.divider} />
          <Button title={'Save'} variant="primary" full onPress={save} />
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
});
