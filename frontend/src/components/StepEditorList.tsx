import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '../theme/colors';

export type Step = { id: string; text: string; done?: boolean };

type Props = {
  steps: Step[];
  onChange: (steps: Step[]) => void;
};

export function StepEditorList({ steps, onChange }: Props) {
  function setStepText(id: string, text: string) {
    onChange(steps.map(s => (s.id === id ? { ...s, text } : s)));
  }

  function removeStep(id: string) {
    onChange(steps.filter(s => s.id !== id));
  }

  function toggleDone(id: string) {
    onChange(steps.map(s => (s.id === id ? { ...s, done: !s.done } : s)));
  }

  return (
    <View style={{ gap: 10 }}>
      {steps.map((s, idx) => (
        <View key={s.id} style={styles.row}>
          <Pressable onPress={() => toggleDone(s.id)} style={[styles.check, s.done ? styles.checkOn : null]} />

          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Step {idx + 1}</Text>
            <TextInput
              value={s.text}
              onChangeText={t => setStepText(s.id, t)}
              placeholder=""
              placeholderTextColor={colors.muted}
              multiline
              textAlignVertical="top"
              style={styles.input}
            />
          </View>

          <Pressable onPress={() => removeStep(s.id)} hitSlop={10} style={styles.trash}>
            <Text style={{ color: colors.danger, fontWeight: '900' }}>🗑</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 14,
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'transparent',
  },
  checkOn: {
    backgroundColor: colors.success,
    borderColor: 'transparent',
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  input: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    paddingVertical: 6,
    paddingHorizontal: 0,
    minHeight: 40,
  },
  trash: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
});
