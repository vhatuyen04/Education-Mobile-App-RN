/**
 * Bounded recovery loop. One-shot mode makes one generation.
 * Verified mode makes at most three and may revise from verifier feedback.
 * A later unverified plan never replaces an earlier verified candidate.
 */

import { performance } from 'node:perf_hooks';

import { verifyRecoveryPlan, type RecoveryPlan, type VerificationResult } from '../../goals/verifyRecoveryPlan.js';
import { measureRecoveryCoverage } from '../experiment/coverage.js';
import type { RequiredRecoveryItem } from '../experiment/requiredRecovery.js';
import { LLM_MAX_OUTPUT_TOKENS, LLM_TEMPERATURE, redactSecrets, type LlmClient, type LlmCompletion } from './llmClient.js';
import { parseRecoveryPlan } from './parseRecoveryPlan.js';
import {
  PROMPT_VERSION,
  buildInitialMessages,
  buildRevisionMessages,
  snapshotHash,
  type RecoveryTaskView,
} from './recoveryPrompt.js';

export const DATASET_ID = 'frozen-phase3a-scenarios';
export const MAX_LLM_GENERATIONS = 3;

export type LlmMethod = 'DIRECT_CONTEXT_LLM' | 'DIRECT_CONTEXT_LLM_VERIFIED';

export type FinalOutcome =
  | 'VERIFIED_FULL_RECOVERY'
  | 'VERIFIED_PARTIAL_RECOVERY'
  | 'NO_RECOVERY'
  | 'NOT_REQUIRED'
  | 'NO_VERIFIED_PLAN'
  | 'INSUFFICIENT_INFORMATION'
  | 'INFEASIBLE';

export type LlmAttempt = {
  attempt: number;
  rawResponse: string | null;
  parsedPlan: RecoveryPlan | null;
  parseErrors: string[];
  providerError: string | null;
  verifierVerdict: 'PASS' | 'FAIL' | 'UNKNOWN' | null;
  violationCodes: string[];
  notEvaluated: string[];
  rawCovered: number;
  planningLatencyMs: number;
  verificationLatencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: null;
};

export type { RecoveryTaskView } from './recoveryPrompt.js';

export type LlmScenarioResult = {
  datasetId: string;
  scenarioId: string;
  method: LlmMethod;
  provider: string;
  model: string;
  promptVersion: string;
  temperature: number;
  maxOutputTokens: number;
  snapshotHash: string;
  firstGenerationReused: boolean;
  generations: number;
  stopReason: string;
  finalOutcome: FinalOutcome;
  initialVerifierVerdict: 'PASS' | 'FAIL' | 'UNKNOWN' | null;
  finalVerifierVerdict: 'PASS' | 'FAIL' | 'UNKNOWN' | null;
  recommendedPlan: RecoveryPlan | null;
  lastParsedPlan: RecoveryPlan | null;
  rawCovered: number;
  verifiedCovered: number;
  required: number;
  attempts: LlmAttempt[];
  planningLatencyMs: number;
  verificationLatencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  tokensComplete: boolean;
  estimatedCostUsd: null;
};

type Candidate = { plan: RecoveryPlan; covered: number };

