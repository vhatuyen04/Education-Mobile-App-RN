import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod/v4';
import { generateGoalPlan } from '../src/goals/generateGoalPlan.ts';
import { goalModelResponse, goalPlanMessages, goalModelSchedule } from '../src/goals/goalModelContract.ts';

const todayCivil = '2026-11-25';
const cleanup = 'Organize my laptop files and remove unnecessary downloads by December 20, 2026. I have no fixed routine or recurring schedule.';
const study = 'Study mathematics every day except Sunday for the next 4 weeks. Study literature every day except Monday for the same 4 weeks.';
const action = (id: number, label: string, explicitSchedule: unknown = null) => ({ id, label, explicitSchedule });
const step = (text: string, actionIds: number[], schedule: unknown = { type: 'none' }) => ({ text, actionIds, schedule, description: 'Complete the work.', durationMinutes: null as number | null });
const DAY = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const weekdays = (...days: number[]) => ({ type: 'weekdays' as const, days: days.map(day => DAY[day]) });
const daily = { type: 'repeat', repeat: 'daily' };
const unrestricted = [action(1, 'Practice')];
const noRoutine = { type: 'nonrecurring' };
const actions = [action(12, 'File organization', noRoutine), action(41, 'Download cleanup', noRoutine)];
const combined = step('Ranger les fichiers et supprimer les t?l?chargements inutiles', [12, 41]);
function draft(actions: ReturnType<typeof action>[], steps: ReturnType<typeof step>[], deadline = '2026-12-20') {
  return { ok: true, message: '', questions: [], suggestion: { actions, steps, deadline, deadlineSource: 'requested', title: 'My goal',
    description: 'An editable plan.', field: 'Academy', expectation: '', requirement: '', difficultyScore: 25, difficultyConfidence: 0.8,
    difficultyReason: 'Routine work.', rankingEligible: false, rankingEligibilityReason: 'Personal goal.' } };
}
async function run(prompt: string, outputs: unknown[], window = {}) {
  let calls = 0, finalized = 0;
  const events: string[] = [];
  const result = await generateGoalPlan({
    messages: goalPlanMessages(prompt, todayCivil, undefined, 'Normal', { name: null, email: '' }), window: { todayCivil, ...window },
    requestModel: async messages => {
      assert.ok(messages.some(message => message.content.includes(prompt)));
      const output = outputs[Math.min(calls++, outputs.length - 1)];
      return typeof output === 'string' ? output : JSON.stringify(output);
    },
    finalize: async suggestion => { finalized++; return suggestion; },
    logRepair: event => events.push(event.status),
  });
  return { result, calls, finalized, events };
}

test('Test 1 associates independent exclusions by ID even after reordering and paraphrasing', async () => {
  const output = draft([action(19, 'Mathematics', weekdays(1, 2, 3, 4, 5, 6)), action(3, 'Literature', weekdays(0, 2, 3, 4, 5, 6))],
    [step('Annotate a passage', [3], weekdays(0, 2, 3, 4, 5, 6)), step('Solve a problem set', [19], weekdays(1, 2, 3, 4, 5, 6))], '2026-12-23');
  const { result, calls } = await run(study, [output]);
  assert.ok(result.ok && 'steps' in result.value);
  assert.equal(calls, 1);
  assert.equal(result.value.deadline, '2026-12-23');
  result.value.steps.forEach(({ schedule }, i) => {
    assert.ok(schedule.type === 'repeat' && schedule.repeat === 'custom');
    const expected = [];
    for (let offset = 0; offset <= 28; offset++) {
      const day = new Date(Date.UTC(2026, 10, 25 + offset));
      if (day.getUTCDay() !== [1, 0][i]) expected.push(day.toISOString().slice(0, 10));
    }
    assert.deepEqual(schedule.customDates, expected);
  });
});

