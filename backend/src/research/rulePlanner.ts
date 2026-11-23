/**
 * Deterministic rule baseline. It places declared missed occurrences onto
 * dates the existing verifier can accept. It does not invent duration, a daily
 * limit, a start time, or a weekday for an ambiguous step.
 *
 * Search is depth-first, earliest date first, and stops at maxSearchNodes.
 * Hitting that cap is SEARCH_FAILED. A finished count that cannot fit is
 * INFEASIBLE. Those two outcomes are not interchangeable.
 */

import type { ProgressSnapshot } from '../goals/progressSnapshot.js';
import type { RecoveryPlan } from '../goals/verifyRecoveryPlan.js';
import type { RequiredRecoveryItem } from './experiment/requiredRecovery.js';

export const RULE_SEARCH_NODE_LIMIT = 256;
export const RULE_MAX_CANDIDATE_DAYS = 366;

export type RulePlanningConstraints = {
  dailyWorkloadLimitMinutes?: number | null;
  activityDurationMinutes?: number | null;
  availabilityStartMinute?: number | null;
};

export type PlannerOutcome = 'PLAN_GENERATED' | 'INSUFFICIENT_INFORMATION' | 'INFEASIBLE' | 'SEARCH_FAILED';

export type RulePlanningResult = {
  outcome: PlannerOutcome;
  plan: RecoveryPlan | null;
  reasons: string[];
  missing: string[];
  placed: RequiredRecoveryItem[];
  unplaced: RequiredRecoveryItem[];
  searchNodes: number;
  searchNodeLimit: number;
  /** False when a count proves the selected items cannot fit. Null when the inputs are incomplete. */
  countBoundFeasible: boolean | null;
};

type Civil = { y: number; m: number; d: number };
type Placement = { item: RequiredRecoveryItem; date: string };

