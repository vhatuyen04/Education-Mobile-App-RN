import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Pill } from '../components/Pill';
import { Button } from '../components/Button';
import { toast } from '../utils/toast';

type Field = 'Sport' | 'Academy' | 'Entertainment';

type Leader = {
  id: string;
  name: string;
  points: number;
  top: number;
};

const leadersByField: Record<Field, Leader[]> = {
  Sport: [
    { id: 's1', name: 'RosMeLabe', points: 9938, top: 1 },
    { id: 's2', name: 'NoMoe', points: 9920, top: 2 },
  ],
  Academy: [
    { id: 'a1', name: 'RosMeLabe', points: 9938, top: 1 },
    { id: 'a2', name: 'NoMoe', points: 9920, top: 2 },
  ],
  Entertainment: [
    { id: 'e1', name: 'RosMeLabe', points: 9938, top: 1 },
    { id: 'e2', name: 'NoMoe', points: 9920, top: 2 },
  ],
};

export function RankingScreen() {
  const [field, setField] = useState<Field>('Sport');
  const list = leadersByField[field];

  const yourRank = useMemo(() => 182, []);

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hTitle}>Ranking</Text>
            <View style={styles.hSub}>
              <Pill dot>Leaderboards</Pill>
            </View>
          </View>
        </View>

        <Card>
          <View style={styles.tabs}>
            {(['Sport', 'Academy', 'Entertainment'] as const).map(t => (
              <Pressable
                key={t}
                onPress={() => setField(t)}
                style={({ pressed }) => [styles.tab, field === t ? styles.tabOn : null, pressed ? { opacity: 0.9 } : null]}
              >
                <Text style={[styles.tabText, field === t ? styles.tabTextOn : null]}>{t}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => toast('Add fields (demo)')}
              style={({ pressed }) => [styles.tab, pressed ? { opacity: 0.9 } : null]}
            >
              <Text style={styles.tabText}>+ Add fields</Text>
            </Pressable>
          </View>

          <View style={{ height: 12 }} />

          <View style={{ gap: 10 }}>
            {list.map(l => (
              <View key={l.id} style={styles.item}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>Top {l.top} · {l.name}</Text>
                  <Text style={styles.meta}>Points: {l.points}</Text>
                </View>
                <Button title="Profile" small onPress={() => toast('View profile (demo)')} />
              </View>
            ))}
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.muted}>
              You are currently rank <Text style={styles.bold}>{yourRank}</Text> in <Text style={styles.bold}>{field}</Text> field.
            </Text>
            <Button title="Move" small onPress={() => toast('Move to your rank (demo)')} />
          </View>
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
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tab: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
  },
  tabOn: {
    backgroundColor: colors.primary,
    borderColor: 'transparent',
  },
  tabText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  tabTextOn: {
    color: '#06101f',
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
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  muted: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  bold: {
    color: colors.text,
    fontWeight: '900',
  },
});
