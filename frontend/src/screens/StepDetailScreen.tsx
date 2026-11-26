import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { colors } from '../theme/colors';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import type { RootStackParamList } from '../navigation/types';
import { ScheduleField } from '../components/ScheduleField';
import { SchedulePickerModal } from '../components/SchedulePickerModal';
import { scheduleDraftError, scheduleToShortText, storedScheduleError, parseScheduleShortText, stepDateAfterGoalError, stepOutsideActiveRangeError } from '../utils/stepSchedule';
import { compactScheduleLabel, scheduleRange } from '../utils/schedulePicker';
import { DELETE_STEP_MESSAGE, formatStepDate, readDurationMinutes, replaceStepCopy, stepOverviewFacts } from '../utils/stepLifecycle';
import { classifyDate, monthDays, pageOccurrences, shiftMonth, type DatedOccurrence, type OccurrenceWindow, type ScheduleStep } from '../utils/stepOccurrences';
import { autoScheduleRemindersForSignedInUser } from '../notifications/scheduler';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'StepDetail'>;
const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const PREVIEW_COUNT = 5;
const PAGE_COUNT = 40;

export function StepDetailScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<R>();
  const { state } = useAuth();
  const goalId = route.params.goalId;
  const stepId = route.params.stepId;
  const [history, setHistory] = useState<authApi.StepHistory | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'replace' | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleText, setScheduleText] = useState('');
  const [durationText, setDurationText] = useState('');
  const [busy, setBusy] = useState(false);
  const [monthCursor, setMonthCursor] = useState<{ year: number; month: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const alignedStep = useRef('');

  const load = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;
    try {
      const next = await authApi.getStepHistory(token, { goalId, stepId });
      setHistory(next);
      setTitle(next.step.text);
      setDescription(next.step.description ?? '');
      setScheduleText(scheduleToShortText(next.step));
      setDurationText(next.step.durationMinutes ? String(next.step.durationMinutes) : '');
    } catch (error: any) {
      toast(String(error?.message ?? 'Failed to load'));
    }
  }, [goalId, state.accessToken, stepId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const step = history?.step;
  const archived = !!step?.archivedAt;
  const canChange = !!history?.goalEditable && !archived;

  async function toggleToday() {
    const token = state.accessToken;
    if (!token || !history?.scheduledToday || !canChange) return;
    setBusy(true);
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await authApi.toggleGoalStepCompletion(token, {
        goalId,
        stepId,
        dateIso: `${history.today}T00:00:00.000Z`,
        done: !history.doneToday,
        timeZone: zone,
      });
      await load();
      void autoScheduleRemindersForSignedInUser({ minIntervalMs: 0 });
    } catch (error: any) {
      toast(String(error?.message ?? 'Could not update today'));
    } finally {
      setBusy(false);
    }
  }

  async function commitDelete() {
    const token = state.accessToken;
    if (!token) return;
    setBusy(true);
    try {
      await authApi.deleteGoalStep(token, { goalId, stepId });
      setConfirm(null);
      toast('Step archived');
      await load();
      void autoScheduleRemindersForSignedInUser({ minIntervalMs: 0 });
    } catch (error: any) {
      toast(String(error?.message ?? 'Could not delete the step'));
    } finally {
      setBusy(false);
    }
  }

  function askReplace() {
    const parsedSchedule = parseScheduleShortText(scheduleText);
    const scheduleError = scheduleDraftError(scheduleText) ?? storedScheduleError(parsedSchedule) ?? stepDateAfterGoalError(parsedSchedule.dueAt, history?.effectiveEnd) ?? stepOutsideActiveRangeError(parsedSchedule, history?.effectiveEnd);
    if (!title.trim() || scheduleError) {
      toast(scheduleError || 'Title is required');
      return;
    }
    if (readDurationMinutes(durationText) === 'invalid') {
      toast('Duration must be a positive number of minutes');
      return;
    }
    setReplaceOpen(false);
    setConfirm('replace');
  }

  async function commitReplace() {
    const token = state.accessToken;
    if (!token || !step) return;
    const minutes = readDurationMinutes(durationText);
    if (minutes === 'invalid') return;
    const schedule = parseScheduleShortText(scheduleText);
    setBusy(true);
    try {
      const created = await authApi.replaceGoalStep(token, { goalId, stepId }, {
        text: title.trim(),
        description: description.trim() ? description.trim() : null,
        order: step.order,
        durationMinutes: minutes,
        dueAt: schedule.dueAt ?? null,
        repeat: schedule.repeat ?? null,
        repeatDay: schedule.repeatDay ?? null,
        repeatMonth: schedule.repeatMonth ?? null,
        repeatDays: schedule.repeatDays ?? [],
        customDates: schedule.customDates ?? null,
      });
      setConfirm(null);
      void autoScheduleRemindersForSignedInUser({ minIntervalMs: 0 });
      nav.replace('StepDetail', { goalId, stepId: created.step.id });
    } catch (error: any) {
      toast(String(error?.message ?? 'Could not replace the step'));
    } finally {
      setBusy(false);
    }
  }

  const today = history?.today ?? '';
  const bounds = useMemo(() => (history ? occurrenceWindow(history) : null), [history]);
  const historyPreview = useMemo(
    () => (bounds && step ? pageOccurrences({ step, window: bounds, direction: 'history', limit: PREVIEW_COUNT }) : { items: [], hasMore: false }),
    [bounds, step]
  );
  const upcomingPreview = useMemo(
    () => (bounds && step ? pageOccurrences({ step, window: bounds, direction: 'upcoming', limit: PREVIEW_COUNT }) : { items: [], hasMore: false }),
    [bounds, step]
  );
  const visibleDays = useMemo(
    () => (bounds && step && monthCursor ? monthDays(step, bounds, monthCursor.year, monthCursor.month) : []),
    [bounds, step, monthCursor]
  );
  const selectedStatus = bounds && step && selected ? classifyDate(step, bounds, selected) : null;
  const facts = step && history
    ? stepOverviewFacts({ step, effectiveStart: history.effectiveStart, effectiveEnd: history.effectiveEnd, today: history.today })
    : null;
  const factRows = facts ? [facts.schedule, facts.duration, facts.range].filter((row): row is NonNullable<typeof row> => !!row) : [];
  const todayStatus = bounds && step ? classifyDate(step, bounds, today) : null;
  const showToday = !!history && ((canChange && history.scheduledToday) || (!canChange && (todayStatus === 'DONE' || todayStatus === 'MISSED')));

  useEffect(() => {
    if (!history || alignedStep.current === stepId) return;
    alignedStep.current = stepId;
    const [year, month] = history.today.split('-').map(Number);
    setMonthCursor({ year, month });
    setSelected(history.today);
    setHistoryOpen(false);
    setUpcomingOpen(false);
  }, [history, stepId]);

  function moveMonth(delta: number) {
    setMonthCursor(current => (current ? shiftMonth(current.year, current.month, delta) : current));
  }

  function returnToToday() {
    if (!history) return;
    const [year, month] = history.today.split('-').map(Number);
    setMonthCursor({ year, month });
    setSelected(history.today);
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.hTitle}>Step</Text>
          <Pressable onPress={() => nav.goBack()} style={styles.iconBtn} hitSlop={8}>
            <Text style={styles.iconText}>←</Text>
          </Pressable>
        </View>

        <Card>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{step?.text ?? 'Step'}</Text>
            <View style={[styles.badge, archived ? styles.badgeMuted : styles.badgeActive]}>
              <Text style={[styles.badgeText, archived ? styles.badgeTextMuted : styles.badgeTextActive]}>{archived ? 'Archived' : 'Active'}</Text>
            </View>
          </View>
          {step?.description ? <Text style={styles.description}>{step.description}</Text> : null}
          {factRows.length ? (
            <View style={styles.facts}>
              {factRows.map(row => (
                <View key={row.label} style={styles.fact}>
                  <Text style={styles.factLabel}>{row.label}</Text>
                  <Text style={styles.factValue}>{row.value}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {step?.replacesStepId ? <Text style={styles.note}>Replaces an earlier step</Text> : null}

          {showToday ? (
            <View style={styles.todayBox}>
              <Text style={styles.kicker}>Today</Text>
              {canChange && history?.scheduledToday && history.doneToday ? (
                <Pressable onPress={() => void toggleToday()} disabled={busy} style={styles.doneRow}>
                  <View style={styles.doneMark}><Text style={styles.doneMarkText}>✓</Text></View>
                  <Text style={styles.doneLabel}>Done today</Text>
                </Pressable>
              ) : null}
              {canChange && history?.scheduledToday && !history.doneToday ? (
                <Button title="Mark as done" variant="primary" full disabled={busy} onPress={() => void toggleToday()} />
              ) : null}
              {!canChange && (todayStatus === 'DONE' || todayStatus === 'MISSED') ? (
                <Text style={todayStatus === 'DONE' ? styles.doneLabel : styles.missedLabel}>
                  {todayStatus === 'DONE' ? 'Done today' : 'Missed today'}
                </Text>
              ) : null}
            </View>
          ) : null}

          {canChange ? (
            <View style={styles.manage}>
              <Button title="Replace" onPress={() => setReplaceOpen(true)} />
              <Pressable onPress={() => setConfirm('delete')} hitSlop={8} style={styles.deleteBtn}>
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>
          ) : null}
        </Card>

        <Card>
          <View style={styles.monthHeader}>
            <Pressable onPress={() => moveMonth(-1)} hitSlop={8} style={styles.monthNav}><Text style={styles.monthNavText}>‹</Text></Pressable>
            <Text style={styles.monthTitle}>{monthCursor ? `${monthName(monthCursor.month)} ${monthCursor.year}` : 'Calendar'}</Text>
            <Pressable onPress={() => moveMonth(1)} hitSlop={8} style={styles.monthNav}><Text style={styles.monthNavText}>›</Text></Pressable>
          </View>
          {monthCursor && history && (monthCursor.year !== Number(history.today.slice(0, 4)) || monthCursor.month !== Number(history.today.slice(5, 7))) ? (
            <Pressable onPress={returnToToday} hitSlop={8}><Text style={styles.todayLink}>Jump back</Text></Pressable>
          ) : null}
          <View style={styles.weekRow}>
            {WEEK.map((label, index) => <Text key={`${label}-${index}`} style={styles.weekLabel}>{label}</Text>)}
          </View>
          <View style={styles.grid}>
            {monthCursor ? Array.from({ length: (new Date(Date.UTC(monthCursor.year, monthCursor.month - 1, 1)).getUTCDay() + 6) % 7 }, (_, index) => (
              <View key={`pad-${index}`} style={styles.cell} />
            )) : null}
            {visibleDays.map(day => {
              const status = day.status;
              const isSelected = day.date === selected;
              return (
                <Pressable key={day.date} style={styles.cell} onPress={() => setSelected(day.date)}>
                  <View style={[styles.day, isSelected ? styles.daySelected : null]}>
                    <Text style={[styles.dayText, day.date === today ? styles.dayTextToday : null]}>{Number(day.date.slice(8))}</Text>
                    {status ? <View style={[styles.dot, status === 'DONE' ? styles.dotDone : status === 'MISSED' ? styles.dotMissed : styles.dotFuture]} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
          {selected && monthCursor && selected.slice(0, 7) === `${monthCursor.year}-${String(monthCursor.month).padStart(2, '0')}` ? (
            <Text style={styles.detail}>{formatStepDate(selected, today)} · {detailLabel(selectedStatus)}</Text>
          ) : null}

          <Text style={[styles.section, styles.sectionGap]}>History</Text>
          {historyPreview.items.length === 0 ? <Text style={styles.empty}>No earlier days.</Text> : null}
          {historyPreview.items.map(row => (
            <OccurrenceLine key={row.date} row={row} today={today} />
          ))}
          {historyPreview.hasMore ? <Pressable onPress={() => setHistoryOpen(true)} hitSlop={8}><Text style={styles.moreLink}>View all history</Text></Pressable> : null}

          <Text style={[styles.section, styles.sectionGap]}>Upcoming</Text>
          {upcomingPreview.items.length === 0 ? <Text style={styles.empty}>No upcoming days.</Text> : null}
          {upcomingPreview.items.map(row => (
            <OccurrenceLine key={row.date} row={row} today={today} />
          ))}
          {upcomingPreview.hasMore ? <Pressable onPress={() => setUpcomingOpen(true)} hitSlop={8}><Text style={styles.moreLink}>View all upcoming</Text></Pressable> : null}
        </Card>
      </ScrollView>

      <Modal visible={replaceOpen && !scheduleOpen} transparent animationType="fade" onRequestClose={() => setReplaceOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.section}>New step</Text>
            <Text style={styles.note}>Saving archives the current step and starts a new one today. The old step keeps its DONE or MISSED result. These fields stay fixed after that.</Text>
            <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Title" placeholderTextColor={colors.muted} />
            <TextInput value={description} onChangeText={setDescription} style={styles.input} placeholder="Description" placeholderTextColor={colors.muted} />
            <ScheduleField value={scheduleText} onPress={() => setScheduleOpen(true)} />
            <TextInput value={durationText} onChangeText={setDurationText} style={styles.input} keyboardType="number-pad" placeholder="Minutes (optional)" placeholderTextColor={colors.muted} />
            <Text style={styles.note}>{title.trim() || 'Untitled'} · {description.trim() || 'No description'} · {compactScheduleLabel(scheduleText)} · {durationText.trim() ? `${durationText.trim()} min` : 'No duration'}</Text>
            <View style={styles.sheetActions}>
              <Button title="Cancel" onPress={() => setReplaceOpen(false)} />
              <Button title="Continue" variant="primary" onPress={askReplace} />
            </View>
          </View>
        </View>
      </Modal>
      <SchedulePickerModal
        visible={scheduleOpen}
        initialText={scheduleText}
        range={scheduleRange(history?.effectiveEnd)}
        onCancel={() => setScheduleOpen(false)}
        onConfirm={text => {
          setScheduleText(text);
          setScheduleOpen(false);
        }}
      />

      <Modal visible={confirm != null} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <View style={styles.dialogBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (!busy) setConfirm(null); }} />
          <View style={styles.dialog}>
            {confirm === 'delete' ? (
              <>
                <Text style={styles.dialogTitle}>Delete this step?</Text>
                <Text style={styles.dialogBody}>{DELETE_STEP_MESSAGE}</Text>
              </>
            ) : (
              <>
                <ReplaceNotice currentEnds={history?.archiveEffectiveUntil ?? 'today'} nextStarts={history?.replacementStartsOn ?? 'today'} />
                <Text style={styles.dialogBody}>{compactScheduleLabel(scheduleText)}</Text>
              </>
            )}
            <View style={styles.dialogDivider} />
            <View style={styles.dialogActions}>
              <Button title="Cancel" onPress={() => setConfirm(null)} />
              <Button title={confirm === 'delete' ? 'Delete' : 'Replace'} variant={confirm === 'delete' ? 'danger' : 'primary'} disabled={busy} onPress={() => void (confirm === 'delete' ? commitDelete() : commitReplace())} />
            </View>
          </View>
        </View>
      </Modal>
      {bounds && step ? (
        <>
          <OccurrenceBrowser visible={historyOpen} title="History" direction="history" step={step} bounds={bounds} today={today} onClose={() => setHistoryOpen(false)} />
          <OccurrenceBrowser visible={upcomingOpen} title="Upcoming" direction="upcoming" step={step} bounds={bounds} today={today} onClose={() => setUpcomingOpen(false)} />
        </>
      ) : null}
    </Screen>
  );
}

function occurrenceWindow(history: authApi.StepHistory): OccurrenceWindow {
  const done = new Set(history.completionDates ?? history.occurrences.filter(row => row.status === 'DONE').map(row => row.date));
  return {
    start: history.effectiveStart,
    end: history.effectiveEnd,
    today: history.today,
    archived: !!history.step.archivedAt,
    done,
  };
}

function detailLabel(status: DatedOccurrence['status'] | null): string {
  if (status === 'DONE') return 'Done';
  if (status === 'MISSED') return 'Missed';
  if (status === 'TODO') return 'Due today';
  if (status === 'FUTURE') return 'Scheduled';
  return 'Not scheduled';
}

function OccurrenceLine({ row, today }: { row: DatedOccurrence; today: string }) {
  const tone = row.status === 'DONE' ? styles.statusDone : row.status === 'MISSED' ? styles.statusMissed : styles.statusFuture;
  return (
    <View style={styles.line}>
      <Text style={styles.lineDate}>{formatStepDate(row.date, today)}</Text>
      <Text style={[styles.lineStatus, tone]}>{detailLabel(row.status)}</Text>
    </View>
  );
}

function OccurrenceBrowser({ visible, title, direction, step, bounds, today, onClose }: {
  visible: boolean;
  title: string;
  direction: 'history' | 'upcoming';
  step: ScheduleStep;
  bounds: OccurrenceWindow;
  today: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<DatedOccurrence[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const cursor = useRef<string | null>(null);
  const loading = useRef(false);

  useEffect(() => {
    if (!visible) return;
    const page = pageOccurrences({ step, window: bounds, direction, limit: PAGE_COUNT });
    cursor.current = page.items.at(-1)?.date ?? null;
    setItems(page.items);
    setHasMore(page.hasMore);
  }, [visible, step, bounds, direction]);

  function loadMore() {
    if (!visible || loading.current || !hasMore) return;
    loading.current = true;
    const page = pageOccurrences({ step, window: bounds, direction, limit: PAGE_COUNT, cursor: cursor.current });
    cursor.current = page.items.at(-1)?.date ?? cursor.current;
    setItems(current => [...current, ...page.items]);
    setHasMore(page.hasMore);
    loading.current = false;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.listBackdrop}>
        <View style={styles.listCard}>
          <View style={styles.listHead}>
            <Text style={styles.dialogTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}><Text style={styles.monthNavText}>✕</Text></Pressable>
          </View>
          <FlatList
            data={items}
            keyExtractor={item => item.date}
            renderItem={({ item }) => <OccurrenceLine row={item} today={today} />}
            style={styles.list}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            initialNumToRender={20}
            windowSize={5}
          />
        </View>
      </View>
    </Modal>
  );
}

function monthName(month: number): string {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month - 1] ?? '';
}

function ReplaceNotice({ currentEnds, nextStarts }: { currentEnds: string; nextStarts: string }) {
  const copy = replaceStepCopy(currentEnds, nextStarts);
  return (
    <>
      <Text style={styles.dialogTitle}>{copy.title}</Text>
      <Text style={styles.dialogBody}>{copy.lead}</Text>
      <Text style={styles.dialogBody}>{copy.records}</Text>
      <Text style={styles.dialogBody}>
        The current step will end on <Text style={styles.dialogEm}>{copy.currentEnds}</Text>, and the new step will start on <Text style={styles.dialogEm}>{copy.nextStarts}</Text>.
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hTitle: { color: colors.text, fontSize: 22, fontWeight: '900' },
  iconBtn: { width: 40, height: 40, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  iconText: { color: colors.text, fontSize: 16, fontWeight: '900' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { flex: 1, color: colors.text, fontSize: 24, lineHeight: 30, fontWeight: '800' },
  badge: { marginTop: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  badgeActive: { backgroundColor: 'rgba(110,231,183,0.12)', borderColor: 'rgba(110,231,183,0.45)' },
  badgeMuted: { backgroundColor: colors.surface2, borderColor: colors.line },
  badgeText: { fontSize: 11, fontWeight: '800' },
  badgeTextActive: { color: colors.success },
  badgeTextMuted: { color: colors.muted },
  description: { color: colors.muted, fontSize: 15, lineHeight: 21, marginTop: 8 },
  facts: { marginTop: 14, gap: 8 },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  factLabel: { width: 92, color: colors.muted, fontSize: 13, fontWeight: '700' },
  factValue: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 10 },
  todayBox: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.line, gap: 10 },
  kicker: { color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  doneMark: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(110,231,183,0.16)', alignItems: 'center', justifyContent: 'center' },
  doneMarkText: { color: colors.success, fontSize: 13, fontWeight: '900' },
  doneLabel: { flex: 1, color: colors.success, fontSize: 15, fontWeight: '800' },
  missedLabel: { color: colors.danger, fontSize: 15, fontWeight: '800' },
  manage: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  deleteBtn: { paddingHorizontal: 8, paddingVertical: 8 },
  deleteText: { color: colors.danger, fontSize: 13, fontWeight: '800' },
  section: { color: colors.text, fontSize: 16, fontWeight: '800' },
  sectionGap: { marginTop: 16 },
  empty: { color: colors.muted, fontSize: 13, marginTop: 8 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthNav: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  monthNavText: { color: colors.text, fontSize: 22, fontWeight: '700' },
  monthTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  todayLink: { color: colors.primary, fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  moreLink: { color: colors.primary, fontSize: 13, fontWeight: '700', marginTop: 8 },
  weekRow: { flexDirection: 'row', marginTop: 10 },
  weekLabel: { flex: 1, textAlign: 'center', color: colors.muted, fontSize: 11, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.285%', height: 40, alignItems: 'center', justifyContent: 'center' },
  day: { width: 32, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  daySelected: { borderWidth: 1, borderColor: colors.text },
  dayText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  dayTextToday: { color: colors.text },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  dotDone: { backgroundColor: colors.success },
  dotMissed: { backgroundColor: colors.danger },
  dotFuture: { backgroundColor: colors.primary },
  detail: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 8 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  lineDate: { color: colors.text, fontSize: 14, fontWeight: '700' },
  lineStatus: { fontSize: 12, fontWeight: '700' },
  statusDone: { color: colors.success },
  statusMissed: { color: colors.danger },
  statusFuture: { color: colors.primary },
  listBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 18 },
  listCard: { height: '72%', backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 16 },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  list: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16, gap: 8 },
  sheetActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10 },
  dialogBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 22 },
  dialog: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 10 },
  dialogTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  dialogBody: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  dialogEm: { color: colors.text, fontWeight: '800' },
  dialogDivider: { height: 1, backgroundColor: colors.line, marginTop: 4 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
});
