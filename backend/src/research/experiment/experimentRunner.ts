/**
 * Offline experiment log. It verifies proposals that were already produced
 * and writes a deterministic record. It does not call a model or MCP.
 *
 * UNKNOWN stays a separate count. Recovery coverage is scored from the
 * declared required-recovery set and is not fed back into the verdict.
 */

import { performance } from 'node:perf_hooks';

import type { ProgressSnapshot } from '../../goals/progressSnapshot.js';
import {
  verifyRecoveryPlan,
  type RecoveryConstraints,
  type RecoveryPlan,
} from '../../goals/verifyRecoveryPlan.js';
import { measureRecoveryCoverage, type RecoveryCoverage } from './coverage.js';
import type { RequiredRecoveryItem } from './requiredRecovery.js';

export const EXPERIMENT_METHODS = ['manual', 'rule', 'direct_context_llm', 'mcp'] as const;
export type ExperimentMethod = (typeof EXPERIMENT_METHODS)[number];

export type ExperimentTask = {
  scenarioId: string;
  snapshot: ProgressSnapshot;
  constraints: RecoveryConstraints;
  expectedVerdict: 'PASS' | 'FAIL' | 'UNKNOWN' | null;
  requiredRecovery: RequiredRecoveryItem[];
};

export type ExperimentProposal = {
  scenarioId: string;
  planId: string;
  method: ExperimentMethod;
  plan: RecoveryPlan;
};

export type ExperimentRecord = {
  experimentId: string;
  method: ExperimentMethod;
  recordedAt: string;
  scenarioId: string;
  planId: string;
  goalId: string;
  constraints: RecoveryConstraints;
  expectedVerdict: 'PASS' | 'FAIL' | 'UNKNOWN' | null;
  actualVerdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  matchedExpected: boolean | null;
  violationCodes: string[];
  notEvaluated: string[];
  progressMeaning: 'self_report_not_verified_achievement';
  recovery: RecoveryCoverage;
  verificationRuntimeMs: number;
};

export type ExperimentSummary = {
  experimentId: string;
  recordedAt: string;
  method: ExperimentMethod | 'mixed';
  unknownCountedAsPass: false;
  counts: { PASS: number; FAIL: number; UNKNOWN: number; total: number };
  expectedComparisons: { matched: number; mismatched: number; notDeclared: number };
  recovery: {
    requiredItems: number;
    coveredItems: number;
    COVERED: number;
    PARTIAL: number;
    NOT_COVERED: number;
    NOT_REQUIRED: number;
  };
};

export type ExperimentRun = {
  tasks: ExperimentTask[];
  proposals: ExperimentProposal[];
  records: ExperimentRecord[];
  summary: ExperimentSummary;
};

const RECORDED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export function assertRecordedAt(value: string): string {
  if (!RECORDED_AT.test(value) || Number.isNaN(new Date(value).getTime())) {
    throw new RangeError('recordedAt must be an explicit ISO-8601 timestamp with a timezone');
  }
  return value;
}

export function runExperiment(input: {
  experimentId: string;
  recordedAt: string;
  tasks: ExperimentTask[];
  proposals: ExperimentProposal[];
}): ExperimentRun {
  const recordedAt = assertRecordedAt(input.recordedAt);
  const experimentId = input.experimentId.trim();
  if (!experimentId) throw new RangeError('experimentId is required');
  const tasks = new Map(input.tasks.map(task => [task.scenarioId, task]));
  if (tasks.size !== input.tasks.length) throw new RangeError('scenarioId values must be unique');

  const records = input.proposals.map(proposal => {
    const task = tasks.get(proposal.scenarioId);
    if (!task) throw new RangeError(`No task for scenario ${proposal.scenarioId}`);
    if (proposal.plan.goalId !== task.snapshot.goal.id) {
      throw new RangeError(`Plan ${proposal.planId} does not target snapshot goal ${task.snapshot.goal.id}`);
    }
    const started = performance.now();
    const verified = verifyRecoveryPlan(task.snapshot, proposal.plan, task.constraints);
    const verificationRuntimeMs = performance.now() - started;
    const recovery = measureRecoveryCoverage({
      asOf: task.snapshot.asOf,
      plan: proposal.plan,
      requiredRecovery: task.requiredRecovery,
    });
    const matchedExpected = task.expectedVerdict == null ? null : verified.verdict === task.expectedVerdict;
    return {
      experimentId,
      method: proposal.method,
      recordedAt,
      scenarioId: proposal.scenarioId,
      planId: proposal.planId,
      goalId: task.snapshot.goal.id,
      constraints: task.constraints,
      expectedVerdict: task.expectedVerdict,
      actualVerdict: verified.verdict,
      matchedExpected,
      violationCodes: verified.violations.map(item => item.code),
      notEvaluated: verified.notEvaluated.map(item => item.code),
      progressMeaning: verified.progressMeaning,
      recovery,
      verificationRuntimeMs,
    } satisfies ExperimentRecord;
  });

  return {
    tasks: input.tasks,
    proposals: input.proposals,
    records,
    summary: summarizeExperiment({ experimentId, recordedAt, records }),
  };
}

export function summarizeExperiment(input: {
  experimentId: string;
  recordedAt: string;
  records: ExperimentRecord[];
}): ExperimentSummary {
  const counts = { PASS: 0, FAIL: 0, UNKNOWN: 0, total: input.records.length };
  const expectedComparisons = { matched: 0, mismatched: 0, notDeclared: 0 };
  const recovery = { requiredItems: 0, coveredItems: 0, COVERED: 0, PARTIAL: 0, NOT_COVERED: 0, NOT_REQUIRED: 0 };
  const methods = new Set<ExperimentMethod>();
  for (const record of input.records) {
    counts[record.actualVerdict] += 1;
    methods.add(record.method);
    if (record.expectedVerdict == null) expectedComparisons.notDeclared += 1;
    else if (record.matchedExpected) expectedComparisons.matched += 1;
    else expectedComparisons.mismatched += 1;
    recovery[record.recovery.status] += 1;
    recovery.requiredItems += record.recovery.required.length;
    recovery.coveredItems += record.recovery.covered.length;
  }
  const [onlyMethod] = methods;
  return {
    experimentId: input.experimentId,
    recordedAt: input.recordedAt,
    method: methods.size === 1 && onlyMethod ? onlyMethod : 'mixed',
    unknownCountedAsPass: false,
    counts,
    expectedComparisons,
    recovery,
  };
}

export function stableRecord(record: ExperimentRecord): Omit<ExperimentRecord, 'verificationRuntimeMs'> {
  return {
    experimentId: record.experimentId,
    method: record.method,
    recordedAt: record.recordedAt,
    scenarioId: record.scenarioId,
    planId: record.planId,
    goalId: record.goalId,
    constraints: record.constraints,
    expectedVerdict: record.expectedVerdict,
    actualVerdict: record.actualVerdict,
    matchedExpected: record.matchedExpected,
    violationCodes: record.violationCodes,
    notEvaluated: record.notEvaluated,
    progressMeaning: record.progressMeaning,
    recovery: record.recovery,
  };
}
