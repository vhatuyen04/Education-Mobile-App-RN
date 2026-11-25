import assert from 'node:assert/strict';
import test from 'node:test';
import { generateGoalPlan } from '../src/goals/generateGoalPlan.ts';
import { GENERATED_SCHEDULE_CONTRACT } from '../src/goals/aiSuggestion.ts';
import { goalModelSchedule, responseFormatForActivities, responseSchemaForActivities } from '../src/goals/goalModelContract.ts';
import { readActivitySchedules } from '../src/goals/aiActivitySchedules.ts';
import { createPlannerTrace } from '../src/goals/plannerTrace.ts';

const todayCivil = '2026-11-25';
const deadline = '2026-12-02';
const weekdays = { type: 'weekdays', days: [1, 2, 3, 4, 6] };
const nativeWeekly = { type: 'repeat', repeat: 'weekly', repeatDay: 3 };
const prompt = 'Exercise 30 minutes, 5 times weekly for 6 weeks';

test('starter step wording must match its recurrence, including model-selected weekdays', async () => {
  const window = { todayCivil, requestedDeadline: deadline, prompt: 'Help me improve my routine.' };
  for (const [title, description, valid, invalid] of [
    ['Daily practice', 'Complete one exercise.', { type: 'repeat', repeat: 'daily' }, { type: 'none' }],
    ['Review a score', 'Practice three times per week.', { type: 'weekdays', days: [1, 3, 5] }, nativeWeekly],
    ['Weekly practice', 'Check one recording.', nativeWeekly, { type: 'none' }],
  ] as const) {
    const raw = (schedule: unknown) => {
      const plan = JSON.parse(draft(schedule, title));
      plan.suggestion.steps[0].description = description;
      plan.suggestion.steps.push({ text: 'Gather supplies', activityIndex: null, schedule: { type: 'none' } });
      return JSON.stringify(plan);
    };
    const mock = mockGeneration([raw(invalid), raw(valid)], window);
    assert.ok((await mock.run()).ok);
    assert.equal(mock.requests.length, 2);
    assert.deepEqual(mock.finalized[0].steps[1].schedule, { type: 'none' });
  }
});

test('no fixed routine permits Once or None and rejects recurring steps', async () => {
  const window = { todayCivil, requestedDeadline: deadline, prompt: 'Archive recordings by December 2, 2026. I have no fixed routine or recurring schedule.' };
  for (const schedule of [{ type: 'none' }, { type: 'once', due: deadline }]) {
    const mock = mockGeneration([draft(nativeWeekly, 'Archive recordings'), draft(schedule, 'Archive recordings')], window);
    assert.ok((await mock.run()).ok);
    assert.equal(mock.requests.length, 2);
  }
});

test('planning a deliverable is actionable without optional preferences', async () => {
  for (const prompt of ['Help me plan a three-day trip to Vienna.', 'Please help me plan a community exhibition.']) {
    const clarification = { ok: false, suggestion: null, message: 'What is your budget?', questions: ['Any preferences?'] };
    assert.equal(responseSchemaForActivities(readActivitySchedules(prompt)).safeParse(clarification).success, false);
    const mock = mockGeneration([JSON.stringify(clarification), draft({ type: 'none' }, 'Plan the itinerary')], { prompt, todayCivil, requestedDeadline: deadline });
    assert.ok((await mock.run()).ok);
    assert.equal(mock.requests.length, 2);
  }
});

test('conflicting deadlines and durations in individual generated fields block finalization', async () => {
  const window = { todayCivil, requestedDeadline: deadline, prompt: 'Practice pottery for the next four weeks.' };
  for (const [field, text] of [['title', 'A four-week plan'], ['description', 'Finish by January 8, 2027.'],
    ['expectation', 'Complete this four-week plan.'], ['stepTitle', 'Follow a 4-week routine'], ['stepDescription', 'Practice for four weeks.']]) {
    const plan = JSON.parse(draft({ type: 'none' }, 'Throw a pot'));
    if (field === 'stepTitle') plan.suggestion.steps[0].text = text;
    else if (field === 'stepDescription') plan.suggestion.steps[0].description = text;
    else plan.suggestion[field] = text;
    const raw = JSON.stringify(plan);
    const mock = mockGeneration([raw, raw], window);
    assert.equal((await mock.run()).ok, false, field);
    assert.equal(mock.finalized.length, 0);
  }
});

function draft(schedule: unknown, text = 'Exercise for 30 minutes', deadline = '2026-12-30') {
  return JSON.stringify({
    ok: true,
    suggestion: {
      title: 'Improve fitness', field: 'Sport', deadline,
      difficultyScore: 25, difficultyConfidence: 0.8, difficultyReason: 'Ordinary exercise',
      rankingEligible: false, rankingEligibilityReason: 'Routine habit',
      steps: [{ text, description: 'Finish the session.', schedule }],
    },
  });
}