export function planRuleRecovery(input: {
  snapshot: ProgressSnapshot;
  requiredRecovery: RequiredRecoveryItem[];
  constraints?: RulePlanningConstraints;
  maxSearchNodes?: number;
}): RulePlanningResult {
  const constraints = input.constraints ?? {};
  const searchNodeLimit = normalizeLimit(input.maxSearchNodes);
  const required = input.requiredRecovery.map(item => ({ stepId: item.stepId, missedDate: item.missedDate }));
  required.sort((left, right) => left.missedDate.localeCompare(right.missedDate) || left.stepId.localeCompare(right.stepId));
  const base = {
    searchNodes: 0,
    searchNodeLimit,
    placed: [] as RequiredRecoveryItem[],
    unplaced: required.map(item => ({ ...item })),
    plan: null,
    countBoundFeasible: null as boolean | null,
  };

  const deadline = input.snapshot.goal.deadline;
  const limit = readNonNegativeInt(constraints.dailyWorkloadLimitMinutes);
  const duration = readPositiveInt(constraints.activityDurationMinutes);
  const startMinute = readMinute(constraints.availabilityStartMinute);
  const scheduleProblems = scheduleBlockers(input.snapshot, required);
  const preserved = preservedByStep(input.snapshot);
  const touchedCount = estimateActivities(required, preserved);
  const missing = missingConstraints({
    deadline,
    limit,
    duration,
    startMinute,
    needsDuration: required.length > 0,
    needsStart: required.length > 0 && touchedCount >= 2,
    ambiguous: scheduleProblems.ambiguous,
  });
  if (required.length > 0 && deadline != null && isCivil(deadline) && deadline < input.snapshot.asOf) {
    return {
      ...base,
      outcome: 'INFEASIBLE',
      reasons: ['no_feasible_date'],
      missing: [],
      countBoundFeasible: false,
    };
  }
  if (required.length === 0 && missing.length === 0 && deadline != null && limit != null) {
    return {
      ...base,
      outcome: 'PLAN_GENERATED',
      reasons: [],
      missing: [],
      unplaced: [],
      countBoundFeasible: true,
      plan: { goalId: input.snapshot.goal.id, activities: [] },
    };
  }
  if (missing.length > 0 || scheduleProblems.ambiguous.length > 0) {
    return {
      ...base,
      outcome: 'INSUFFICIENT_INFORMATION',
      reasons: missing,
      missing,
    };
  }
  if (scheduleProblems.unknown.length > 0) {
    return {
      ...base,
      outcome: 'INFEASIBLE',
      reasons: ['unknown_step'],
      missing: [],
      countBoundFeasible: false,
    };
  }
  if (scheduleProblems.archived.length > 0) {
    return {
      ...base,
      outcome: 'INFEASIBLE',
      reasons: ['archived_step'],
      missing: [],
      countBoundFeasible: false,
    };
  }
  if (deadline == null || limit == null || duration == null) {
    return { ...base, outcome: 'INSUFFICIENT_INFORMATION', reasons: missing, missing };
  }
  if (deadline < input.snapshot.asOf) {
    return {
      ...base,
      outcome: 'INFEASIBLE',
      reasons: ['no_feasible_date'],
      missing: [],
      countBoundFeasible: false,
    };
  }

  const span = inclusiveDays(input.snapshot.asOf, deadline);
  if (span > RULE_MAX_CANDIDATE_DAYS) {
    return {
      ...base,
      outcome: 'SEARCH_FAILED',
      reasons: ['date_span_exceeds_supported_bound'],
      missing: [],
      countBoundFeasible: null,
    };
  }
  const dates = enumerateDates(input.snapshot.asOf, deadline);
  const needsStart = touchedCount >= 2;
  if (needsStart && startMinute == null) {
    return {
      ...base,
      outcome: 'INSUFFICIENT_INFORMATION',
      reasons: ['missing_availability_start'],
      missing: ['missing_availability_start'],
    };
  }
  if (duration > limit) {
    return {
      ...base,
      outcome: 'INFEASIBLE',
      reasons: ['duration_exceeds_daily_limit'],
      missing: [],
      countBoundFeasible: false,
    };
  }
  if (startMinute != null && startMinute + duration > 1440) {
    return {
      ...base,
      outcome: 'INFEASIBLE',
      reasons: ['duration_exceeds_day'],
      missing: [],
      countBoundFeasible: false,
    };
  }

  const prefix = longestFeasiblePrefix({
    items: required,
    dates,
    preserved,
    duration,
    limit,
    startMinute: startMinute ?? 0,
    packClock: needsStart,
  });
  if (prefix.length === 0) {
    return {
      ...base,
      outcome: 'INFEASIBLE',
      reasons: infeasibleReasons(required, dates, preserved, duration, limit, startMinute ?? 0, needsStart),
      missing: [],
      countBoundFeasible: false,
    };
  }

  const search = searchAssignments({
    items: prefix,
    dates,
    preserved,
    duration,
    limit,
    startMinute: startMinute ?? 0,
    packClock: needsStart,
    maxSearchNodes: searchNodeLimit,
  });
  if (search.status === 'limit') {
    return {
      ...base,
      outcome: 'SEARCH_FAILED',
      reasons: ['search_node_limit'],
      missing: [],
      searchNodes: search.nodes,
      countBoundFeasible: true,
      unplaced: required.map(item => ({ ...item })),
    };
  }
  if (search.status !== 'found') {
    return {
      ...base,
      outcome: 'INFEASIBLE',
      reasons: ['no_assignment'],
      missing: [],
      searchNodes: search.nodes,
      countBoundFeasible: false,
    };
  }

  const remaining = [...search.placements];
  const placed: RequiredRecoveryItem[] = [];
  const unplaced: RequiredRecoveryItem[] = [];
  for (const item of required) {
    const index = remaining.findIndex(
      placement => placement.item.stepId === item.stepId && placement.item.missedDate === item.missedDate
    );
    if (index === -1) unplaced.push({ ...item });
    else {
      remaining.splice(index, 1);
      placed.push({ ...item });
    }
  }
  const reasons = unplaced.length > 0 ? ['full_recovery_exceeds_capacity'] : [];
  return {
    outcome: 'PLAN_GENERATED',
    reasons,
    missing: [],
    placed,
    unplaced,
    searchNodes: search.nodes,
    searchNodeLimit,
    countBoundFeasible: unplaced.length === 0,
    plan: buildPlan({
      goalId: input.snapshot.goal.id,
      placements: search.placements,
      preserved,
      duration,
      startMinute,
    }),
  };
}