for (const steps of [[combined], [step('Classer', [12]), step('Supprimer', [41], { type: 'once', due: '2026-12-01' })]]) {
  test('Test 7 covers both actions in ' + steps.length + ' editable step(s)', async () => {
    const { result, calls } = await run(cleanup, [draft(actions, steps)]);
    assert.ok(result.ok && 'steps' in result.value);
    assert.equal(calls, 1);
    assert.equal(result.value.deadline, '2026-12-20');
    assert.deepEqual(result.value.steps.map(s => s.schedule), steps.map(s => s.schedule ?? { type: 'none' }));
  });
}
test('repair covers an omitted action while retaining IDs across rewording', async () => {
  const incomplete = draft(actions, [step('Classer', [12])]);
  const repaired = draft(actions.map(a => ({ ...a, label: 'Rephrased ' + a.id })), [combined]);
  assert.deepEqual((await run(cleanup, [incomplete, repaired])).events, ['attempted', 'succeeded']);
  const dropped = draft([actions[0]], [step('Classer', [12])]);
  assert.equal((await run(cleanup, [incomplete, dropped])).finalized, 0);
});
for (const [name, output] of [
  ['unknown ID', draft(actions, [step('Work', [12, 100])])],
  ['duplicate IDs', draft([actions[0], actions[0]], [step('Work', [12])])],
  ['repeated references', draft(actions, [step('Work', [12, 12, 41])])],
  ['null step schedule despite explicit action timing', draft([action(1, 'A', weekdays(1, 3))], [step('A', [1], null)])],
  ['duplicated weekday', draft(unrestricted, [step('Work', [1], weekdays(1, 1))])],
  ['no occurrence in window', draft(unrestricted, [step('Work', [1], weekdays(0, 1))], todayCivil)],
  ['expanded schedule exceeds 2000', draft(unrestricted, [step('Work', [1], weekdays(1, 2, 3, 4, 5))], '2050-12-20')],
  ['invalid date', draft(unrestricted, [step('Work', [1])], '2026-11-31')],
  ['impossible leap day', draft(unrestricted, [step('Work', [1])], '2027-02-29')],
  ['malformed JSON', '{'],
] as const) {
  test('invalid structure cannot finalize: ' + name, async () => {
    const { calls, finalized, result } = await run(study, [output]);
    assert.equal(result.ok, false); assert.equal(calls, 2); assert.equal(finalized, 0);
  });
}
test('model-selected weekly frequency and per-session duration reach the draft', async () => {
  const output = draft(unrestricted, [{ ...step('Five sessions a week', [1], weekdays(1, 2, 3, 4, 5)), durationMinutes: 30 }]);
  const { result } = await run('Improve my fitness', [output]);
  assert.ok(result.ok && 'steps' in result.value);
  const [s] = result.value.steps;
  assert.equal(s.durationMinutes, 30);
  assert.ok(s.schedule.type === 'repeat' && s.schedule.repeat === 'custom');
  assert.equal(s.schedule.customDates.filter(d => d >= '2026-11-30' && d <= '2026-12-06').length, 5);
});
test('manual deadline conflict requires a choice, then the chosen field governs', async () => {
  const output = draft(actions, [combined]);
  const manual = { requestedDeadline: '2026-12-28' };
  const { result, finalized } = await run(cleanup, [output], manual);
  assert.ok(result.ok && 'planDeadline' in result.value && result.value.planDeadline === '2026-12-20');
  assert.equal(finalized, 0);
  const confirmed = await run(cleanup, [output], { ...manual, deadlineConfirmed: true });
  assert.ok(confirmed.result.ok && 'steps' in confirmed.result.value);
  assert.equal(confirmed.result.value.deadline, manual.requestedDeadline);
  output.suggestion.deadlineSource = 'proposed';
  assert.equal((await run('Organize my laptop', [output], manual)).finalized, 1);
});
test('a model deadline is stored unchanged, including a real leap day', async () => {
  const review = draft(unrestricted, [step('Review achievements', [1], { type: 'repeat', repeat: 'yearly', repeatMonth: 12, repeatDay: 1 })], '2027-12-01');
  const named = await run('Review my achievements every December 1, with a goal deadline of December 1, 2027.', [review]);
  assert.ok(named.result.ok && 'steps' in named.result.value);
  assert.equal(named.result.value.deadline, '2027-12-01');
  const leap = draft(unrestricted, [step('Practice', [1])], '2028-02-29');
  const accepted = await run('Practice through the leap day.', [leap]);
  assert.ok(accepted.result.ok && 'steps' in accepted.result.value);
  assert.equal(accepted.result.value.deadline, '2028-02-29');
  const [system, user] = goalPlanMessages(study, todayCivil, undefined, 'Normal', { name: null, email: '' });
  assert.ok(system.content.includes('broad or unmeasurable one') && system.content.includes('still return the plan'));
  assert.ok(system.content.includes('A desired outcome that is broad or unmeasurable is still a topic.'));
  assert.ok(user.content.includes('YYYY-MM-DD') && user.content.includes('real date'));
  const field = goalPlanMessages(study, todayCivil, '2026-12-15', 'Normal', { name: null, email: '' })[1].content;
  const chosen = goalPlanMessages(study, todayCivil, '2026-12-15', 'Normal', { name: null, email: '' }, 'planner', true)[1].content;
  assert.ok(field.includes('Deadline: 2026-12-15') && field.includes('not a reason to ask for clarification'));
  assert.ok(chosen.includes('The user chose the Deadline field') && chosen.includes('2026-12-15'));
});
test('one structural repair handles invalid JSON and clarifications skip finalization', async () => {
  assert.deepEqual((await run(cleanup, ['{', draft(actions, [combined])])).events, ['attempted', 'succeeded']);
  const ask = await run('?', [{ ok: false, suggestion: null, message: 'Which goal?', questions: ['What would you like to achieve?'] }]);
  assert.equal(ask.result.ok, true); assert.equal(ask.finalized, 0); assert.equal(ask.calls, 1);
});
test('a clarification with an empty message is repaired into a starter plan', async () => {
  const repairs: string[] = [];
  let calls = 0;
  const plan = draft(unrestricted, [step('Practice one small habit', [1])], '2027-06-01');
  const result = await generateGoalPlan({
    messages: goalPlanMessages('Build a better daily habit.', todayCivil, '2027-06-01', 'Normal', { name: null, email: '' }),
    window: { todayCivil, requestedDeadline: '2027-06-01' },
    requestModel: async messages => {
      calls += 1;
      if (calls === 2) repairs.push(messages.map(message => message.content).join('\n'));
      const output = calls === 1
        ? { ok: false, suggestion: null, message: '', questions: ['What activity do you want?'] }
        : plan;
      return JSON.stringify(output);
    },
    finalize: async suggestion => suggestion,
    logRepair: () => undefined,
  });
  assert.equal(calls, 2);
  assert.ok(result.ok && 'steps' in result.value);
  assert.equal(result.value.steps.length, 1);
  assert.match(repairs[0] ?? '', /short editable starter plan/);
  assert.match(repairs[0] ?? '', /message must be one non-empty sentence/);
});
test('practice dates named beside the deadline stay in the plan', async () => {
  const plan = draft(unrestricted, [step('Practice speaking', [1], { type: 'repeat', repeat: 'custom', customDates: ['2026-11-27', '2026-11-29', '2026-12-02'] })], '2026-12-02');
  plan.suggestion.description = 'Practice on November 27, November 29, and December 2, 2026.';
  const { result, calls } = await run('Practice on three dates and finish on the last one.', [plan], { requestedDeadline: '2026-12-02' });
  assert.equal(calls, 1);
  assert.ok(result.ok && 'steps' in result.value);
  assert.equal(result.value.deadline, '2026-12-02');
});
test('provider schema rejects contradictory selectors', () => {
  assert.equal(goalModelSchedule.safeParse({ ...weekdays(0, 1), repeatDay: 0 }).success, false);
});