test('planning without a requested recurrence excludes repeating direct and supporting work', async () => {
  const prompt = 'Help me plan a three-day exhibition. Complete the plan by December 2, 2026.';
  const plan = JSON.parse(draft({ type: 'none' }, 'Research venues', deadline));
  Object.assign(plan, { message: '', questions: [] });
  Object.assign(plan.suggestion, { description: 'Prepare an exhibition plan.', expectation: 'Finish the plan.', requirement: '' });
  const direct = { ...plan.suggestion.steps[0], activityIndex: 1 };
  for (const index of [1, null]) {
    plan.suggestion.steps = [direct, { text: 'Compare layouts', description: 'Sketch options.', activityIndex: index, schedule: nativeWeekly }];
    const schema = responseSchemaForActivities(readActivitySchedules(prompt));
    assert.equal(schema.safeParse(plan).success, false, 'provider contract');
    const raw = JSON.stringify(plan);
    const mock = mockGeneration([raw, raw], { todayCivil, prompt, requestedDeadline: deadline });
    assert.equal((await mock.run()).ok, false, 'independent validator');
    assert.equal(mock.requests.length, 2);
  }
});

test('Sunday wording separates a purpose clause from a weekday range and rejects contradictory claims', async () => {
  const schedule = { ...nativeWeekly, repeatDay: 0 };
  const window = { todayCivil, requestedDeadline: deadline, prompt: 'Join the club every Sunday.' };
  for (const [description, valid] of [
    ['Attend every Sunday to practice.', true], ['Attend every Sunday through December 2, 2026.', true],
    ['Attend conversation sessions every week.', true],
    ['Attend each Monday to practice.', false], ['Attend three times per week.', false],
    ['Attend every Sunday through Wednesday.', false], ['Attend every other week.', false],
  ] as const) {
    const plan = JSON.parse(draft(schedule, 'Attend the club'));
    Object.assign(plan.suggestion.steps[0], { description, activityIndex: 1 });
    const raw = JSON.stringify(plan);
    const mock = mockGeneration([raw, raw], window);
    assert.equal((await mock.run()).ok, valid, description);
    assert.equal(mock.requests.length, valid ? 1 : 2);
  }
});

test('model-proposed daily editing receives one wording repair and can remain editable', async () => {
  const window = { todayCivil, requestedDeadline: deadline, prompt: 'Help me plan a three-day exhibition.' };
  const value = JSON.parse(draft({ type: 'none' }, 'Draft the program'));
  value.suggestion.steps[0].description = 'Update the program each day.';
  const raw = JSON.stringify(value);
  const traces: any[] = [];
  const mock = mockGeneration([raw, raw], window, createPlannerTrace(event => traces.push(event)));
  assert.equal((await mock.run()).ok, true);
  assert.equal(mock.requests.length, 2);
  assert.equal(traces[0].rule, 'daily_for_seven_days');
  assert.deepEqual(traces[0].fields, ['suggestion.steps.0.description']);
  assert.ok(!JSON.stringify(traces).includes('Update the program'));
  const feedback = JSON.parse(mock.requests[1].at(-1)!.content.split('\n').at(-1)!);
  assert.equal(JSON.parse(feedback.violation.detail).clause, 'Update the program each day');
});

test('a deadline-only goal keeps its validated draft after unsuccessful wording repair', async () => {
  const window = { todayCivil, requestedDeadline: deadline, prompt: 'I want to be more considerate in 1 week.' };
  const initial = draft({ type: 'none' }, 'Daily reflection');
  for (const repair of [initial, 'invalid JSON', draft({ type: 'once', due: '2030-01-01' }), new Error('offline')]) {
    const mock = mockGeneration([initial, repair], window);
    assert.ok((await mock.run()).ok);
    assert.equal(mock.requests.length, 2);
    assert.equal(mock.finalized.length, 1);
    assert.equal(mock.finalized[0].deadline, deadline);
    assert.deepEqual(mock.finalized[0].steps[0].schedule, { type: 'none' });
  }
});

test('a wording warning cannot mask an explicit weekday or a conflicting goal deadline', async () => {
  const raw = JSON.parse(draft({ type: 'none' }, 'Daily reflection'));
  for (const [prompt, description] of [['Reflect every Sunday.', 'Reflect on a decision.'],
    ['Become more considerate in 1 week.', 'Finish by January 8, 2027.']]) {
    raw.suggestion.description = description;
    const mock = mockGeneration([JSON.stringify(raw), JSON.stringify(raw)], { todayCivil, requestedDeadline: deadline, prompt });
    assert.equal((await mock.run()).ok, false);
    assert.equal(mock.finalized.length, 0);
  }
});