function missingConstraints(input: {
  deadline: string | null;
  limit: number | null;
  duration: number | null;
  startMinute: number | null;
  needsDuration: boolean;
  needsStart: boolean;
  ambiguous: string[];
}): string[] {
  const missing: string[] = [];
  if (input.deadline == null || !isCivil(input.deadline)) missing.push('missing_deadline');
  if (input.limit == null) missing.push('missing_daily_workload_limit');
  if (input.needsDuration && input.duration == null) missing.push('missing_activity_duration');
  if (input.needsStart && input.startMinute == null) missing.push('missing_availability_start');
  if (input.ambiguous.length > 0) missing.push('ambiguous_schedule');
  return missing;
}

function scheduleBlockers(snapshot: ProgressSnapshot, required: RequiredRecoveryItem[]) {
  const steps = new Map(snapshot.steps.map(step => [step.id, step]));
  const ambiguous: string[] = [];
  const unknown: string[] = [];
  const archived: string[] = [];
  for (const item of required) {
    const step = steps.get(item.stepId);
    if (!step) unknown.push(item.stepId);
    else if (step.lifecycle === 'archived') archived.push(item.stepId);
    else if (step.occurrenceStatus !== 'scheduled') ambiguous.push(item.stepId);
  }
  return {
    ambiguous: [...new Set(ambiguous)].sort(),
    unknown: [...new Set(unknown)].sort(),
    archived: [...new Set(archived)].sort(),
  };
}

function preservedByStep(snapshot: ProgressSnapshot): Map<string, string[]> {
  const byStep = new Map<string, string[]>();
  for (const occurrence of snapshot.occurrences) {
    if (occurrence.status !== 'DONE') continue;
    const dates = byStep.get(occurrence.stepId) ?? [];
    dates.push(occurrence.date);
    byStep.set(occurrence.stepId, dates);
  }
  for (const dates of byStep.values()) dates.sort();
  return byStep;
}

function estimateActivities(required: RequiredRecoveryItem[], preserved: Map<string, string[]>): number {
  const steps = new Set(required.map(item => item.stepId));
  let preservedCount = 0;
  for (const stepId of steps) preservedCount += preserved.get(stepId)?.length ?? 0;
  return preservedCount + required.length;
}

function longestFeasiblePrefix(input: {
  items: RequiredRecoveryItem[];
  dates: string[];
  preserved: Map<string, string[]>;
  duration: number;
  limit: number;
  startMinute: number;
  packClock: boolean;
}): RequiredRecoveryItem[] {
  for (let count = input.items.length; count >= 1; count -= 1) {
    const prefix = input.items.slice(0, count);
    if (prefixFits(prefix, input)) return prefix;
  }
  return [];
}

function prefixFits(
  items: RequiredRecoveryItem[],
  input: {
    dates: string[];
    preserved: Map<string, string[]>;
    duration: number;
    limit: number;
    startMinute: number;
    packClock: boolean;
  }
): boolean {
  const steps = new Set(items.map(item => item.stepId));
  const blocked = blockedDates(steps, input.preserved, input.dates);
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.stepId, (counts.get(item.stepId) ?? 0) + 1);
  for (const [stepId, count] of counts) {
    if (count > input.dates.length - (blocked.get(stepId)?.size ?? 0)) return false;
  }
  let capacity = 0;
  for (const date of input.dates) {
    const preservedCount = preservedOnDate(date, steps, input.preserved);
    const preservedMinutes = preservedCount * input.duration;
    if (preservedMinutes > input.limit) return false;
    const workSlots = Math.floor((input.limit - preservedMinutes) / input.duration);
    const clockSlots = input.packClock
      ? Math.floor((1440 - input.startMinute - preservedMinutes) / input.duration)
      : workSlots;
    capacity += Math.max(0, Math.min(workSlots, clockSlots));
  }
  if (pastOverload(steps, input.preserved, input.dates, input.duration, input.limit, input.startMinute, input.packClock)) {
    return false;
  }
  return items.length <= capacity;
}

