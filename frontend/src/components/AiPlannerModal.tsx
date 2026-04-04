import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '../theme/colors';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { Pill } from './Pill';
import { Step } from './StepEditorList';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

function makeId() {
  return `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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
      return { type: 'repeat', repeat: 'yearly', ...(Number.isFinite(month) ? { repeatMonth: month } : null), ...(Number.isFinite(day) ? { repeatDay: day } : null) } as any;
    }
    return { type: 'repeat', repeat: 'yearly' };
  }

  if (lower.startsWith('repeat:')) {
    const repeat = raw.slice(7).trim();
    return repeat ? { type: 'repeat', repeat } : { type: 'none' };
  }

  return { type: 'repeat', repeat: raw };
}

function formatDateYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(raw: string): Date | null {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseDmy(raw: string): Date | null {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

type PlanDeadline = { date: Date; label: string };

function parseDeadlineFromPlanText(planText: string): PlanDeadline | null {
  const txt = String(planText ?? '');

  const absMatch = txt.match(/\b(?:by|before|until|deadline\s*[:=]?)\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})\b/i);
  if (absMatch?.[1]) {
    const d = parseYmd(absMatch[1]) ?? parseDmy(absMatch[1]);
    if (d) return { date: d, label: absMatch[1] };
  }

  const relMatch =
    txt.match(/\b(?:in|within|for)\s*(\d+)\s*(day|days|week|weeks|month|months)\b/i) ??
    txt.match(/\b(\d+)\s*[- ]\s*(day|days|week|weeks|month|months)\b/i);
  if (relMatch?.[1] && relMatch?.[2]) {
    const n = Number(relMatch[1]);
    const unit = relMatch[2].toLowerCase();
    if (!Number.isFinite(n) || n <= 0) return null;
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const d = new Date(base);
    if (unit.startsWith('day')) d.setDate(d.getDate() + n);
    else if (unit.startsWith('week')) d.setDate(d.getDate() + n * 7);
    else if (unit.startsWith('month')) d.setMonth(d.getMonth() + n);
    return { date: d, label: `${n} ${unit}` };
  }

  return null;
}

function isSimilarDeadline(a: Date, b: Date) {
  const ms = Math.abs(a.getTime() - b.getTime());
  const days = ms / (1000 * 60 * 60 * 24);
  return days <= 3;
}

function inferFieldFromText(text: string): 'Sport' | 'Academy' | 'Entertainment' {
  const t = (text || '').toLowerCase();
  if (t.includes('gym') || t.includes('run') || t.includes('basket') || t.includes('swim') || t.includes('fitness')) return 'Sport';
  if (t.includes('thesis') || t.includes('study') || t.includes('exam') || t.includes('database') || t.includes('ielts')) return 'Academy';
  if (t.includes('game') || t.includes('lol') || t.includes('movie') || t.includes('music')) return 'Entertainment';
  return 'Academy';
}

function defaultGoalTitle(text: string) {
  const firstLine = (text || '').trim().split(/\r?\n/)[0] || 'My new plan';
  return firstLine.length > 46 ? `${firstLine.slice(0, 46)}…` : firstLine;
}

export function AiPlannerModal({ visible, onClose, onSaved }: Props) {
  const { state } = useAuth();
  const [planText, setPlanText] = useState('');
  const [deadline, setDeadline] = useState('');
  const [intensity, setIntensity] = useState<'Light' | 'Normal' | 'Hard'>('Normal');

  const [aiHelp, setAiHelp] = useState<{ message: string; questions: string[] } | null>(null);
  const [dirty, setDirty] = useState(false);

  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);

  const [goalTitle, setGoalTitle] = useState('');
  const [goalField, setGoalField] = useState<'Sport' | 'Academy' | 'Entertainment'>('Academy');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [steps, setSteps] = useState<Array<Step & { schedule?: authApi.AiGoalStepSchedule }>>([]);

  const stepCount = steps.length;

  const templates = useMemo(
    () => [
      { label: 'Study plan', text: 'Study plan: I want to study ___ for ___ weeks.' },
      { label: 'Fitness plan', text: 'Fitness plan: I want to improve ___ in ___ weeks.' },
      { label: 'Thesis plan', text: 'Thesis plan: I want to finish chapter ___ by ___.' },
      { label: 'Balanced week', text: 'Balanced week: I need to balance study, sport and rest. I want 1 main goal and small daily tasks.' },
    ],
    []
  );

  function resetGenerated() {
    setGenerated(false);
    setGoalTitle('');
    setGoalField('Academy');
    setGoalDeadline(deadline);
    setSteps([]);
    setAiHelp(null);
    setDirty(false);
  }

  async function resolveDeadlineForPlan(override?: string): Promise<string | null> {
    const input = String(override ?? deadline ?? '').trim();
    const fromPlan = parseDeadlineFromPlanText(planText);

    if (fromPlan && !input) {
      const auto = formatDateYmd(fromPlan.date);
      setDeadline(auto);
      return auto;
    }

    if (!fromPlan) {
      return input || null;
    }

    if (!input) {
      const auto = formatDateYmd(fromPlan.date);
      setDeadline(auto);
      return auto;
    }

    const inputDate = parseYmd(input) ?? parseDmy(input);
    if (!inputDate) {
      return input;
    }

    if (isSimilarDeadline(fromPlan.date, inputDate)) {
      return input;
    }

    const planChoice = formatDateYmd(fromPlan.date);
    const inputChoice = formatDateYmd(inputDate);

    return new Promise(resolve => {
      Alert.alert(
        'Choose deadline',
        `Your plan mentions a deadline that differs from the Deadline field.\n\nFrom plan: ${planChoice}\nFrom field: ${inputChoice}`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => resolve(null),
          },
          {
            text: `Use ${planChoice}`,
            onPress: () => {
              setDeadline(planChoice);
              resolve(planChoice);
            },
          },
          {
            text: `Use ${inputChoice}`,
            onPress: () => resolve(inputChoice),
          },
        ]
      );
    });
  }

  function insertTemplate(t: string) {
    setPlanText(t);
    setAiHelp(null);
    if (generated) setDirty(true);
  }

  function addStep() {
    setSteps(prev => [...prev, { id: makeId(), text: 'New step', schedule: { type: 'none' } }]);
  }

  function removeStep(id: string) {
    setSteps(prev => prev.filter(s => s.id !== id));
  }

  function parseDeadlineToISOEndOfDay(v: string, opts?: { mustBeFuture?: boolean }): string | null {
    const raw = v.trim();
    if (!raw) return null;

    const d = new Date(raw);
    if (!Number.isFinite(d.getTime())) return null;

    d.setHours(23, 59, 59, 999);

    if (opts?.mustBeFuture) {
      const now = new Date();
      if (d.getTime() < now.getTime()) return null;
    }

    return d.toISOString();
  }

  async function generate() {
    if (!planText.trim()) {
      toast('Please describe your plan first');
      return;
    }

    if (planText.includes('___')) {
      toast('Please fill in the blanks (___) in your plan first.');
      return;
    }

    const resolvedDeadline = await resolveDeadlineForPlan();
    if (!resolvedDeadline) {
      toast('Please enter a deadline (or mention it in your plan like “in 6 weeks”).');
      return;
    }

    const dl = parseDeadlineToISOEndOfDay(resolvedDeadline, { mustBeFuture: true });
    if (!dl) {
      toast('Please enter a valid future deadline');
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
      const resp = await authApi.aiSuggestGoal(token, { prompt: planText.trim(), deadline: dl, intensity });
      if (!resp.ok) {
        setAiHelp({ message: resp.message, questions: resp.questions ?? [] });
        return;
      }

      setGoalTitle(resp.suggestion.title || defaultGoalTitle(planText));
      setGoalField(resp.suggestion.field);
      setGoalDeadline(resp.suggestion.deadline || resolvedDeadline);
      setSteps(resp.suggestion.steps.map(s => ({ id: makeId(), text: s.text, schedule: s.schedule })));
      setGenerated(true);
      setDirty(false);
      toast('AI suggestions ready');
    } catch (e: any) {
      toast(String(e?.message ?? 'AI failed'));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    const title = goalTitle.trim();
    const stepTexts = steps.map(s => s.text.trim()).filter(Boolean);
    if (!title) {
      toast('Goal title is required');
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

    if (loading) return;
    setLoading(true);
    try {
      const resolvedDeadline = await resolveDeadlineForPlan(goalDeadline || deadline);
      if (!resolvedDeadline) return;

      const dueIso = parseDeadlineToISOEndOfDay(resolvedDeadline, { mustBeFuture: true });
      if (!dueIso) {
        toast('Please enter a valid future deadline');
        return;
      }

      const created = await authApi.createGoal(token, { title, description: planText.trim() ? planText.trim() : null, dueAt: dueIso });

      const goalId = created.goal.id;

      const scheduledSteps = steps
        .map((s, idx) => ({ s, idx, text: s.text.trim() }))
        .filter(x => x.text)
        .filter(x => x.s.schedule && x.s.schedule.type !== 'none');

      for (const { s, idx, text } of scheduledSteps) {
        const schedule = s.schedule as authApi.AiGoalStepSchedule;
        const body: any = { text, order: idx };
        if (schedule.type === 'once') {
          const d = parseYmd(schedule.due);
          if (!d) continue;
          d.setHours(23, 59, 59, 999);
          body.dueAt = d.toISOString();
        } else if (schedule.type === 'repeat') {
          body.repeat = schedule.repeat;
          body.repeatDay = schedule.repeatDay ?? null;
          body.repeatMonth = schedule.repeatMonth ?? null;
        }
        await authApi.createGoalStep(token, goalId, body);
      }

      toast('Saved');
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast(String(e?.message ?? 'Save failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>AI Planner</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.mutedSmall}>Describe your plan. AI will suggest 1 goal and a checklist.</Text>

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
                    <Badge>Editable</Badge>
                  </View>

                  <View style={[styles.field, { marginTop: 10 }]}
                  >
                    <Text style={styles.label}>Goal title</Text>
                    <TextInput value={goalTitle} onChangeText={setGoalTitle} style={styles.input} placeholder="" placeholderTextColor={colors.muted} />
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <Pill>Field: {goalField}</Pill>
                    <Pill>Deadline: {goalDeadline || deadline || '—'}</Pill>
                  </View>
                </Card>

                <Card>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>Steps</Text>
                    <Badge>{stepCount} steps</Badge>
                  </View>

                  <View style={{ marginTop: 10 }}>
                    <View style={{ gap: 10 }}>
                      {steps.map((s, idx) => (
                        <View key={s.id} style={styles.stepItemRow}>
                          <Text style={styles.stepNum}>{idx + 1}.</Text>
                          <Text style={styles.stepItemText}>
                            {s.text}
                          </Text>
                          <View style={{ gap: 6, alignItems: 'flex-end' }}>
                            <TextInput
                              value={scheduleToShortText(s.schedule)}
                              onChangeText={t => {
                                setSteps(prev =>
                                  prev.map(p => {
                                    if (p.id !== s.id) return p;
                                    return { ...p, schedule: parseScheduleShortText(t) };
                                  })
                                );
                              }}
                              placeholder="daily | weekly:Mon | monthly:15 | yearly:01-15 | once:2027-01-01"
                              placeholderTextColor={colors.muted}
                              style={[styles.input, { paddingVertical: 6, paddingHorizontal: 8, minWidth: 160 }]}
                            />
                            <Text style={styles.mutedSmall}>Optional. Leave empty to ignore.</Text>
                          </View>
                          <Pressable onPress={() => removeStep(s.id)} hitSlop={10} style={styles.stepRemove}>
                            <Text style={styles.stepRemoveText}>🗑</Text>
                          </Pressable>
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
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 14,
  },
  stepNum: {
    color: colors.muted,
    fontWeight: '900',
    width: 20,
    textAlign: 'right',
    paddingTop: 1,
  },
  stepItemText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
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