function mockGeneration(
  responses: (string | Error | null)[],
  window: Parameters<typeof generateGoalPlan>[0]['window'] = { todayCivil, requestedDeadline: deadline, prompt },
  trace?: ReturnType<typeof createPlannerTrace>,
) {
  type Options = Parameters<typeof generateGoalPlan>[0];
  const requests: Options['messages'][] = [];
  const events: Parameters<Options['logRepair']>[0][] = [];
  const finalized: Parameters<Options['finalize']>[0][] = [];
  const run = () => generateGoalPlan({
    messages: [{ role: 'system', content: 'Return a goal plan as JSON.' }, { role: 'user', content: window.prompt ?? '' }],
    window,
    trace,
    async requestModel(messages) {
      const response = responses[requests.length];
      requests.push(messages);
      if (response instanceof Error) throw response;
      assert.notEqual(response, undefined, 'unexpected extra model call');
      return response ?? null;
    },
    async finalize(suggestion) {
      finalized.push(suggestion);
      return { ok: true as const, suggestion: { ...suggestion, suggestionToken: 'test-token' } };
    },
    logRepair: event => events.push(event),
  });
  return { run, requests, events, finalized };
}

test('valid weekday selector uses one model call and finalizes canonical Custom Dates', async () => {
  const mock = mockGeneration([draft(weekdays)]);
  const result = await mock.run();
  assert.ok(result.ok && result.value.ok);
  assert.equal(result.value.suggestion.suggestionToken, 'test-token');
  assert.equal(result.value.suggestion.deadline, deadline);
  assert.deepEqual(result.value.suggestion.steps[0].schedule, {
    type: 'repeat', repeat: 'custom',
    customDates: ['2026-11-25', '2026-11-26', '2026-11-28', '2026-11-30', '2026-12-01', '2026-12-02'],
  });
  assert.equal(mock.requests.length, 1);
  assert.deepEqual(mock.events, []);
  assert.equal(mock.finalized.length, 1);
});

test('single-day Weekly is native and works in one call', async () => {
  const mock = mockGeneration([draft(nativeWeekly, 'Swim laps')], {
    todayCivil, requestedDeadline: deadline, prompt: 'Swim every Wednesday.',
  });
  assert.equal((await mock.run()).ok, true);
  assert.deepEqual(mock.finalized[0].steps[0].schedule, nativeWeekly);
  assert.equal(mock.requests.length, 1);
});

test('repair receives each activity schedule and identifies the violated activity', async () => {
  const prompt = 'Study botany every day except Tuesday. Study physics every day except Friday.';
  const exceptTuesday = { type: 'weekdays', days: [0, 1, 3, 4, 5, 6] };
  const exceptFriday = { type: 'weekdays', days: [0, 1, 2, 3, 4, 6] };
  const response = (schedule: typeof exceptFriday) => {
    const plan = JSON.parse(draft(exceptTuesday, 'Study botany'));
    Object.assign(plan.suggestion, {
      title: 'Study Botany and Physics',
      description: 'Study botany every day except Tuesday. Study physics every day except Friday.',
      expectation: 'Complete the study sessions for both subjects.',
    });
    plan.suggestion.steps.push({ text: 'Study physics', schedule });
    return JSON.stringify(plan);
  };
  const mock = mockGeneration([response(exceptTuesday), response(exceptFriday)], { todayCivil, requestedDeadline: deadline, prompt });
  const result = await mock.run();
  assert.ok(result.ok && result.value.ok);
  assert.equal(result.value.suggestion.deadline, deadline);
  assert.equal(mock.requests.length, 2);
  const context = mock.requests[0].at(-1)?.content ?? '';
  const activities = JSON.parse(context.slice(context.indexOf('\n') + 1));
  assert.deepEqual(activities.map((activity: { schedule: { days: number[] } }) => activity.schedule.days), [exceptTuesday.days, exceptFriday.days]);
  const repair = mock.requests[1].at(-1)?.content ?? '';
  const data = JSON.parse(repair.slice(repair.indexOf('\n') + 1));
  assert.deepEqual(data.activities, activities);
  assert.equal(data.violation.code, 'schedule');
  assert.equal(data.violation.activity, 'Study physics');
  assert.equal(data.violation.stepNumber, 2);
  assert.deepEqual(mock.events, [{ status: 'attempted', code: 'schedule', stepNumber: 2 }, { status: 'succeeded' }]);
});

test('editable metadata does not consume the repair attempt when both activities are present', async () => {
  const prompt = 'Read poetry every Wednesday. Write essays every Friday.';
  const response = JSON.parse(draft(nativeWeekly, 'Read poetry'));
  Object.assign(response.suggestion, {
    title: 'Read Poetry',
    description: 'Read poetry on Wednesdays and write essays on Fridays.',
    expectation: 'Complete the sessions for both activities.',
  });
  response.suggestion.steps.push({ text: 'Write essays', schedule: { type: 'repeat', repeat: 'weekly', repeatDay: 5 } });
  const mock = mockGeneration([JSON.stringify(response)], { todayCivil, requestedDeadline: deadline, prompt });
  assert.equal((await mock.run()).ok, true);
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.finalized[0].steps.length, 2);
  assert.deepEqual(mock.events, []);
});

