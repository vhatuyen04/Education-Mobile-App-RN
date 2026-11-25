import assert from 'node:assert/strict';
import test from 'node:test';

import { preparePlannerDraft } from '../src/components/aiPlannerDraft.ts';
import { choosePlannerDeadline, resolvePlannerDeadline } from '../src/components/aiPlannerDeadline.ts';
import { parseScheduleShortText, stepOutsideActiveRangeError } from '../src/utils/stepSchedule.ts';
import { generateGoalPlan } from '../../backend/src/goals/generateGoalPlan.ts';
import { responseSchemaForActivities, responseFormatForActivities, goalPlanMessages, requestGoalModel } from '../../backend/src/goals/goalModelContract.ts';

const schoolWeeks = '2026-12-23';
const none = { type: 'none' };
const days = (...days: number[]) => ({ type: 'weekdays', days });
const annual = { type: 'repeat', repeat: 'yearly', repeatDay: 1, repeatMonth: 12 };
const monthly = { type: 'repeat', repeat: 'monthly', repeatDay: 1 };

for (const scenario of [
  {
    prompt: 'Practice English every Monday and Wednesday. Swim every Tuesday and Thursday. Read books every Friday and Saturday for the next 4 weeks.',
    title: 'Language, Swimming and Reading', description: 'Follow the three activity schedules.', deadline: schoolWeeks,
    steps: [
      { text: 'Read a chapter', description: 'Read books and summarize a chapter.', schedule: days(5, 6) },
      { text: 'Practice English', description: 'Hold a conversation.', schedule: days(1, 3) },
      { text: 'Swim laps', description: 'Complete a pool session.', schedule: days(2, 4) },
    ], indices: [3, 1, 2], weekdays: [[5, 6], [1, 3], [2, 4]],
  },
  {
    prompt: 'I want to improve my health and build better habits over the next 4 weeks. Please create an editable starter plan using reasonable assumptions.',
    title: 'Build healthier habits', description: 'Start with manageable changes.', deadline: schoolWeeks,
    steps: [
      { text: 'Plan meals', description: 'Write a grocery list.', schedule: none },
      { text: 'Take a walk', description: 'Walk a comfortable route.', schedule: none },
    ], indices: [1, 1], flat: true,
  },
  {
    prompt: 'Help me plan a three-day trip to Vienna. Complete the travel plan by December 15, 2026.',
    title: 'Prepare a three-day itinerary', description: 'Create a travel plan with routes and costs.', deadline: '2026-12-15',
    steps: [
      { text: 'Compare travel options', description: 'Estimate the transport costs.', schedule: { type: 'once', due: '2026-12-03' } },
      { text: 'Draft a daily itinerary', description: 'Outline activities for each day of the trip.', schedule: none },
    ], indices: [1, 1], flat: true,
  },
  {
    prompt: 'Study mathematics every day except Sunday for the next 4 weeks. Study literature every day except Monday for the same 4 weeks.',
    title: 'Build a Balanced Study Habit', deadline: schoolWeeks,
    description: 'Alternate focused mathematics exercises with close reading in literature.',
    steps: [
      { text: 'Solve a problem set', description: 'Work through mathematics problems and check the solutions.', schedule: days(1, 2, 3, 4, 5, 6) },
      { text: 'Annotate a passage', description: 'Read a work of literature and explain one passage.', schedule: days(0, 2, 3, 4, 5, 6) },
    ], indices: [1, 2], weekdays: [[1, 2, 3, 4, 5, 6], [0, 2, 3, 4, 5, 6]],
  },
  {
    prompt: 'Practice mathematics every Monday and Wednesday for the next 4 weeks. Practice English speaking every Tuesday and Thursday for the same 4 weeks.',
    title: 'Strengthen Quantitative and Speaking Skills', deadline: schoolWeeks,
    description: 'Pair mathematics problem solving with spoken English practice.',
    steps: [
      { text: 'Speak with a partner', description: 'Hold a conversation in English and note one new expression.', schedule: days(2, 4) },
      { text: 'Solve problems independently', description: 'Check the reasoning behind each mathematics answer.', schedule: days(1, 3) },
    ], indices: [2, 1], weekdays: [[2, 4], [1, 3]],
  },
  {
    prompt: 'Review my achievements every December 1, with a goal deadline of December 1, 2027.',
    title: 'Annual Achievement Review', deadline: '2027-12-01',
    description: 'Reflect on the year and identify achievements worth building on.',
    steps: [
      { text: 'Set a reminder', description: 'Choose a convenient time for the review.', schedule: none },
      { text: 'Year in retrospect', description: 'Review your achievements and record what each one taught you.', schedule: annual },
    ], indices: [null, 1], native: 'yearly:12-01',
  },
  {
    prompt: 'Review my income, expenses, and savings on the first day of every month. Finish by January 1, 2027.',
    title: 'Monthly Financial Review', deadline: '2027-01-01',
    description: 'Understand changes in cash flow and savings each month.',
    steps: [
      { text: 'Gather account statements', description: 'Keep statements together for the next review.', schedule: none },
      { text: 'Balance the monthly accounts', description: 'Compare income, expenses, and savings and record the totals.', schedule: monthly },
      { text: 'File the statements', description: 'Keep the reviewed records together.', schedule: none },
    ], indices: [null, 1, null], native: 'monthly:1',
  },
]) {
  for (const reverse of scenario.native ? [false, true] : [false]) {
    test(`Android request reaches an editable draft on the first model call: ${scenario.title} (reversed=${reverse})`, async () => {
      const rows = scenario.steps.map((step, i) => ({ ...step, activityIndex: scenario.indices[i] }));
      if (reverse) rows.reverse();
      const ordered = rows.map((step, order) => ({ ...step, order }));
      const todayCivil = '2026-11-25';
      const resolved = resolvePlannerDeadline(scenario.prompt, '', new Date(2026, 10, 25, 12));
      assert.ok(resolved.kind === 'resolved');
      assert.equal(resolved.civil, scenario.deadline);
      let calls = 0;
      const result = await generateGoalPlan({
        messages: goalPlanMessages(scenario.prompt, todayCivil, resolved.civil, 'Normal', { name: null, email: 'test@example.invalid' }),
        window: { todayCivil, requestedDeadline: resolved.civil, prompt: scenario.prompt },
        requestModel: (messages, scope) => requestGoalModel(messages, 'unused', 'offline', scope, async (_url, init) => {
          calls++;
          assert.equal(scope.kind, scenario.weekdays ? 'scoped' : 'single');
          const request = JSON.parse(String(init?.body));
          assert.deepEqual(request.response_format, responseFormatForActivities(scope));
          assert.ok(request.messages.some((message: { content: string }) => message.content.includes(scenario.prompt)));
          const response = responseSchemaForActivities(scope).parse({ ok: true, message: '', questions: [], suggestion: {
            title: scenario.title, description: scenario.description, expectation: 'Maintain a record of progress.',
            field: 'Academy', deadline: scenario.deadline, requirement: '', difficultyScore: 25, difficultyConfidence: 0.9,
            difficultyReason: 'Routine practice.', rankingEligible: false, rankingEligibilityReason: 'A personal habit.',
            steps: scenario.flat ? rows : {
              ...Object.fromEntries(ordered.filter(s => s.activityIndex !== null).map(s => [`activity${s.activityIndex}`, s])),
              additional: ordered.filter(s => s.activityIndex === null),
            },
          } });
          return Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] });
        }),
        finalize: async suggestion => preparePlannerDraft(suggestion, resolved.civil),
        logRepair: event => assert.fail(JSON.stringify(event)),
      });
      assert.equal(calls, 1);
      assert.ok(result.ok && 'steps' in result.value);
      const draft = result.value;
      assert.equal(draft.deadline, scenario.deadline);
      assert.deepEqual(draft.steps.map(step => step.text), rows.map(step => step.text));
      if (scenario.flat) assert.deepEqual(draft.steps.map(step => step.schedule), rows.map(step => step.schedule));
      assert.ok(draft.steps.every(step => !('activityIndex' in step)));
      if (scenario.native) {
        for (const [i, step] of draft.steps.entries()) {
          assert.equal(step.scheduleText, rows[i].activityIndex === null ? '' : scenario.native);
        }
      }
      for (const [i, expectedDays] of (scenario.weekdays ?? []).entries()) {
        const expectedDates: string[] = [];
        for (const day = new Date(todayCivil + 'T00:00:00Z'); day.toISOString().slice(0, 10) <= draft.deadline; day.setUTCDate(day.getUTCDate() + 1)) {
          if (expectedDays.includes(day.getUTCDay())) expectedDates.push(day.toISOString().slice(0, 10));
        }
        assert.deepEqual(parseScheduleShortText(draft.steps[i].scheduleText).customDates, expectedDates);
      }
    });
  }
}

