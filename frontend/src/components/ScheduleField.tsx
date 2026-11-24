import React from 'react';
import { Keyboard, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme/colors';
import { compactScheduleLabel } from '../utils/schedulePicker';

type Props = {
  value: string;
  onPress: () => void;
  editable?: boolean;
};

export function ScheduleField({ value, onPress, editable = true }: Props) {
  const label = value.trim() ? compactScheduleLabel(value) : 'No schedule';
  return (
    <>
      <Text style={styles.label}>Schedule</Text>
      <Pressable
        disabled={!editable}
        onPress={() => { Keyboard.dismiss(); onPress(); }}
        style={({ pressed }) => [styles.field, !editable ? styles.locked : null, pressed && editable ? { opacity: 0.85 } : null]}
      >
        <Text style={[styles.value, value.trim() ? null : styles.placeholder]}>{label}</Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 6 },
  field: {
    minHeight: 48,
    marginTop: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  locked: { opacity: 0.55 },
  value: { color: colors.text, flex: 1, fontWeight: '700' },
  placeholder: { color: colors.muted, fontWeight: '600' },
  chevron: { color: colors.muted, fontSize: 22, marginLeft: 8 },
});