test('unclear activity scope returns a clarification error before generation', async () => {
  const mock = mockGeneration([], {
    todayCivil, requestedDeadline: deadline, prompt: 'Paint landscapes every Monday. Every Saturday.',
  });
  const result = await mock.run();
  assert.ok(!result.ok);
  assert.match(result.error, /each activity and its schedule separately/i);
  assert.equal(mock.requests.length, 0);
  assert.equal(mock.finalized.length, 0);
});

test('a merged model step that remains ambiguous after repair returns a matching error', async () => {
  const merged = draft(nativeWeekly, 'Read poetry and write essays');
  const mock = mockGeneration([merged, merged], {
    todayCivil, requestedDeadline: deadline, prompt: 'Read poetry every Wednesday. Write essays every Friday.',
  });
  const result = await mock.run();
  assert.ok(!result.ok);
  assert.match(result.error, /could not match steps to the requested activities/i);
  assert.equal(mock.requests.length, 2);
  assert.equal(mock.finalized.length, 0);
});

for (const [first, code, violation] of [
  [draft(nativeWeekly), 'schedule', /requires 5 distinct days/],
  [draft(weekdays, 'Schedule workouts'), 'primary_action', /step that directly performs/],
] as const) {
  test(`repairs ${code} exactly once using the original request and structured violation`, async () => {
    const mock = mockGeneration([first, draft(weekdays)]);
    assert.equal((await mock.run()).ok, true);
    assert.equal(mock.requests.length, 2);
    assert.deepEqual(mock.requests[1].slice(0, -1), mock.requests[0]);
    const repair = mock.requests[1].at(-1)?.content ?? '';
    const data = JSON.parse(repair.slice(repair.indexOf('\n') + 1));
    assert.equal(data.invalidOutput, first);
    assert.equal(data.effectiveDeadline, deadline);
    assert.equal(data.deadlineIsAuthoritative, true);
    assert.equal(data.violation.code, code);
    assert.match(data.violation.message, violation);
    assert.deepEqual(mock.events, [{ status: 'attempted', code, ...(code === 'schedule' && { stepNumber: 1 }) }, { status: 'succeeded' }]);
    assert.equal(mock.finalized.length, 1);
    assert.equal(mock.finalized[0].deadline, deadline);
  });
}

test('two invalid outputs return a safe error and never reach token finalization', async () => {
  const mock = mockGeneration([draft(nativeWeekly), draft({ type: 'repeat', repeat: 'RAW_PROVIDER_VALUE' })]);
  const result = await mock.run();
  assert.deepEqual(result, {
    ok: false, error: 'The AI could not produce a plan that fits the requested schedule. Check the deadline and schedule or try generating again.',
  });
  assert.equal(mock.requests.length, 2);
  assert.deepEqual(mock.finalized, []);
  assert.deepEqual(mock.events, [{ status: 'attempted', code: 'schedule', stepNumber: 1 }, { status: 'rejected', code: 'schedule', stepNumber: 1 }]);
});

test('both planner and recommendation contexts repair malformed model JSON with the same limits', async () => {
  for (const input of [prompt, '']) {
    const mock = mockGeneration(['not-json', draft(weekdays)], { todayCivil, requestedDeadline: deadline, prompt: input });
    assert.equal((await mock.run()).ok, true);
    assert.equal(mock.requests.length, 2);
    assert.deepEqual(mock.events, [{ status: 'attempted', code: 'json' }, { status: 'succeeded' }]);
  }
});

test('repair receives a recommendation deadline as a proposal when the user did not select one', async () => {
  const mock = mockGeneration([
    draft(nativeWeekly, 'Schedule workouts', '2026-12-02'),
    draft(nativeWeekly, 'Exercise', '2026-12-09'),
  ], { todayCivil, prompt: '' });
  const result = await mock.run();
  assert.ok(result.ok && result.value.ok);
  assert.equal(result.value.suggestion.deadline, '2026-12-09');
  const repair = mock.requests[1].at(-1)?.content ?? '';
  const data = JSON.parse(repair.slice(repair.indexOf('\n') + 1));
  assert.equal(data.effectiveDeadline, '2026-12-02');
  assert.equal(data.deadlineIsAuthoritative, false);
});

test('provider and finalization failures are never retried', async () => {
  const failedRequest = mockGeneration([new Error('network')]);
  await assert.rejects(failedRequest.run, /network/);
  assert.equal(failedRequest.requests.length, 1);
  assert.deepEqual(failedRequest.events, []);
  const failedRepair = mockGeneration(['bad json', new Error('upstream')]);
  await assert.rejects(failedRepair.run, /upstream/);
  assert.deepEqual(failedRepair.events, [{ status: 'attempted', code: 'json' }, { status: 'request_failed' }]);
  assert.equal(failedRepair.requests.length, 2);
  let calls = 0;
  await assert.rejects(() => generateGoalPlan({
    messages: [],
    window: { todayCivil, prompt: '' },
    requestModel: async () => { calls++; return draft(weekdays); },
    finalize: async () => { throw new Error('database'); },
    logRepair: () => assert.fail('finalization failure must not cause repair'),
  }), /database/);
  assert.equal(calls, 1);
});

