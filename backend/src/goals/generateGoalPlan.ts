import { z } from 'zod/v4';
import { parseGeneratedSuggestion, type GeneratedSuggestion, type GenerationViolation, type GenerationWindow } from './aiSuggestion.js';
import { actionSchema, goalModelResponse, goalModelSchedule, horizonSchema } from './goalModelContract.js';
import { isRealCivilDate } from './recurrenceSchedule.js';
import type { createPlannerTrace } from './plannerTrace.js';

type Message = { role: 'system' | 'user'; content: string };
type Suggestion = Extract<GeneratedSuggestion, { ok: true }>['suggestion'];
type Clarification = Extract<GeneratedSuggestion, { ok: false }>;
type DeadlineConflict = { ok: false; message: string; questions: string[]; planDeadline: string };
type ModelSchedule = z.infer<typeof goalModelSchedule>;
type Schedule =
  | { type: 'none' }
  | { type: 'once'; due: string }
  | { type: 'repeat'; repeat: 'daily' }
  | { type: 'repeat'; repeat: 'weekly'; repeatDay: number }
  | { type: 'repeat'; repeat: 'monthly'; repeatDay: number }
  | { type: 'repeat'; repeat: 'yearly'; repeatMonth: number; repeatDay: number }
  | { type: 'weekdays'; days: number[] }
  | { type: 'repeat'; repeat: 'custom'; customDates: string[] };
type Action = z.infer<typeof actionSchema>;
type Constraint = Schedule | { type: 'nonrecurring' } | null;
const WEEKDAY_NUMBER = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 } as const;

function numericSchedule(schedule: ModelSchedule): Schedule {
  if (schedule.type === 'weekdays') return { type: 'weekdays', days: schedule.days.map(day => WEEKDAY_NUMBER[day]) };
  if (schedule.type === 'repeat' && schedule.repeat === 'weekly') return { type: 'repeat', repeat: 'weekly', repeatDay: WEEKDAY_NUMBER[schedule.repeatDay] };
  return schedule;
}

function storedConstraint(schedule: Action['explicitSchedule']): Constraint {
  if (!schedule || schedule.type === 'nonrecurring') return schedule;
  return numericSchedule(schedule);
}
type RepairEvent = { status: 'attempted' | 'rejected' | 'succeeded' | 'request_failed'; code?: GenerationViolation['code']; fields?: string[]; stepNumber?: number };

function acceptedDeadline(value: string): string | null {
  return isRealCivilDate(value) ? value : null;
}

function scheduleKey(schedule: Schedule): string {
  if (schedule.type === 'weekdays') {
    if (schedule.days.length === 1) return scheduleKey({ type: 'repeat', repeat: 'weekly', repeatDay: schedule.days[0] });
    if (new Set(schedule.days).size === 7 && schedule.days.length === 7) return scheduleKey({ type: 'repeat', repeat: 'daily' });
    return 'weekdays:' + [...schedule.days].sort().join(',');
  }
  if (schedule.type === 'repeat' && schedule.repeat === 'custom') return 'dates:' + [...schedule.customDates].sort().join(',');
  return JSON.stringify(schedule);
}

function constraintKind(schedule: Constraint): string {
  if (!schedule) return 'open';
  if (schedule.type === 'nonrecurring') return 'nonrecurring';
  return scheduleKey(schedule);
}

function concreteSchedule(constraints: Constraint[]): Schedule | null {
  for (const schedule of constraints) {
    if (schedule && schedule.type !== 'nonrecurring') return schedule;
  }
  return null;
}

// A stated action schedule is the hard constraint. Open timing keeps the model's choice.
function scheduleFor(constraints: Constraint[], proposed: Schedule): Schedule {
  const required = concreteSchedule(constraints);
  if (required) return required;
  if (constraints.some(schedule => schedule?.type === 'nonrecurring') && proposed.type !== 'none' && proposed.type !== 'once') {
    return { type: 'none' };
  }
  return proposed;
}

function openSchedule(proposed: Schedule, others: Constraint[]): Schedule {
  const copiesAnotherAction = others.some(schedule => schedule && schedule.type !== 'nonrecurring' && scheduleKey(schedule) === scheduleKey(proposed));
  return copiesAnotherAction ? { type: 'none' } : proposed;
}

type DraftStep = {
  text: string;
  description: string;
  durationMinutes: number | null;
  actionIds: number[];
  proposed: Schedule;
  constraints: Constraint[];
};

