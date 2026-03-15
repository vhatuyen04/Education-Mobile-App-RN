import React from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme/colors';

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <SafeAreaView style={[styles.root, style]}>{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 14,
  },
});
