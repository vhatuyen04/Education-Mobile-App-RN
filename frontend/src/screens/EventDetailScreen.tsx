import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Pill } from '../components/Pill';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';

export function EventDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { state } = useAuth();

  const id: string | undefined = route.params?.id;

  const [event, setEvent] = useState<authApi.EventItem | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    const token = state.accessToken;
    if (!token) return;

    setLoading(true);
    try {
      const now = new Date();
      const from = new Date(now);
      from.setMonth(from.getMonth() - 6);
      const to = new Date(now);
      to.setMonth(to.getMonth() + 18);

      const resp = await authApi.listEvents(token, {
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const found = resp.events.find((e) => e.id === id) ?? null;
      setEvent(found);
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [id, state.accessToken]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const title = event?.title ?? 'Event';

  const timeRange = useMemo(() => {
    if (!event) return '';
    const start = new Date(event.startAt);
    const end = event.endAt ? new Date(event.endAt) : null;
    const startTxt = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const endTxt = end ? end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
    return endTxt ? `${startTxt} – ${endTxt}` : startTxt;
  }, [event]);

  const dateLabel = useMemo(() => {
    if (!event) return '';
    const d = new Date(event.startAt);
    return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit' });
  }, [event]);

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hTitle}>{title}</Text>
            <View style={styles.hSub}>
              {event?.repeat ? <Pill>{event.repeat}</Pill> : <Pill>Once</Pill>}
              {loading ? <Pill>Loading…</Pill> : null}
            </View>
          </View>

          <Pressable onPress={() => nav.goBack()} style={({ pressed }) => [styles.iconBtn, pressed ? { opacity: 0.85 } : null]}>
            <Text style={styles.iconText}>←</Text>
          </Pressable>
        </View>

        <Card>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Details</Text>
            <Badge>{event?.repeat ?? 'Once'}</Badge>
          </View>

          <View style={{ height: 10 }} />

          {event ? (
            <View style={{ gap: 10 }}>
              <View>
                <Text style={styles.label}>Date</Text>
                <Text style={styles.value}>{dateLabel}</Text>
              </View>

              <View>
                <Text style={styles.label}>Time</Text>
                <Text style={styles.value}>{timeRange || '—'}</Text>
              </View>

              <View>
                <Text style={styles.label}>Repeat</Text>
                <Text style={styles.value}>{event.repeat ?? 'Once'}</Text>
              </View>

              <View style={{ height: 6 }} />
              <Button
                title="Open calendar"
                full
                onPress={() =>
                  nav.navigate('Tabs', {
                    screen: 'Calendar',
                    params: { openEventId: id, openEventStartAt: event.startAt },
                  })
                }
              />
            </View>
          ) : (
            <Text style={styles.muted12}>Event not found.</Text>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 14,
    paddingBottom: 40,
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  hTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  hSub: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
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
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
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
  muted12: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 6,
  },
  value: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
});
