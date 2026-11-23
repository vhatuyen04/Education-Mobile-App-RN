/**
 * Read-only snapshot printer. It selects one goal and prints the progress
 * snapshot JSON. It does not insert, update, delete, migrate, or seed.
 *
 * stdout is only the snapshot. Diagnostics go to stderr and never include a
 * database URL, token, or another user's identity.
 *
 * Usage from backend/:
 *   npx tsx src/research/printProgressSnapshot.ts --goal-id <id> --time-zone Europe/Budapest --as-of YYYY-MM-DD
 */

import 'dotenv/config';

import { mapStoredGoalToSnapshotInput } from '../goals/mapProgressSnapshotRows.js';
import { buildProgressSnapshot } from '../goals/progressSnapshot.js';
import { prisma } from '../utils/prisma.js';

const USAGE =
  'npx tsx src/research/printProgressSnapshot.ts --goal-id <id> --time-zone <IANA zone> --as-of YYYY-MM-DD [--future-horizon 14] [--past-horizon 14]';

async function main() {
  const goalId = flag('--goal-id');
  const timeZone = flag('--time-zone');
  const asOf = flag('--as-of');
  if (!goalId || !timeZone || !asOf) {
    console.error(`Missing arguments.\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const futureHorizonDays = optionalHorizon('--future-horizon');
  const pastHorizonDays = optionalHorizon('--past-horizon');

  const goal = await prisma.goal.findFirst({
    where: { id: goalId },
    select: {
      id: true,
      title: true,
      createdAt: true,
      dueAt: true,
      completed: true,
      failedAt: true,
    },
  });
  if (!goal) {
    console.error(`No goal found for id ${goalId}.`);
    console.error(`After that goal exists, run:\n${USAGE.replace('<id>', goalId)}`);
    process.exitCode = 1;
    return;
  }

  const steps = await prisma.goalStep.findMany({
    where: { goalId: goal.id },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      order: true,
      text: true,
      description: true,
      dueAt: true,
      repeat: true,
      repeatDay: true,
      repeatMonth: true,
      createdAt: true,
      archivedAt: true,
      effectiveFrom: true,
      effectiveUntil: true,
    },
  });
  const completions = steps.length
    ? await prisma.goalStepCompletion.findMany({
        where: { stepId: { in: steps.map(step => step.id) } },
        select: { stepId: true, date: true },
      })
    : [];

  const mapped = mapStoredGoalToSnapshotInput({ goal, steps, completions, timeZone });
  const snapshot = buildProgressSnapshot({
    ...mapped,
    asOf,
    futureHorizonDays,
    pastHorizonDays,
  });
  process.stdout.write(`${JSON.stringify(snapshot)}\n`);
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
}

function optionalHorizon(name: string): number | undefined {
  const value = flag(name);
  if (value == null) return undefined;
  if (!/^\d+$/.test(value)) throw new RangeError(`${name} must be an integer >= 0`);
  return Number(value);
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Request failed';
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-database-url]')
    .replace(/DATABASE_URL=\S+/gi, 'DATABASE_URL=[redacted]');
}

main()
  .catch(error => {
    console.error(publicError(error));
    process.exitCode = 2;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