const deadline = '2026-11-30';

for (const choice of ['plan', 'field'] as const) {
  test(`the chosen ${choice} deadline governs the generated text, editable draft and weekday dates`, async () => {
    const prompt = 'Sketch every Tuesday and Thursday for the next four weeks.';
    const resolved = await choosePlannerDeadline(prompt, '2028-04-20', async () => choice, new Date(2028, 3, 4, 12));
    assert.ok(resolved?.kind === 'resolved');
    const todayCivil = '2028-04-04';
    const end = choice === 'field' ? '2028-04-20' : '2028-05-02';
    let calls = 0;
    const result = await generateGoalPlan({
      messages: goalPlanMessages(prompt, todayCivil, resolved.civil, 'Normal', { name: null, email: '' }),
      window: { prompt, todayCivil, requestedDeadline: resolved.civil },
      requestModel: async messages => {
        assert.ok(messages.some(message => message.content.includes('Deadline: ' + end)));
        const wording = ++calls === 1 ? 'Keep sketching for four weeks.' : 'Keep sketching through ' + end + '.';
        return JSON.stringify({ ok: true, suggestion: {
          title: 'Sketch regularly', description: wording, expectation: wording, field: 'Academy', deadline: end,
          difficultyScore: 20, difficultyConfidence: 0.8, difficultyReason: 'Routine', rankingEligible: false, rankingEligibilityReason: 'Habit',
          steps: [{ text: 'Sketch', description: wording, activityIndex: 1, schedule: days(2, 4) }],
        } });
      },
      finalize: async suggestion => ({ ...suggestion, ...preparePlannerDraft(suggestion, resolved.civil) }),
      logRepair: () => {},
    });
    assert.ok(result.ok && 'steps' in result.value);
    assert.equal(calls, choice === 'field' ? 2 : 1);
    assert.equal(result.value.deadline, end);
    for (const text of [result.value.description, result.value.expectation, result.value.steps[0].description]) {
      assert.equal(text, choice === 'field' ? 'Keep sketching through ' + end + '.' : 'Keep sketching for four weeks.');
    }
    assert.equal(parseScheduleShortText(result.value.steps[0].scheduleText).customDates?.at(-1), end);
  });
}

