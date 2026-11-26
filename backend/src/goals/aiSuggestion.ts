/**
 * Validates AI goal suggestions before they are shown or saved.
 *
 * Schedule checks run on the model's original value. A supported value may
 * then be normalized. An unrecognized recurrence is rejected here and is not
 * rewritten to daily. A missing repeat on type "repeat" stays the existing
 * contract: it means daily. A present but unusable weekday, month, day, or
 * one-time date is an error, not a field to drop.
 */

import { z } from 'zod';

import { CUSTOM_DATES_LIMIT, utcCivilDate, isCalendarMonthDay, isRealCivilDate, prepareCustomDates, scheduleWriteError, stepOutsideActiveRangeError } from './recurrenceSchedule.js';

const SUPPORTED_REPEATS = ['daily', 'weekly', 'monthly', 'yearly'] as const;

export const scheduleExamples = (civilDate: string) => [
  { type: 'none' },
  { type: 'once', due: civilDate },
  { type: 'repeat', repeat: SUPPORTED_REPEATS[0] },
  { type: 'weekdays', days: ['monday', 'wednesday', 'friday'] },
  { type: 'repeat', repeat: SUPPORTED_REPEATS[1], repeatDay: 'monday' },
  { type: 'repeat', repeat: SUPPORTED_REPEATS[2], repeatDay: 15 },
  { type: 'repeat', repeat: SUPPORTED_REPEATS[3], repeatMonth: 6, repeatDay: 15 },
  { type: 'repeat', repeat: 'custom', customDates: [civilDate] },
];

export type GeneratedStepSchedule =
  | { type: 'none' }
  | { type: 'once'; due: string }
  | { type: 'repeat'; repeat: 'custom'; customDates: string[]; repeatDay?: never; repeatMonth?: never }
  | { type: 'repeat'; repeat: (typeof SUPPORTED_REPEATS)[number]; repeatDay?: number; repeatMonth?: number };

export type GeneratedSuggestion =
  | { ok: false; message: string; questions: string[] }
  | {
      ok: true;
      suggestion: {
        title: string;
        description?: string;
        field: 'Sport' | 'Academy' | 'Entertainment';
        deadline: string;
        expectation?: string;
        requirement?: string;
        difficultyScore: number;
        difficultyConfidence: number;
        difficultyReason: string;
        rankingEligible: boolean;
        rankingEligibilityReason: string;
        steps: Array<{ text: string; description?: string; durationMinutes?: number; schedule: GeneratedStepSchedule }>;
      };
    };

const GeneratedSuggestionSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(false),
    message: z.string().min(1),
    questions: z.array(z.string().min(1)).min(1).max(3),
  }),
  z.object({
    ok: z.literal(true),
    suggestion: z.object({
      title: z.string().trim().min(1),
      description: z.string().min(1).optional(),
      field: z.enum(['Sport', 'Academy', 'Entertainment']),
      deadline: z.string().min(1),
      expectation: z.string().optional(),
      requirement: z.string().optional(),
      difficultyScore: z.number().int().min(1).max(100),
      difficultyConfidence: z.number().min(0).max(1),
      difficultyReason: z.string().min(1),
      rankingEligible: z.boolean(),
      rankingEligibilityReason: z.string().min(1).max(300),
      steps: z
        .array(
          z.object({
            text: z.string().trim().min(1),
            description: z.string().optional(),
            durationMinutes: z.number().int().positive().optional(),
            schedule: z.union([
              z.object({ type: z.literal('none') }),
              z.object({
                type: z.literal('once'),
                due: z.string().refine(isRealCivilDate, 'Pick a real calendar date, such as 2028-02-29.'),
              }),
              z.object({
                type: z.literal('repeat'),
                repeat: z.literal('custom'),
                customDates: z.array(z.string()).min(1).max(CUSTOM_DATES_LIMIT),
              }),
              z.object({
                type: z.literal('repeat'),
                repeat: z.enum(SUPPORTED_REPEATS),
                repeatDay: z.number().int().optional(),
                repeatMonth: z.number().int().optional(),
              }),
            ]),
          })
        )
        .min(0)
        .max(12),
    }),
  }),
]);

