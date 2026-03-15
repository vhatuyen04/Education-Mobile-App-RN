import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '../theme/colors';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { Pill } from './Pill';
import { Step, StepEditorList } from './StepEditorList';
import { toast } from '../utils/toast';

type Props = {
  visible: boolean;
  onClose: () => void;
};

function makeId() {
  return `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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

export function AiPlannerModal({ visible, onClose }: Props) {
  const [planText, setPlanText] = useState('');
  const [horizon, setHorizon] = useState<'This week' | '2 weeks' | '1 month'>('This week');
  const [intensity, setIntensity] = useState<'Light' | 'Normal' | 'Hard'>('Normal');

  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);

  const [goalTitle, setGoalTitle] = useState('');
  const [goalField, setGoalField] = useState<'Sport' | 'Academy' | 'Entertainment'>('Academy');
  const [goalHorizon, setGoalHorizon] = useState('This week');
  const [steps, setSteps] = useState<Step[]>([]);

  const stepCount = steps.length;

  const templates = useMemo(
    () => [
      { label: 'Study plan', text: 'Study plan: I want to study ___ for ___ weeks. I can spend ___ minutes/day.' },
      { label: 'Fitness plan', text: 'Fitness plan: I want to improve ___ in ___ weeks. I can train ___ times/week.' },
      { label: 'Thesis plan', text: 'Thesis plan: I want to finish chapter ___ by ___. I can write ___ minutes/day.' },
      { label: 'Balanced week', text: 'Balanced week: I need to balance study, sport and rest. I want 1 main goal and small daily tasks.' },
    ],
    []
  );

  function insertTemplate(t: string) {
    setPlanText(prev => (prev.trim() ? `${prev.trim()}\n${t}` : t));
  }

  function addStep() {
    setSteps(prev => [...prev, { id: makeId(), text: 'New step' }]);
  }

  function generate() {
    if (!planText.trim()) {
      toast('Please describe your plan first');
      return;
    }

    setGenerated(false);
    setLoading(true);

    const field = inferFieldFromText(planText);
    const base = [
      'Define outcome + deadline',
      'Break the goal into 3 measurable tasks',
      'Schedule 2 focused sessions',
      'Review progress and adjust',
    ];

    const chosen = intensity === 'Hard' ? [...base, 'Add one extra challenge task'] : intensity === 'Light' ? base.slice(0, 3) : base;

    setTimeout(() => {
      setLoading(false);
      setGenerated(true);
      setGoalTitle(defaultGoalTitle(planText));
      setGoalField(field);
      setGoalHorizon(horizon);
      setSteps(chosen.map(s => ({ id: makeId(), text: s })));
      toast('AI suggestions ready (demo)');
    }, 700);
  }

  function save() {
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
    toast(`Saved: ${title} (${stepTexts.length} steps) (demo)`);
    onClose();
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

          <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
            <Text style={styles.mutedSmall}>Describe your plan. AI will suggest 1 goal and a checklist.</Text>

            <View style={styles.field}>
              <Text style={styles.label}>Your plan</Text>
              <TextInput
                value={planText}
                onChangeText={setPlanText}
                placeholder="Example: I want to prepare for database exam in 3 weeks and go to gym 2 times/week."
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
                <Text style={styles.label}>Time horizon</Text>
                <View style={styles.selectRow}>
                  {(['This week', '2 weeks', '1 month'] as const).map(v => (
                    <Pressable key={v} onPress={() => setHorizon(v)} style={[styles.selectOpt, horizon === v ? styles.selectOptOn : null]}>
                      <Text style={[styles.selectText, horizon === v ? styles.selectTextOn : null]}>{v}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Intensity</Text>
                <View style={styles.selectRow}>
                  {(['Light', 'Normal', 'Hard'] as const).map(v => (
                    <Pressable key={v} onPress={() => setIntensity(v)} style={[styles.selectOpt, intensity === v ? styles.selectOptOn : null]}>
                      <Text style={[styles.selectText, intensity === v ? styles.selectTextOn : null]}>{v}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

            <View style={{ height: 10 }} />
            <Button title={generated ? 'Regenerate' : 'Generate suggestions'} variant="primary" full onPress={generate} />

            {loading ? <Text style={[styles.mutedSmall, { marginTop: 10 }]}>Thinking…</Text> : null}

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
                    <Pill>Horizon: {goalHorizon}</Pill>
                  </View>
                </Card>

                <Card>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>Checklist</Text>
                    <Badge>{stepCount} steps</Badge>
                  </View>

                  <View style={{ marginTop: 10 }}>
                    <StepEditorList steps={steps} onChange={setSteps} />
                  </View>

                  <View style={{ height: 10 }} />
                  <Button title={'+ Add step'} full onPress={addStep} />
                </Card>

                <View style={{ gap: 8 }}>
                  <Button title={'Save (demo)'} variant="primary" full onPress={save} />
                  <Text style={styles.hint}>In prototype: save will show a toast only (no persistence yet).</Text>
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
    maxHeight: '90%',
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
});
