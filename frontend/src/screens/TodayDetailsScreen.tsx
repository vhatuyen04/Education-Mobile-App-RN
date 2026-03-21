import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Pill } from '../components/Pill';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { toast } from '../utils/toast';

type ItemType = 'event' | 'goal';

type Item = {
  id: string;
  type: ItemType;
  name: string;
  meta: string;
  done: boolean;
};

export function TodayDetailsScreen() {
  const nav = useNavigation();

  const [items, setItems] = useState<Item[]>([
    {
      id: 'e1',
      type: 'event',
      name: 'Database class (Daily)',
      meta: '15:00 – 18:00 · Not completed',
      done: false,
    },
    {
      id: 'e2',
      type: 'event',
      name: 'Chess class (Daily)',
      meta: '18:00 – 19:00 · Not completed',
      done: false,
    },
    {
      id: 'g1',
      type: 'goal',
      name: 'Basketball goal',
      meta: 'Until 22:00 · Step action plan · Not completed',
      done: false,
    },
  ]);

  const [confirm, setConfirm] = useState<{ open: boolean; item?: Item }>({ open: false });

  const confirmText = useMemo(() => {
    if (!confirm.item) return 'Are you sure you want to delete this item?';
    return confirm.item.type === 'event'
      ? 'Are you sure you want to delete this event?'
      : 'Are you sure you want to delete this goal?';
  }, [confirm.item]);

  function requestDelete(item: Item) {
    setConfirm({ open: true, item });
  }

  function closeConfirm() {
    setConfirm({ open: false });
  }

  function deleteConfirmed() {
    if (!confirm.item) return;
    setItems(prev => prev.filter(i => i.id !== confirm.item!.id));
    toast('Deleted (demo)');
    closeConfirm();
  }

  function markDone(id: string) {
    setItems(prev =>
      prev.map(i =>
        i.id === id
          ? {
              ...i,
              done: true,
              meta: i.meta
                .replace('Not completed', 'Completed')
                .replace('Status: Not completed', 'Status: Completed'),
            }
          : i
      )
    );
    toast('Marked as done (demo)');
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hTitle}>Details (Todo today)</Text>
            <View style={styles.hSub}>
              <Pill dot>Events & goals today</Pill>
            </View>
          </View>
          <Pressable
            onPress={() => (nav as any).goBack()}
            style={({ pressed }) => [styles.iconBtn, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={styles.iconText}>←</Text>
          </Pressable>
        </View>

        <Card>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>List of events today</Text>
          </View>

          <View style={{ height: 10 }} />

          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 10 }} nestedScrollEnabled>
            {items.map(item => (
              <View key={item.id} style={styles.item}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.meta}>{item.meta}</Text>
                </View>

                <View style={styles.actions}>
                  <Button title="Delete" small variant="danger" onPress={() => requestDelete(item)} />
                  <Button title={item.done ? 'Done' : 'Mark as done'} small onPress={() => markDone(item.id)} />
                </View>
              </View>
            ))}
          </ScrollView>
        </Card>
      </ScrollView>

      <Modal visible={confirm.open} transparent animationType="fade" onRequestClose={closeConfirm}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeConfirm} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Confirm delete</Text>
              <Pressable onPress={closeConfirm} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.confirmText}>{confirmText}</Text>
            <View style={styles.divider} />
            <View style={styles.confirmRow}>
              <Button title="No" onPress={closeConfirm} />
              <Button title="Yes" variant="danger" onPress={deleteConfirmed} />
            </View>
          </View>
        </View>
      </Modal>
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
  actions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 16,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  close: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  confirmText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 12,
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
});
