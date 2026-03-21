import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Pill } from '../components/Pill';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { toast } from '../utils/toast';

type DayKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

type Block = {
  id: string;
  day: DayKey;
  title: string;
  start: string;
  end: string;
  repeat: 'Once' | 'Daily' | 'Weekly' | 'Custom';
  desc: string;
};

function makeId() {
  return `b_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function ScheduleWeekScreen() {
  const nav = useNavigation();
  const [day, setDay] = useState<DayKey>('Mon');

  const [blocks, setBlocks] = useState<Block[]>([
    { id: 'b1', day: 'Mon', title: 'Database class', start: '15:00', end: '18:00', repeat: 'Daily', desc: 'None' },
    { id: 'b2', day: 'Mon', title: 'Chess class', start: '18:00', end: '19:00', repeat: 'Daily', desc: 'None' },
    { id: 'b3', day: 'Tue', title: 'Gym session', start: '18:00', end: '19:00', repeat: 'Weekly', desc: 'None' },
    { id: 'b4', day: 'Wed', title: 'Thesis writing', start: '20:00', end: '21:30', repeat: 'Daily', desc: 'None' },
    { id: 'b5', day: 'Fri', title: 'IELTS practice', start: '19:00', end: '20:00', repeat: 'Daily', desc: 'None' },
  ]);

  const [edit, setEdit] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [confirm, setConfirm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });

  const currentBlocks = useMemo(() => blocks.filter(b => b.day === day), [blocks, day]);
  const editingBlock = useMemo(() => (edit.id ? blocks.find(b => b.id === edit.id) ?? null : null), [blocks, edit.id]);

  const [form, setForm] = useState({ title: 'New event', start: '09:00', end: '10:00', repeat: 'Once', desc: 'None' });

  function openEdit(id: string) {
    setEdit({ open: true, id });
    const b = blocks.find(x => x.id === id);
    if (b) setForm({ title: b.title, start: b.start, end: b.end, repeat: b.repeat, desc: b.desc });
  }

  function openNew() {
    const id = makeId();
    const newBlock: Block = { id, day, title: 'New event', start: '09:00', end: '10:00', repeat: 'Once', desc: 'None' };
    setBlocks(prev => [newBlock, ...prev]);
    setForm({ title: newBlock.title, start: newBlock.start, end: newBlock.end, repeat: newBlock.repeat, desc: newBlock.desc });
    setEdit({ open: true, id });
  }

  function closeEdit() {
    setEdit({ open: false, id: null });
  }

  function saveEdit() {
    if (!edit.id) return;
    setBlocks(prev =>
      prev.map(b =>
        b.id === edit.id
          ? {
              ...b,
              title: form.title || 'New event',
              start: form.start || '00:00',
              end: form.end || '00:00',
              repeat: (form.repeat as any) || 'Once',
              desc: form.desc || 'None',
            }
          : b
      )
    );
    toast('Saved (demo)');
    closeEdit();
  }

  function requestDelete() {
    if (!edit.id) return;
    setConfirm({ open: true, id: edit.id });
  }

  function closeConfirm() {
    setConfirm({ open: false, id: null });
  }

  function deleteConfirmed() {
    if (!confirm.id) return;
    setBlocks(prev => prev.filter(b => b.id !== confirm.id));
    toast('Deleted (demo)');
    closeConfirm();
    closeEdit();
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hTitle}>Modify schedule</Text>
            <View style={styles.hSub}>
              <Pill dot>Weekly view</Pill>
              <Pill>Tap a block to edit</Pill>
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
            <Text style={styles.cardTitle}>Week (March, 20XX)</Text>
            <Badge>All editable</Badge>
          </View>

          <View style={{ height: 10 }} />

          <View style={styles.tabs}>
            {(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const).map(t => (
              <Pressable
                key={t}
                onPress={() => setDay(t)}
                style={({ pressed }) => [styles.tab, day === t ? styles.tabOn : null, pressed ? { opacity: 0.9 } : null]}
              >
                <Text style={[styles.tabText, day === t ? styles.tabTextOn : null]}>{t}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ height: 12 }} />

          <View style={{ gap: 10 }}>
            {currentBlocks.length === 0 ? (
              <Text style={styles.mutedSmall}>No blocks for this day (demo)</Text>
            ) : (
              currentBlocks.map(b => (
                <Pressable
                  key={b.id}
                  onPress={() => openEdit(b.id)}
                  style={({ pressed }) => [styles.item, pressed ? { opacity: 0.85 } : null]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{b.title}</Text>
                    <Text style={styles.meta}>
                      {b.start} – {b.end} · {b.repeat}
                    </Text>
                  </View>
                  <Badge>Edit</Badge>
                </Pressable>
              ))
            )}
          </View>

          <View style={{ height: 12 }} />
          <Button title={'+ Add'} variant="primary" full onPress={openNew} />
        </Card>
      </ScrollView>

      <Modal visible={edit.open} transparent animationType="slide" onRequestClose={closeEdit}>
        <View style={styles.backdropBottom}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeEdit} />
          <View style={styles.sheetBottom}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Event details</Text>
              <Pressable onPress={closeEdit} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 10 }}>
              <View style={styles.field}>
                <Text style={styles.label}>Title</Text>
                <TextInput value={form.title} onChangeText={t => setForm(s => ({ ...s, title: t }))} style={styles.input} placeholder="" placeholderTextColor={colors.muted} />
              </View>

              <View style={styles.row}>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>Start</Text>
                  <TextInput value={form.start} onChangeText={t => setForm(s => ({ ...s, start: t }))} style={styles.input} placeholder="" placeholderTextColor={colors.muted} />
                </View>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>End</Text>
                  <TextInput value={form.end} onChangeText={t => setForm(s => ({ ...s, end: t }))} style={styles.input} placeholder="" placeholderTextColor={colors.muted} />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Repeat</Text>
                <TextInput
                  value={form.repeat}
                  onChangeText={t => setForm(s => ({ ...s, repeat: t }))}
                  style={styles.input}
                  placeholder="Once | Daily | Weekly | Custom"
                  placeholderTextColor={colors.muted}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Description</Text>
                <TextInput
                  value={form.desc}
                  onChangeText={t => setForm(s => ({ ...s, desc: t }))}
                  style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                  placeholder=""
                  placeholderTextColor={colors.muted}
                  multiline
                />
              </View>

              <View style={styles.divider} />

              <View style={styles.rowEnd}>
                <Button title="Delete event" variant="danger" onPress={requestDelete} />
                <Button title="Save" variant="primary" onPress={saveEdit} />
              </View>
              <Text style={styles.hint}>
                This sheet represents the “click in the tab to modify information” behavior in your sketch.
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

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
            <Text style={styles.mutedSmall}>Are you sure you want to delete this event?</Text>
            <View style={styles.divider} />
            <View style={styles.rowEnd}>
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
  mutedSmall: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
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
  backdropBottom: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheetBottom: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingTop: 12,
    maxHeight: '90%',
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
  field: {
    marginTop: 10,
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: colors.text,
    fontWeight: '900',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-end',
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 12,
  },
  rowEnd: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    alignItems: 'center',
  },
  hint: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
});
