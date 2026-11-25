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

import { CUSTOM_DATES_LIMIT, isCalendarMonthDay, isRealCivilDate, prepareCustomDates, scheduleWriteError, stepOutsideActiveRangeError } from './recurrenceSchedule.js';
import { duplicateActionError, durationClaims, generatedHorizonError, hasActionableGoalWording, readScheduleIntent, scheduleIntentError, stepFrequencyClaim, weekdayDates } from './aiScheduleIntent.js';
import { activityMetadataWarnings, activityScheduleError, ambiguousActivityMessage, readActivitySchedules, type ActivitySchedules } from './aiActivitySchedules.js';

const SUPPORTED_REPEATS = ['daily', 'weekly', 'monthly', 'yearly'] as const;

export const GENERATED_SCHEDULE_CONTRACT = [
  { type: 'none' },
  { type: 'once', due: 'YYYY-MM-DD' },
  { type: 'repeat', repeat: SUPPORTED_REPEATS[0] },
  { type: 'repeat', repeat: SUPPORTED_REPEATS[1], repeatDay: 1 },
  { type: 'repeat', repeat: SUPPORTED_REPEATS[2], repeatDay: 15 },
  { type: 'repeat', repeat: SUPPORTED_REPEATS[3], repeatMonth: 6, repeatDay: 15 },
  { type: 'weekdays', days: [1, 3, 5] },
  { type: 'repeat', repeat: 'custom', customDates: ['YYYY-MM-DD'] },
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
        steps: Array<{ text: string; description?: string; schedule: GeneratedStepSchedule }>;
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
            activityIndex: z.number().int().positive().nullable().optional(),
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

export type GenerationWindow = { todayCivil: string; requestedDeadline?: string; prompt?: string; activitySchedules?: ActivitySchedules };

export type GenerationViolation = {
  stage?: string;
  rule?: string;
  ok: false;
  code: 'json' | 'shape' | 'deadline' | 'schedule' | 'primary_action' | 'clarification' | 'activity_mapping';
  fields?: string[];
  error: string;
  detail?: string;
  activity?: string;
  stepNumber?: number;
};

export function parseGeneratedSuggestion(
  value: unknown,
  window?: GenerationWindow
): { ok: true; value: GeneratedSuggestion; warnings: string[]; wordingWarning?: GenerationViolation } | GenerationViolation {
  const activitySchedules = window?.activitySchedules ?? (window?.prompt === undefined ? null : readActivitySchedules(window.prompt));
  if (activitySchedules?.kind === 'ambiguous') return { ok: false, code: 'activity_mapping', error: ambiguousActivityMessage };
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
  const warnings: string[] = [];
  let wordingWarning: GenerationViolation | undefined;
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
    if (window.prompt !== undefined || activitySchedules?.kind === 'scoped') {
      const violation = activityScheduleError(activitySchedules, window.prompt ?? '', steps, window.todayCivil, deadline, normalized.stepWeekdays ?? []);
      if (violation) return { ok: false, stage: violation.code === 'schedule' ? 'schedule_intent' : violation.code, ...violation };
    }
    for (const [i, step] of steps.entries()) {
      for (const field of ['text', 'description'] as const) {
        const wording = step[field] ?? '';
        for (const clause of wording.split(/[.!?;]\s*|\n/)) {
          const claim = stepFrequencyClaim(clause, activitySchedules?.kind === 'single' && activitySchedules.planningDeliverable);
          if (!claim) continue;
          const mismatch = scheduleIntentError(claim, step.schedule, window.todayCivil, deadline, normalized.stepWeekdays?.[i]);
          if (!mismatch) continue;
          const issue: GenerationViolation = { ok: false, code: 'schedule', stage: 'step_wording',
            rule: claim.kind === 'invalid' ? `wording_${claim.reason}` : mismatch.rule, stepNumber: i + 1,
            fields: [`suggestion.steps.${i}.${field}`],
            detail: JSON.stringify({ field, clause, interpretedClaim: claim, submittedSchedule: step.schedule }),
            error: `Step ${i + 1}: ${mismatch.error} Rewrite the indicated wording to describe the scheduled action accurately. Preserve the user's explicit schedule.` };
          if (activitySchedules?.kind !== 'single' || activitySchedules.activity) return issue;
          wordingWarning ??= issue;
          warnings.push(issue.error);
        }
      }
    }
    if (window.requestedDeadline) {
      const originalEnds = new Set(durationClaims(window.prompt ?? '', window.todayCivil).map(claim => claim.end));
      const { title, description, expectation, requirement } = parsed.data.suggestion;
      const fields: { text?: string; stepNumber?: number }[] = [title, description, expectation, requirement].map(text => ({ text }));
      fields.push(...steps.flatMap((step, i) => [step.text, step.description].map(text => ({ text, stepNumber: i + 1 }))));
      for (const { text, stepNumber } of fields) {
        const error = text && generatedHorizonError(text, window.todayCivil, deadline, !!stepNumber, originalEnds);
        if (error) return { ok: false, code: 'deadline', stage: 'generated_wording', rule: 'consistent_goal_horizon', stepNumber, error };
      }
    }
    if (activitySchedules?.kind === 'scoped') warnings.push(...activityMetadataWarnings(activitySchedules.activities, parsed.data.suggestion));
    const duplicate = duplicateActionError(steps);
    if (duplicate) warnings.push(duplicate);
  } else if (window?.prompt && (readScheduleIntent(window.prompt) || hasActionableGoalWording(window.prompt) ||
    (activitySchedules?.kind === 'single' && activitySchedules.actionable))) {
    return { ok: false, code: 'clarification', error: 'The request has an actionable goal. Return a draft instead of clarification questions.' };
  }
  if (!parsed.data.ok) return { ok: true, value: parsed.data, warnings };
  const { suggestion } = parsed.data;
  return { ok: true, warnings, ...(wordingWarning && { wordingWarning }), value: { ok: true, suggestion: {
    ...suggestion, steps: suggestion.steps.map(({ activityIndex: _modelOnly, ...step }) => step),
  } } };
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

function normalizeGeneratedSuggestion(value: unknown, window?: GenerationWindow): { ok: true; value: unknown; stepWeekdays?: (number[] | undefined)[] } | { ok: false; error: string; rule: string; stepNumber: number } {
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
  const stepWeekdays: (number[] | undefined)[] = [];
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
      if (step?.schedule?.type === 'weekdays') stepWeekdays[index] = step.schedule.days;
      const description = String(step?.description ?? '').trim();
      normalizedSteps.push({ text, ...(description ? { description } : {}), activityIndex: step.activityIndex, schedule: schedule.schedule });
    }
    suggestion.steps = normalizedSteps;
  }
  return { ok: true, value: root, stepWeekdays };
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
