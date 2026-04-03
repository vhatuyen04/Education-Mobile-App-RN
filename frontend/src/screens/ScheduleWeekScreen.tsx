import React, { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';

type DayKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

type RepeatMode = 'Once' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';

type Block = {
  id: string;
  eventId: string;
  day: DayKey;
  title: string;
  start: string;
  end: string;
  repeat: RepeatMode;
  desc: string;
  startAt: string;
  endAt: string | null;
  seriesId?: string | null;
};

function makeId() {
  return `b_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function ScheduleWeekScreen() {
  const nav = useNavigation();
  const { state } = useAuth();

  const [day, setDay] = useState<DayKey>(() => {
    const d = new Date();
    const keys: DayKey[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const k = keys[d.getDay()];
    return (k === 'Sun' ? 'Sun' : k) as DayKey;
  });

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(false);

  const [edit, setEdit] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [confirm, setConfirm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });

  const currentBlocks = useMemo(() => {
    function toMinutes(hm: string) {
      const m = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return 0;
      return Number(m[1]) * 60 + Number(m[2]);
    }

    return blocks
      .filter(b => b.day === day)
      .slice()
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  }, [blocks, day]);

  const editingBlock = useMemo(() => {
    if (!edit.id) return null;
    return blocks.find(b => b.eventId === edit.id && b.day === day) ?? blocks.find(b => b.eventId === edit.id) ?? null;
  }, [blocks, day, edit.id]);

  const [form, setForm] = useState({
    title: 'New event',
    startDate: '',
    startTime: '09:00',
    endDate: '',
    endTime: '10:00',
    repeat: 'Once' as RepeatMode,
    repeatUntil: '',
    desc: 'None',
  });

  const week = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    const dayIdx = (start.getDay() + 6) % 7; // Monday=0
    start.setDate(start.getDate() - dayIdx);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, []);

  const dayDate = useMemo(() => {
    const map: Record<DayKey, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    const d = new Date(week.start);
    d.setDate(d.getDate() + map[day]);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [day, week.start]);

  const dayDateLabel = useMemo(() => {
    const dd = String(dayDate.getDate()).padStart(2, '0');
    const mm = String(dayDate.getMonth() + 1).padStart(2, '0');
    const yyyy = String(dayDate.getFullYear());
    return `${dd}-${mm}-${yyyy}`;
  }, [dayDate]);

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

  const refresh = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;

    setLoading(true);
    try {
      const resp = await authApi.listEvents(token);

      const unique = new Map<string, authApi.EventItem>();
      for (const e of resp.events) unique.set(e.id, e);

      const keys: DayKey[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

      const next: Block[] = [];
      for (const e of Array.from(unique.values())) {
        const d = new Date(e.startAt);
        const idx = (d.getDay() + 6) % 7; // Monday=0
        const eventDay = keys[idx];

        const startTxt = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        const endTxt = e.endAt
          ? new Date(e.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
          : '';

        const targetDays: DayKey[] = [eventDay];

        for (const dayKey of targetDays) {
          next.push({
            id: e.id,
            eventId: e.id,
            day: dayKey,
            title: e.title,
            start: startTxt,
            end: endTxt || startTxt,
            repeat: ((e.repeat ?? 'Once') as any) as RepeatMode,
            desc: 'None',
            startAt: e.startAt,
            endAt: e.endAt ?? null,
            seriesId: e.seriesId ?? null,
          });
        }
      }

      setBlocks(next);
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [state.accessToken]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  function openEdit(eventId: string) {
    setEdit({ open: true, id: eventId });
    const b = blocks.find(x => x.eventId === eventId && x.day === day) ?? blocks.find(x => x.eventId === eventId);
    if (b) {
      const s = new Date(b.startAt);
      const e = b.endAt ? new Date(b.endAt) : null;

      const sdd = String(s.getDate()).padStart(2, '0');
      const smm = String(s.getMonth() + 1).padStart(2, '0');
      const syy = String(s.getFullYear());
      const startDate = `${sdd}-${smm}-${syy}`;

      const edd = e ? String(e.getDate()).padStart(2, '0') : sdd;
      const emm = e ? String(e.getMonth() + 1).padStart(2, '0') : smm;
      const eyy = e ? String(e.getFullYear()) : syy;
      const endDate = `${edd}-${emm}-${eyy}`;

      setForm({
        title: b.title,
        startDate,
        startTime: b.start,
        endDate,
        endTime: b.end,
        repeat: b.repeat,
        repeatUntil: '',
        desc: b.desc,
      });
    }
  }

  function openNew() {
    const id = makeId();
    setForm({
      title: 'New event',
      startDate: dayDateLabel,
      startTime: '09:00',
      endDate: dayDateLabel,
      endTime: '10:00',
      repeat: 'Once',
      repeatUntil: '',
      desc: 'None',
    });
    setEdit({ open: true, id });
  }

  function closeEdit() {
    setEdit({ open: false, id: null });
  }

  async function saveEdit() {
    if (loading) return;
    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }
    if (!edit.id) return;

    const repeatMode = (form.repeat || 'Once') as RepeatMode;

    const startDt = combineDateAndTimeDMY(form.startDate, form.startTime || '00:00', dayDate);
    const endDt = combineDateAndTimeDMY(form.endDate || form.startDate, form.endTime || '00:00', dayDate);
    if (!startDt) {
      toast('Invalid start (use DD-MM-YYYY and HH:MM)');
      return;
    }
    if (!endDt) {
      toast('Invalid end (use DD-MM-YYYY and HH:MM)');
      return;
    }

    const isExisting = blocks.some(b => b.eventId === edit.id);

    setLoading(true);
    try {
      if (isExisting) {
        const existingBlock = blocks.find(b => b.eventId === edit.id) ?? null;
        const scope = repeatMode !== 'Once' || existingBlock?.seriesId ? 'series' : 'single';
        await authApi.updateEvent(
          token,
          edit.id,
          {
            title: form.title || 'New event',
            startAt: startDt.toISOString(),
            endAt: endDt ? endDt.toISOString() : null,
            repeat: repeatMode || null,
          },
          { scope }
        );
      } else {
        const isRepeat = repeatMode && repeatMode !== 'Once';
        const payload: any = {
          title: form.title || 'New event',
          startAt: startDt.toISOString(),
          endAt: endDt ? endDt.toISOString() : undefined,
          repeat: repeatMode || undefined,
        };

        if (isRepeat) {
          const seriesEndBase = parseDateDMY(form.endDate);
          if (!seriesEndBase) {
            toast('End date is required for repeating events (DD-MM-YYYY)');
            return;
          }
          const seriesEnd = new Date(seriesEndBase);
          seriesEnd.setHours(23, 59, 59, 999);
          if (seriesEnd.getTime() < startDt.getTime()) {
            toast('End date must be after start date');
            return;
          }
          payload.seriesEndAt = seriesEnd.toISOString();
        }

        await authApi.createEvent(token, payload);
      }

      await refresh();
      toast('Saved');
      closeEdit();
    } catch (e: any) {
      toast(String(e?.message ?? 'Save failed'));
    } finally {
      setLoading(false);
    }
  }

  function requestDelete() {
    if (!edit.id) return;
    setConfirm({ open: true, id: edit.id });
  }

  function closeConfirm() {
    setConfirm({ open: false, id: null });
  }

  async function deleteConfirmed() {
    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }
    if (!confirm.id) return;

    const existingBlock = blocks.find(b => b.eventId === confirm.id) ?? null;
    const scope = existingBlock?.repeat !== 'Once' || existingBlock?.seriesId ? 'series' : 'single';

    setLoading(true);
    try {
      await authApi.deleteEvent(token, confirm.id, { scope });
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
          <View style={{ flex: 1 }}>
            <Text style={styles.hTitle}>Modify schedule</Text>
          </View>
          <Pressable
            onPress={() => (nav as any).goBack()}
            style={({ pressed }) => [styles.iconBtn, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={styles.iconText}>←</Text>
          </Pressable>
        </View>

        <Card>
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
              <Text style={styles.mutedSmall}>No blocks for this day</Text>
            ) : (
              currentBlocks.map(b => (
                <Pressable
                  key={b.id}
                  onPress={() => openEdit(b.eventId)}
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
                  <Text style={styles.label}>Start date</Text>
                  <TextInput
                    value={form.startDate}
                    onChangeText={t => setForm(s => ({ ...s, startDate: t }))}
                    style={styles.input}
                    placeholder="DD-MM-YYYY"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                  />
                </View>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>Start time</Text>
                  <TextInput
                    value={form.startTime}
                    onChangeText={t => setForm(s => ({ ...s, startTime: t }))}
                    style={styles.input}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.muted}
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
                    style={styles.input}
                    placeholder="DD-MM-YYYY"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                  />
                </View>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.label}>End time</Text>
                  <TextInput
                    value={form.endTime}
                    onChangeText={t => setForm(s => ({ ...s, endTime: t }))}
                    style={styles.input}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Repeat</Text>
                <View style={styles.repeatRow}>
                  {(['Once', 'Daily', 'Weekly', 'Monthly', 'Yearly'] as const).map(opt => (
                    <Pressable
                      key={opt}
                      onPress={() => setForm(s => ({ ...s, repeat: opt }))}
                      style={({ pressed }) => [
                        styles.repeatChip,
                        form.repeat === opt ? styles.repeatChipOn : null,
                        pressed ? { opacity: 0.9 } : null,
                      ]}
                    >
                      <Text style={[styles.repeatChipText, form.repeat === opt ? styles.repeatChipTextOn : null]}>{opt}</Text>
                    </Pressable>
                  ))}
                </View>
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
  repeatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  repeatChip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
  },
  repeatChipOn: {
    backgroundColor: colors.primary,
    borderColor: 'transparent',
  },
  repeatChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  repeatChipTextOn: {
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