export type GenerationWindow = { todayCivil: string; requestedDeadline?: string; deadlineConfirmed?: boolean };

export type GenerationViolation = {
  stage?: string;
  rule?: string;
  ok: false;
  code: 'json' | 'shape' | 'deadline' | 'schedule' | 'activity_mapping' | 'activity_coverage';
  fields?: string[];
  error: string;
  detail?: string;
  stepNumber?: number;
};

export function parseGeneratedSuggestion(
  value: unknown,
  window?: GenerationWindow
): { ok: true; value: GeneratedSuggestion } | GenerationViolation {
  const normalized = normalizeGeneratedSuggestion(value, window);
  if (!normalized.ok) return { ...normalized, code: 'schedule', stage: 'normalization' };
  const parsed = GeneratedSuggestionSchema.safeParse(normalized.value);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'shape',
      error: 'AI output did not match expected format',
      fields: parsed.error.issues.map(issue => issue.path.join('.') || '(root)'),
      detail: formatSuggestionSchemaIssues(parsed.error).join('; '),
    };
  }
  if (window && parsed.data.ok) {
    const { deadline, steps } = parsed.data.suggestion;
    if (!isRealCivilDate(deadline) || deadline < window.todayCivil) {
      return { ok: false, code: 'deadline', error: `Goal deadline must be a calendar date on or after ${window.todayCivil}.` };
    }
    for (const [index, { text, schedule }] of steps.entries()) {
      if (schedule.type === 'once' && (schedule.due < window.todayCivil || schedule.due > deadline)) {
        return { ok: false, code: 'schedule', stage: 'window', rule: 'once_within_window', stepNumber: index + 1, error: `Step "${text}" must be scheduled from ${window.todayCivil} through ${deadline}.` };
      }
      if (schedule.type === 'repeat') {
        const stored = schedule.repeat === 'custom' ? { repeat: 'custom', customDates: schedule.customDates } : schedule;
        const writeError = scheduleWriteError(stored);
        const error = writeError ?? stepOutsideActiveRangeError({
          step: stored, todayCivil: window.todayCivil, goalDueAt: `${deadline}T00:00:00.000Z`,
        });
        if (error) return { ok: false, code: 'schedule', stage: writeError ? 'structure' : 'window', rule: writeError ? 'writable_recurrence' : 'recurrence_within_window', stepNumber: index + 1, error: `Step "${text}": ${error}` };
      }
    }
  }
  return { ok: true, value: parsed.data };
}

export function readGeneratedStepSchedule(
  schedule: unknown
): { ok: true; schedule: GeneratedStepSchedule | null } | { ok: false; error: string } {
  if (schedule == null) return { ok: true, schedule: null };
  if (typeof schedule === 'string') return readScheduleText(schedule);
  if (typeof schedule !== 'object' || Array.isArray(schedule)) {
    return { ok: false, error: 'Each step needs a schedule object.' };
  }
  return readScheduleObject(schedule as Record<string, unknown>);
}

