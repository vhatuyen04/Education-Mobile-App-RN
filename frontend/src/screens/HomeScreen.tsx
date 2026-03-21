import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Pill } from '../components/Pill';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { ProgressBar } from '../components/ProgressBar';
import { toast } from '../utils/toast';
import { AiPlannerModal } from '../components/AiPlannerModal';
import type { RootStackParamList } from '../navigation/types';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function HomeScreen() {
  const nav = useNavigation<Nav>();
  const [aiOpen, setAiOpen] = useState(false);

  const today = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
    return days[new Date().getDay()];
  }, []);

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hTitle}>Today</Text>
            <View style={styles.hSub}>
              <Pill dot>{today}</Pill>
              <Pill>
                Score: <Text style={styles.bold}>38</Text>
              </Pill>
              <Pill>
                <Text style={styles.bold}>3</Text> tasks planned
              </Pill>
            </View>
          </View>

          <Pressable
            onPress={() => toast('No notifications in prototype')}
            style={({ pressed }) => [styles.iconBtn, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={styles.iconText}>🔔</Text>
          </Pressable>
        </View>

        <View style={{ gap: 12 }}>
          <Pressable onPress={() => nav.navigate('GoalDetail', { title: 'Challenger LoL' })}>
            <Card>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>Next goal</Text>
                <Badge>Due in 7 weeks</Badge>
              </View>

              <View style={{ marginTop: 10 }}>
                <View style={styles.titleLine}>
                  <Text style={styles.goalName}>Challenge LoL</Text>
                  <Pill>
                    Progress: <Text style={styles.bold}>58%</Text>
                  </Pill>
                </View>

                <View style={{ height: 10 }} />
                <ProgressBar value={58} />
                <View style={{ height: 10 }} />
                <Text style={styles.muted12}>Tap this card to open the goal details and start the steps.</Text>
              </View>
            </Card>
          </Pressable>

          <Card>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>Next event</Text>
              <Badge>Daily</Badge>
            </View>

            <View style={[styles.row, { marginTop: 10 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.eventTitle}>Database class</Text>
                <Text style={styles.muted12}>15:00 – 18:00</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Cancel" small variant="danger" onPress={() => toast('Cancel event (demo)')} />
                <Button title="Detail" small onPress={() => toast('Detail (demo)')} />
              </View>
            </View>
          </Card>

          <Card>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>Todo today</Text>
              <Badge>
                <Text style={styles.bold}>2</Text> conflicts
              </Badge>
            </View>

            <View style={{ marginTop: 10, gap: 10 }}>
              <View style={styles.item}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>Database class</Text>
                  <Text style={styles.itemMeta}>15:00 – 18:00</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title="Mark as done" small onPress={() => toast('Marked as done (demo)')} />
                  <Button title="Edit" small onPress={() => toast('Edit (demo)')} />
                </View>
              </View>

              <View style={styles.item}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>Chess class</Text>
                  <Text style={styles.itemMeta}>18:00 – 19:00</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title="Mark as done" small onPress={() => toast('Marked as done (demo)')} />
                  <Button title="Edit" small onPress={() => toast('Edit (demo)')} />
                </View>
              </View>

              <View style={styles.item}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>Basketball goal</Text>
                  <Text style={styles.itemMeta}>Action: Shoot 20 times · Deadline: 22:00</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title="Mark as done" small onPress={() => toast('Marked as done (demo)')} />
                  <Button title="Detail" small onPress={() => nav.navigate('GoalDetail', { title: 'Basketball goal' })} />
                </View>
              </View>
            </View>

            <View style={{ height: 10 }} />
            <Button title="Details" full onPress={() => nav.navigate('TodayDetails')} />
          </Card>
        </View>
      </ScrollView>

      <Pressable
        onPress={() => setAiOpen(true)}
        style={({ pressed }) => [styles.fab, pressed ? { opacity: 0.9 } : null]}
      >
        <Text style={styles.fabText}>✨</Text>
      </Pressable>

      <AiPlannerModal visible={aiOpen} onClose={() => setAiOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 14,
    paddingBottom: 120,
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
  bold: {
    color: colors.text,
    fontWeight: '900',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 16,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  goalName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  muted12: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  eventTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  item: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 14,
  },
  itemName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  itemMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 84,
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: {
    fontSize: 20,
    fontWeight: '900',
  },
});
