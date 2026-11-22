import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProgressSnapshot, type ProgressSnapshot } from '../src/goals/progressSnapshot.ts';
import type { RecoveryActivity, RecoveryPlan } from '../src/goals/verifyRecoveryPlan.ts';
import { LlmProviderError, type LlmClient, type LlmCompletion, type LlmMessage } from '../src/research/llm/llmClient.ts';
import { runLlmRecovery, runPairedLlmMethods } from '../src/research/llm/llmRecoveryLoop.ts';
import { parseRecoveryPlan } from '../src/research/llm/parseRecoveryPlan.ts';
import { buildInitialMessages, type RecoveryTaskView } from '../src/research/llm/recoveryPrompt.ts';

const TWO = [
  { stepId: 'step-study', missedDate: '2026-11-19' },
  { stepId: 'step-study', missedDate: '2026-11-20' },
];

function studySnapshot(deadline: string | null = '2026-11-28'): ProgressSnapshot {
  return buildProgressSnapshot({
    goal: {
      id: 'goal-study',
      title: 'Study',
      createdAt: '2026-11-16',
      deadline,
      completed: false,
      failedAt: null,
    },
    steps: [
      {
        id: 'step-study',
        order: 0,
        text: 'Study',
        description: 'Read the chapter',
        dueAt: null,
        repeat: 'daily',
        repeatDay: null,
        repeatMonth: null,
      },
    ],
    completions: [
      { stepId: 'step-study', date: '2026-11-16' },
      { stepId: 'step-study', date: '2026-11-17' },
      { stepId: 'step-study', date: '2026-11-18' },
    ],
    asOf: '2026-11-21',
  });
}

function task(input?: {
  constraints?: RecoveryTaskView['constraints'];
  required?: RecoveryTaskView['requiredRecovery'];
  deadline?: string | null;
}): RecoveryTaskView {
  return {
    scenarioId: 'unit-study',
    snapshot: studySnapshot(input?.deadline),
    constraints: input?.constraints ?? { dailyWorkloadLimitMinutes: 60 },
    requiredRecovery: input?.required ?? TWO,
  };
}

function act(activityId: string, date: string, timed = true): RecoveryActivity {
  return {
    activityId,
    stepId: 'step-study',
    date,
    ...(timed ? { durationMinutes: 30, startMinuteOfDay: 480 } : {}),
  };
}

function done(timed = true): RecoveryActivity[] {
  return [act('done-16', '2026-11-16', timed), act('done-17', '2026-11-17', timed), act('done-18', '2026-11-18', timed)];
}

function plan(activities: RecoveryActivity[]): RecoveryPlan {
  return { goalId: 'goal-study', activities };
}

function reply(value: unknown, tokens?: { input: number; output: number }): LlmCompletion {
  return {
    text: typeof value === 'string' ? value : JSON.stringify(value),
    inputTokens: tokens?.input ?? null,
    outputTokens: tokens?.output ?? null,
    estimatedCostUsd: null,
  };
}