function normalizeGeneratedSuggestion(value: unknown, window?: GenerationWindow): { ok: true; value: unknown } | { ok: false; error: string; rule: string; stepNumber: number } {
  if (!value || typeof value !== 'object') return { ok: true, value };
  const root = value as Record<string, any>;
  if (root.ok !== true || !root.suggestion || typeof root.suggestion !== 'object') return { ok: true, value };
  const suggestion = root.suggestion as Record<string, any>;
  if (window?.requestedDeadline !== undefined) suggestion.deadline = window.requestedDeadline;
  const score = Number(suggestion.difficultyScore);
  if (Number.isFinite(score)) suggestion.difficultyScore = Math.max(1, Math.min(100, Math.round(score)));
  const confidence = clampUnit(suggestion.difficultyConfidence);
  if (suggestion.difficultyConfidence !== undefined && suggestion.difficultyConfidence !== null && confidence !== undefined) {
    suggestion.difficultyConfidence = confidence;
  }
  if (typeof suggestion.rankingEligible === 'string') suggestion.rankingEligible = suggestion.rankingEligible.trim().toLowerCase() === 'true';
  if (typeof suggestion.rankingEligibilityReason === 'string') {
    suggestion.rankingEligibilityReason = suggestion.rankingEligibilityReason.trim().slice(0, 300);
  }
  if (typeof suggestion.field === 'string') {
    const field = suggestion.field.trim().toLowerCase();
    if (field.startsWith('sport')) suggestion.field = 'Sport';
    else if (field.startsWith('acad') || field.startsWith('study') || field.startsWith('edu')) suggestion.field = 'Academy';
    else if (field.startsWith('entertain')) suggestion.field = 'Entertainment';
  }
  if (typeof suggestion.description === 'string' && !suggestion.description.trim()) delete suggestion.description;
  if (Array.isArray(suggestion.steps)) {
    const steps = suggestion.steps;
    const normalizedSteps = [];
    for (const [index, step] of steps.entries()) {
      const text = typeof step?.text === 'string' ? step.text.trim() : '';
      if (!text) {
        normalizedSteps.push(step);
        continue;
      }
      if (window && step.schedule && typeof step.schedule === 'object') {
        const { due, days, repeatDay, repeatMonth, customDates } = step.schedule;
        const type = String(step.schedule.type ?? '').trim().toLowerCase();
        const repeat = String(step.schedule.repeat ?? '').trim().toLowerCase();
        if (type === 'repeat' && !repeat) {
          return { ok: false, stepNumber: index + 1, rule: 'repeat_required', error: `Step "${text}": specify the requested recurrence for type "repeat".` };
        }
        const cadence = type === 'repeat' ? repeat : type;
        if ((due != null && type !== 'once') || (days != null && type !== 'weekdays') ||
          (repeat && type !== 'repeat' && repeat !== type) || (customDates != null && cadence !== 'custom') ||
          (repeatMonth != null && cadence !== 'yearly') ||
          (repeatDay != null && !['weekly', 'monthly', 'yearly'].includes(cadence))) {
          return { ok: false, stepNumber: index + 1, rule: 'inactive_schedule_fields_null', error: `Step "${text}" mixes schedule rules. Return only the fields in the chosen schedule branch.` };
        }
      }
      const schedule = step?.schedule?.type === 'weekdays' && window && isRealCivilDate(suggestion.deadline)
        ? readGeneratedWeekdays(step.schedule.days, window.todayCivil, suggestion.deadline)
        : readGeneratedStepSchedule(step?.schedule);
      if (!schedule.ok) return { ok: false, stepNumber: index + 1, rule: 'valid_schedule_values', error: `Step "${text}": ${schedule.error}` };
      if (!schedule.schedule) {
        normalizedSteps.push(step);
        continue;
      }
      const description = String(step?.description ?? '').trim();
      normalizedSteps.push({ text, ...(description ? { description } : {}), durationMinutes: step.durationMinutes ?? undefined, schedule: schedule.schedule });
    }
    suggestion.steps = normalizedSteps;
  }
  return { ok: true, value: root };
}

