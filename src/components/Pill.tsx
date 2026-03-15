import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme/colors';

export function Pill({ children, dot }: { children: React.ReactNode; dot?: boolean }) {
  return (
    <View style={styles.pill}>
      {dot ? <View style={styles.dot} /> : null}
      <Text style={styles.text} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
  },
  text: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: colors.success,
  },
});
