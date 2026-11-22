/**
 * Writes the phase-3A manual experiment. It does not call a model, open the
 * database, or read the clock. Pass the experiment timestamp explicitly.
 *
 * From backend/:
 *   npx tsx src/research/runOfflineExperiment.ts --recorded-at 2026-11-22T00:18:00.000Z
 */

import { join } from 'node:path';

import { MANUAL_EXPERIMENT_ID, loadManualExperiment } from './experiment/manualExperiment.js';
import { runExperiment } from './experiment/experimentRunner.js';
import { writeExperimentOutput } from './experiment/writeExperiment.js';

const USAGE =
  'npx tsx src/research/runOfflineExperiment.ts --recorded-at <ISO-8601 timestamp> [--out research-output/phase3a]';

function main() {
  const recordedAt = flag('--recorded-at');
  if (!recordedAt) {
    console.error(`Missing --recorded-at.\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  const directory = flag('--out') ?? join('research-output', 'phase3a');
  const loaded = loadManualExperiment();
  const run = runExperiment({
    experimentId: MANUAL_EXPERIMENT_ID,
    recordedAt,
    tasks: loaded.tasks,
    proposals: loaded.proposals,
  });
  const paths = writeExperimentOutput(directory, run);
  const counts = run.summary.counts;
  const recovery = run.summary.recovery;
  process.stdout.write(
    [
      `experiment ${run.summary.experimentId}`,
      `recordedAt ${run.summary.recordedAt}`,
      `PASS ${counts.PASS}`,
      `FAIL ${counts.FAIL}`,
      `UNKNOWN ${counts.UNKNOWN}`,
      `total ${counts.total}`,
      'unknown counted as pass: no',
      `recovery covered ${recovery.coveredItems}/${recovery.requiredItems}`,
      `recovery scenarios COVERED ${recovery.COVERED}, PARTIAL ${recovery.PARTIAL}, NOT_COVERED ${recovery.NOT_COVERED}, NOT_REQUIRED ${recovery.NOT_REQUIRED}`,
      `tasks ${paths.tasks}`,
      `proposals ${paths.proposals}`,
      `results ${paths.results}`,
      `summary ${paths.summary}`,
      '',
    ].join('\n')
  );
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
}

main();