function pastOverload(
  steps: Set<string>,
  preserved: Map<string, string[]>,
  candidateDates: string[],
  duration: number,
  limit: number,
  startMinute: number,
  packClock: boolean
): boolean {
  const candidate = new Set(candidateDates);
  const perDate = new Map<string, number>();
  for (const stepId of steps) {
    for (const date of preserved.get(stepId) ?? []) {
      if (candidate.has(date)) continue;
      perDate.set(date, (perDate.get(date) ?? 0) + duration);
    }
  }
  for (const minutes of perDate.values()) {
    if (minutes > limit) return true;
    if (packClock && startMinute + minutes > 1440) return true;
  }
  return false;
}

function infeasibleReasons(
  items: RequiredRecoveryItem[],
  dates: string[],
  preserved: Map<string, string[]>,
  duration: number,
  limit: number,
  startMinute: number,
  packClock: boolean
): string[] {
  const reasons: string[] = [];
  const steps = new Set(items.map(item => item.stepId));
  const blocked = blockedDates(steps, preserved, dates);
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.stepId, (counts.get(item.stepId) ?? 0) + 1);
  for (const [stepId, count] of counts) {
    if (count > dates.length - (blocked.get(stepId)?.size ?? 0)) reasons.push('step_exceeds_available_days');
  }
  if (pastOverload(steps, preserved, dates, duration, limit, startMinute, packClock)) reasons.push('preserved_workload');
  if (!prefixFits(items.slice(0, 1), { dates, preserved, duration, limit, startMinute, packClock }) && reasons.length === 0) {
    reasons.push('workload_capacity');
  }
  if (reasons.length === 0) reasons.push('workload_capacity');
  return [...new Set(reasons)];
}

function searchAssignments(input: {
  items: RequiredRecoveryItem[];
  dates: string[];
  preserved: Map<string, string[]>;
  duration: number;
  limit: number;
  startMinute: number;
  packClock: boolean;
  maxSearchNodes: number;
}): { status: 'found' | 'limit' | 'none'; nodes: number; placements: Placement[] } {
  const steps = new Set(input.items.map(item => item.stepId));
  const preservedCount = new Map<string, number>();
  const preservedSteps = new Map<string, Set<string>>();
  for (const date of input.dates) {
    const present = new Set<string>();
    let count = 0;
    for (const stepId of steps) {
      if ((input.preserved.get(stepId) ?? []).includes(date)) {
        present.add(stepId);
        count += 1;
      }
    }
    preservedCount.set(date, count);
    preservedSteps.set(date, present);
  }
  const addedCount = new Map<string, number>();
  const addedSteps = new Map<string, string[]>();
  const placements: Placement[] = [];
  let nodes = 0;

  const status = visit(0);
  return { status, nodes, placements: status === 'found' ? placements.map(item => ({ item: { ...item.item }, date: item.date })) : [] };

  function visit(index: number): 'found' | 'limit' | 'none' {
    if (nodes >= input.maxSearchNodes) return 'limit';
    nodes += 1;
    if (index === input.items.length) return 'found';
    const item = input.items[index];
    for (const date of input.dates) {
      if ((preservedSteps.get(date)?.has(item.stepId) ?? false) || (addedSteps.get(date) ?? []).includes(item.stepId)) continue;
      const count = (preservedCount.get(date) ?? 0) + (addedCount.get(date) ?? 0);
      const minutes = count * input.duration;
      if (minutes + input.duration > input.limit) continue;
      if (input.packClock && input.startMinute + minutes + input.duration > 1440) continue;
      placements.push({ item, date });
      addedCount.set(date, (addedCount.get(date) ?? 0) + 1);
      const stepsOnDate = addedSteps.get(date) ?? [];
      stepsOnDate.push(item.stepId);
      addedSteps.set(date, stepsOnDate);
      const next = visit(index + 1);
      if (next !== 'none') return next;
      placements.pop();
      addedCount.set(date, (addedCount.get(date) ?? 1) - 1);
      stepsOnDate.pop();
    }
    return 'none';
  }
}

