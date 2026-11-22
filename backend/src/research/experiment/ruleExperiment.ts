/**
 * Scores the rule baseline on frozen experiment tasks.
 * Task constraints are copied as stored. Duration and availability are not
 * filled in from the manual plans.
 */

import { performance } from 'node:perf_hooks';

import type { ProgressSnapshot } from '../../goals/progressSnapshot.js';
import { verifyRecoveryPlan, type RecoveryConstraints } from '../../goals/verifyRecoveryPlan.js';
import { planRuleRecovery, type PlannerOutcome, type RulePlanningResult } from '../rulePlanner.js';
import { measureRecoveryCoverage } from './coverage.js';
import type { ExperimentTask } from './experimentRunner.js';
import { assertRecordedAt } from './experimentRunner.js';

export const RULE_EXPERIMENT_ID = 'phase3b-rule';
export const RULE_METHOD_ID = 'RULE_BASED';

export type RecoveryClass = 'FULL_RECOVERY' | 'PARTIAL_RECOVERY' | 'NO_RECOVERY' | 'NOT_GENERATED';

export type RuleScenarioResult = {
  experimentId: string;
  method: typeof RULE_METHOD_ID;
  recordedAt: string;
  scenarioId: string;
  goalId: string;
  plannerOutcome: PlannerOutcome;
  recoveryClass: RecoveryClass;
  reasons: string[];
  missing: string[];
  plan: RulePlanningResult['plan'];
  verifierVerdict: 'PASS' | 'FAIL' | 'UNKNOWN' | null;
  violationCodes: string[];
  notEvaluated: string[];
  rawCovered: number;
  required: number;
  verifiedCovered: number;
  planningRuntimeMs: number;
  verificationRuntimeMs: number;
};

export type RuleExperimentSummary = {
  experimentId: string;
  method: typeof RULE_METHOD_ID;
  recordedAt: string;
  unknownCountedAsPass: false;
  scenarios: number;
  planner: Record<PlannerOutcome, number>;
  verifier: { PASS: number; FAIL: number; UNKNOWN: number; notRun: number };
  recoveryClass: Record<RecoveryClass, number>;
  rawCoverage: { covered: number; required: number; percentage: number | null };
  verifiedCoverage: { covered: number; required: number; percentage: number | null };
};

export function classifyVerifiedRecovery(input: {
  required: number;
  covered: number;
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN' | null;
}): { recoveryClass: RecoveryClass; verifiedCovered: number } {
  if (input.verdict !== 'PASS') return { recoveryClass: 'NOT_GENERATED', verifiedCovered: 0 };
  if (input.required === 0 || input.covered >= input.required) {
    return { recoveryClass: 'FULL_RECOVERY', verifiedCovered: input.covered };
  }
  if (input.covered === 0) return { recoveryClass: 'NO_RECOVERY', verifiedCovered: 0 };
  return { recoveryClass: 'PARTIAL_RECOVERY', verifiedCovered: input.covered };
}

export function evaluateRuleTask(
  task: ExperimentTask,
  options: { recordedAt: string; experimentId?: string; maxSearchNodes?: number } 
): RuleScenarioResult {
  const recordedAt = assertRecordedAt(options.recordedAt);
  const constraints: RecoveryConstraints = {
    dailyWorkloadLimitMinutes: task.constraints.dailyWorkloadLimitMinutes ?? null,
  };
  const started = performance.now();
  const planned = planRuleRecovery({
    snapshot: task.snapshot,
    requiredRecovery: task.requiredRecovery,
    constraints,
    maxSearchNodes: options.maxSearchNodes,
  });
  const planningRuntimeMs = performance.now() - started;
  return finishRuleResult({
    experimentId: options.experimentId ?? RULE_EXPERIMENT_ID,
    recordedAt,
    scenarioId: task.scenarioId,
    snapshot: task.snapshot,
    requiredRecovery: task.requiredRecovery,
    constraints,
    planned,
    planningRuntimeMs,
  });
}

