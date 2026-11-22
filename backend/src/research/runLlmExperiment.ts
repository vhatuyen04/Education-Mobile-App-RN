/**
 * Phase 3C offline runner.
 * Default mode is a deterministic mock and does not call a model.
 * --live is the only path that reads OPENAI_API_KEY, and it is capped at two scenarios.
 *
 * From backend/:
 *   npx tsx src/research/runLlmExperiment.ts --recorded-at 2026-11-22T00:57:00.000Z --mock
 *   npx tsx src/research/runLlmExperiment.ts --recorded-at <ISO-8601> --live --max-scenarios 2
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { assertRecordedAt } from './experiment/experimentRunner.js';
import { loadManualExperiment } from './experiment/manualExperiment.js';
import { createOpenAiRecoveryClient, type LlmClient, type LlmCompletionRequest } from './llm/llmClient.js';
import { runPairedLlmMethods, summarizeLlmResults, type LlmScenarioResult, type RecoveryTaskView } from './llm/llmRecoveryLoop.js';
import { PROMPT_VERSION } from './llm/recoveryPrompt.js';

const LIVE_SCENARIO_IDS = ['goal-d-ambiguous-schedule', 'goal-b-workload'];
const LIVE_CAP = 2;

const USAGE = [
  'npx tsx src/research/runLlmExperiment.ts --recorded-at <ISO-8601 timestamp> [--mock] [--out research-output/phase3c]',
  'npx tsx src/research/runLlmExperiment.ts --recorded-at <ISO-8601 timestamp> --live --max-scenarios 2',
  'Live calls require OPENAI_API_KEY. OPENAI_MODEL defaults to gpt-4o-mini.',
].join('\n');

async function main() {
  const recordedAtArg = flag('--recorded-at');
  if (!recordedAtArg) {
    console.error(`Missing --recorded-at.\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  let recordedAt: string;
  try {
    recordedAt = assertRecordedAt(recordedAtArg);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid --recorded-at');
    process.exitCode = 1;
    return;
  }
  if (flagPresent('--mock') && flagPresent('--live')) {
    console.error('Choose either --mock or --live.');
    process.exitCode = 1;
    return;
  }
  const live = flagPresent('--live');
  const directory = resolve(flag('--out') ?? join('research-output', 'phase3c'));
  if (basename(directory) === 'phase3a' || basename(directory) === 'phase3b') {
    console.error('Refusing to write into the phase 3A or phase 3B output directory.');
    process.exitCode = 1;
    return;
  }

  const loaded = loadManualExperiment().tasks.map(toView);
  const tasks = live ? selectLive(loaded) : selectMock(loaded);
  const client = live ? liveClient() : emptyPlanClient();
  if (!client) {
    process.exitCode = 1;
    return;
  }
  let modelCalls = 0;
  const counting: LlmClient = {
    provider: client.provider,
    model: client.model,
    async complete(request: LlmCompletionRequest) {
      modelCalls += 1;
      return client.complete(request);
    },
  };

  const results: LlmScenarioResult[] = [];
  for (const task of tasks) {
    const paired = await runPairedLlmMethods({ task, client: counting });
    results.push(paired.oneShot, paired.verified);
  }

  const experimentId = live ? 'phase3c-llm-live' : 'phase3c-llm-mock';
  const oneShot = results.filter(result => result.method === 'DIRECT_CONTEXT_LLM');
  const verified = results.filter(result => result.method === 'DIRECT_CONTEXT_LLM_VERIFIED');
  const summary = {
    experimentId,
    recordedAt,
    datasetId: 'frozen-phase3a-scenarios',
    source: live ? 'live_openai' : 'mock_empty_plan',
    promptVersion: PROMPT_VERSION,
    temperature: 0,
    jsonObject: true,
    maxOutputTokens: 2000,
    provider: client.provider,
    model: client.model,
    scenarios: tasks.map(task => task.scenarioId),
    modelCalls,
    firstGenerationReused: true,
    tokenAccounting:
      'The shared first completion is copied into both methods. Adding the two method token totals double-counts that first call. modelCalls is the number of client completions.',
    estimatedCostUsd: null,
    unknownCountedAsPass: false,
    notRequiredCountedAsRecoverySuccess: false,
    methods: {
      DIRECT_CONTEXT_LLM: summarizeLlmResults(oneShot),
      DIRECT_CONTEXT_LLM_VERIFIED: summarizeLlmResults(verified),
    },
  };

  mkdirSync(directory, { recursive: true });
  const stem = live ? 'phase3c-llm-live' : 'phase3c-llm-mock';
  const tasksPath = join(directory, `${stem}.tasks.json`);
  const resultsPath = join(directory, `${stem}.results.jsonl`);
  const summaryPath = join(directory, `${stem}.summary.json`);
  writeFileSync(
    tasksPath,
    `${JSON.stringify(
      {
        experimentId,
        recordedAt,
        reusableBy: ['direct_context_llm', 'direct_context_llm_verified', 'mcp'],
        tasks,
      },
      null,
      2
    )}\n`
  );
  writeFileSync(
    resultsPath,
    `${results.map(result => JSON.stringify({ experimentId, recordedAt, ...result })).join('\n')}\n`
  );
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  const verifiedSummary = summary.methods.DIRECT_CONTEXT_LLM_VERIFIED;
  const oneShotSummary = summary.methods.DIRECT_CONTEXT_LLM;
  process.stdout.write(
    [
      `experiment ${experimentId}`,
      `source ${summary.source}`,
      `provider ${summary.provider}`,
      `model ${summary.model}`,
      `scenarios ${tasks.length}`,
      `model calls ${modelCalls}`,
      `one-shot final PASS ${oneShotSummary.finalVerifier.PASS} FAIL ${oneShotSummary.finalVerifier.FAIL} UNKNOWN ${oneShotSummary.finalVerifier.UNKNOWN}`,
      `verified final PASS ${verifiedSummary.finalVerifier.PASS} FAIL ${verifiedSummary.finalVerifier.FAIL} UNKNOWN ${verifiedSummary.finalVerifier.UNKNOWN}`,
      `one-shot raw ${oneShotSummary.rawCoverage.covered}/${oneShotSummary.rawCoverage.required}`,
      `one-shot verified coverage ${oneShotSummary.verifiedCoverage.covered}/${oneShotSummary.verifiedCoverage.required}`,
      `verified-mode raw ${verifiedSummary.rawCoverage.covered}/${verifiedSummary.rawCoverage.required}`,
      `verified-mode verified coverage ${verifiedSummary.verifiedCoverage.covered}/${verifiedSummary.verifiedCoverage.required}`,
      `verified-mode average attempts ${verifiedSummary.averageAttempts}`,
      `estimated cost: unknown`,
      `tasks ${tasksPath}`,
      `results ${resultsPath}`,
      `summary ${summaryPath}`,
      '',
    ].join('\n')
  );
}

function toView(task: {
  scenarioId: string;
  snapshot: RecoveryTaskView['snapshot'];
  constraints: RecoveryTaskView['constraints'];
  requiredRecovery: RecoveryTaskView['requiredRecovery'];
}): RecoveryTaskView {
  return {
    scenarioId: task.scenarioId,
    snapshot: task.snapshot,
    constraints: { dailyWorkloadLimitMinutes: task.constraints.dailyWorkloadLimitMinutes ?? null },
    requiredRecovery: task.requiredRecovery,
  };
}

function selectMock(tasks: RecoveryTaskView[]): RecoveryTaskView[] {
  const requested = flag('--max-scenarios');
  if (!requested) return tasks;
  const count = Number(requested);
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('--max-scenarios must be a positive integer');
  }
  return tasks.slice(0, count);
}

function selectLive(tasks: RecoveryTaskView[]): RecoveryTaskView[] {
  const requested = Number(flag('--max-scenarios') ?? String(LIVE_CAP));
  const count = Number.isInteger(requested) && requested > 0 ? Math.min(LIVE_CAP, requested) : LIVE_CAP;
  return LIVE_SCENARIO_IDS.slice(0, count).map(id => {
    const task = tasks.find(item => item.scenarioId === id);
    if (!task) throw new RangeError(`Frozen scenario ${id} is missing`);
    return task;
  });
}

function liveClient(): LlmClient | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
  if (!apiKey) {
    console.error('OPENAI_API_KEY is absent. No live results were written.');
    console.error('Set OPENAI_API_KEY and, if needed, OPENAI_MODEL (default gpt-4o-mini), then run:');
    console.error('npx tsx src/research/runLlmExperiment.ts --recorded-at <ISO-8601 timestamp> --live --max-scenarios 2');
    return null;
  }
  return createOpenAiRecoveryClient({ apiKey, model: process.env.OPENAI_MODEL });
}

function emptyPlanClient(): LlmClient {
  return {
    provider: 'mock',
    model: 'deterministic-empty-plan',
    async complete(request) {
      return {
        text: JSON.stringify({ goalId: goalIdFrom(request.messages.map(message => message.content)), activities: [] }),
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
      };
    },
  };
}

function goalIdFrom(contents: string[]): string {
  for (const content of contents) {
    try {
      const parsed = JSON.parse(content) as {
        snapshot?: { goal?: { id?: string } };
        previousPlan?: { goalId?: string } | null;
      };
      if (typeof parsed.snapshot?.goal?.id === 'string') return parsed.snapshot.goal.id;
      if (typeof parsed.previousPlan?.goalId === 'string') return parsed.previousPlan.goalId;
    } catch {
      continue;
    }
  }
  return 'unknown-goal';
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
}

function flagPresent(name: string): boolean {
  return process.argv.includes(name);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : 'LLM experiment failed';
  console.error(message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]'));
  process.exitCode = 1;
});
