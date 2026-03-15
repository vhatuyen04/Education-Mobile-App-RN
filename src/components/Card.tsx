import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { colors } from '../theme/colors';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 14,
  },
});