export async function runLlmRecovery(input: {
  task: RecoveryTaskView;
  client: LlmClient;
  method: LlmMethod;
  firstGenerationReused?: boolean;
  initialCompletion?: LlmCompletion;
}): Promise<LlmScenarioResult> {
  const maxAttempts = input.method === 'DIRECT_CONTEXT_LLM' ? 1 : MAX_LLM_GENERATIONS;
  if (proveInfeasible(input.task)) {
    return emptyResult(input, { stopReason: proveInfeasible(input.task) as string, finalOutcome: 'INFEASIBLE', generations: 0 });
  }

  const attempts: LlmAttempt[] = [];
  let best: Candidate | null = null;
  let previousSignature: string | null = null;
  let stopReason = 'attempt_budget';
  let terminalOutcome: FinalOutcome | null = null;
  let lastParsed: { plan: RecoveryPlan; covered: number } | null = null;
  let lastViolationMessages: string[] = [];
  let lastNotEvaluatedMessages: string[] = [];
  let lastUncovered: RequiredRecoveryItem[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const messages =
      attempt === 1
        ? buildInitialMessages(input.task)
        : buildRevisionMessages({
            task: input.task,
            previousRaw: attempts[attempts.length - 1]?.rawResponse ?? '',
            previousPlan: attempts[attempts.length - 1]?.parsedPlan ?? null,
            parseErrors: attempts[attempts.length - 1]?.parseErrors ?? [],
            verifierVerdict: attempts[attempts.length - 1]?.verifierVerdict ?? null,
            violationCodes: attempts[attempts.length - 1]?.violationCodes ?? [],
            violationMessages: lastViolationMessages,
            notEvaluated: attempts[attempts.length - 1]?.notEvaluated ?? [],
            notEvaluatedMessages: lastNotEvaluatedMessages,
            uncovered: lastUncovered,
          });
    let completion: LlmCompletion;
    const started = performance.now();
    try {
      completion =
        attempt === 1 && input.initialCompletion
          ? input.initialCompletion
          : await input.client.complete({
              messages,
              temperature: LLM_TEMPERATURE,
              jsonObject: true,
              maxOutputTokens: LLM_MAX_OUTPUT_TOKENS,
            });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'provider_error';
      attempts.push(blankAttempt(attempt, performance.now() - started, redactSecrets(message)));
      stopReason = 'provider_error';
      break;
    }
    const planningLatencyMs = attempt === 1 && input.initialCompletion ? 0 : performance.now() - started;
    const stored: LlmCompletion = { ...completion, text: redactSecrets(completion.text) };
    const signature = planSignature(completion.text);
    const repeated = previousSignature != null && previousSignature === signature;
    const parsed = parseRecoveryPlan(completion.text);
    if (!parsed.ok) {
      attempts.push({
        ...baseAttempt(attempt, stored, planningLatencyMs),
        parsedPlan: null,
        parseErrors: parsed.errors,
        verifierVerdict: null,
        violationCodes: [],
        notEvaluated: [],
        rawCovered: 0,
        verificationLatencyMs: 0,
      });
      previousSignature = signature;
      if (repeated) {
        stopReason = 'stagnation';
        break;
      }
      continue;
    }

    const verifiedStarted = performance.now();
    const verified = verifyRecoveryPlan(input.task.snapshot, parsed.plan, input.task.constraints);
    const coverage = measureRecoveryCoverage({
      asOf: input.task.snapshot.asOf,
      plan: parsed.plan,
      requiredRecovery: input.task.requiredRecovery,
    });
    lastParsed = { plan: parsed.plan, covered: coverage.covered.length };
    lastViolationMessages = verified.violations.map(item => item.message);
    lastNotEvaluatedMessages = verified.notEvaluated.map(item => item.message);
    lastUncovered = coverage.uncovered;
    attempts.push({
      ...baseAttempt(attempt, stored, planningLatencyMs),
      parsedPlan: parsed.plan,
      parseErrors: [],
      verifierVerdict: verified.verdict,
      violationCodes: verified.violations.map(item => item.code),
      notEvaluated: verified.notEvaluated.map(item => item.code),
      rawCovered: coverage.covered.length,
      verificationLatencyMs: performance.now() - verifiedStarted,
    });
    previousSignature = signature;
    if (repeated) {
      stopReason = 'stagnation';
      break;
    }

    if (verified.verdict === 'PASS') {
      if (!best || coverage.covered.length > best.covered) best = { plan: parsed.plan, covered: coverage.covered.length };
      const outcome = outcomeForPass(input.task.requiredRecovery.length, best.covered);
      if (outcome === 'VERIFIED_FULL_RECOVERY' || outcome === 'NOT_REQUIRED' || attempt === maxAttempts) {
        terminalOutcome = outcome;
        stopReason = outcome === 'VERIFIED_FULL_RECOVERY' ? 'verified_full' : outcome === 'NOT_REQUIRED' ? 'not_required' : 'attempt_budget';
        break;
      }
      continue;
    }

    if (verified.verdict === 'UNKNOWN' && unresolvable(verified, input.task)) {
      terminalOutcome = best ? outcomeForPass(input.task.requiredRecovery.length, best.covered) : 'INSUFFICIENT_INFORMATION';
      stopReason = 'insufficient_information';
      break;
    }
  }

  const required = input.task.requiredRecovery.length;
  const finalOutcome = terminalOutcome ?? (best ? outcomeForPass(required, best.covered) : 'NO_VERIFIED_PLAN');
  return {
    ...identity(input),
    generations: attempts.length,
    stopReason,
    finalOutcome,
    initialVerifierVerdict: attempts[0]?.verifierVerdict ?? null,
    finalVerifierVerdict: best ? 'PASS' : attempts[attempts.length - 1]?.verifierVerdict ?? null,
    recommendedPlan: best?.plan ?? null,
    lastParsedPlan: lastParsed?.plan ?? null,
    rawCovered: best ? best.covered : lastParsed?.covered ?? 0,
    verifiedCovered: best ? best.covered : 0,
    required,
    attempts,
    planningLatencyMs: attempts.reduce((sum, item) => sum + item.planningLatencyMs, 0),
    verificationLatencyMs: attempts.reduce((sum, item) => sum + item.verificationLatencyMs, 0),
    ...tokenTotals(attempts),
    estimatedCostUsd: null,
  };
}