export function summarizeRuleResults(input: {
  experimentId: string;
  recordedAt: string;
  results: RuleScenarioResult[];
}): RuleExperimentSummary {
  const planner: Record<PlannerOutcome, number> = {
    PLAN_GENERATED: 0,
    INSUFFICIENT_INFORMATION: 0,
    INFEASIBLE: 0,
    SEARCH_FAILED: 0,
  };
  const verifier = { PASS: 0, FAIL: 0, UNKNOWN: 0, notRun: 0 };
  const recoveryClass: Record<RecoveryClass, number> = {
    FULL_RECOVERY: 0,
    PARTIAL_RECOVERY: 0,
    NO_RECOVERY: 0,
    NOT_GENERATED: 0,
  };
  let rawCovered = 0;
  let verifiedCovered = 0;
  let required = 0;
  for (const result of input.results) {
    planner[result.plannerOutcome] += 1;
    if (result.verifierVerdict == null) verifier.notRun += 1;
    else verifier[result.verifierVerdict] += 1;
    recoveryClass[result.recoveryClass] += 1;
    rawCovered += result.rawCovered;
    verifiedCovered += result.verifiedCovered;
    required += result.required;
  }
  return {
    experimentId: input.experimentId,
    method: RULE_METHOD_ID,
    recordedAt: input.recordedAt,
    unknownCountedAsPass: false,
    scenarios: input.results.length,
    planner,
    verifier,
    recoveryClass,
    rawCoverage: coverageRatio(rawCovered, required),
    verifiedCoverage: coverageRatio(verifiedCovered, required),
  };
}

export function evaluateRuleTasks(
  tasks: ExperimentTask[],
  options: { recordedAt: string; experimentId?: string }
): { results: RuleScenarioResult[]; summary: RuleExperimentSummary } {
  const recordedAt = assertRecordedAt(options.recordedAt);
  const experimentId = options.experimentId ?? RULE_EXPERIMENT_ID;
  const results = tasks.map(task => evaluateRuleTask(task, { recordedAt, experimentId }));
  return { results, summary: summarizeRuleResults({ experimentId, recordedAt, results }) };
}

function finishRuleResult(input: {
  experimentId: string;
  recordedAt: string;
  scenarioId: string;
  snapshot: ProgressSnapshot;
  requiredRecovery: ExperimentTask['requiredRecovery'];
  constraints: RecoveryConstraints;
  planned: RulePlanningResult;
  planningRuntimeMs: number;
}): RuleScenarioResult {
  if (!input.planned.plan) {
    return {
      experimentId: input.experimentId,
      method: RULE_METHOD_ID,
      recordedAt: input.recordedAt,
      scenarioId: input.scenarioId,
      goalId: input.snapshot.goal.id,
      plannerOutcome: input.planned.outcome,
      recoveryClass: 'NOT_GENERATED',
      reasons: input.planned.reasons,
      missing: input.planned.missing,
      plan: null,
      verifierVerdict: null,
      violationCodes: [],
      notEvaluated: [],
      rawCovered: 0,
      required: input.requiredRecovery.length,
      verifiedCovered: 0,
      planningRuntimeMs: input.planningRuntimeMs,
      verificationRuntimeMs: 0,
    };
  }
  const started = performance.now();
  const verified = verifyRecoveryPlan(input.snapshot, input.planned.plan, input.constraints);
  const verificationRuntimeMs = performance.now() - started;
  const coverage = measureRecoveryCoverage({
    asOf: input.snapshot.asOf,
    plan: input.planned.plan,
    requiredRecovery: input.requiredRecovery,
  });
  const classified = classifyVerifiedRecovery({
    required: input.requiredRecovery.length,
    covered: coverage.covered.length,
    verdict: verified.verdict,
  });
  return {
    experimentId: input.experimentId,
    method: RULE_METHOD_ID,
    recordedAt: input.recordedAt,
    scenarioId: input.scenarioId,
    goalId: input.snapshot.goal.id,
    plannerOutcome: input.planned.outcome,
    recoveryClass: classified.recoveryClass,
    reasons: input.planned.reasons,
    missing: input.planned.missing,
    plan: input.planned.plan,
    verifierVerdict: verified.verdict,
    violationCodes: verified.violations.map(item => item.code),
    notEvaluated: verified.notEvaluated.map(item => item.code),
    rawCovered: coverage.covered.length,
    required: input.requiredRecovery.length,
    verifiedCovered: classified.verifiedCovered,
    planningRuntimeMs: input.planningRuntimeMs,
    verificationRuntimeMs,
  };
}

function coverageRatio(covered: number, required: number): { covered: number; required: number; percentage: number | null } {
  return {
    covered,
    required,
    percentage: required === 0 ? null : covered / required,
  };
}
