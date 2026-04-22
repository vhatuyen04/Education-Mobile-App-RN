import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import type { RootStackParamList } from '../navigation/types';

type EventItem = authApi.EventItem;

type CalendarEventInstance = EventItem & {
  _instanceId: string;
  _baseEventId: string;
  _occurrenceStartAt: string;
};

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function daysInMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function startOfDayLocal(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDayLocal(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function addDaysLocal(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function addMonthsLocal(d: Date, months: number) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}

function addYearsLocal(d: Date, years: number) {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + years);
  return x;
}

function normalizeRepeat(r: string | null | undefined) {
  const t = String(r ?? '').trim().toLowerCase();
  return t && t !== 'once' ? t : 'once';
}

function expandEventsForMonth(params: { events: EventItem[]; from: Date; to: Date }): CalendarEventInstance[] {
  const { events, from, to } = params;
  const windowStart = startOfDayLocal(from);
  const windowEnd = endOfDayLocal(to);

  const out: CalendarEventInstance[] = [];
  for (const e of events) {
    const repeat = normalizeRepeat(e.repeat);
    const baseStart = new Date(e.startAt);
    if (Number.isNaN(baseStart.getTime())) continue;

    const seriesStart = e.seriesStartAt ? new Date(e.seriesStartAt) : baseStart;
    const seriesEnd = e.seriesEndAt ? new Date(e.seriesEndAt) : null;

    const effectiveStart = seriesStart.getTime() > windowStart.getTime() ? seriesStart : windowStart;
    const effectiveEnd = seriesEnd && seriesEnd.getTime() < windowEnd.getTime() ? seriesEnd : windowEnd;
    if (effectiveEnd.getTime() < effectiveStart.getTime()) continue;

    if (repeat === 'once') {
      if (baseStart.getTime() < windowStart.getTime() || baseStart.getTime() > windowEnd.getTime()) continue;
      out.push({
        ...e,
        _instanceId: `${e.id}@${e.startAt}`,
        _baseEventId: e.id,
        _occurrenceStartAt: e.startAt,
      });
      continue;
    }

    if (repeat === 'daily') {
      for (let cur = startOfDayLocal(effectiveStart); cur.getTime() <= effectiveEnd.getTime(); cur = addDaysLocal(cur, 1)) {
        const occ = new Date(cur);
        occ.setHours(baseStart.getHours(), baseStart.getMinutes(), 0, 0);
        out.push({
          ...e,
          startAt: occ.toISOString(),
          _instanceId: `${e.id}@${occ.toISOString()}`,
          _baseEventId: e.id,
          _occurrenceStartAt: occ.toISOString(),
        });
      }
      continue;
    }

    if (repeat === 'weekly') {
      let cursor = new Date(baseStart);
      while (cursor.getTime() < effectiveStart.getTime()) cursor = addDaysLocal(cursor, 7);
      while (cursor.getTime() <= effectiveEnd.getTime()) {
        out.push({
          ...e,
          startAt: cursor.toISOString(),
          _instanceId: `${e.id}@${cursor.toISOString()}`,
          _baseEventId: e.id,
          _occurrenceStartAt: cursor.toISOString(),
        });
        cursor = addDaysLocal(cursor, 7);
      }
      continue;
    }

    if (repeat === 'monthly') {
      let cursor = new Date(baseStart);
      while (cursor.getTime() < effectiveStart.getTime()) cursor = addMonthsLocal(cursor, 1);
      while (cursor.getTime() <= effectiveEnd.getTime()) {
        out.push({
          ...e,
          startAt: cursor.toISOString(),
          _instanceId: `${e.id}@${cursor.toISOString()}`,
          _baseEventId: e.id,
          _occurrenceStartAt: cursor.toISOString(),
        });
        cursor = addMonthsLocal(cursor, 1);
      }
      continue;
    }

    if (repeat === 'yearly') {
      let cursor = new Date(baseStart);
      while (cursor.getTime() < effectiveStart.getTime()) cursor = addYearsLocal(cursor, 1);
      while (cursor.getTime() <= effectiveEnd.getTime()) {
        out.push({
          ...e,
          startAt: cursor.toISOString(),
          _instanceId: `${e.id}@${cursor.toISOString()}`,
          _baseEventId: e.id,
          _occurrenceStartAt: cursor.toISOString(),
        });
        cursor = addYearsLocal(cursor, 1);
      }
      continue;
    }

    // Unknown repeat type: keep existing behavior (only show if within window).
    if (baseStart.getTime() >= windowStart.getTime() && baseStart.getTime() <= windowEnd.getTime()) {
      out.push({
        ...e,
        _instanceId: `${e.id}@${e.startAt}`,
        _baseEventId: e.id,
        _occurrenceStartAt: e.startAt,
      });
    }
  }

  return out;
}

function parseDateDMY(raw: string): Date | null {
  const s = raw.trim();
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (Number.isNaN(dd) || Number.isNaN(mm) || Number.isNaN(yyyy)) return null;
  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseTimeHM(raw: string): { hh: number; mm: number } | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function combineDateAndTimeDMY(dateDmy: string, timeHm: string, fallbackDate: Date): Date | null {
  const base = dateDmy.trim() ? parseDateDMY(dateDmy) : new Date(fallbackDate);
  if (!base) return null;
  const t = parseTimeHM(timeHm);
  if (!t) return null;
  const d = new Date(base);
  d.setHours(t.hh, t.mm, 0, 0);
  return d;
}

// Monday = 0 ... Sunday = 6
function mondayIndexOfFirstDay(year: number, monthIndex0: number) {
  const js = new Date(year, monthIndex0, 1).getDay();
  return (js + 6) % 7;
}

export function CalendarScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<{ Calendar: { openEventId?: string; openEventStartAt?: string } | undefined }, 'Calendar'>>();
  const { state } = useAuth();

  const [viewDate, setViewDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);

  const year = viewDate.getFullYear();
  const monthIndex0 = viewDate.getMonth();

  const monthLabel = useMemo(() => {
    return viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }, [viewDate]);

  const [dayEvents, setDayEvents] = useState<{ open: boolean; day: number | null }>({ open: false, day: null });
  const [edit, setEdit] = useState<{ open: boolean; eventId: string | null }>({ open: false, eventId: null });
  const [confirm, setConfirm] = useState<{ open: boolean; eventId: string | null }>({ open: false, eventId: null });

  const lastAutoOpenedEventId = useRef<string | null>(null);

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

  const monthRange = useMemo(() => {
    const from = new Date(year, monthIndex0, 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(year, monthIndex0 + 1, 0);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }, [monthIndex0, year]);

  const calendarEvents = useMemo(() => {
    return expandEventsForMonth({ events, from: monthRange.from, to: monthRange.to });
  }, [events, monthRange.from, monthRange.to]);

  const selectedDayEvents = useMemo(() => {
    if (!dayEvents.day) return [];
    return calendarEvents.filter(e => {
      const d = new Date(e.startAt);
      return d.getFullYear() === year && d.getMonth() === monthIndex0 && d.getDate() === dayEvents.day;
    });
  }, [calendarEvents, dayEvents.day, monthIndex0, year]);

  const editingEvent = useMemo(() => {
    if (!edit.eventId) return null;
    return events.find(e => e.id === edit.eventId) ?? null;
  }, [events, edit.eventId]);

  const [form, setForm] = useState({
    title: 'New event',
    startDate: '',
    startTime: '09:00',
    endDate: '',
    endTime: '10:00',
    repeat: 'Once',
    desc: 'None',
  });

  useEffect(() => {
    const startAt = route.params?.openEventStartAt;
    if (!startAt) return;
    const d = new Date(startAt);
    if (Number.isNaN(d.getTime())) return;
    const target = new Date(d.getFullYear(), d.getMonth(), 1);
    if (target.getFullYear() === viewDate.getFullYear() && target.getMonth() === viewDate.getMonth()) return;
    setViewDate(target);
  }, [route.params?.openEventStartAt, viewDate]);

  const refresh = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;

    setLoading(true);
    try {
      const resp = await authApi.listEvents(token, { from: monthRange.from.toISOString(), to: monthRange.to.toISOString() });
      const unique = new Map<string, authApi.EventItem>();
      for (const e of resp.events) unique.set(e.id, e);
      setEvents(Array.from(unique.values()));
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [monthRange.from, monthRange.to, state.accessToken]);

  useEffect(() => {
    const eventId = route.params?.openEventId;
    if (!eventId) return;
    if (lastAutoOpenedEventId.current === eventId && edit.open) return;
    const exists = events.some(e => e.id === eventId);
    if (!exists) return;
    lastAutoOpenedEventId.current = eventId;
    openEdit(eventId);
    // Clear the param so closing the modal doesn't immediately reopen it.
    // Navigating here again with openEventId will set it back.
    (nav as any).setParams?.({ openEventId: undefined, openEventStartAt: undefined });
  }, [route.params?.openEventId, events, edit.open]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function combineDateAndTime(day: number, hm: string) {
    const m = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    const d = new Date(year, monthIndex0, day);
    d.setHours(hh, mm, 0, 0);
    return d;
  }

  function formatTimeRange(startAt: string, endAt: string | null) {
    const start = new Date(startAt);
    const end = endAt ? new Date(endAt) : null;
    const startTxt = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const endTxt = end ? end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
    return endTxt ? `${startTxt} – ${endTxt}` : startTxt;
  }

  function openDay(day: number) {
    setDayEvents({ open: true, day });
  }

  function closeDayEvents() {
    setDayEvents(s => ({ ...s, open: false }));
  }

  function openEdit(eventId: string) {
    setEdit({ open: true, eventId });
    const e = events.find(x => x.id === eventId);
    if (e) {
      const s = new Date(e.startAt);
      const endDt = e.endAt ? new Date(e.endAt) : null;
      const startTime = s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const endTime = endDt
        ? endDt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        : startTime;

      const sdd = String(s.getDate()).padStart(2, '0');
      const smm = String(s.getMonth() + 1).padStart(2, '0');
      const syy = String(s.getFullYear());
      const startDate = `${sdd}-${smm}-${syy}`;

      const edd = endDt ? String(endDt.getDate()).padStart(2, '0') : sdd;
      const emm = endDt ? String(endDt.getMonth() + 1).padStart(2, '0') : smm;
      const eyy = endDt ? String(endDt.getFullYear()) : syy;
      const endDate = `${edd}-${emm}-${eyy}`;

      setForm({
        title: e.title,
        startDate,
        startTime,
        endDate,
        endTime,
        repeat: (e.repeat ?? 'Once') as any,
        desc: 'None',
      });
    }
  }

  function closeEdit() {
    setEdit({ open: false, eventId: null });
  }

  async function saveEdit() {
    if (loading) return;
    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }
    if (!edit.eventId) return;

    const fallbackDate = editingEvent ? new Date(editingEvent.startAt) : new Date(year, monthIndex0, 1);
    const startDt = combineDateAndTimeDMY(form.startDate, form.startTime || '00:00', fallbackDate);
    const endDt = combineDateAndTimeDMY(form.endDate || form.startDate, form.endTime || '00:00', fallbackDate);
    if (!startDt) {
      toast('Invalid start (use DD-MM-YYYY and HH:MM)');
      return;
    }
    if (!endDt) {
      toast('Invalid end (use DD-MM-YYYY and HH:MM)');
      return;
    }

    setLoading(true);
    try {
      const repeatMode = (form.repeat as any) || 'Once';
      const scope = repeatMode !== 'Once' || editingEvent?.seriesId ? 'series' : 'single';
      await authApi.updateEvent(
        token,
        edit.eventId,
        {
          title: form.title || 'New event',
          startAt: startDt.toISOString(),
          endAt: endDt ? endDt.toISOString() : null,
          repeat: (form.repeat as any) || null,
        },
        { scope }
      );
      await refresh();
      toast('Saved');
      closeEdit();
    } catch (e: any) {
      toast(String(e?.message ?? 'Save failed'));
    } finally {
      setLoading(false);
    }
  }

  function requestDelete(eventId: string) {
    setConfirm({ open: true, eventId });
  }

  function closeConfirm() {
    setConfirm({ open: false, eventId: null });
  }

  async function deleteConfirmed() {
    if (loading) return;
    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }
    if (!confirm.eventId) return;

    setLoading(true);
    try {
      const e = events.find(x => x.id === confirm.eventId) ?? null;
      const repeatMode = (e?.repeat ?? 'Once') as any;
      const scope = repeatMode !== 'Once' || e?.seriesId ? 'series' : 'single';
      await authApi.deleteEvent(token, confirm.eventId, { scope });
      await refresh();
      toast('Deleted');
      closeConfirm();
      closeEdit();
    } catch (e: any) {
      toast(String(e?.message ?? 'Delete failed'));
    } finally {
      setLoading(false);
    }
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
            <Button
              title="◀"
              small
              onPress={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            />
            <Text style={styles.calMonth}>{monthLabel}</Text>
            <Button
              title="▶"
              small
              onPress={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            />
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

              const count = calendarEvents.filter(e => {
                const d = new Date(e.startAt);
                return d.getFullYear() === year && d.getMonth() === monthIndex0 && d.getDate() === c.day;
              }).length;

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

          <View style={{ height: 10 }} />
          <Button title="Modify schedule" full onPress={() => nav.navigate('ScheduleWeek')} />
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
                <Text style={styles.mutedSmall}>No events</Text>
              ) : (
                selectedDayEvents.map(e => (
                  <Pressable
                    key={(e as any)._instanceId ?? e.id}
                    onPress={() => {
                      closeDayEvents();
                      openEdit((e as any)._baseEventId ?? e.id);
                    }}
                    style={({ pressed }) => [styles.modalItem, pressed ? { opacity: 0.85 } : null]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalName}>{e.title}</Text>
                      <Text style={styles.modalMeta}>
                        {pad2(new Date(e.startAt).getDate())} · {formatTimeRange(e.startAt, e.endAt)} · {e.repeat ?? 'Once'}
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
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>Start date</Text>
                  <TextInput
                    value={form.startDate}
                    onChangeText={t => setForm(s => ({ ...s, startDate: t }))}
                    placeholder="DD-MM-YYYY"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                    autoCapitalize="none"
                  />
                </View>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>Start time</Text>
                  <TextInput
                    value={form.startTime}
                    onChangeText={t => setForm(s => ({ ...s, startTime: t }))}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                    autoCapitalize="none"
                  />
                </View>
              </View>

              <View style={styles.row}>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>End date</Text>
                  <TextInput
                    value={form.endDate}
                    onChangeText={t => setForm(s => ({ ...s, endDate: t }))}
                    placeholder="DD-MM-YYYY"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                    autoCapitalize="none"
                  />
                </View>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>End time</Text>
                  <TextInput
                    value={form.endTime}
                    onChangeText={t => setForm(s => ({ ...s, endTime: t }))}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                    autoCapitalize="none"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Repeat</Text>
                <TextInput
                  value={form.repeat}
                  onChangeText={t => setForm(s => ({ ...s, repeat: t }))}
                  placeholder="Once | Daily | Weekly | Monthly | Yearly"
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
