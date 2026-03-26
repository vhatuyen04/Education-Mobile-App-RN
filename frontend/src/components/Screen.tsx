import React from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme/colors';
import { useSettings } from '../settings/SettingsContext';

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { settings } = useSettings();
  return <SafeAreaView style={[styles.root, { backgroundColor: settings.backgroundColor || colors.bg }, style]}>{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 14,
  },
});
