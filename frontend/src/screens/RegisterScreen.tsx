import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { colors } from '../theme/colors';
import { useAuth } from '../auth/AuthContext';

type Props = {
  onGoLogin: () => void;
};

export function RegisterScreen({ onGoLogin }: Props) {
  const { register } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegister() {
    setLoading(true);
    setError(null);
    try {
      await register(email, password, name);
    } catch (e: any) {
      setError(e?.message ?? 'Register failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 12 }}>
        <View style={{ gap: 6 }}>
          <Text style={styles.hTitle}>Create account</Text>
          <Text style={styles.hSub}>Register to get started</Text>
        </View>

        <Card>
          <View style={{ gap: 10 }}>
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                keyboardType="email-address"
                style={styles.input}
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Min 6 characters"
                placeholderTextColor={colors.muted}
                secureTextEntry
                style={styles.input}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button title={loading ? 'Registering…' : 'Register'} variant="primary" full onPress={handleRegister} />

            <Pressable onPress={onGoLogin} style={({ pressed }) => [pressed ? { opacity: 0.85 } : null]}>
              <Text style={styles.link}>Already have an account? Log in</Text>
            </Pressable>
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '900',
  },
  hSub: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontWeight: '800',
  },
  error: {
    color: colors.danger,
    fontWeight: '800',
  },
  link: {
    color: colors.text,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 10,
  },
});