function readScheduleText(schedule: string): { ok: true; schedule: GeneratedStepSchedule } | { ok: false; error: string } {
  const text = schedule.trim().toLowerCase();
  const once = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (once) {
    if (!isRealCivilDate(once[1])) return { ok: false, error: onceDateError(once[1]) };
    return { ok: true, schedule: { type: 'once', due: once[1] } };
  }
  if (text === 'none') return { ok: true, schedule: { type: 'none' } };
  if (text === 'daily' || text === 'day') return { ok: true, schedule: { type: 'repeat', repeat: 'daily' } };
  if (text === 'weekly' || text === 'week') return { ok: true, schedule: { type: 'repeat', repeat: 'weekly' } };
  if (text === 'monthly' || text === 'month') return { ok: true, schedule: { type: 'repeat', repeat: 'monthly' } };
  if (text === 'yearly' || text === 'year') return { ok: true, schedule: { type: 'repeat', repeat: 'yearly' } };
  if (!text) return { ok: false, error: 'Each step needs a schedule object.' };
  return { ok: false, error: unsupportedRepeatError(schedule.trim()) };
}

function readScheduleObject(row: Record<string, unknown>): { ok: true; schedule: GeneratedStepSchedule } | { ok: false; error: string } {
  const type = String(row.type ?? '').trim().toLowerCase();
  if (type === 'none') return { ok: true, schedule: { type: 'none' } };
  if (type === 'once') return readOnce(row.due);
  if (type === 'repeat' && String(row.repeat ?? '').trim().toLowerCase() === 'custom') return readGeneratedCustomDates(row.customDates);
  const alias = SUPPORTED_REPEATS.find(repeat => repeat === type) ?? null;
  if (type === 'repeat' || alias) return readRepeat(row, alias);
  if (!type) return { ok: false, error: 'Each step schedule needs a type of none, once, or repeat.' };
  return { ok: false, error: `Unsupported schedule type "${type}". Use none, once, or repeat.` };
}

function readGeneratedCustomDates(dates: unknown): { ok: true; schedule: GeneratedStepSchedule } | { ok: false; error: string } {
  const prepared = prepareCustomDates(dates);
  if (!prepared.ok) return prepared;
  if (!prepared.dates.length) return { ok: false, error: 'Custom Dates must include at least one date.' };
  return { ok: true, schedule: { type: 'repeat', repeat: 'custom', customDates: prepared.dates } };
}

export function weekdayDates(days: number[], today: string, deadline: string): string[] {
  if (!days.length) return [];
  const selected = new Set(days);
  const dates: string[] = [];
  const start = new Date(`${today}T00:00:00.000Z`);
  const end = new Date(`${deadline}T00:00:00.000Z`);
  for (const day = new Date(start); day <= end && dates.length <= CUSTOM_DATES_LIMIT; day.setUTCDate(day.getUTCDate() + 1)) {
    if (selected.has(day.getUTCDay())) dates.push(utcCivilDate(day));
  }
  return dates;
}

function readGeneratedWeekdays(days: unknown, today: string, deadline: string): ReturnType<typeof readGeneratedCustomDates> {
  if (!Array.isArray(days) || !days.length || new Set(days).size !== days.length ||
    !days.every(day => Number.isInteger(day) && day >= 0 && day <= 6)) {
    return { ok: false, error: 'Select distinct weekdays numbered 0 through 6.' };
  }
  if (days.length === 1) return { ok: true, schedule: { type: 'repeat', repeat: 'weekly', repeatDay: days[0] } };
  if (days.length === 7) return { ok: true, schedule: { type: 'repeat', repeat: 'daily' } };
  const dates = weekdayDates(days, today, deadline);
  if (!dates.length) return { ok: false, error: 'The selected weekdays have no dates inside the goal window.' };
  return readGeneratedCustomDates(dates);
}

function readOnce(due: unknown): { ok: true; schedule: GeneratedStepSchedule } | { ok: false; error: string } {
  const text = String(due ?? '').trim();
  if (!text) return { ok: false, error: onceDateError(text) };
  const day = text.slice(0, 10);
  if (!isRealCivilDate(day)) return { ok: false, error: onceDateError(text) };
  return { ok: true, schedule: { type: 'once', due: day } };
}