test('repair preserves exclusions and refuses to substitute an explicit date', async () => {
  const daily = { type: 'repeat', repeat: 'daily' };
  const restricted = mockGeneration([draft(daily), draft({ type: 'weekdays', days: [1, 2, 3, 4, 5, 6] })], {
    todayCivil, requestedDeadline: deadline, prompt: 'Exercise 30 minutes daily except Sunday.',
  });
  assert.equal((await restricted.run()).ok, true);
  const schedule = restricted.finalized[0].steps[0].schedule;
  assert.ok(schedule.type === 'repeat' && schedule.repeat === 'custom');
  assert.ok(!schedule.customDates.includes('2026-11-29'));
  const exactDates = ['2026-11-26', '2026-11-28', '2026-12-02'];
  const exact = mockGeneration([
    draft({ type: 'repeat', repeat: 'custom', customDates: ['2026-11-27', ...exactDates.slice(1)] }),
    draft({ type: 'repeat', repeat: 'custom', customDates: exactDates }),
  ], { todayCivil, requestedDeadline: deadline, prompt: 'Exercise 30 minutes only on November 26, November 28, and December 2, 2026.' });
  assert.equal((await exact.run()).ok, true);
  assert.deepEqual(exact.finalized[0].steps[0].schedule, { type: 'repeat', repeat: 'custom', customDates: exactDates });
});

test('planning can be the primary deliverable without a repair', async () => {
  for (const prompt of ['Help me plan a trip.', "I'd like to plan a trip.", 'Draft a travel plan.']) {
    const mock = mockGeneration([draft({ type: 'none' }, 'Plan the itinerary')], { todayCivil, requestedDeadline: deadline, prompt });
    assert.equal((await mock.run()).ok, true);
    assert.equal(mock.requests.length, 1);
  }
});

test('every documented schedule shape is accepted by the production pipeline', async () => {
  for (const schedule of GENERATED_SCHEDULE_CONTRACT) {
    const concrete = JSON.parse(JSON.stringify(schedule).replaceAll('YYYY-MM-DD', deadline));
    assert.ok(goalModelSchedule.safeParse(concrete).success);
    const mock = mockGeneration([draft(concrete, 'Complete the activity', '2028-12-31')], {
      todayCivil, requestedDeadline: '2028-12-31', prompt: '',
    });
    assert.equal((await mock.run()).ok, true, JSON.stringify(concrete));
    assert.equal(mock.requests.length, 1);
  }
});

test('a malformed suggestion reports the failing field and repairs only once', async () => {
  const incomplete = JSON.parse(draft(weekdays));
  delete incomplete.suggestion.field;
  const mock = mockGeneration([JSON.stringify(incomplete), draft(weekdays)]);
  assert.ok((await mock.run()).ok);
  assert.deepEqual(mock.events, [{ status: 'attempted', code: 'shape', fields: ['suggestion.field'] }, { status: 'succeeded' }]);
  const instruction = mock.requests[1].at(-1)!.content;
  assert.match(instruction, /suggestion\.field/);
  assert.doesNotMatch(instruction.slice(instruction.indexOf('"violation"'), instruction.indexOf('"invalidOutput"')), /questions/);
});

test('the model schema prevents the mixed weekday and Weekly shape captured from live generation', () => {
  const valid = { type: 'weekdays', days: [1, 2, 3, 4, 5, 6] };
  assert.ok(goalModelSchedule.safeParse(valid).success);
  assert.equal(goalModelSchedule.safeParse({ ...valid, repeat: 'weekly', repeatDay: 1 }).success, false);
});

