import React from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { colors } from '../theme/colors';

type Variant = 'primary' | 'ghost' | 'danger';

type Props = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  full?: boolean;
  small?: boolean;
  style?: ViewStyle;
  disabled?: boolean;
};

export function Button({ title, onPress, variant = 'ghost', full, small, style, disabled }: Props) {
  return (
    <Pressable
      onPress={disabled ? () => {} : onPress}
      style={({ pressed }) => [
        styles.base,
        full ? styles.full : null,
        small ? styles.small : null,
        variantStyles[variant],
        disabled ? { opacity: 0.45 } : pressed ? { opacity: 0.85 } : null,
        style,
      ]}
    >
      <Text style={[styles.text, textVariantStyles[variant], small ? { fontSize: 12 } : null]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontWeight: '800',
    fontSize: 13,
  },
  full: {
    alignSelf: 'stretch',
  },
  small: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
});

const variantStyles: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: colors.primary, borderColor: 'transparent' },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: colors.danger, borderColor: 'transparent' },
};

const textVariantStyles: Record<Variant, any> = {
  primary: { color: '#06101f' },
  ghost: { color: colors.text },
  danger: { color: '#1a0a0f' },
};
