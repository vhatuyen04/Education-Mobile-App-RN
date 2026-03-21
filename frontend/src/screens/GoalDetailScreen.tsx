import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
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
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'GoalDetail'>;

function makeId() {
  return `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function exampleStepsFor(title: string): Step[] {
  const t = (title || '').toLowerCase();
  const base = (arr: string[]) => arr.map(text => ({ id: makeId(), text }));
  if (t.includes('ielts')) {
    return base(['Do 1 listening test', 'Learn 20 new words', 'Write 1 task 2 essay', 'Review mistakes']);
  }
  if (t.includes('thesis')) {
    return base(['Outline today section', 'Write 300 words', 'Add 2 references', 'Proofread and commit']);
  }
  if (t.includes('run')) {
    return base(['Warm up 10 min', 'Run 5km', 'Cooldown + stretch', 'Log distance']);
  }
  if (t.includes('lol')) {
    return base(['Warm up (1 normal game)', 'Focus on 1 champion', 'Review 1 replay', 'Track LP + notes']);
  }
  return base(['Define outcome + deadline', 'Break into 3 tasks', 'Schedule sessions', 'Review progress']);
}

export function GoalDetailScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<R>();

  const initialTitle = route.params?.title || 'New goal';

  const [title, setTitle] = useState(initialTitle);
  const [desc, setDesc] = useState('');
  const [steps, setSteps] = useState<Step[]>(() => exampleStepsFor(initialTitle));

  const stepCount = useMemo(() => steps.filter(s => s.text.trim()).length, [steps]);

  function addStep() {
    setSteps(prev => [...prev, { id: makeId(), text: 'New step' }]);
  }

  function save() {
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
    toast('Saved (demo)');
    nav.goBack();
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
            <Badge>{stepCount} steps</Badge>
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
