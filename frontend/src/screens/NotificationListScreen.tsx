import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { colors } from '../theme/colors';
import { toast } from '../utils/toast';
import type { RootStackParamList } from '../navigation/types';

type Item = {
  id: string;
  title: string;
  body: string;
  whenText: string;
};

function formatWhen(trigger: any): string {
  if (!trigger) return 'Unknown';

  // Date trigger
  if (typeof trigger === 'object' && 'date' in trigger) {
    const d = new Date((trigger as any).date);
    return Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString();
  }

  // Calendar triggers
  if (typeof trigger === 'object') {
    const t: any = trigger;
    const parts: string[] = [];
    if (t.weekday != null) parts.push(`weekday=${t.weekday}`);
    if (t.day != null) parts.push(`day=${t.day}`);
    if (t.month != null) parts.push(`month=${t.month}`);
    if (t.hour != null) parts.push(`hour=${t.hour}`);
    if (t.minute != null) parts.push(`minute=${t.minute}`);
    if (t.repeats != null) parts.push(`repeats=${String(t.repeats)}`);
    return parts.length ? parts.join(', ') : 'Unknown';
  }

  return 'Unknown';
}

export function NotificationListScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [loading, setLoading] = useState(false);
  const [scheduled, setScheduled] = useState<Item[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sched = await Notifications.getAllScheduledNotificationsAsync();
      const items: Item[] = sched
        .map(s => {
          const title = String(s.content?.title ?? 'Notification');
          const body = String(s.content?.body ?? '');
          return {
            id: String(s.identifier ?? `${title}-${body}`),
            title,
            body,
            whenText: formatWhen(s.trigger),
          };
        })
        .sort((a, b) => a.whenText.localeCompare(b.whenText));

      setScheduled(items);
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to load notifications'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const count = scheduled.length;

  const emptyText = useMemo(() => {
    if (loading) return 'Loading…';
    return 'No scheduled notifications.';
  }, [loading]);

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Notifications</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Button
              title="Back"
              small
              onPress={() => {
                if ((nav as any).canGoBack?.()) {
                  nav.goBack();
                  return;
                }
                (nav as any).navigate('Tabs', { screen: 'Home' });
              }}
            />
            <Button title="Refresh" small onPress={load} />
          </View>
        </View>

        <Text style={styles.meta}>{count} scheduled</Text>

        <View style={{ height: 12 }} />

        {count === 0 ? (
          <Card>
            <Text style={styles.empty}>{emptyText}</Text>
          </Card>
        ) : (
          <View style={{ gap: 12 }}>
            {scheduled.map(n => (
              <Card key={n.id}>
                <Text style={styles.itemTitle}>{n.title}</Text>
                {n.body ? <Text style={styles.itemBody}>{n.body}</Text> : null}
                <Text style={styles.itemWhen}>{n.whenText}</Text>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  meta: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 12,
  },
  empty: {
    color: colors.muted,
    fontSize: 12,
  },
  itemTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  itemBody: {
    marginTop: 6,
    color: colors.text,
    fontSize: 12,
  },
  itemWhen: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 12,
  },
});