function buildPlan(input: {
  goalId: string;
  placements: Placement[];
  preserved: Map<string, string[]>;
  duration: number;
  startMinute: number | null;
}): RecoveryPlan {
  const steps = [...new Set(input.placements.map(item => item.item.stepId))].sort();
  const activities: RecoveryPlan['activities'] = [];
  for (const stepId of steps) {
    for (const date of input.preserved.get(stepId) ?? []) {
      activities.push({
        activityId: `preserve:${stepId}:${date}`,
        stepId,
        date,
        durationMinutes: input.duration,
        ...(input.startMinute == null ? {} : { startMinuteOfDay: input.startMinute }),
      });
    }
  }
  const recoveries = [...input.placements].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.item.stepId.localeCompare(right.item.stepId) ||
      left.item.missedDate.localeCompare(right.item.missedDate)
  );
  recoveries.forEach((placement, index) => {
    activities.push({
      activityId: `recover:${placement.item.stepId}:${placement.item.missedDate}:${index}`,
      stepId: placement.item.stepId,
      date: placement.date,
      durationMinutes: input.duration,
      ...(input.startMinute == null ? {} : { startMinuteOfDay: input.startMinute }),
    });
  });
  if (input.startMinute != null) assignStarts(activities, input.startMinute, input.duration);
  activities.sort((left, right) => left.date.localeCompare(right.date) || left.activityId.localeCompare(right.activityId));
  return { goalId: input.goalId, activities };
}

function assignStarts(activities: RecoveryPlan['activities'], startMinute: number, duration: number) {
  const byDate = new Map<string, RecoveryPlan['activities']>();
  for (const activity of activities) {
    const group = byDate.get(activity.date) ?? [];
    group.push(activity);
    byDate.set(activity.date, group);
  }
  for (const group of byDate.values()) {
    group.sort((left, right) => left.activityId.localeCompare(right.activityId));
    group.forEach((activity, index) => {
      activity.startMinuteOfDay = startMinute + index * duration;
    });
  }
}

function blockedDates(steps: Set<string>, preserved: Map<string, string[]>, dates: string[]): Map<string, Set<string>> {
  const candidate = new Set(dates);
  const blocked = new Map<string, Set<string>>();
  for (const stepId of steps) {
    const datesForStep = new Set((preserved.get(stepId) ?? []).filter(date => candidate.has(date)));
    blocked.set(stepId, datesForStep);
  }
  return blocked;
}

function preservedOnDate(date: string, steps: Set<string>, preserved: Map<string, string[]>): number {
  let count = 0;
  for (const stepId of steps) {
    if ((preserved.get(stepId) ?? []).includes(date)) count += 1;
  }
  return count;
}

function normalizeLimit(value: number | undefined): number {
  if (value == null) return RULE_SEARCH_NODE_LIMIT;
  if (!Number.isInteger(value) || value < 0) throw new RangeError('maxSearchNodes must be an integer >= 0');
  return value;
}

function readNonNegativeInt(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function readPositiveInt(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function readMinute(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1439) return null;
  return value;
}

function isCivil(value: string): boolean {
  return parseCivil(value) != null;
}

function parseCivil(value: string): Civil | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return { y, m, d };
}

function inclusiveDays(fromText: string, toText: string): number {
  const from = parseCivil(fromText);
  const to = parseCivil(toText);
  if (!from || !to) return 0;
  const start = Date.UTC(from.y, from.m - 1, from.d);
  const end = Date.UTC(to.y, to.m - 1, to.d);
  return Math.round((end - start) / 86400000) + 1;
}

function enumerateDates(fromText: string, toText: string): string[] {
  const dates: string[] = [];
  let cursor = parseCivil(fromText);
  const end = parseCivil(toText);
  if (!cursor || !end) return dates;
  while (compareCivil(cursor, end) <= 0) {
    dates.push(formatCivil(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function addDays(date: Civil, days: number): Civil {
  const utc = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() };
}

function compareCivil(left: Civil, right: Civil): number {
  if (left.y !== right.y) return left.y - right.y;
  if (left.m !== right.m) return left.m - right.m;
  return left.d - right.d;
}

function formatCivil(date: Civil): string {
  return `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
}
