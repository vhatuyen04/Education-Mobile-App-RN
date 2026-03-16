import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { toast } from '../utils/toast';

type EventItem = {
  id: string;
  day: number;
  title: string;
  start: string;
  end: string;
  repeat: 'Once' | 'Daily' | 'Weekly' | 'Custom';
  desc: string;
};

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function daysInMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

// Monday = 0 ... Sunday = 6
function mondayIndexOfFirstDay(year: number, monthIndex0: number) {
  const js = new Date(year, monthIndex0, 1).getDay();
  return (js + 6) % 7;
}

export function CalendarScreen() {
  const year = 20;
  const [monthIndex0] = useState(2);

  const monthLabel = 'March, 20XX';

  const [events, setEvents] = useState<EventItem[]>([
    { id: 'ev1', day: 2, title: 'Morning review', start: '07:30', end: '08:00', repeat: 'Daily', desc: 'None' },
    { id: 'ev2', day: 3, title: 'Gym session', start: '18:00', end: '19:00', repeat: 'Weekly', desc: 'None' },
    { id: 'ev3', day: 4, title: 'Thesis writing', start: '20:00', end: '21:30', repeat: 'Daily', desc: 'None' },
    { id: 'ev4', day: 5, title: 'Database class', start: '15:00', end: '18:00', repeat: 'Daily', desc: 'None' },
    { id: 'ev5', day: 5, title: 'Chess class', start: '18:00', end: '19:00', repeat: 'Daily', desc: 'None' },
    { id: 'ev6', day: 6, title: 'Basketball training', start: '20:00', end: '21:00', repeat: 'Once', desc: 'None' },
    { id: 'ev7', day: 7, title: 'IELTS practice', start: '19:00', end: '20:00', repeat: 'Daily', desc: 'None' },
    { id: 'ev8', day: 9, title: 'Study block', start: '09:00', end: '11:00', repeat: 'Once', desc: 'None' },
    { id: 'ev9', day: 9, title: 'Team meeting', start: '13:30', end: '14:00', repeat: 'Weekly', desc: 'None' },
    { id: 'ev10', day: 10, title: 'Project planning', start: '17:00', end: '17:40', repeat: 'Once', desc: 'None' },
    { id: 'ev11', day: 12, title: 'LoL ranked session', start: '21:00', end: '22:00', repeat: 'Custom', desc: 'None' },
    { id: 'ev12', day: 12, title: 'Stretching', start: '07:00', end: '07:20', repeat: 'Daily', desc: 'None' },
    { id: 'ev24', day: 12, title: 'Database revision', start: '16:00', end: '17:15', repeat: 'Once', desc: 'None' },
    { id: 'ev25', day: 12, title: 'Quick walk', start: '12:10', end: '12:30', repeat: 'Once', desc: 'None' },
    { id: 'ev13', day: 14, title: 'Weekly review', start: '20:30', end: '21:00', repeat: 'Weekly', desc: 'None' },
    { id: 'ev14', day: 15, title: 'Reading time', start: '22:00', end: '22:30', repeat: 'Daily', desc: 'None' },
    { id: 'ev15', day: 16, title: 'Database quiz', start: '10:00', end: '10:30', repeat: 'Once', desc: 'None' },
    { id: 'ev16', day: 18, title: 'Gym session', start: '18:00', end: '19:00', repeat: 'Weekly', desc: 'None' },
    { id: 'ev17', day: 20, title: 'Chess class', start: '18:00', end: '19:00', repeat: 'Daily', desc: 'None' },
    { id: 'ev18', day: 20, title: 'Study block', start: '19:30', end: '21:00', repeat: 'Once', desc: 'None' },
    { id: 'ev19', day: 21, title: 'Basketball goal step', start: '21:00', end: '21:30', repeat: 'Once', desc: 'None' },
    { id: 'ev20', day: 24, title: 'Thesis writing', start: '20:00', end: '21:30', repeat: 'Daily', desc: 'None' },
    { id: 'ev21', day: 24, title: 'Calendar cleanup', start: '21:40', end: '22:00', repeat: 'Once', desc: 'None' },
    { id: 'ev22', day: 26, title: 'Rest day', start: '00:00', end: '23:59', repeat: 'Once', desc: 'None' },
    { id: 'ev23', day: 28, title: 'Final review', start: '19:00', end: '21:00', repeat: 'Once', desc: 'None' },
  ]);

  const [dayEvents, setDayEvents] = useState<{ open: boolean; day: number | null }>({ open: false, day: null });
  const [edit, setEdit] = useState<{ open: boolean; eventId: string | null }>({ open: false, eventId: null });
  const [confirm, setConfirm] = useState<{ open: boolean; eventId: string | null }>({ open: false, eventId: null });

  const [gridWidth, setGridWidth] = useState<number | null>(null);
  const cellSize = useMemo(() => {
    if (!gridWidth) return null;
    const size = Math.floor(gridWidth / 7);
    return size > 0 ? size : null;
  }, [gridWidth]);

  const monthDays = useMemo(() => daysInMonth(year, monthIndex0), [year, monthIndex0]);
  const firstOffset = useMemo(() => mondayIndexOfFirstDay(year, monthIndex0), [year, monthIndex0]);

  const gridCells = useMemo(() => {
    const cells: Array<{ key: string; day: number | null }> = [];
    for (let i = 0; i < firstOffset; i++) cells.push({ key: `e_${i}`, day: null });
    for (let d = 1; d <= monthDays; d++) cells.push({ key: `d_${d}`, day: d });
    while (cells.length % 7 !== 0) cells.push({ key: `t_${cells.length}`, day: null });
    return cells;
  }, [firstOffset, monthDays]);

  const selectedDayEvents = useMemo(() => {
    if (!dayEvents.day) return [];
    return events.filter(e => e.day === dayEvents.day);
  }, [events, dayEvents.day]);

  const editingEvent = useMemo(() => {
    if (!edit.eventId) return null;
    return events.find(e => e.id === edit.eventId) ?? null;
  }, [events, edit.eventId]);

  const [form, setForm] = useState({ title: 'Database class', start: '15:00', end: '18:00', repeat: 'Daily', desc: 'None' });

  function openDay(day: number) {
    setDayEvents({ open: true, day });
  }

  function closeDayEvents() {
    setDayEvents({ open: false, day: null });
  }

  function openEdit(eventId: string) {
    setEdit({ open: true, eventId });
    const e = events.find(x => x.id === eventId);
    if (e) {
      setForm({ title: e.title, start: e.start, end: e.end, repeat: e.repeat, desc: e.desc });
    }
  }

  function closeEdit() {
    setEdit({ open: false, eventId: null });
  }

  function saveEdit() {
    if (!edit.eventId) return;
    setEvents(prev =>
      prev.map(e =>
        e.id === edit.eventId
          ? {
              ...e,
              title: form.title || 'New event',
              start: form.start || '00:00',
              end: form.end || '00:00',
              repeat: (form.repeat as any) || 'Once',
              desc: form.desc || 'None',
            }
          : e
      )
    );
    toast('Saved (demo)');
    closeEdit();
  }

  function requestDelete(eventId: string) {
    setConfirm({ open: true, eventId });
  }

  function closeConfirm() {
    setConfirm({ open: false, eventId: null });
  }

  function deleteConfirmed() {
    if (!confirm.eventId) return;
    setEvents(prev => prev.filter(e => e.id !== confirm.eventId));
    toast('Deleted (demo)');
    closeConfirm();
    closeEdit();
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.hTitle}>Calendar</Text>
          </View>
        </View>

        <Card>
          <View style={styles.calHeader}>
            <Button title="◀" small onPress={() => toast('Previous month (demo)')} />
            <Text style={styles.calMonth}>{monthLabel}</Text>
            <Button title="▶" small onPress={() => toast('Next month (demo)')} />
          </View>

          <View style={styles.weekdayRow}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <Text key={d} style={styles.weekday}>
                {d}
              </Text>
            ))}
          </View>

          <View
            style={[styles.grid, cellSize ? { width: cellSize * 7 } : null]}
            onLayout={e => setGridWidth(e.nativeEvent.layout.width)}
          >
            {gridCells.map(c => {
              if (!c.day) {
                return (
                  <View
                    key={c.key}
                    style={[
                      styles.cell,
                      !cellSize ? styles.cellFallback : null,
                      cellSize ? { width: cellSize, height: cellSize } : null,
                      styles.cellEmpty,
                    ]}
                  />
                );
              }

              const count = events.filter(e => e.day === c.day).length;
              const has = count > 0;
              const dotStrength = Math.min(4, count);
              const dotOpacity = 0.25 + dotStrength * 0.18;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => openDay(c.day!)}
                  style={({ pressed }) => [
                    styles.cell,
                    !cellSize ? styles.cellFallback : null,
                    cellSize ? { width: cellSize, height: cellSize } : null,
                    has ? styles.cellHas : null,
                    pressed ? { opacity: 0.85 } : null,
                  ]}
                >
                  <Text style={styles.dayText}>{c.day}</Text>
                  {has ? (
                    <View style={styles.dotRow}>
                      <View style={[styles.dot, { opacity: dotOpacity }]} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Card>
      </ScrollView>

      <Modal visible={dayEvents.open} transparent animationType="fade" onRequestClose={closeDayEvents}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDayEvents} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Events</Text>
              <Pressable onPress={closeDayEvents} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.mutedSmall}>All events for this day</Text>
            <View style={styles.divider} />

            <View style={{ gap: 10 }}>
              {selectedDayEvents.length === 0 ? (
                <Text style={styles.mutedSmall}>No events (demo)</Text>
              ) : (
                selectedDayEvents.map(e => (
                  <Pressable
                    key={e.id}
                    onPress={() => {
                      closeDayEvents();
                      openEdit(e.id);
                    }}
                    style={({ pressed }) => [styles.modalItem, pressed ? { opacity: 0.85 } : null]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalName}>{e.title}</Text>
                      <Text style={styles.modalMeta}>
                        {pad2(e.day)} · {e.start} – {e.end} · {e.repeat}
                      </Text>
                    </View>
                    <Badge>Edit</Badge>
                  </Pressable>
                ))
              )}
            </View>
          </View>
        </View>
      </Modal>

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
                <TextInput
                  value={form.title}
                  onChangeText={t => setForm(s => ({ ...s, title: t }))}
                  placeholder=""
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
              </View>

              <View style={styles.row}>
                <View style={[styles.field, { flex: 1 }]}
                >
                  <Text style={styles.label}>Start</Text>
                  <TextInput
                    value={form.start}
                    onChangeText={t => setForm(s => ({ ...s, start: t }))}
                    placeholder=""
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                  />
                </View>
                <View style={[styles.field, { flex: 1 }]}
                >
                  <Text style={styles.label}>End</Text>
                  <TextInput
                    value={form.end}
                    onChangeText={t => setForm(s => ({ ...s, end: t }))}
                    placeholder=""
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Repeat</Text>
                <TextInput
                  value={form.repeat}
                  onChangeText={t => setForm(s => ({ ...s, repeat: t }))}
                  placeholder="Once | Daily | Weekly | Custom"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Description</Text>
                <TextInput
                  value={form.desc}
                  onChangeText={t => setForm(s => ({ ...s, desc: t }))}
                  placeholder=""
                  placeholderTextColor={colors.muted}
                  multiline
                  style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                />
              </View>

              <View style={styles.divider} />

              <View style={styles.rowEnd}>
                <Button
                  title="Delete event"
                  variant="danger"
                  onPress={() => {
                    if (editingEvent) requestDelete(editingEvent.id);
                  }}
                />
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
    fontSize: 26,
    fontWeight: '900',
  },
  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  calMonth: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  weekdayRow: {
    flexDirection: 'row',
    marginTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    alignSelf: 'center',
  },
  cell: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 6,
    justifyContent: 'space-between',
  },
  cellFallback: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
  },
  cellEmpty: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: colors.line,
  },
  cellHas: {
    backgroundColor: 'rgba(139, 203, 255, 0.08)',
  },
  dayText: {
    color: colors.text,
    fontWeight: '900',
    fontSize: 12,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 99,
    backgroundColor: colors.primary,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 16,
  },
  backdropBottom: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
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
  mutedSmall: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 12,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 14,
  },
  modalName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  modalMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
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
