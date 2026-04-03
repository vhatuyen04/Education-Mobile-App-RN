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
import { Step, StepEditorList } from '../components/StepEditorList';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'GoalDetail'>;

function makeId() {
  return `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function parseGoalTitle(raw: string): { name: string; steps: Step[] } {
  const txt = String(raw ?? '');
  const lines = txt.split(/\r?\n/);
  const name = (lines[0] ?? '').trim() || 'Untitled goal';

  const idx = lines.findIndex(l => l.trim().toLowerCase() === 'steps:' || l.trim().toLowerCase() === 'steps');
  if (idx === -1) {
    return { name, steps: [] };
  }

  const stepLines = lines.slice(idx + 1).map(l => l.trim()).filter(Boolean);
  const steps: Step[] = [];
  for (const l of stepLines) {
    const m = l.match(/^[-*]\s*\[(x| )\]\s*(.+)$/i);
    if (m) {
      steps.push({ id: makeId(), done: m[1].toLowerCase() === 'x', text: m[2].trim() });
      continue;
    }
    const m2 = l.match(/^[-*]\s*(.+)$/);
    if (m2) {
      steps.push({ id: makeId(), done: false, text: m2[1].trim() });
    }
  }

  return { name, steps };
}

function serializeGoalTitle(name: string, steps: Step[]): string {
  const cleanName = (name ?? '').trim() || 'Untitled goal';
  const cleanSteps = steps.map(s => ({ ...s, text: (s.text ?? '').trim() })).filter(s => s.text.length > 0);
  if (cleanSteps.length === 0) return cleanName;
  return `${cleanName}\n\nSteps:\n${cleanSteps.map(s => `- [${s.done ? 'x' : ' '}] ${s.text}`).join('\n')}`;
}

export function GoalDetailScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<R>();
  const { state } = useAuth();

  const goalId = route.params?.id;
  const initialTitle = route.params?.title || 'New goal';

  const [title, setTitle] = useState(initialTitle);
  const [desc, setDesc] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [saving, setSaving] = useState(false);

  const stepCount = useMemo(() => steps.filter(s => s.text.trim()).length, [steps]);
  const doneCount = useMemo(() => steps.filter(s => s.text.trim() && s.done).length, [steps]);

  const refresh = useCallback(async () => {
    if (!goalId) return;
    const token = state.accessToken;
    if (!token) return;
    try {
      const resp = await authApi.getGoal(token, goalId);
      const parsed = parseGoalTitle(resp.goal.title);
      setTitle(parsed.name);
      setDesc(resp.goal.description ?? '');
      setSteps(parsed.steps.length ? parsed.steps : [{ id: makeId(), text: 'New step', done: false }]);
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
    setSteps(prev => [...prev, { id: makeId(), text: 'New step' }]);
  }

  async function save() {
    if (saving) return;
    const t = title.trim();
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
      const serialized = serializeGoalTitle(t, steps);
      const total = steps.map(s => s.text.trim()).filter(Boolean).length;
      const done = steps.filter(s => s.text.trim() && s.done).length;
      const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

      if (goalId) {
        await authApi.updateGoal(token, goalId, { title: serialized, description: desc.trim() ? desc : null, progressPct });
      } else {
        await authApi.createGoal(token, { title: serialized, description: desc.trim() ? desc : null, progressPct });
      }
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
              <Pill>Checklist</Pill>
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
            <Text style={styles.cardTitle}>Checklist</Text>
            <Badge>
              {doneCount}/{stepCount}
            </Badge>
          </View>

          <View style={{ marginTop: 10 }}>
            <StepEditorList steps={steps} onChange={setSteps} />
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
});