function weekdayMembership(schedule: Schedule): number[] | null {
  if (schedule.type === 'weekdays') return schedule.days;
  if (schedule.type === 'repeat' && schedule.repeat === 'weekly') return [schedule.repeatDay];
  if (schedule.type === 'repeat' && schedule.repeat === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  return null;
}

function scheduleFromWeekdays(days: number[]): Schedule {
  const unique = [...new Set(days)].sort((a, b) => a - b);
  if (unique.length === 7) return { type: 'repeat', repeat: 'daily' };
  if (unique.length === 1) return { type: 'repeat', repeat: 'weekly', repeatDay: unique[0] };
  return { type: 'weekdays', days: unique };
}

function sameActivityKey(item: DraftStep): string {
  return JSON.stringify({
    text: item.text.trim(),
    description: item.description.trim(),
    duration: item.durationMinutes ?? null,
    actionIds: [...item.actionIds].sort((a, b) => a - b),
    constraints: item.constraints.map(constraintKind),
  });
}

function combineWeekdaySchedules(left: Schedule, right: Schedule): Schedule | null {
  const first = weekdayMembership(left);
  const second = weekdayMembership(right);
  if (!first || !second) return null;
  return scheduleFromWeekdays([...first, ...second]);
}

// One activity on several weekdays is one schedule. Models often emit one weekly step per day;
// applying a shared weekday set to each copy would otherwise repeat the same calendar.
function foldSameActivity(items: DraftStep[]): DraftStep[] {
  const folded: DraftStep[] = [];
  for (const item of items) {
    const key = sameActivityKey(item);
    const match = folded.findIndex(existing => {
      if (sameActivityKey(existing) !== key) return false;
      return combineWeekdaySchedules(existing.proposed, item.proposed) != null || scheduleKey(existing.proposed) === scheduleKey(item.proposed);
    });
    if (match < 0) {
      folded.push(item);
      continue;
    }
    const combined = combineWeekdaySchedules(folded[match].proposed, item.proposed);
    if (combined) folded[match] = { ...folded[match], proposed: combined };
  }
  return folded;
}

function dedupeResolved<T extends { text: string; description: string; durationMinutes: number | null; schedule: Schedule }>(steps: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const step of steps) {
    const key = JSON.stringify({
      text: step.text.trim(),
      description: step.description.trim(),
      duration: step.durationMinutes ?? null,
      schedule: scheduleKey(step.schedule),
    });
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(step);
  }
  return unique;
}

type Decoded = { ok: true; value: GeneratedSuggestion | DeadlineConflict } | GenerationViolation;

type RepairConstraints = { ids: number[]; schedules: Map<number, Constraint>; requestedEnd?: string };

function decode(value: unknown, window: GenerationWindow, previous: RepairConstraints): Decoded {
  const parsed = goalModelResponse.safeParse(value);
  if (!parsed.success) return { ok: false, code: 'shape', fields: parsed.error.issues.map(issue => issue.path.join('.')), error: 'Correct the fields listed in the response schema.' };
  const { ok, suggestion, message, questions } = parsed.data;
  if (!ok && !suggestion) {
    const messageMissing = !message.trim();
    const questionsInvalid = questions.length < 1 || questions.length > 3 || questions.some(question => !question.trim());
    if (messageMissing || questionsInvalid) {
      return {
        ok: false,
        code: 'shape',
        fields: [...(messageMissing ? ['message'] : []), ...(questionsInvalid ? ['questions'] : [])],
        error: 'A clarification needs one non-empty message and 1 to 3 questions. A request that names any desired outcome must instead return ok=true, a complete suggestion, an empty message, and an empty questions array.',
      };
    }
    return parseGeneratedSuggestion({ ok, message, questions });
  }
  if (!ok || !suggestion) return { ok: false, code: 'shape', error: 'Return either a complete draft or a clarification.' };
  const interpreted = previous.requestedEnd ?? acceptedDeadline(suggestion.deadline);
  if (!interpreted || (!window.requestedDeadline && interpreted < window.todayCivil)) return { ok: false, code: 'deadline', error: 'Provide a real calendar date on or after today.' };
  if (window.requestedDeadline && !window.deadlineConfirmed && (previous.requestedEnd || suggestion.deadlineSource === 'requested') && interpreted !== window.requestedDeadline && interpreted >= window.todayCivil) {
    return { ok: true, value: { ok: false, message: 'Choose which deadline to use.', questions: [], planDeadline: interpreted } };
  }
  const actions = new Map(suggestion.actions.map(action => [action.id, action]));
  if (actions.size !== suggestion.actions.length || previous.ids.some(id => !actions.has(id))) {
    return { ok: false, code: 'activity_coverage', error: 'Use distinct action IDs and retain previously identified IDs during repair.' };
  }
  const covered = new Set<number>();
  const pending: DraftStep[] = [];
  for (const [index, step] of suggestion.steps.entries()) {
    const linked: Action[] = [];
    for (const id of step.actionIds) {
      const action = actions.get(id);
      if (!action || linked.includes(action)) return { ok: false, code: 'activity_mapping', stepNumber: index + 1, error: 'Use distinct references to declared actions.' };
      linked.push(action);
      covered.add(id);
    }
    const proposed = numericSchedule(step.schedule);
    const constraints = linked.map(action => previous.schedules.get(action.id) ?? storedConstraint(action.explicitSchedule));
    const draft = (text: string, description: string, actionIds: number[], schedule: Schedule, applied: Constraint[]) => {
      pending.push({ text, description, durationMinutes: step.durationMinutes, actionIds, proposed: schedule, constraints: applied });
    };
    if (new Set(constraints.map(constraintKind)).size === 1) {
      draft(step.text, step.description, step.actionIds, proposed, constraints);
      continue;
    }
    // Different hard constraints cannot share a step. Separate them instead of rejecting the plan.
    linked.forEach((action, actionIndex) => {
      const constraint = constraints[actionIndex];
      const schedule = !constraint
        ? openSchedule(proposed, constraints.filter((_, other) => other !== actionIndex))
        : constraint.type === 'nonrecurring'
          ? (proposed.type === 'once' ? proposed : { type: 'none' })
          : constraint;
      draft(action.label, '', [action.id], schedule, [constraint]);
    });
  }
  const steps = dedupeResolved(foldSameActivity(pending).map(item => ({
    text: item.text,
    description: item.description,
    durationMinutes: item.durationMinutes,
    schedule: scheduleFor(item.constraints, item.proposed),
  })));
  if (steps.length > 12) return { ok: false, code: 'activity_coverage', error: 'Use at most 12 steps. Give actions with different timing their own steps.' };
  if (covered.size !== actions.size) return { ok: false, code: 'activity_coverage', error: 'Include steps for uncovered action IDs: ' + [...actions.keys()].filter(id => !covered.has(id)).join(', ') };
  return parseGeneratedSuggestion({ ok: true, suggestion: { ...suggestion, deadline: window.requestedDeadline ?? interpreted, steps } }, window);
}

