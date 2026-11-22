/**
 * Structural parse only. Semantic problems (unknown steps, past dates,
 * duplicates, workload) are left to verifyRecoveryPlan. Invalid activities
 * are not dropped or replaced.
 */

import type { RecoveryActivity, RecoveryPlan } from '../../goals/verifyRecoveryPlan.js';

export type PlanParseResult = { ok: true; plan: RecoveryPlan } | { ok: false; errors: string[] };

export function parseRecoveryPlan(raw: string): PlanParseResult {
  let value: unknown;
  try {
    value = JSON.parse(extractJsonObject(raw));
  } catch {
    return { ok: false, errors: ['invalid_json'] };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['plan_not_object'] };
  const row = value as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof row.goalId !== 'string' || row.goalId.trim() === '') errors.push('missing_goal_id');
  if (!Array.isArray(row.activities)) errors.push('missing_activities');
  if (errors.length > 0 || !Array.isArray(row.activities) || typeof row.goalId !== 'string') return { ok: false, errors };

  const activities: RecoveryActivity[] = [];
  row.activities.forEach((item, index) => {
    const prefix = `activities[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${prefix}_not_object`);
      return;
    }
    const activity = item as Record<string, unknown>;
    const activityId = typeof activity.activityId === 'string' ? activity.activityId.trim() : '';
    const stepId = typeof activity.stepId === 'string' ? activity.stepId.trim() : '';
    if (!activityId) errors.push(`${prefix}.activityId`);
    if (!stepId) errors.push(`${prefix}.stepId`);
    if (typeof activity.date !== 'string') errors.push(`${prefix}.date`);
    if (!isOptionalNumber(activity.durationMinutes)) errors.push(`${prefix}.durationMinutes`);
    if (!isOptionalNumber(activity.startMinuteOfDay)) errors.push(`${prefix}.startMinuteOfDay`);
    if (errors.some(error => error.startsWith(prefix))) return;
    activities.push({
      activityId,
      stepId,
      date: activity.date as string,
      ...(activity.durationMinutes == null ? {} : { durationMinutes: activity.durationMinutes as number }),
      ...(activity.startMinuteOfDay == null ? {} : { startMinuteOfDay: activity.startMinuteOfDay as number }),
    });
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, plan: { goalId: row.goalId.trim(), activities } };
}

function isOptionalNumber(value: unknown): boolean {
  return value == null || (typeof value === 'number' && Number.isFinite(value));
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  if (trimmed.startsWith('{')) return trimmed;
  const start = trimmed.indexOf('{');
  if (start < 0) return trimmed;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return trimmed.slice(start, index + 1);
    }
  }
  return trimmed.slice(start);
}