for (const [prompt, schedule, invalid] of [
  ['Walk daily.', { type: 'repeat', repeat: 'daily' }, { type: 'none' }],
  ['Swim every Friday.', { type: 'repeat', repeat: 'weekly', repeatDay: 5 }, nativeWeekly],
  ['Train three times per week.', { type: 'weekdays', days: [1, 3, 5] }, nativeWeekly],
  ['Review sketches every month.', { type: 'repeat', repeat: 'monthly', repeatDay: 17 }, { type: 'none' }],
  ['Review sketches every year.', { type: 'repeat', repeat: 'yearly', repeatMonth: 8, repeatDay: 4 }, { type: 'none' }],
  ['Draw once on 2027-03-17.', { type: 'once', due: '2027-03-17' }, { type: 'once', due: '2027-03-18' }],
  ['Draw only on 2027-03-17 and 2027-03-18.', { type: 'repeat', repeat: 'custom', customDates: ['2027-03-17', '2027-03-18'] }, { type: 'none' }],
  ['Sketch without a schedule.', { type: 'none' }, nativeWeekly],
] as const) {
  test(`direct step schema uses the parsed intent for "${prompt}"`, () => {
    const schema = responseSchemaForActivities(readActivitySchedules(prompt));
    const activity1 = { activityIndex: 1, text: 'Do the activity', description: '', order: 0, schedule };
    const plan = JSON.parse(draft(schedule));
    Object.assign(plan, { message: '', questions: [] });
    Object.assign(plan.suggestion, { description: 'Practice.', expectation: 'Complete sessions.', requirement: '',
      steps: { activity1, additional: [] } });
    assert.ok(schema.safeParse(plan).success);
    plan.suggestion.steps.activity1 = { ...activity1, schedule: invalid };
    assert.equal(schema.safeParse(plan).success, false);
  });
}

for (const [prompt, required, wrong] of [
  ['Review my achievements every December 1, with a goal deadline of December 1, 2027.',
    { type: 'repeat', repeat: 'yearly', repeatDay: 1, repeatMonth: 12 },
    { type: 'repeat', repeat: 'yearly', repeatDay: 1, repeatMonth: 11 }],
  ['Review my income, expenses, and savings on the first day of every month. Finish by January 1, 2027.',
    { type: 'repeat', repeat: 'monthly', repeatDay: 1 }, { type: 'repeat', repeat: 'monthly', repeatDay: 2 }],
] as const) {
  test(`strict contract requires the direct ${required.repeat} review and its exact calendar rule`, () => {
    const scope = readActivitySchedules(prompt);
    const schema = responseSchemaForActivities(scope);
    const wire = responseFormatForActivities(scope).json_schema.schema as any;
    const suggestion = wire.properties.suggestion.anyOf.find((branch: { type: string }) => branch.type === 'object');
    assert.ok(suggestion.properties.steps.required.includes('activity1'));
    const pinned = suggestion.properties.steps.properties.activity1.properties.schedule;
    for (const [key, expected] of Object.entries(required)) assert.equal(pinned.properties[key].const, expected);
    const plan = JSON.parse(draft(required, 'Perform the review'));
    Object.assign(plan, { message: '', questions: [] });
    Object.assign(plan.suggestion, { description: 'Complete the review.', expectation: 'Record findings.', requirement: '' });
    const direct = { ...plan.suggestion.steps[0], order: 1, activityIndex: 1 };
    const support = { text: 'Set a reminder', description: '', schedule: { type: 'none' }, activityIndex: null, order: 0 };
    const accepts = (steps: unknown) => schema.safeParse({ ...plan, suggestion: { ...plan.suggestion, steps } }).success;
    assert.equal(accepts([support, { ...direct, schedule: support.schedule }]), false, 'captured flat unscheduled draft');
    assert.equal(accepts({ activity1: direct, additional: [support] }), true);
    assert.equal(accepts({ additional: [support] }), false);
    assert.equal(accepts({ activity1: { ...direct, activityIndex: null }, additional: [] }), false);
    for (const schedule of [wrong, support.schedule, { ...required, repeatDay: 9 }]) {
      assert.equal(accepts({ activity1: { ...direct, schedule }, additional: [support] }), false);
    }
  });

  test(`backend independently rejects invalid ${required.repeat} drafts and repairs with the same activity rule`, async () => {
    const window = { todayCivil, requestedDeadline: '2027-12-01', prompt };
    const response = (schedule: unknown, title = 'Perform the review', activityIndex: number | null = 1) => {
      const plan = JSON.parse(draft(required));
      plan.suggestion.steps = {
        activity1: { text: title, description: 'Assess the results and record findings.', activityIndex, order: 1, schedule },
        additional: [{ text: 'Set a reminder', activityIndex: null, order: 0, schedule: { type: 'none' } }],
      };
      return JSON.stringify(plan);
    };
    const invalid = response({ type: 'none' });
    const repaired = mockGeneration([invalid, response(required)], window);
    assert.ok((await repaired.run()).ok);
    assert.equal(repaired.requests.length, 2);
    const instruction = repaired.requests[1].at(-1)!.content;
    const detail = JSON.parse(instruction.slice(instruction.indexOf('\n') + 1));
    assert.equal(detail.violation.rule, 'native_rule_matches');
    assert.equal(detail.violation.stepNumber, 2);
    assert.deepEqual(detail.activities[0].requiredDirectSchedule, required);
    assert.deepEqual(repaired.finalized[0].steps.map(step => step.schedule), [{ type: 'none' }, required]);
    for (const raw of [invalid, response(wrong), response({ ...required, repeatDay: 9 }),
      response(required, 'Set a reminder'), response(required, 'Perform the review', null)]) {
      const rejected = mockGeneration([raw, raw], window);
      assert.equal((await rejected.run()).ok, false);
      assert.equal(rejected.requests.length, 2);
      assert.equal(rejected.finalized.length, 0);
    }
  });
}

