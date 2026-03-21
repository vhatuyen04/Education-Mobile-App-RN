import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { colors } from '../theme/colors';
import { useAuth } from '../auth/AuthContext';

type Props = {
  onGoRegister: () => void;
};

export function LoginScreen({ onGoRegister }: Props) {
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function isValidEmail(v: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  }

  async function handleLogin() {
    if (!isValidEmail(email)) {
      setError('Invalid email.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (e: any) {
      const msg = String(e?.message ?? 'Login failed');
      if (msg.toLowerCase().includes('invalid email')) {
        setError('Invalid email.');
      } else if (msg.toLowerCase().includes('invalid username or password')) {
        setError('Invalid username or password.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 12 }}>
        <View style={{ gap: 6 }}>
          <Text style={styles.hTitle}>SmartGoal App</Text>
        </View>

        <Card>
          <View style={{ gap: 10 }}>
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
                placeholder="••••••••"
                placeholderTextColor={colors.muted}
                secureTextEntry
                style={styles.input}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button title={loading ? 'Logging in…' : 'Log in'} variant="primary" full onPress={handleLogin} />

            <Pressable onPress={onGoRegister} style={({ pressed }) => [pressed ? { opacity: 0.85 } : null]}>
              <Text style={styles.link}>No account? Register</Text>
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
