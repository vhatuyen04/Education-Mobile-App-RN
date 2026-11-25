import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { GenerationViolation, GenerationWindow } from './aiSuggestion.js';
import { readScheduleIntent } from './aiScheduleIntent.js';

const scheduleWords = new Set(['none', 'once', 'repeat', 'weekdays', 'daily', 'weekly', 'monthly', 'yearly', 'custom']);
const civil = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const field = (v: unknown) => v == null ? null : typeof v === 'string' && scheduleWords.has(v) ? v : 'invalid';
const integer = (v: unknown) => Number.isSafeInteger(v) ? v as number : null;

export function createPlannerTrace(emit: (event: object) => void) {
  const correlationId = randomUUID();
  const key = randomBytes(32);
  const fingerprint = (value: string) => createHmac('sha256', key).update(value).digest('hex').slice(0, 16);
  function schedule(value: any) {
    if (value == null) return null;
    const dates = Array.isArray(value.customDates) ? value.customDates.map(civil).sort() : null;
    return {
      type: field(typeof value === 'string' ? value : value.type), repeat: field(value.repeat),
      days: Array.isArray(value.days) ? value.days.slice(0, 14).map(integer).sort() : null,
      repeatDay: integer(value.repeatDay), repeatMonth: integer(value.repeatMonth), due: civil(value.due),
      customDates: dates && dates.slice(0, 32), dateCount: dates?.length ?? null,
      datesHash: dates && fingerprint(JSON.stringify(dates)),
    };
  }
  function snapshot(output: any) {
    return (Array.isArray(output?.suggestion?.steps) ? output.suggestion.steps.slice(0, 12) as any[] : []).map((step, index) => ({
      stepNumber: index + 1, titleId: fingerprint(typeof step?.text === 'string' ? step.text : ''),
      activityIndex: integer(step?.activityIndex), schedule: schedule(step?.schedule),
    }));
  }
  type Rows = ReturnType<typeof snapshot>;
  let failed: Rows[number] | undefined;
  return {
    correlationId, snapshot,
    record(attempt: 'initial' | 'repair', window: GenerationWindow, deadline: string | undefined, raw: Rows, normalized: Rows | null, failure?: GenerationViolation) {
      const scope = window.activitySchedules;
      const intents = scope?.kind === 'scoped' ? scope.activities.map(a => a.intent) : [readScheduleIntent(window.prompt ?? '')];
      const expected = intents.map((intent, i) => ({
        activityIndex: i + 1, kind: intent?.kind,
        ...(intent?.kind === 'weekdays' && { days: intent.days, count: intent.count }),
        ...(intent?.kind === 'native' && { schedule: schedule(intent.schedule) }),
        ...(intent?.kind === 'cadence' && { repeat: intent.repeat }),
        ...(intent?.kind === 'dates' && { schedule: schedule({ type: 'repeat', repeat: 'custom', customDates: intent.dates }) }),
      }));
      let changed: boolean | null = null;
      if (failed && attempt === 'repair') {
        let matches = raw.filter(row => row.titleId === failed!.titleId);
        if (!matches.length && failed.activityIndex != null) matches = raw.filter(row => row.activityIndex === failed!.activityIndex);
        if (matches.length === 1) changed = JSON.stringify(matches[0].schedule) !== JSON.stringify(failed.schedule);
      }
      emit({ correlationId, attempt, today: window.todayCivil, deadline, authoritative: !!window.requestedDeadline,
        stage: failure?.stage ?? failure?.code ?? 'accepted', code: failure?.code ?? null, rule: failure?.rule ?? failure?.code ?? null,
        fields: failure?.fields, stepNumber: failure?.stepNumber ?? null, expected, raw, normalized,
        repairChangedSubmittedSchedule: changed });
      if (failure?.stepNumber) failed = raw[failure.stepNumber - 1];
    },
  };
}