function scripted(responses: Array<LlmCompletion | Error>): LlmClient & { calls: LlmMessage[][] } {
  const calls: LlmMessage[][] = [];
  return {
    provider: 'mock',
    model: 'scripted',
    calls,
    async complete({ messages }) {
      calls.push(messages);
      const next = responses.shift();
      if (!next) throw new Error('scripted client exhausted');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const full = plan([...done(), act('recover-19', '2026-11-21'), { ...act('recover-20', '2026-11-22'), startMinuteOfDay: 540 }]);
const partial = plan([...done(), act('recover-19', '2026-11-21')]);
const past = (id: string) =>
  plan([...done(), act(id, '2026-11-19'), { ...act(`later-${id}`, '2026-11-21'), startMinuteOfDay: 540 }]);

test('a valid plan is accepted on the first attempt', async () => {
  const client = scripted([reply(full, { input: 10, output: 4 })]);
  const result = await runLlmRecovery({ task: task(), client, method: 'DIRECT_CONTEXT_LLM_VERIFIED' });
  assert.equal(client.calls.length, 1);
  assert.equal(result.generations, 1);
  assert.deepEqual(result.attempts.map(item => item.attempt), [1]);
  assert.equal(result.finalOutcome, 'VERIFIED_FULL_RECOVERY');
  assert.equal(result.initialVerifierVerdict, 'PASS');
  assert.equal(result.finalVerifierVerdict, 'PASS');
  assert.equal(result.verifiedCovered, 2);
  assert.equal(result.rawCovered, 2);
  assert.equal(result.inputTokens, 10);
  assert.equal(result.outputTokens, 4);
  assert.equal(result.estimatedCostUsd, null);
  const prompt = JSON.stringify(client.calls[0]);
  assert.match(prompt, /step-study/);
  assert.match(prompt, /Read the chapter/);
  assert.doesNotMatch(prompt, /sk-/);
  assert.doesNotMatch(prompt, /expectedVerdict/);
});

test('a failed plan can be revised into a verified plan', async () => {
  const client = scripted([reply(past('bad-1')), reply(full)]);
  const result = await runLlmRecovery({ task: task(), client, method: 'DIRECT_CONTEXT_LLM_VERIFIED' });
  assert.equal(result.generations, 2);
  assert.equal(result.attempts[0]?.verifierVerdict, 'FAIL');
  assert.deepEqual(result.attempts[0]?.violationCodes, ['PAST_DATE']);
  assert.equal(result.finalOutcome, 'VERIFIED_FULL_RECOVERY');
  assert.equal(result.finalVerifierVerdict, 'PASS');
  assert.match(JSON.stringify(client.calls[1]), /PAST_DATE/);
  assert.match(JSON.stringify(client.calls[1]), /violationCodes/);
});

test('three different failed plans stop at the generation budget', async () => {
  const client = scripted([reply(past('bad-1')), reply(past('bad-2')), reply(past('bad-3'))]);
  const result = await runLlmRecovery({ task: task(), client, method: 'DIRECT_CONTEXT_LLM_VERIFIED' });
  assert.equal(client.calls.length, 3);
  assert.deepEqual(result.attempts.map(item => item.attempt), [1, 2, 3]);
  assert.equal(result.finalOutcome, 'NO_VERIFIED_PLAN');
  assert.notEqual(result.finalOutcome, 'INFEASIBLE');
  assert.equal(result.verifiedCovered, 0);
  assert.equal(result.recommendedPlan, null);
  assert.equal(result.rawCovered, 1);
  assert.equal(result.stopReason, 'attempt_budget');
});

test('missing workload information stops as insufficient without another generation', async () => {
  const open = plan([...done(false), act('later', '2026-11-21', false)]);
  const client = scripted([reply(open), reply(full), reply(full)]);
  const result = await runLlmRecovery({
    task: task({ constraints: {} }),
    client,
    method: 'DIRECT_CONTEXT_LLM_VERIFIED',
  });
  assert.equal(client.calls.length, 1);
  assert.equal(result.generations, 1);
  assert.equal(result.initialVerifierVerdict, 'UNKNOWN');
  assert.ok(result.attempts[0]?.notEvaluated.includes('WORKLOAD'));
  assert.equal(result.finalOutcome, 'INSUFFICIENT_INFORMATION');
  assert.equal(result.verifiedCovered, 0);
  assert.equal(result.stopReason, 'insufficient_information');
});

test('a missing proposal duration is sent back with the unevaluated check message', async () => {
  const open = plan([...done(false), act('later-21', '2026-11-21', false), act('later-22', '2026-11-22', false)]);
  const client = scripted([reply(open), reply(full)]);
  const result = await runLlmRecovery({ task: task(), client, method: 'DIRECT_CONTEXT_LLM_VERIFIED' });
  assert.equal(result.generations, 2);
  assert.equal(result.attempts[0]?.verifierVerdict, 'UNKNOWN');
  assert.ok(result.attempts[0]?.notEvaluated.includes('WORKLOAD'));
  assert.match(JSON.stringify(client.calls[1]), /no durationMinutes/);
  assert.equal(result.finalOutcome, 'VERIFIED_FULL_RECOVERY');
  assert.equal(result.verifiedCovered, 2);
});

test('malformed JSON is recorded as a parse error and can be corrected', async () => {
  assert.equal(
    parseRecoveryPlan('{"goalId":"goal-study","activities":[{"activityId":"a","stepId":"step-study","date":"2026-11-21","durationMinutes":"30"}]}').ok,
    false
  );
  assert.equal(parseRecoveryPlan('{"goalId":"goal-study","activities":[]}').ok, true);
  const client = scripted([reply('nope'), reply(full)]);
  const result = await runLlmRecovery({ task: task(), client, method: 'DIRECT_CONTEXT_LLM_VERIFIED' });
  assert.equal(result.generations, 2);
  assert.deepEqual(result.attempts[0]?.parseErrors, ['invalid_json']);
  assert.equal(result.attempts[0]?.verifierVerdict, null);
  assert.equal(result.finalOutcome, 'VERIFIED_FULL_RECOVERY');
  assert.match(JSON.stringify(client.calls[1]), /invalid_json/);
});

test('an identical invalid response stops before the third generation', async () => {
  const client = scripted([reply('nope'), reply('nope'), reply(full)]);
  const result = await runLlmRecovery({ task: task(), client, method: 'DIRECT_CONTEXT_LLM_VERIFIED' });
  assert.equal(client.calls.length, 2);
  assert.equal(result.generations, 2);
  assert.equal(result.stopReason, 'stagnation');
  assert.equal(result.finalOutcome, 'NO_VERIFIED_PLAN');
  assert.equal(result.verifiedCovered, 0);
});

test('a passing plan that covers only part of the missed work stays partial', async () => {
  const client = scripted([reply(partial)]);
  const result = await runLlmRecovery({ task: task(), client, method: 'DIRECT_CONTEXT_LLM' });
  assert.equal(client.calls.length, 1);
  assert.equal(result.finalVerifierVerdict, 'PASS');
  assert.equal(result.finalOutcome, 'VERIFIED_PARTIAL_RECOVERY');
  assert.equal(result.verifiedCovered, 1);
  assert.equal(result.required, 2);
});

test('a passing plan with no recovered misses is not successful recovery', async () => {
  const client = scripted([reply(plan([]))]);
  const result = await runLlmRecovery({ task: task(), client, method: 'DIRECT_CONTEXT_LLM' });
  assert.equal(result.finalVerifierVerdict, 'PASS');
  assert.equal(result.rawCovered, 0);
  assert.equal(result.verifiedCovered, 0);
  assert.equal(result.finalOutcome, 'NO_RECOVERY');
  assert.notEqual(result.finalOutcome, 'VERIFIED_FULL_RECOVERY');
});

test('a later empty pass does not replace an earlier verified partial plan', async () => {
  const client = scripted([reply(partial), reply(past('bad-2')), reply(plan([]))]);
  const result = await runLlmRecovery({ task: task(), client, method: 'DIRECT_CONTEXT_LLM_VERIFIED' });
  assert.equal(result.generations, 3);
  assert.equal(result.finalOutcome, 'VERIFIED_PARTIAL_RECOVERY');
  assert.equal(result.verifiedCovered, 1);
  assert.equal(result.rawCovered, 1);
  assert.equal(result.finalVerifierVerdict, 'PASS');
  assert.deepEqual(
    result.recommendedPlan?.activities.map(item => item.activityId),
    partial.activities.map(item => item.activityId)
  );
});

test('a provider failure counts as one attempt and does not retry', async () => {
  const client = scripted([new LlmProviderError('sk-testkey rejected'), reply(full)]);
  const result = await runLlmRecovery({ task: task(), client, method: 'DIRECT_CONTEXT_LLM_VERIFIED' });
  assert.equal(client.calls.length, 1);
  assert.equal(result.generations, 1);
  assert.equal(result.stopReason, 'provider_error');
  assert.equal(result.finalOutcome, 'NO_VERIFIED_PLAN');
  assert.equal(result.verifiedCovered, 0);
  assert.equal(result.tokensComplete, false);
  assert.doesNotMatch(result.attempts[0]?.providerError ?? '', /sk-testkey/);
});

test('one-shot and verified modes share the first generation and then diverge', async () => {
  const client = scripted([reply(past('bad-1')), reply(full)]);
  const paired = await runPairedLlmMethods({ task: task(), client });
  assert.equal(client.calls.length, 2);
  assert.equal(paired.oneShot.method, 'DIRECT_CONTEXT_LLM');
  assert.equal(paired.oneShot.generations, 1);
  assert.equal(paired.oneShot.finalVerifierVerdict, 'FAIL');
  assert.equal(paired.oneShot.verifiedCovered, 0);
  assert.equal(paired.verified.method, 'DIRECT_CONTEXT_LLM_VERIFIED');
  assert.equal(paired.verified.generations, 2);
  assert.equal(paired.verified.initialVerifierVerdict, 'FAIL');
  assert.equal(paired.verified.finalVerifierVerdict, 'PASS');
  assert.equal(paired.verified.finalOutcome, 'VERIFIED_FULL_RECOVERY');
  assert.equal(paired.oneShot.firstGenerationReused, true);
  assert.equal(paired.verified.firstGenerationReused, true);
  assert.equal(paired.oneShot.attempts[0]?.rawResponse, paired.verified.attempts[0]?.rawResponse);
  assert.equal(paired.oneShot.attempts.length, 1);
  assert.deepEqual(paired.verified.attempts.map(item => item.attempt), [1, 2]);
});

test('a deadline before asOf with required work is infeasible before any model call', async () => {
  const client = scripted([reply(full)]);
  const result = await runLlmRecovery({
    task: task({ deadline: '2026-11-01' }),
    client,
    method: 'DIRECT_CONTEXT_LLM_VERIFIED',
  });
  assert.equal(client.calls.length, 0);
  assert.equal(result.generations, 0);
  assert.equal(result.finalOutcome, 'INFEASIBLE');
  assert.equal(result.stopReason, 'infeasible_deadline');
});

test('zero required misses are not counted as a recovery success', async () => {
  const client = scripted([reply(plan([]))]);
  const result = await runLlmRecovery({
    task: task({ required: [] }),
    client,
    method: 'DIRECT_CONTEXT_LLM',
  });
  assert.equal(result.finalVerifierVerdict, 'PASS');
  assert.equal(result.finalOutcome, 'NOT_REQUIRED');
  assert.equal(result.required, 0);
  assert.equal(result.verifiedCovered, 0);
});

test('the initial prompt labels a missing workload limit as unknown', () => {
  const messages = buildInitialMessages(task({ constraints: {} }));
  const user = messages.find(message => message.role === 'user')?.content ?? '';
  const system = messages.find(message => message.role === 'system')?.content ?? '';
  assert.match(system, /JSON/);
  assert.match(user, /"dailyWorkloadLimitMinutes":null/);
  assert.match(user, /proposalsNotFacts/);
  assert.match(user, /"optionalPreferences":null/);
  assert.match(user, /"goalDescription":null/);
  assert.match(user, /step-study/);
  assert.doesNotMatch(user, /expectedVerdict/);
  assert.doesNotMatch(`${system}\n${user}`, /sk-/);
});