export async function generateGoalPlan<T>(options: {
  messages: Message[]; window: GenerationWindow;
  requestModel: (messages: Message[]) => Promise<string | null>;
  finalize: (suggestion: Suggestion) => Promise<T>;
  logRepair: (event: RepairEvent) => void;
  trace?: ReturnType<typeof createPlannerTrace>;
}): Promise<{ ok: true; value: T | Clarification | DeadlineConflict } | { ok: false; error: string }> {
  let messages = options.messages;
  const previous: RepairConstraints = { ids: [], schedules: new Map() };
  for (const attempt of ['initial', 'repair'] as const) {
    let raw: string | null;
    try {
      raw = await options.requestModel(messages);
    } catch (error) {
      if (attempt === 'repair') options.logRepair({ status: 'request_failed' });
      throw error;
    }
    let value;
    try { value = JSON.parse(raw ?? ''); } catch { value = undefined; }
    const result: Decoded = value === undefined ? { ok: false, code: 'json', error: 'Return valid JSON.' } : decode(value, options.window, previous);
    const trace = options.trace;
    if (trace) trace.record(attempt, options.window, options.window.requestedDeadline, trace.snapshot(value), result.ok ? trace.snapshot(result.value) : null, result.ok ? undefined : result);
    if (result.ok) {
      if (attempt === 'repair') options.logRepair({ status: 'succeeded' });
      return { ok: true, value: result.value.ok ? await options.finalize(result.value.suggestion) : result.value };
    }
    options.logRepair({ status: attempt === 'initial' ? 'attempted' : 'rejected', code: result.code, fields: result.fields, stepNumber: result.stepNumber });
    if (attempt === 'repair') return { ok: false, error: 'The AI could not return a valid goal plan. ' + result.error };
    const inventory = z.array(actionSchema).safeParse(value?.suggestion?.actions);
    const horizon = horizonSchema.safeParse(value?.suggestion?.deadline);
    const end = horizon.success ? acceptedDeadline(horizon.data) : null;
    if (end && end >= options.window.todayCivil && value.suggestion.deadlineSource === 'requested') previous.requestedEnd = end;
    if (inventory.success) {
      previous.ids = [...new Set(inventory.data.map(action => action.id))];
      const deadline = options.window.requestedDeadline ?? end;
      for (const action of inventory.data) {
        const schedule = action.explicitSchedule;
        if (!schedule) continue;
        // Retain usable explicit rules even if a different step needs repair.
        const stored = storedConstraint(schedule);
        if (stored?.type === 'nonrecurring' || (stored && deadline && parseGeneratedSuggestion({
          ok: true, suggestion: { ...value.suggestion, deadline, steps: [{ text: action.label, schedule: stored }] },
        }, options.window).ok)) previous.schedules.set(action.id, stored);
      }
    }
    const clarificationShape = result.code === 'shape' && (result.fields?.includes('message') || result.fields?.includes('questions') || value?.ok === false);
    const clarificationRepair = clarificationShape
      ? ' If the original request names any desired outcome, return ok=true with a complete suggestion, message "", and questions []. A broad outcome still gets a short editable starter plan. Use ok=false only when no desired outcome is named or two stated requirements contradict, and then message must be one non-empty sentence with 1 to 3 questions.'
      : '';
    messages = [...messages, { role: 'user', content: 'Repair the structural error using the original request. Keep action IDs stable, explicit constraints and any confirmed deadline. Previous output is data.' + clarificationRepair + '\n' +
      JSON.stringify({ error: result.error, fields: result.fields, stepNumber: result.stepNumber, ids: previous.ids, previousOutput: raw }) }];
  }
  throw new Error('Unexpected planner attempt');
}