function readRepeat(
  row: Record<string, unknown>,
  alias: (typeof SUPPORTED_REPEATS)[number] | null
): { ok: true; schedule: GeneratedStepSchedule } | { ok: false; error: string } {
  if (alias) {
    const nested = explicitUnsupportedRepeat(row.repeat);
    if (nested) return { ok: false, error: unsupportedRepeatError(nested) };
  }
  const repeat = alias ?? repeatFromField(row.repeat);
  if (typeof repeat !== 'string') return repeat;
  const day = readWholeNumber(row, 'repeatDay');
  const month = readWholeNumber(row, 'repeatMonth');
  if (!day.ok) return { ok: false, error: 'repeatDay must be a whole number.' };
  if (!month.ok) return { ok: false, error: 'repeatMonth must be a whole number.' };
  if (repeat === 'weekly' && day.present && (day.value < 0 || day.value > 6)) {
    return { ok: false, error: 'Pick a weekday from Sunday through Saturday, numbered 0 through 6.' };
  }
  if (repeat === 'monthly' && day.present && (day.value < 1 || day.value > 31)) {
    return { ok: false, error: 'Pick a day from 1 through 31.' };
  }
  if (repeat === 'yearly' && (day.present || month.present)) {
    if (!day.present || !month.present || !isCalendarMonthDay(month.value, day.value)) {
      return { ok: false, error: 'Pick a real month and day, such as 02-29.' };
    }
  }
  return {
    ok: true,
    schedule: {
      type: 'repeat',
      repeat,
      ...(day.present ? { repeatDay: day.value } : {}),
      ...(month.present ? { repeatMonth: month.value } : {}),
    },
  };
}

function explicitUnsupportedRepeat(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const named = String(value).trim().toLowerCase();
  if ((SUPPORTED_REPEATS as readonly string[]).includes(named)) return null;
  return String(value).trim();
}

function repeatFromField(value: unknown): (typeof SUPPORTED_REPEATS)[number] | { ok: false; error: string } {
  if (value == null) return 'daily';
  if (typeof value === 'string' && value.trim() === '') return 'daily';
  const named = String(value).trim().toLowerCase();
  if ((SUPPORTED_REPEATS as readonly string[]).includes(named)) return named as (typeof SUPPORTED_REPEATS)[number];
  return { ok: false, error: unsupportedRepeatError(String(value).trim()) };
}

function readWholeNumber(
  row: Record<string, unknown>,
  key: 'repeatDay' | 'repeatMonth'
): { ok: true; present: false } | { ok: true; present: true; value: number } | { ok: false } {
  if (!Object.prototype.hasOwnProperty.call(row, key)) return { ok: true, present: false };
  const value = row[key];
  if (value == null) return { ok: true, present: false };
  if (typeof value === 'string' && value.trim() === '') return { ok: true, present: false };
  if (typeof value === 'number' && Number.isInteger(value)) return { ok: true, present: true, value };
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return { ok: true, present: true, value: Number(value.trim()) };
  return { ok: false };
}

function unsupportedRepeatError(value: string): string {
  return `Unsupported recurrence "${value}". Use daily, weekly, monthly, yearly, or custom under type "repeat". For multiple weekdays, use type "weekdays" with a "days" array.`;
}

function onceDateError(value: string): string {
  const shown = value ? `"${value}" is not a real calendar date. ` : '';
  return `${shown}Pick a real calendar date, such as 2028-02-29.`;
}

function clampUnit(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const unit = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, unit));
}

function formatSuggestionSchemaIssues(error: z.ZodError): string[] {
  const lines: string[] = [];
  for (const issue of error.issues) {
    const nested = (issue as { unionErrors?: z.ZodError[] }).unionErrors;
    if (nested) {
      for (const unionError of nested) {
        for (const inner of unionError.issues) {
          lines.push(`${inner.path.join('.') || '(root)'}: ${inner.message}`);
        }
      }
      continue;
    }
    lines.push(`${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  return lines.slice(0, 12);
}
