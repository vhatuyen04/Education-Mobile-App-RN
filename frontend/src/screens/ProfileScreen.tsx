import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Pill } from '../components/Pill';
import { Button } from '../components/Button';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';

type Row = {
  key: string;
  title: string;
  meta: string;
  actionLabel: string;
  onPress: () => void;
};

export function ProfileScreen() {
  const { signOut } = useAuth();
  const [rankingMode, setRankingMode] = useState(true);
  const [tryHardMode, setTryHardMode] = useState(true);

  const rows = useMemo<Row[]>(
    () => [
      { key: 'help', title: 'Help', meta: 'FAQ / Contact', actionLabel: 'Open', onPress: () => toast('Help (demo)') },
      { key: 'account', title: 'Account', meta: 'Security / Email', actionLabel: 'Open', onPress: () => toast('Account (demo)') },
      { key: 'bg', title: 'Background color', meta: 'Red', actionLabel: 'Change', onPress: () => toast('Change color (demo)') },
      { key: 'hobbies', title: 'Hobbies', meta: 'Swimming, Basketball', actionLabel: 'Edit', onPress: () => toast('Hobbies (demo)') },
      {
        key: 'fields',
        title: 'Fields you are interested in',
        meta: 'Sport, Academy, Entertainment',
        actionLabel: 'Edit',
        onPress: () => toast('Fields (demo)'),
      },
    ],
    []
  );

  function toggleRanking() {
    setRankingMode(v => !v);
    toast('Changed (demo)');
  }

  function toggleTryHard() {
    setTryHardMode(v => !v);
    toast('Changed (demo)');
  }

  async function handleLogout() {
    await signOut();
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hTitle}>Profile</Text>
            <View style={styles.hSub}>
              <Pill dot>Account</Pill>
              <Pill>Preferences</Pill>
            </View>
          </View>
        </View>

        <Card>
          <View style={styles.headerRow}>
            <View style={styles.userRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>T</Text>
              </View>
              <View style={{ gap: 2 }}>
                <Text style={styles.userName}>Tuyen Vu</Text>
                <Text style={styles.userEmail}>katuyen123@gmail.com</Text>
              </View>
            </View>
            <Button title="Edit" small onPress={() => toast('Edit profile (demo)')} />
          </View>

          <View style={styles.divider} />

          <View style={{ gap: 10 }}>
            {rows.map(r => (
              <View key={r.key} style={styles.item}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{r.title}</Text>
                  <Text style={styles.meta}>{r.meta}</Text>
                </View>
                <Button title={r.actionLabel} small onPress={r.onPress} />
              </View>
            ))}

            <View style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>Ranking mode</Text>
                <Text style={styles.meta}>{rankingMode ? 'On' : 'Off'}</Text>
              </View>
              <Button title="Change" small onPress={toggleRanking} />
            </View>

            <View style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>Try hard mode</Text>
                <Text style={styles.meta}>{tryHardMode ? 'On' : 'Off'}</Text>
              </View>
              <Button title="Change" small onPress={toggleTryHard} />
            </View>

            <View style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>Language</Text>
                <Text style={styles.meta}>English</Text>
              </View>
              <Button title="Change" small onPress={() => toast('Change language (demo)')} />
            </View>
          </View>

          <View style={styles.divider} />

          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => [styles.logout, pressed ? { opacity: 0.9 } : null]}
          >
            <Text style={styles.logoutText}>Log out</Text>
          </Pressable>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 14,
    paddingBottom: 30,
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  hTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '900',
  },
  hSub: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: 'rgba(110,231,183,.14)',
    borderWidth: 1,
    borderColor: 'rgba(110,231,183,.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.text,
    fontWeight: '900',
  },
  userName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  userEmail: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 12,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 14,
  },
  name: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  logout: {
    alignSelf: 'stretch',
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutText: {
    color: '#1a0a0f',
    fontWeight: '900',
  },
});