export async function runPairedLlmMethods(input: {
  task: RecoveryTaskView;
  client: LlmClient;
}): Promise<{ oneShot: LlmScenarioResult; verified: LlmScenarioResult }> {
  const started = performance.now();
  const first = await input.client.complete({
    messages: buildInitialMessages(input.task),
    temperature: LLM_TEMPERATURE,
    jsonObject: true,
    maxOutputTokens: LLM_MAX_OUTPUT_TOKENS,
  });
  const planningLatencyMs = performance.now() - started;
  const oneShot = await runLlmRecovery({
    task: input.task,
    client: input.client,
    method: 'DIRECT_CONTEXT_LLM',
    firstGenerationReused: true,
    initialCompletion: first,
  });
  const verified = await runLlmRecovery({
    task: input.task,
    client: input.client,
    method: 'DIRECT_CONTEXT_LLM_VERIFIED',
    firstGenerationReused: true,
    initialCompletion: first,
  });
  if (oneShot.attempts[0]) oneShot.attempts[0].planningLatencyMs = planningLatencyMs;
  oneShot.planningLatencyMs = oneShot.attempts.reduce((sum, item) => sum + item.planningLatencyMs, 0);
  if (verified.attempts[0]) verified.attempts[0].planningLatencyMs = planningLatencyMs;
  verified.planningLatencyMs = verified.attempts.reduce((sum, item) => sum + item.planningLatencyMs, 0);
  return { oneShot, verified };
}

export function summarizeLlmResults(results: LlmScenarioResult[]) {
  const outcomes: Record<FinalOutcome, number> = {
    VERIFIED_FULL_RECOVERY: 0,
    VERIFIED_PARTIAL_RECOVERY: 0,
    NO_RECOVERY: 0,
    NOT_REQUIRED: 0,
    NO_VERIFIED_PLAN: 0,
    INSUFFICIENT_INFORMATION: 0,
    INFEASIBLE: 0,
  };
  const initialVerifier = { PASS: 0, FAIL: 0, UNKNOWN: 0, notRun: 0 };
  const finalVerifier = { PASS: 0, FAIL: 0, UNKNOWN: 0, notRun: 0 };
  let rawCovered = 0;
  let verifiedCovered = 0;
  let required = 0;
  let attemptSum = 0;
  let latencySum = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let tokensComplete = results.length > 0;
  for (const result of results) {
    outcomes[result.finalOutcome] += 1;
    addVerdict(initialVerifier, result.initialVerifierVerdict);
    addVerdict(finalVerifier, result.finalVerifierVerdict);
    rawCovered += result.rawCovered;
    verifiedCovered += result.verifiedCovered;
    required += result.required;
    attemptSum += result.generations;
    latencySum += result.planningLatencyMs;
    if (!result.tokensComplete || result.inputTokens == null || result.outputTokens == null) tokensComplete = false;
    else {
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
    }
  }
  return {
    scenarios: results.length,
    outcomes,
    recoverySuccesses: outcomes.VERIFIED_FULL_RECOVERY,
    initialVerifier,
    finalVerifier,
    rawCoverage: { covered: rawCovered, required, percentage: required === 0 ? null : rawCovered / required },
    verifiedCoverage: { covered: verifiedCovered, required, percentage: required === 0 ? null : verifiedCovered / required },
    averageAttempts: results.length === 0 ? null : attemptSum / results.length,
    averagePlanningLatencyMs: results.length === 0 ? null : latencySum / results.length,
    tokenUsage: tokensComplete
      ? { inputTokens, outputTokens, complete: true as const }
      : { inputTokens: null, outputTokens: null, complete: false as const },
    estimatedCostUsd: null,
    unknownCountedAsPass: false as const,
    notRequiredCountedAsRecoverySuccess: false as const,
  };
}

