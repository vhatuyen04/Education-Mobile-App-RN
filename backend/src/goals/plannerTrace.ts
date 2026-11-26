import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { GenerationViolation, GenerationWindow } from './aiSuggestion.js';

const scheduleWords = new Set(['none', 'once', 'repeat', 'weekdays', 'monthDays', 'daily', 'weekly', 'monthly', 'yearly', 'custom']);
const weekdayNumber = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 } as const;
const civil = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const field = (v: unknown) => v == null ? null : typeof v === 'string' && scheduleWords.has(v) ? v : 'invalid';
const integer = (v: unknown) => Number.isSafeInteger(v) ? v as number : null;
const weekday = (v: unknown) => integer(v) ?? (typeof v === 'string' ? weekdayNumber[v.toLowerCase() as keyof typeof weekdayNumber] ?? null : null);

export function createPlannerTrace(emit: (event: object) => void) {
  const correlationId = randomUUID();
  const key = randomBytes(32);
  const fingerprint = (value: string) => createHmac('sha256', key).update(value).digest('hex').slice(0, 16);
  function schedule(value: any) {
    if (value == null) return null;
    const dates = Array.isArray(value.customDates) ? value.customDates.map(civil).sort() : null;
    return {
      type: field(typeof value === 'string' ? value : value.type), repeat: field(value.repeat),
      days: Array.isArray(value.days) ? value.days.slice(0, 31).map(weekday).sort() : null,
      repeatDay: weekday(value.repeatDay), repeatMonth: integer(value.repeatMonth),
      repeatDays: Array.isArray(value.repeatDays) ? value.repeatDays.slice(0, 31).map(integer) : null,
      due: civil(value.due),
      customDates: dates && dates.slice(0, 32), dateCount: dates?.length ?? null,
      datesHash: dates && fingerprint(JSON.stringify(dates)),
    };
  }
  function snapshot(output: any) {
    return (Array.isArray(output?.suggestion?.steps) ? output.suggestion.steps.slice(0, 12) as any[] : []).map((step, index) => ({
      stepNumber: index + 1, titleId: fingerprint(typeof step?.text === 'string' ? step.text : ''),
      actionIds: Array.isArray(step?.actionIds) ? step.actionIds.map(integer) : [], schedule: schedule(step?.schedule),
    }));
  }
  type Rows = ReturnType<typeof snapshot>;
  let failed: Rows[number] | undefined;
  return {
    correlationId, snapshot,
    record(attempt: 'initial' | 'repair', window: GenerationWindow, deadline: string | undefined, raw: Rows, normalized: Rows | null, failure?: GenerationViolation) {
      let changed: boolean | null = null;
      if (failed && attempt === 'repair') {
        let matches = raw.filter(row => row.titleId === failed!.titleId);
        if (matches.length === 1) changed = JSON.stringify(matches[0].schedule) !== JSON.stringify(failed.schedule);
      }
      emit({ correlationId, attempt, today: window.todayCivil, deadline, authoritative: !!window.requestedDeadline,
        stage: failure?.stage ?? failure?.code ?? 'accepted', code: failure?.code ?? null, rule: failure?.rule ?? failure?.code ?? null,
        fields: failure?.fields, stepNumber: failure?.stepNumber ?? null, raw, normalized,
        repairChangedSubmittedSchedule: changed });
      if (failure?.stepNumber) failed = raw[failure.stepNumber - 1];
    },
  };
}
