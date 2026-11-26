import assert from 'node:assert/strict';
import test from 'node:test';

import { preparePlannerDraft } from '../src/components/aiPlannerDraft.ts';
import { parseScheduleShortText, stepOutsideActiveRangeError } from '../src/utils/stepSchedule.ts';
import { generateGoalPlan } from '../../backend/src/goals/generateGoalPlan.ts';
import { goalModelResponse, goalPlanMessages, requestGoalModel } from '../../backend/src/goals/goalModelContract.ts';

const schoolWeeks = '2026-12-23';
const none = { type: 'none' };
const DAY = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const days = (...days: number[]) => ({ type: 'weekdays' as const, days: days.map(day => DAY[day]) });
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
      { text: 'Year in retrospect', description: 'Review your achievements and record what each one taught you.', schedule: annual },
    ], indices: [1], native: 'yearly:12-01',
  },
  {
    prompt: 'Review my income, expenses, and savings on the first day of every month. Finish by January 1, 2027.',
    title: 'Monthly Financial Review', deadline: '2027-01-01',
    description: 'Understand changes in cash flow and savings each month.',
    steps: [
      { text: 'Balance the monthly accounts', description: 'Compare income, expenses, and savings and record the totals.', schedule: monthly },
    ], indices: [1], native: 'monthly:1',
  },
]) {
  for (const reverse of scenario.native ? [false, true] : [false]) {
    test(`Android request reaches an editable draft on the first model call: ${scenario.title} (reversed=${reverse})`, async () => {
      const rows = scenario.steps.map((step, i) => ({ ...step, actionId: scenario.indices[i] }));
      if (reverse) rows.reverse();
      const todayCivil = '2026-11-25';
      let calls = 0;
      const result = await generateGoalPlan({
        messages: goalPlanMessages(scenario.prompt, todayCivil, undefined, 'Normal', { name: null, email: 'test@example.invalid' }),
        window: { todayCivil },
        requestModel: messages => requestGoalModel(messages, 'unused', 'offline', async (_url, init) => {
          calls++;
          const request = JSON.parse(String(init?.body));
          assert.equal(request.response_format.json_schema.strict, true);
          assert.ok(request.messages.some((message: { content: string }) => message.content.includes(scenario.prompt)));
          const response = goalModelResponse.parse({ ok: true, message: '', questions: [], suggestion: {
            actions: [...new Set(rows.map(row => row.actionId))].map(id => ({ id, label: scenario.title, explicitSchedule: scenario.flat ? null : rows.find(row => row.actionId === id)?.schedule ?? null })),
            title: scenario.title, description: scenario.description, expectation: 'Maintain a record of progress.',
            field: 'Academy', deadline: scenario.deadline, deadlineSource: 'requested', requirement: '', difficultyScore: 25, difficultyConfidence: 0.9,
            difficultyReason: 'Routine practice.', rankingEligible: false, rankingEligibilityReason: 'A personal habit.',
            steps: rows.map(({ text, description, actionId, schedule }) => ({ text, description, actionIds: [actionId], schedule, durationMinutes: null })),
          } });
          return Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] });
        }),
        finalize: async suggestion => preparePlannerDraft(suggestion),
        logRepair: event => assert.fail(JSON.stringify(event)),
      });
      assert.equal(calls, 1);
      assert.ok(result.ok && 'steps' in result.value);
      const draft = result.value;
      assert.equal(draft.deadline, scenario.deadline);
      assert.deepEqual(draft.steps.map(step => step.text), rows.map(step => step.text));
      if (scenario.flat) assert.deepEqual(draft.steps.map(step => step.schedule), rows.map(step => step.schedule));
      assert.ok(draft.steps.every(step => !('actionIds' in step)));
      if (scenario.native) {
        for (const [i, step] of draft.steps.entries()) {
          assert.equal(step.scheduleText, scenario.native);
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