for (const schedule of [
  { type: 'repeat', repeat: 'weekly', repeatDay: 3 },
  { type: 'repeat', repeat: 'monthly', repeatDay: 25 },
  { type: 'repeat', repeat: 'yearly', repeatDay: 25, repeatMonth: 11 },
] as const) {
  test(`planner preserves a ${schedule.repeat} rule with one occurrence`, () => {
    const draft = preparePlannerDraft({ deadline, steps: [{ text: 'Practice', schedule }] }, deadline);
    const step = draft.steps[0];
    assert.deepEqual(step.schedule, schedule);
    const stored = parseScheduleShortText(step.scheduleText);
    assert.equal(stored.repeat, schedule.repeat);
    assert.equal(stepOutsideActiveRangeError(stored, draft.deadline, '2026-11-24'), null);
  });
}

test('planner preserves a zero-occurrence rule for the active-window guard to reject', () => {
  const schedule = { type: 'repeat', repeat: 'monthly', repeatDay: 15 } as const;
  const draft = preparePlannerDraft({ deadline, steps: [{ text: 'Practice', schedule }] }, deadline);
  const step = draft.steps[0];
  assert.deepEqual(step.schedule, schedule);
  const stored = parseScheduleShortText(step.scheduleText);
  assert.match(stepOutsideActiveRangeError(stored, draft.deadline, '2026-11-24') ?? '', /between today and the goal deadline/);
});

test('planner preserves the selected December 24 deadline when the model returns December 1', () => {
  const draft = preparePlannerDraft({ deadline: '2026-12-01', steps: [] }, '2026-12-24');
  assert.equal(draft.deadline, '2026-12-24');
});

test('planner can use the model deadline when no deadline is supplied', () => {
  const draft = preparePlannerDraft({ deadline: '2026-12-01', steps: [] });
  assert.equal(draft.deadline, '2026-12-01');
});

test('generated Custom Dates reach the existing schedule draft without adding or removing days', () => {
  const customDates = ['2026-11-26', '2026-11-28', '2026-12-02'];
  const draft = preparePlannerDraft({
    deadline: '2026-12-04',
    steps: [{ text: 'Practice English', schedule: { type: 'repeat', repeat: 'custom', customDates } }],
  });
  const stored = parseScheduleShortText(draft.steps[0].scheduleText);
  assert.equal(stored.repeat, 'custom');
  assert.deepEqual(stored.customDates, customDates);
});

test('a valid model response keeps native Weekly Sunday with the extracted inclusive deadline', async () => {
  const prompt = 'Attend an English speaking club every Sunday until December 20, 2026.';
  const resolved = resolvePlannerDeadline(prompt, '', new Date(2026, 10, 24, 12));
  assert.ok(resolved.kind === 'resolved');
  const schedule = { type: 'repeat', repeat: 'weekly', repeatDay: 0 };
  let requests = 0;
  const result = await generateGoalPlan({
    messages: [{ role: 'user', content: prompt }],
    window: { todayCivil: '2026-11-24', requestedDeadline: resolved.civil, prompt },
    requestModel: async () => {
      requests++;
      return JSON.stringify({
        ok: true,
        suggestion: {
          title: 'Practice English', field: 'Academy', deadline: '2026-12-20',
          difficultyScore: 20, difficultyConfidence: 0.9, difficultyReason: 'Weekly speaking practice.',
          rankingEligible: false, rankingEligibilityReason: 'Routine practice.',
          steps: [{ text: 'Attend the English speaking club', description: 'Attend every Sunday to practice conversation.', activityIndex: 1, schedule }],
        },
      });
    },
    finalize: async suggestion => preparePlannerDraft(suggestion, resolved.civil),
    logRepair: () => assert.fail('The valid Weekly Sunday output should not need repair.'),
  });
  assert.ok(result.ok && 'steps' in result.value);
  assert.equal(requests, 1);
  assert.equal(result.value.deadline, '2026-12-20');
  const [step] = result.value.steps;
  assert.deepEqual(step.schedule, schedule);
  assert.equal(step.scheduleText, 'weekly:Sun');
  assert.equal(parseScheduleShortText(step.scheduleText).repeatDay, 0);
});