function outcomeForPass(required: number, covered: number): FinalOutcome {
  if (required === 0) return 'NOT_REQUIRED';
  if (covered >= required) return 'VERIFIED_FULL_RECOVERY';
  if (covered === 0) return 'NO_RECOVERY';
  return 'VERIFIED_PARTIAL_RECOVERY';
}

function proveInfeasible(task: RecoveryTaskView): string | null {
  const stepIds = new Set(task.snapshot.steps.map(step => step.id));
  if (task.requiredRecovery.some(item => !stepIds.has(item.stepId))) return 'infeasible_unknown_step';
  const archived = new Set(task.snapshot.steps.filter(step => step.lifecycle === 'archived').map(step => step.id));
  if (task.requiredRecovery.some(item => archived.has(item.stepId))) return 'infeasible_archived_step';
  const deadline = task.snapshot.goal.deadline;
  if (task.requiredRecovery.length > 0 && deadline != null && deadline < task.snapshot.asOf) return 'infeasible_deadline';
  return null;
}

function unresolvable(verified: VerificationResult, task: RecoveryTaskView): boolean {
  const codes = verified.notEvaluated.map(item => item.code);
  if (codes.includes('DEADLINE') || codes.includes('SCHEDULE_KNOWN')) return true;
  const limit = task.constraints.dailyWorkloadLimitMinutes;
  if (codes.includes('WORKLOAD') && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0)) return true;
  return false;
}

function planSignature(raw: string): string {
  const parsed = parseRecoveryPlan(raw);
  return parsed.ok ? JSON.stringify(parsed.plan) : raw.trim();
}

function baseAttempt(attempt: number, completion: LlmCompletion, planningLatencyMs: number) {
  return {
    attempt,
    rawResponse: completion.text,
    providerError: null,
    planningLatencyMs,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    estimatedCostUsd: null as null,
  };
}

function blankAttempt(attempt: number, planningLatencyMs: number, providerError: string): LlmAttempt {
  return {
    attempt,
    rawResponse: null,
    parsedPlan: null,
    parseErrors: [],
    providerError,
    verifierVerdict: null,
    violationCodes: [],
    notEvaluated: [],
    rawCovered: 0,
    planningLatencyMs,
    verificationLatencyMs: 0,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
  };
}

function tokenTotals(attempts: LlmAttempt[]) {
  if (attempts.length === 0 || attempts.some(item => item.inputTokens == null || item.outputTokens == null)) {
    return { inputTokens: null, outputTokens: null, tokensComplete: false };
  }
  return {
    inputTokens: attempts.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0),
    outputTokens: attempts.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0),
    tokensComplete: true,
  };
}

function identity(input: { task: RecoveryTaskView; client: LlmClient; method: LlmMethod; firstGenerationReused?: boolean }) {
  return {
    datasetId: DATASET_ID,
    scenarioId: input.task.scenarioId,
    method: input.method,
    provider: input.client.provider,
    model: input.client.model,
    promptVersion: PROMPT_VERSION,
    temperature: LLM_TEMPERATURE,
    maxOutputTokens: LLM_MAX_OUTPUT_TOKENS,
    snapshotHash: snapshotHash(input.task.snapshot),
    firstGenerationReused: input.firstGenerationReused === true,
  };
}

function emptyResult(
  input: { task: RecoveryTaskView; client: LlmClient; method: LlmMethod; firstGenerationReused?: boolean },
  extra: { stopReason: string; finalOutcome: FinalOutcome; generations: number }
): LlmScenarioResult {
  return {
    ...identity(input),
    generations: extra.generations,
    stopReason: extra.stopReason,
    finalOutcome: extra.finalOutcome,
    initialVerifierVerdict: null,
    finalVerifierVerdict: null,
    recommendedPlan: null,
    lastParsedPlan: null,
    rawCovered: 0,
    verifiedCovered: 0,
    required: input.task.requiredRecovery.length,
    attempts: [],
    planningLatencyMs: 0,
    verificationLatencyMs: 0,
    inputTokens: null,
    outputTokens: null,
    tokensComplete: false,
    estimatedCostUsd: null,
  };
}

function addVerdict(
  bucket: { PASS: number; FAIL: number; UNKNOWN: number; notRun: number },
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN' | null
) {
  if (verdict == null) bucket.notRun += 1;
  else bucket[verdict] += 1;
}