test('the request-specific provider schema rejects both captured responses before normalization', () => {
  const scope = readActivitySchedules('Study mathematics every day except Sunday for the next 4 weeks. Study literature every day except Monday for the same 4 weeks.');
  const schema = responseSchemaForActivities(scope);
  const response = JSON.parse(draft(weekdays));
  Object.assign(response, { message: '', questions: [] });
  Object.assign(response.suggestion, { description: 'Study both subjects.', requirement: '', expectation: 'Finish the sessions.' });
  const first = { activityIndex: 1, text: 'Solve mathematics problems', description: 'Check the answers.',
    schedule: { type: 'weekdays', days: [1, 2, 3, 4, 5, 6] } };
  const second = { activityIndex: 2, text: 'Study literature', description: 'Discuss a passage.',
    schedule: { type: 'weekdays', days: [0, 2, 3, 4, 5, 6] } };
  for (const steps of [[first, second], [second, first]]) {
    const allowed = (rows: { activityIndex: number | null; text: string; description: string; schedule: unknown }[]) => {
      const ordered = rows.map((s, order) => ({ ...s, order }));
      return schema.safeParse({ ...response, suggestion: { ...response.suggestion, steps: {
        ...Object.fromEntries(ordered.filter(s => s.activityIndex !== null).map(s => [`activity${s.activityIndex}`, s])),
        additional: ordered.filter(s => s.activityIndex === null),
      } } }).success;
    };
    assert.equal(allowed(steps), true);
    assert.equal(allowed(steps.map(step => ({ ...step, schedule: { ...step.schedule, repeat: 'weekly', repeatDay: step.schedule.days[0] } }))), false);
    assert.equal(allowed(steps.map(step => ({ ...step, schedule: { type: 'none' } }))), false);
    assert.equal(allowed(steps.map(step => ({ ...step, schedule: step.activityIndex === 1 ? second.schedule : first.schedule }))), false);
    assert.equal(allowed([...steps, { activityIndex: null, text: 'Gather materials', description: '', schedule: { type: 'none' } }]), true);
  }
});

for (const reverse of [false, true]) {
  test(`independent exclusions keep their activity IDs and trace the actual failed step (reversed=${reverse})`, async () => {
    const prompt = 'Sketch buildings daily except Thursday. Read essays daily except Tuesday.';
    const first = [0, 1, 2, 3, 5, 6];
    const second = [0, 1, 3, 4, 5, 6];
    const plan = (incorrect: boolean) => {
      const value = JSON.parse(draft({ type: 'weekdays', days: first }, 'Sketch buildings for private@example.invalid'));
      value.suggestion.steps[0].activityIndex = 1;
      value.suggestion.steps.push({ text: 'Read essays', activityIndex: 2, schedule: { type: 'weekdays', days: incorrect ? first : second } });
      if (reverse) value.suggestion.steps.reverse();
      return JSON.stringify(value);
    };
    const window = { todayCivil, requestedDeadline: deadline, prompt };
    const events: any[] = [];
    const trace = createPlannerTrace(event => events.push(event));
    const repaired = mockGeneration([plan(true), plan(false)], window, trace);
    assert.ok((await repaired.run()).ok);
    const [initial, repair] = events;
    assert.equal(initial.correlationId, repair.correlationId);
    assert.equal(initial.rule, 'weekday_selector_equals_requested');
    assert.equal(initial.stepNumber, reverse ? 1 : 2);
    assert.deepEqual(initial.expected[1].days, second);
    assert.deepEqual(initial.raw[initial.stepNumber - 1].schedule.days, first);
    assert.equal(initial.normalized[initial.stepNumber - 1].schedule.repeat, 'custom');
    assert.equal(repair.stage, 'accepted');
    assert.equal(repair.repairChangedSubmittedSchedule, true);
    assert.doesNotMatch(JSON.stringify(events), /private@example|Sketch buildings|Read essays/);
    const wrong = mockGeneration([plan(true), plan(true)], window);
    assert.equal((await wrong.run()).ok, false);
    assert.equal(wrong.finalized.length, 0);
  });
}