test('serialized schedule branches and prompt examples start with type', () => {
  const schema = z.toJSONSchema(goalModelResponse, { target: 'draft-7' });
  const unions: Array<{ path: string; branches: Array<{ properties?: Record<string, { const?: string }> }> }> = [];
  const visit = (node: unknown, path: string) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}.${index}`));
      return;
    }
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.anyOf) && record.anyOf.some((branch: any) => branch?.properties?.type?.const === 'weekdays')) {
      unions.push({ path, branches: record.anyOf });
    }
    for (const [key, value] of Object.entries(record)) visit(value, `${path}.${key}`);
  };
  visit(schema, '$');
  const stepUnion = unions.find(union => union.path.includes('steps'));
  assert.ok(stepUnion);
  assert.ok(unions.length >= 2);
  for (const union of unions) {
    for (const branch of union.branches) {
      assert.equal(Object.keys(branch.properties ?? {})[0], 'type');
    }
  }
  const [system] = goalPlanMessages(study, todayCivil, undefined, 'Normal', { name: null, email: '' });
  const examples = JSON.parse(system.content.match(/step schedule shapes, with type as the first property: (\[.*?\])\./)![1]) as Array<Record<string, unknown>>;
  assert.equal(examples.length, stepUnion.branches.length);
  examples.forEach((example, index) => {
    const branch = stepUnion.branches[index];
    assert.equal(example.type, branch.properties?.type?.const);
    assert.deepEqual(Object.keys(example), Object.keys(branch.properties ?? {}));
    if (branch.properties?.repeat?.const) assert.equal(example.repeat, branch.properties.repeat.const);
  });
});
test('intensity guidance applies only to flexible choices', () => {
  for (const [mode, guidance] of [['Light', 'manageable'], ['Normal', 'balanced workload'], ['Hard', 'progression in complexity']] as const) {
    const [system, user] = goalPlanMessages(study, todayCivil, undefined, mode, { name: null, email: '' });
    assert.ok(system.content.includes(guidance) && system.content.includes('identical plans'));
    assert.ok(user.content.includes(study) && user.content.includes(mode));
  }
});

function datesExcept(excluded: number[]) {
  const expected = [];
  for (let offset = 0; offset <= 28; offset++) {
    const day = new Date(Date.UTC(2026, 10, 25 + offset));
    if (!excluded.includes(day.getUTCDay())) expected.push(day.toISOString().slice(0, 10));
  }
  return expected;
}
const weeklyDay = (repeatDay: number) => ({ type: 'repeat' as const, repeat: 'weekly' as const, repeatDay: DAY[repeatDay] });

test('stated timing replaces a conflicting step schedule and separates incompatible actions', async () => {
  const weeklyOnExcludedDay = draft(
    [action(1, 'Mathematics', weekdays(1, 2, 3, 4, 5, 6)), action(2, 'Literature', weekdays(0, 2, 3, 4, 5, 6))],
    [step('Study mathematics every day except Sunday', [1], weeklyDay(0)), step('Study literature every day except Monday', [2], weeklyDay(1))],
    '2026-12-23',
  );
  const separated = await run('Practice two subjects on different days.', [weeklyOnExcludedDay]);
  assert.equal(separated.calls, 1);
  assert.ok(separated.result.ok && 'steps' in separated.result.value);
  separated.result.value.steps.forEach((item, index) => {
    assert.ok(item.schedule.type === 'repeat' && item.schedule.repeat === 'custom');
    assert.deepEqual(item.schedule.customDates, datesExcept([index === 0 ? 0 : 1]));
  });
  const combined = draft(
    [action(1, 'A', weekdays(1, 2)), action(2, 'B', weekdays(1, 3))],
    [step('Work', [1, 2], daily)],
  );
  const split = await run('Do both activities.', [combined]);
  assert.ok(split.result.ok && 'steps' in split.result.value);
  assert.deepEqual(split.result.value.steps.map(item => item.text), ['A', 'B']);
  assert.ok(split.result.value.steps.every(item => item.schedule.type === 'repeat' && item.schedule.repeat === 'custom'));
});

test('an unstated schedule stays under model control, and a no-routine action stays unscheduled', async () => {
  const open = await run('Improve my fitness', [draft(unrestricted, [step('Practice', [1])])]);
  assert.ok(open.result.ok && 'steps' in open.result.value);
  assert.deepEqual(open.result.value.steps[0].schedule, { type: 'none' });
  const routine = await run(cleanup, [draft(actions, [step('Work', [12, 41], daily)])]);
  assert.equal(routine.calls, 1);
  assert.ok(routine.result.ok && 'steps' in routine.result.value);
  assert.deepEqual(routine.result.value.steps[0].schedule, { type: 'none' });
});

test('repair cannot erase explicit timing or move a valid requested deadline', async () => {
  const incomplete = draft(actions, [step('File cleanup', [12])]);
  const changed = draft(actions.map(a => ({ ...a, explicitSchedule: null })), [step('Both tasks', [12, 41], daily)]);
  const preserved = await run(cleanup, [incomplete, changed]);
  assert.equal(preserved.finalized, 1);
  assert.ok(preserved.result.ok && 'steps' in preserved.result.value);
  assert.deepEqual(preserved.result.value.steps[0].schedule, { type: 'none' });
  const repaired = draft(actions, [combined], '2027-01-01');
  const { result } = await run(cleanup, [incomplete, repaired]);
  assert.ok(result.ok && 'steps' in result.value);
  assert.equal(result.value.deadline, '2026-12-20');
});

test('per-weekday copies of one activity collapse to that activity schedule', async () => {
  const session = (text: string, actionId: number, day: number, description: string) => ({
    ...step(text, [actionId], weeklyDay(day)), durationMinutes: 120, description,
  });
  const mathDays = [1, 2, 3, 4, 5, 6];
  const literatureDays = [0, 2, 3, 4, 5, 6];
  const output = draft(
    [action(1, 'Mathematics', weekdays(...mathDays)), action(2, 'Literature', weekdays(...literatureDays))],
    [
      ...mathDays.map(day => session('Study mathematics for 120 minutes.', 1, day, 'Focused mathematics.')),
      ...literatureDays.map(day => session('Study literature for 120 minutes.', 2, day, 'Focused literature.')),
    ],
    '2026-12-23',
  );
  const { result, calls } = await run('Practice two subjects on different days.', [output]);
  assert.equal(calls, 1);
  assert.ok(result.ok && 'steps' in result.value);
  assert.deepEqual(result.value.steps.map(item => item.text), [
    'Study mathematics for 120 minutes.',
    'Study literature for 120 minutes.',
  ]);
  assert.deepEqual(result.value.steps.map(item => item.durationMinutes), [120, 120]);
  result.value.steps.forEach((item, index) => {
    assert.ok(item.schedule.type === 'repeat' && item.schedule.repeat === 'custom');
    assert.deepEqual(item.schedule.customDates, datesExcept([index === 0 ? 0 : 1]));
  });
  const open = draft(
    [action(1, 'Mathematics'), action(2, 'Literature')],
    [
      ...mathDays.map(day => session('Study mathematics for 120 minutes.', 1, day, 'Focused mathematics.')),
      ...literatureDays.map(day => session('Study literature for 120 minutes.', 2, day, 'Focused literature.')),
    ],
    '2026-12-23',
  );
  const chosen = await run('Practice two subjects on different days.', [open]);
  assert.ok(chosen.result.ok && 'steps' in chosen.result.value);
  assert.equal(chosen.result.value.steps.length, 2);
  chosen.result.value.steps.forEach((item, index) => {
    assert.ok(item.schedule.type === 'repeat' && item.schedule.repeat === 'custom');
    assert.deepEqual(item.schedule.customDates, datesExcept([index === 0 ? 0 : 1]));
  });
});

test('distinct work on the same action keeps its own step', async () => {
  const output = draft(unrestricted, [
    step('Warm up', [1], weeklyDay(1)),
    step('Intervals', [1], weeklyDay(3)),
    step('Warm up', [1], { type: 'once', due: '2026-12-01' }),
  ]);
  const { result } = await run('Train this week.', [output]);
  assert.ok(result.ok && 'steps' in result.value);
  assert.deepEqual(result.value.steps.map(item => [item.text, item.schedule]), [
    ['Warm up', { type: 'repeat', repeat: 'weekly', repeatDay: 1 }],
    ['Intervals', { type: 'repeat', repeat: 'weekly', repeatDay: 3 }],
    ['Warm up', { type: 'once', due: '2026-12-01' }],
  ]);
});

test('Custom Dates accepts exactly 2,000 unique dates and rejects 2,001', async () => {
  const dates = Array.from({ length: 2001 }, (_, i) => new Date(Date.UTC(2026, 10, 25 + i)).toISOString().slice(0, 10));
  for (const size of [2000, 2001]) {
    const schedule = { type: 'repeat', repeat: 'custom', customDates: dates.slice(0, size) };
    const output = draft(unrestricted, [step('Practice', [1], schedule)], dates[2000]);
    const { result } = await run('Practice on selected dates', [output]);
    assert.equal(result.ok, size === 2000);
  }
});
