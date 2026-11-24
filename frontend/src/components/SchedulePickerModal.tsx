import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme/colors';
import { Button } from './Button';
import { shiftMonth } from '../utils/stepOccurrences';
import {
  REPLACE_CHANGES,
  applyPending,
  compactScheduleLabel,
  draftFromScheduleText,
  endForDisplay,
  isCustomized,
  isDateSelected,
  requestMonthDay,
  requestPreset,
  requestWeekday,
  requestYearDay,
  requestYearMonth,
  scheduleTextFromDraft,
  selectionState,
  unmodifiedRepeatLabel,
  setCustomUntil,
  toggleDate,
  type PendingChange,
  type PickerDraft,
  type Preset,
  type ScheduleRange,
} from '../utils/schedulePicker';

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
  { id: 'once', label: 'Once' },
  { id: 'manual', label: 'Custom' },
];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEK_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_MAX = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const HEADS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type Props = {
  visible: boolean;
  initialText: string;
  range: ScheduleRange;
  onCancel: () => void;
  onConfirm: (text: string) => void;
};

export function SchedulePickerModal({ visible, initialText, range, onCancel, onConfirm }: Props) {
  const [draft, setDraft] = useState<PickerDraft>(() => draftFromScheduleText(initialText));
  const [cursor, setCursor] = useState(() => monthOf(range.start));
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [pickingEnd, setPickingEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const next = draftFromScheduleText(initialText);
    setDraft(next);
    setPending(null);
    setPickingEnd(false);
    setError(null);
    setCursor(monthOf(next.onceDate ?? next.added[0] ?? range.start));
  }, [visible, initialText, range.start, range.deadline]);

  const summary = useMemo(() => selectionState(draft, range), [draft, range]);
  const confirmed = useMemo(() => scheduleTextFromDraft(draft, range), [draft, range]);
  const cells = useMemo(() => monthCells(cursor.year, cursor.month), [cursor]);
  const end = endForDisplay(draft, range);
  const repeating = draft.preset === 'daily' || draft.preset === 'weekly' || draft.preset === 'monthly' || draft.preset === 'yearly';
  const showEnd = repeating && isCustomized(draft, range);
  const yearDayMax = MONTH_MAX[draft.yearMonth - 1] ?? 31;

  function propose(next: { draft: PickerDraft; confirm: boolean }, change: PendingChange) {
    if (pending) return;
    setError(null);
    if (next.confirm) setPending(change);
    else {
      setPending(null);
      setDraft(next.draft);
    }
  }

  function onDay(date: string) {
    if (pending) return;
    if (pickingEnd) {
      const next = setCustomUntil(draft, date, range);
      if (next !== draft) {
        setDraft(next);
        setPickingEnd(false);
        setError(null);
      }
      return;
    }
    setDraft(toggleDate(draft, date, range));
    setError(null);
  }

  function confirm() {
    if (pending) return;
    const result = scheduleTextFromDraft(draft, range);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    onConfirm(result.text);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.root}>
        <Text style={styles.title}>Select Schedule</Text>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.wrap}>
            {PRESETS.map(item => (
              <Pressable key={item.id} onPress={() => propose(requestPreset(draft, item.id, range), { type: 'preset', preset: item.id })} style={[styles.chip, draft.preset === item.id ? styles.chipOn : null]}>
                <Text style={[styles.chipText, draft.preset === item.id ? styles.chipTextOn : null]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          {draft.preset === 'weekly' || pending?.type === 'weekday' ? (
            <View style={styles.wrap}>
              {WEEK_ORDER.map(day => (
                <Pressable key={day} onPress={() => propose(requestWeekday(draft, day, range), { type: 'weekday', weekday: day })} style={[styles.chip, draft.preset === 'weekly' && draft.weekday === day ? styles.chipOn : null]}>
                  <Text style={[styles.chipText, draft.preset === 'weekly' && draft.weekday === day ? styles.chipTextOn : null]}>{WEEK_LABEL[day]}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {draft.preset === 'monthly' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {Array.from({ length: 31 }, (_, index) => index + 1).map(day => (
                <Pressable key={day} onPress={() => propose(requestMonthDay(draft, day, range), { type: 'monthDay', monthDay: day })} style={[styles.chip, draft.monthDay === day ? styles.chipOn : null]}>
                  <Text style={[styles.chipText, draft.monthDay === day ? styles.chipTextOn : null]}>{day}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {draft.preset === 'yearly' ? (
            <>
              <View style={styles.wrap}>
                {MONTHS.map((name, index) => {
                  const month = index + 1;
                  return (
                    <Pressable key={name} onPress={() => propose(requestYearMonth(draft, month, range), { type: 'yearMonth', yearMonth: month })} style={[styles.chip, draft.yearMonth === month ? styles.chipOn : null]}>
                      <Text style={[styles.chipText, draft.yearMonth === month ? styles.chipTextOn : null]}>{name}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {Array.from({ length: yearDayMax }, (_, index) => index + 1).map(day => (
                  <Pressable key={day} onPress={() => propose(requestYearDay(draft, day, range), { type: 'yearDay', yearDay: day })} style={[styles.chip, draft.yearDay === day ? styles.chipOn : null]}>
                    <Text style={[styles.chipText, draft.yearDay === day ? styles.chipTextOn : null]}>{day}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}

          <View style={styles.monthHeader}>
            <Pressable onPress={() => setCursor(shiftMonth(cursor.year, cursor.month, -1))} hitSlop={8} style={styles.nav}><Text style={styles.navText}>‹</Text></Pressable>
            <Text style={styles.month}>{MONTHS[cursor.month - 1]} {cursor.year}</Text>
            <Pressable onPress={() => setCursor(shiftMonth(cursor.year, cursor.month, 1))} hitSlop={8} style={styles.nav}><Text style={styles.navText}>›</Text></Pressable>
          </View>
          <View style={styles.weekRow}>{HEADS.map((label, index) => <Text key={`${label}-${index}`} style={styles.head}>{label}</Text>)}</View>
          <View style={styles.grid}>
            {cells.map((date, index) => {
              if (!date) return <View key={`empty-${index}`} style={styles.cell} />;
              const selected = isDateSelected(draft, date, range);
              const enabled = date >= range.start && (!range.deadline || date <= range.deadline);
              return (
                <Pressable key={date} disabled={!enabled} onPress={() => onDay(date)} style={styles.cell}>
                  <View style={[styles.day, selected ? styles.dayOn : null, !enabled ? styles.dayOff : null, pickingEnd && end === date ? styles.dayEnd : null]}>
                    <Text style={[styles.dayText, selected ? styles.dayTextOn : null]}>{Number(date.slice(8))}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.count}>{summary.label}</Text>
          <Text style={styles.summary}>{summaryLine(draft, confirmed, range)}</Text>
          {showEnd ? (
            <Pressable onPress={() => setPickingEnd(value => !value)} style={styles.endRow}>
              <Text style={styles.summary}>{pickingEnd ? 'Tap the last date to include' : `Through ${end ?? 'an end date you pick'}`}</Text>
            </Pressable>
          ) : null}
          {!range.deadline && isCustomized(draft, range) ? (
            <Text style={styles.note}>This custom schedule contains only dates from {range.start} through the end date you pick.</Text>
          ) : null}
          {pending ? <Text style={styles.note}>{REPLACE_CHANGES}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        {pending ? (
          <View style={styles.pending}>
            <Button title="Keep dates" onPress={() => setPending(null)} />
            <Button title="Replace" variant="primary" onPress={() => { setDraft(applyPending(draft, pending)); setPending(null); }} />
          </View>
        ) : null}
        <View style={styles.footer}>
          <Button title="Cancel" onPress={onCancel} />
          <Button title="Confirm" variant="primary" disabled={pending != null} onPress={confirm} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function summaryLine(draft: PickerDraft, result: { text: string } | { error: string }, range: ScheduleRange): string {
  if ('error' in result) return 'Custom schedule';
  const repeatLabel = unmodifiedRepeatLabel(draft, range);
  if (repeatLabel) return repeatLabel;
  return result.text ? compactScheduleLabel(result.text) : 'No schedule';
}

function monthOf(date: string): { year: number; month: number } {
  const [year, month] = date.split('-').map(Number);
  if (!year || !month) return { year: 2026, month: 1 };
  return { year, month };
}

function monthCells(year: number, month: number): Array<string | null> {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: first }, () => null);
  for (let day = 1; day <= count; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return cells;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 20, fontWeight: '800', paddingHorizontal: 16, paddingTop: 8 },
  scroll: { padding: 16, paddingBottom: 24 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  row: { flexDirection: 'row', gap: 8, paddingVertical: 12 },
  chip: { minHeight: 40, minWidth: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontWeight: '700' },
  chipTextOn: { color: '#04101F' },
  monthHeader: { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month: { color: colors.text, fontSize: 16, fontWeight: '800' },
  nav: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  navText: { color: colors.text, fontSize: 28, fontWeight: '700' },
  weekRow: { flexDirection: 'row' },
  head: { width: '14.285%', textAlign: 'center', color: colors.muted, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.285%', height: 44, alignItems: 'center', justifyContent: 'center' },
  day: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: colors.primary },
  dayOff: { opacity: 0.35 },
  dayEnd: { borderWidth: 1, borderColor: colors.warning },
  dayText: { color: colors.text, fontWeight: '700' },
  dayTextOn: { color: '#04101F' },
  count: { color: colors.text, marginTop: 12, fontWeight: '800' },
  summary: { color: colors.muted, marginTop: 4 },
  endRow: { marginTop: 8, minHeight: 44, justifyContent: 'center' },
  note: { color: colors.warning, marginTop: 8 },
  error: { color: colors.danger, marginTop: 8 },
  pending: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: colors.line },
});