test('a supporting native weekday may be a subset of the activity schedule', async () => {
  const prompt = 'Practice violin daily except Sunday. Read poetry every Sunday.';
  const plan = JSON.parse(draft({ type: 'weekdays', days: [1, 2, 3, 4, 5, 6] }, 'Play violin scales'));
  plan.suggestion.steps[0].activityIndex = 1;
  const support = { text: 'Gather violin scores', activityIndex: null, schedule: nativeWeekly };
  plan.suggestion.steps.unshift(support);
  plan.suggestion.steps.push({ text: 'Read a poem', description: 'Reflect on a line of poetry.', activityIndex: 2,
    schedule: { type: 'repeat', repeat: 'weekly', repeatDay: 0 } });
  const window = { todayCivil, requestedDeadline: deadline, prompt };
  const valid = JSON.stringify(plan);
  const good = mockGeneration([valid], window);
  assert.ok((await good.run()).ok);
  support.schedule = { ...nativeWeekly, repeatDay: 0 };
  const bad = mockGeneration([JSON.stringify(plan), valid], window);
  assert.ok((await bad.run()).ok);
  assert.deepEqual(bad.events[0], { status: 'attempted', code: 'schedule', stepNumber: 1 });
});

test('an index cannot replace a missing activity or override a contradictory step title', async () => {
  const prompt = 'Review sketches every Wednesday. Read essays every Friday.';
  const plan = JSON.parse(draft(nativeWeekly, 'Review sketches'));
  plan.suggestion.steps[0].activityIndex = 1;
  const window = { todayCivil, requestedDeadline: deadline, prompt };
  for (const extra of [
    { text: 'File essays', activityIndex: null },
    { text: 'Review sketches again', activityIndex: 2 },
    { text: 'Read essays', activityIndex: 3 },
  ]) {
    const raw = JSON.stringify({ ...plan, suggestion: { ...plan.suggestion, steps: [
      ...plan.suggestion.steps, { ...extra, schedule: { type: 'repeat', repeat: 'weekly', repeatDay: 5 } },
    ] } });
    const mock = mockGeneration([raw, raw], window);
    assert.equal((await mock.run()).ok, false);
    assert.equal(mock.requests.length, 2);
    assert.equal(mock.finalized.length, 0);
  }
});

test('an explicit activity link supports a paraphrase even when the step shares no subject word', async () => {
  const prompt = 'Study algebra every Wednesday. Practice climbing every Friday.';
  const plan = JSON.parse(draft(nativeWeekly, 'Solve simultaneous equations'));
  Object.assign(plan.suggestion.steps[0], { activityIndex: 1, description: 'Check that each solution satisfies both equations.' });
  plan.suggestion.steps.unshift({ text: 'Complete a bouldering route', description: 'Reach the top hold in control.',
    activityIndex: 2, schedule: { type: 'repeat', repeat: 'weekly', repeatDay: 5 } });
  const mock = mockGeneration([JSON.stringify(plan)], { todayCivil, requestedDeadline: deadline, prompt });
  assert.ok((await mock.run()).ok);
  assert.equal(mock.requests.length, 1);
  assert.deepEqual(mock.finalized[0].steps.map(step => step.text), ['Complete a bouldering route', 'Solve simultaneous equations']);
});

test('a correctly scheduled supporting step cannot excuse a wrongly scheduled main activity', async () => {
  const prompt = 'Review my achievements every December 1.';
  const plan = JSON.parse(draft({ type: 'once', due: '2026-12-01' }, 'Review achievements'));
  plan.suggestion.steps[0].activityIndex = 1;
  plan.suggestion.steps.unshift({ text: 'Gather records', activityIndex: null,
    schedule: { type: 'repeat', repeat: 'yearly', repeatMonth: 12, repeatDay: 1 } });
  const raw = JSON.stringify(plan);
  const mock = mockGeneration([raw, raw], { todayCivil, requestedDeadline: deadline, prompt });
  assert.equal((await mock.run()).ok, false);
  assert.equal(mock.finalized.length, 0);
  assert.deepEqual(mock.events[1], { status: 'rejected', code: 'schedule', stepNumber: 2 });
});

test('a yearly review may use an activity title starting with Track when its description performs the review', async () => {
  const prompt = 'Review my achievements every December 1.';
  const schedule = { type: 'repeat', repeat: 'yearly', repeatMonth: 12, repeatDay: 1 };
  const plan = JSON.parse(draft(schedule, 'Track milestones'));
  Object.assign(plan.suggestion.steps[0], { activityIndex: 1, description: 'Review your achievements and assess the impact of each one.' });
  const mock = mockGeneration([JSON.stringify(plan)], { todayCivil, requestedDeadline: deadline, prompt });
  assert.ok((await mock.run()).ok);
  assert.deepEqual(mock.finalized[0].steps[0].schedule, schedule);
});

test('missing or mixed schedule data cannot be filled in from the prompt', async () => {
  for (const schedule of [
    { type: 'repeat', repeat: null }, { type: 'repeat', repeat: 'monthly', repeatDay: null },
    { type: 'repeat', repeat: 'daily', days: [1, 3] }, { type: 'none', due: deadline },
  ]) {
    const raw = draft(schedule, 'Review finances');
    const mock = mockGeneration([raw, raw], { todayCivil, requestedDeadline: deadline, prompt: 'Review my finances.' });
    assert.equal((await mock.run()).ok, false);
    assert.equal(mock.finalized.length, 0);
  }
});
