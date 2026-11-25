import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGeneratedSuggestion, readGeneratedStepSchedule } from '../src/goals/aiSuggestion.ts';
import { scheduleWriteError } from '../src/goals/recurrenceSchedule.ts';

function suggestion(steps: unknown[]) {
  return {
    ok: true,
    suggestion: {
      title: 'Study Java',
      field: 'Academy',
      deadline: '2026-12-31',
      difficultyScore: 20,
      difficultyConfidence: 0.5,
      difficultyReason: 'A normal study habit.',
      rankingEligible: false,
      rankingEligibilityReason: 'Ordinary study.',
      steps,
    },
  };
}

function step(schedule: unknown, text = 'Study Java') {
  return { text, description: 'Read one chapter.', schedule };
}

function scheduleOf(value: unknown) {
  const parsed = parseGeneratedSuggestion(value);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || !parsed.value.ok) return null;
  return parsed.value.suggestion.steps[0]?.schedule ?? null;
}

test('valid daily, weekly, monthly, yearly, once, and no schedule pass', () => {
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'repeat', repeat: 'daily' })])), { type: 'repeat', repeat: 'daily' });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'repeat', repeat: 'weekly', repeatDay: 1 })])), {
    type: 'repeat',
    repeat: 'weekly',
    repeatDay: 1,
  });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'repeat', repeat: 'monthly', repeatDay: 31 })])), {
    type: 'repeat',
    repeat: 'monthly',
    repeatDay: 31,
  });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'repeat', repeat: 'yearly', repeatMonth: 2, repeatDay: 29 })])), {
    type: 'repeat',
    repeat: 'yearly',
    repeatMonth: 2,
    repeatDay: 29,
  });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'once', due: '2028-02-29' })])), { type: 'once', due: '2028-02-29' });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'none' })])), { type: 'none' });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'daily' })])), { type: 'repeat', repeat: 'daily' });
  assert.deepEqual(scheduleOf(suggestion([step('day')])), { type: 'repeat', repeat: 'daily' });
});

test('a missing repeat stays daily, and a missing weekday stays missing', () => {
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'repeat' })])), { type: 'repeat', repeat: 'daily' });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'repeat', repeat: '   ' })])), { type: 'repeat', repeat: 'daily' });
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'repeat', repeat: 'weekly' })])), { type: 'repeat', repeat: 'weekly' });
});

test('an unknown recurrence is rejected for goal generation and is not stored as daily', () => {
  const generated = parseGeneratedSuggestion(suggestion([step({ type: 'repeat', repeat: 'every-other-day' })]));
  assert.equal(generated.ok, false);
  if (!generated.ok) {
    assert.match(generated.error, /every-other-day/);
    assert.equal(generated.error.includes('daily'), true);
    assert.equal(JSON.stringify(generated).includes('"repeat":"daily"'), false);
  }
  assert.equal(readGeneratedStepSchedule({ type: 'repeat', repeat: 'every-other-day' }).ok, false);
  const aliased = parseGeneratedSuggestion(suggestion([step({ type: 'daily', repeat: 'every-other-day' })]));
  assert.equal(aliased.ok, false);
  if (!aliased.ok) assert.match(aliased.error, /every-other-day/);
  assert.deepEqual(scheduleOf(suggestion([step({ type: 'daily', repeat: 'daily' })])), { type: 'repeat', repeat: 'daily' });
});

test('invalid weekday, month day, yearly date, and one-time date are rejected', () => {
  const weekday = parseGeneratedSuggestion(suggestion([step({ type: 'repeat', repeat: 'weekly', repeatDay: 7 })]));
  const namedDay = parseGeneratedSuggestion(suggestion([step({ type: 'repeat', repeat: 'weekly', repeatDay: 'Mon' })]));
  const month = parseGeneratedSuggestion(suggestion([step({ type: 'repeat', repeat: 'monthly', repeatDay: 32 })]));
  const year = parseGeneratedSuggestion(suggestion([step({ type: 'repeat', repeat: 'yearly', repeatMonth: 2, repeatDay: 30 })]));
  const partialYear = parseGeneratedSuggestion(suggestion([step({ type: 'repeat', repeat: 'yearly', repeatMonth: 2 })]));
  const once = parseGeneratedSuggestion(suggestion([step({ type: 'once', due: '2026-02-29' })]));
  for (const result of [weekday, namedDay, month, year, partialYear, once]) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(JSON.stringify(result).includes('"repeat":"daily"'), false);
  }
  assert.match(weekday.ok ? '' : weekday.error, /weekday/i);
  assert.match(once.ok ? '' : once.error, /2026-02-29/);
});

test('recommendation acceptance uses the same rejection and cannot persist the raw repeat as daily', () => {
  const recommendation = suggestion([step({ type: 'repeat', repeat: 'every-other-day' }, 'Practice')]);
  const parsed = parseGeneratedSuggestion(recommendation);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.error, /Practice/);
  const writeError = scheduleWriteError({ repeat: 'every-other-day', repeatDay: null, repeatMonth: null, dueAt: null });
  assert.equal(typeof writeError, 'string');
  assert.notEqual(writeError, null);
});

for (const [input, repeat] of [
  ['daily', 'daily'],
  ['weekly', 'weekly'],
  ['monthly', 'monthly'],
  ['yearly', 'yearly'],
  ['day', 'daily'],
  ['week', 'weekly'],
  ['month', 'monthly'],
  ['year', 'yearly'],
]) {
  test(`generated schedule accepts the supported value "${input}"`, () => {
    assert.deepEqual(readGeneratedStepSchedule(input), { ok: true, schedule: { type: 'repeat', repeat } });
  });
}

for (const input of ['not daily', 'every-other-day', 'daily | weekly', 'weeklyish', '??']) {
  test(`generated suggestion rejects the unsupported schedule "${input}"`, () => {
    assert.equal(parseGeneratedSuggestion(suggestion([step(input)])).ok, false);
  });
}

const todayCivil = '2026-11-24';

test('explicit exclusions reject Daily output even when the schedule is structurally valid', () => {
  const result = parseGeneratedSuggestion(suggestion([step({ type: 'repeat', repeat: 'daily' }, 'Study mathematics')]), {
    todayCivil, prompt: 'Study mathematics every day except Sunday for four weeks.',
  });
  assert.equal(result.ok, false);
});

test('explicit annual intent rejects a Once schedule on the same date', () => {
  const result = parseGeneratedSuggestion(suggestion([step({ type: 'once', due: '2026-12-01' }, 'Review achievements')]), {
    todayCivil, prompt: 'Review yearly achievements every December 1.',
  });
  assert.equal(result.ok, false);
});

test('an administrative-only plan is rejected for a request with a goal topic', () => {
  const result = parseGeneratedSuggestion(suggestion([step({ type: 'none' }, 'Schedule workouts')]), {
    todayCivil, prompt: 'Exercise regularly.',
  });
  assert.equal(result.ok, false);
});

test('a generated finite custom schedule uses the existing Custom Dates representation', () => {
  const schedule = { type: 'repeat', repeat: 'custom', customDates: ['2026-11-26', '2026-12-02'] };
  assert.deepEqual(scheduleOf(suggestion([step(schedule)])), schedule);
});

function withIntent(prompt: string, schedule: unknown, options: {
  deadline?: string; title?: string; supporting?: unknown[];
  metadata?: { title: string; description?: string; expectation?: string };
} = {}) {
  const input = suggestion([step(schedule, options.title ?? 'Practice the skill'), ...(options.supporting ?? [])]);
  input.suggestion.deadline = options.deadline ?? '2026-12-05';
  Object.assign(input.suggestion, options.metadata);
  return parseGeneratedSuggestion(input, { todayCivil, prompt });
}

function acceptedSchedule(result: ReturnType<typeof withIntent>) {
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  if (!result.ok || !result.value.ok) assert.fail('Expected an accepted plan');
  return result.value.suggestion.steps[0].schedule;
}

const weekdaysExcept = (day: number) => ({ type: 'weekdays', days: [0, 1, 2, 3, 4, 5, 6].filter(value => value !== day) });

const independentSubjects = 'Study mathematics every day except Sunday for the next 4 weeks. Study literature for the same 4 weeks, every day except Monday.';

const subjectMetadata = {
  title: 'Study Mathematics and Literature',
  description: 'Study mathematics every day except Sunday. Study literature every day except Monday.',
  expectation: 'Complete the scheduled study sessions for both subjects.',
};

function subjectSuggestion(metadata: typeof subjectMetadata) {
  return withIntent(independentSubjects, weekdaysExcept(0), {
    title: 'Study mathematics', deadline: '2026-12-22',
    supporting: [step(weekdaysExcept(1), 'Study literature')],
    metadata,
  });
}

for (const [name, metadata, field] of [
  ['title narrows the goal to the first subject', { ...subjectMetadata, title: 'Study Mathematics' }, 'title'],
  ['title calls an excluded schedule Daily', { ...subjectMetadata, title: 'Study Mathematics Daily' }, 'title'],
  ['description omits the second subject', { ...subjectMetadata, description: 'Study mathematics every day except Sunday.' }, 'description'],
  ['description drops the weekday restrictions', { ...subjectMetadata, description: 'Study mathematics and literature for four weeks.' }, 'description'],
  ['description changes the second subject’s exclusion', {
    ...subjectMetadata, description: 'Study mathematics every day except Sunday. Study literature every day except Sunday.',
  }, 'description'],
  ['expectation covers only one activity', { ...subjectMetadata, expectation: 'Complete the literature sessions.' }, 'expectation'],
] as const) {
  test(`multi-activity metadata warns when its ${name}`, () => {
    const result = subjectSuggestion(metadata);
    assert.ok(result.ok);
    assert.match(result.warnings.join(' '), new RegExp(field, 'i'));
  });
}

test('the two subjects retain their schedules with either an explicit or an umbrella title', () => {
  for (const title of [subjectMetadata.title, 'Study Math and Literature', 'Complete a Balanced Study Plan']) {
    const result = subjectSuggestion({ ...subjectMetadata, title });
    assert.ok(result.ok && result.value.ok);
    assert.equal(result.value.suggestion.title, title);
    assert.equal(result.value.suggestion.deadline, '2026-12-22');
    assert.equal(result.value.suggestion.steps.length, 2);
  }
});

test('fitness metadata accepts activity inflections and a collective completion requirement', () => {
  const result = withIntent('Run every Monday. Swim every Thursday.', { type: 'repeat', repeat: 'weekly', repeatDay: 1 }, {
    title: 'Run a route', supporting: [step({ type: 'repeat', repeat: 'weekly', repeatDay: 4 }, 'Swim laps')],
    metadata: {
      title: 'Build Endurance by Running and Swimming',
      description: 'Run a route on Mondays and swim laps on Thursdays.',
      expectation: 'Complete both activities on their scheduled days.',
    },
  });
  assert.ok(result.ok && result.value.ok);
});

test('a single-activity draft retains its existing metadata behavior', () => {
  const result = withIntent('Study mathematics every day.', { type: 'repeat', repeat: 'daily' }, {
    title: 'Study mathematics', metadata: { title: 'Study Mathematics Daily' },
  });
  assert.ok(result.ok && result.value.ok);
  assert.equal(result.value.suggestion.title, 'Study Mathematics Daily');
  assert.equal(result.value.suggestion.expectation, undefined);
});

test('independent exclusions allow Literature on Sunday and Mathematics on Monday', () => {
  const result = withIntent(independentSubjects, weekdaysExcept(0), {
    title: 'Study mathematics',
    deadline: '2026-12-22',
    supporting: [step(weekdaysExcept(1), 'Study literature')],
    metadata: subjectMetadata,
  });
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  if (result.ok && result.value.ok) {
    const [math, literature] = result.value.suggestion.steps;
    assert.ok(math.schedule.type === 'repeat' && math.schedule.repeat === 'custom');
    assert.ok(literature.schedule.type === 'repeat' && literature.schedule.repeat === 'custom');
    assert.ok(math.schedule.customDates.includes('2026-11-30'));
    assert.ok(literature.schedule.customDates.includes('2026-11-29'));
  }
});

test('copying the first activity schedule onto a second activity is rejected', () => {
  const result = withIntent(independentSubjects, weekdaysExcept(0), {
    title: 'Study mathematics',
    supporting: [step(weekdaysExcept(0), 'Study literature')],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /literature/i);
});

test('distinct schedules are matched to actions even when the steps are reordered', () => {
  const result = withIntent('Practice piano every Monday and Wednesday; Paint landscapes every Thursday and Saturday.', {
    type: 'weekdays', days: [4, 6],
  }, {
    title: 'Paint landscapes',
    supporting: [step({ type: 'weekdays', days: [1, 3] }, 'Practice piano')],
    metadata: {
      title: 'Practice Piano and Paint Landscapes',
      description: 'Practice piano every Monday and Wednesday. Paint landscapes every Thursday and Saturday.',
      expectation: 'Complete the sessions for both activities.',
    },
  });
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
});

test('a valid schedule for one activity does not excuse omission of another', () => {
  const result = withIntent('Read poetry every Monday. Write essays every Thursday.', {
    type: 'repeat', repeat: 'weekly', repeatDay: 1,
  }, { title: 'Read poetry' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /write essays/i);
});

test('a step that merges separately scheduled activities is an ambiguous match', () => {
  const result = withIntent('Review chemistry every Tuesday. Practice violin every Friday.', {
    type: 'repeat', repeat: 'weekly', repeatDay: 2,
  }, { title: 'Review chemistry and practice violin' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /match|separate|multiple activities/i);
});

test('different exclusions are scoped in a coordinated sentence, with unrelated support allowed', () => {
  const result = withIntent('Sketch portraits every day except Tuesday and garden every day except Friday.', weekdaysExcept(2), {
    title: 'Sketch portraits',
    supporting: [
      step(weekdaysExcept(5), 'Garden'),
      step({ type: 'repeat', repeat: 'daily' }, 'Clean the workspace'),
      step({ type: 'none' }, 'Gather supplies'),
    ],
    metadata: {
      title: 'Sketch Portraits and Garden',
      description: 'Sketch portraits every day except Tuesday. Garden every day except Friday.',
      expectation: 'Complete both activities on their respective schedules.',
    },
  });
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
});

test('overlapping weekday sets still preserve the days unique to each activity', () => {
  const first = { type: 'weekdays', days: [1, 3, 5] };
  const second = { type: 'weekdays', days: [3, 6] };
  const prompt = 'Read poetry every Monday, Wednesday and Friday. Write essays every Wednesday and every Saturday.';
  const result = withIntent(prompt, first, {
    title: 'Read poetry', supporting: [step(second, 'Write essays')],
    metadata: {
      title: 'Read Poetry and Write Essays',
      description: prompt,
      expectation: 'Complete the sessions for both activities.',
    },
  });
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  const wrong = withIntent(prompt, first, { title: 'Read poetry', supporting: [step(first, 'Write essays')] });
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.activity, 'Write essays');
});

test('each activity keeps its own frequency and session duration', () => {
  const prompt = 'Swim 20 minutes two times weekly, cycle 45 minutes four times weekly.';
  const options = {
    title: 'Swim for 20 minutes',
    supporting: [step({ type: 'weekdays', days: [1, 3, 5, 6] }, 'Cycle for 45 minutes')],
    metadata: {
      title: 'Build Endurance',
      description: 'Swim for 20 minutes twice per week. Cycle for 45 minutes four times weekly.',
      expectation: 'Complete all scheduled sessions for both activities.',
    },
  };
  const result = withIntent(prompt, { type: 'weekdays', days: [2, 4] }, options);
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  const wrong = withIntent(prompt, { type: 'weekdays', days: [2, 4] }, {
    ...options, supporting: [step({ type: 'weekdays', days: [1, 3, 5, 6] }, 'Cycle for 20 minutes')],
  });
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.activity, 'cycle 45 minutes');
});

test('an unscheduled supporting step is valid alongside a weekday activity', () => {
  const result = withIntent('Practice drawing every day except Sunday.', weekdaysExcept(0), {
    title: 'Practice drawing',
    supporting: [step({ type: 'none' }, 'Organize materials')],
  });
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
});

test('related supporting work follows only its own activity exclusions', () => {
  const options = (due: string) => ({
    title: 'Study mathematics',
    supporting: [step(weekdaysExcept(1), 'Study literature'), step({ type: 'once', due }, 'Track literature reading')],
    metadata: subjectMetadata,
  });
  assert.equal(withIntent(independentSubjects, weekdaysExcept(0), options('2026-11-29')).ok, true);
  const wrong = withIntent(independentSubjects, weekdaysExcept(0), options('2026-11-30'));
  assert.equal(wrong.ok, false);
  if (!wrong.ok) {
    assert.equal(wrong.activity, 'Study literature');
    assert.equal(wrong.stepNumber, 3);
  }
});

test('a second activity cannot swap a weekday just because both rules yield the same short-window date', () => {
  const result = withIntent('Read poetry every Tuesday. Write essays every Monday and Thursday.', {
    type: 'repeat', repeat: 'weekly', repeatDay: 2,
  }, {
    title: 'Read poetry', deadline: '2026-11-26',
    supporting: [step({ type: 'weekdays', days: [4, 6] }, 'Write essays')],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.activity, 'Write essays');
    assert.equal(result.stepNumber, 2);
  }
});

test('three activities preserve an exact date list, a native weekday, and no schedule', () => {
  const result = withIntent('Photograph buildings only on November 27 and December 2, 2026. Practice guitar every Thursday. Archive pictures without a schedule.', {
    type: 'repeat', repeat: 'custom', customDates: ['2026-11-27', '2026-12-02'],
  }, {
    title: 'Photograph buildings',
    supporting: [
      step({ type: 'repeat', repeat: 'weekly', repeatDay: 4 }, 'Practice guitar'),
      step({ type: 'none' }, 'Archive pictures'),
    ],
    metadata: {
      title: 'Photography, Guitar, and Photo Archiving',
      description: 'Photograph buildings on November 27 and December 2, 2026. Practice guitar every Thursday. Archive the pictures without a schedule.',
      expectation: 'Complete all three activities on their respective schedules and finish archiving the pictures.',
    },
  });
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
});

test('an unlabeled second schedule is rejected instead of inheriting the first activity', () => {
  const result = withIntent('Sketch buildings every Tuesday. Every Friday.', {
    type: 'repeat', repeat: 'weekly', repeatDay: 2,
  }, { title: 'Sketch buildings' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /each activity and its schedule separately/i);
});

for (const [prompt, days, dates] of [
  ['Practice every Monday and Thursday.', [1, 4], ['2026-11-26', '2026-11-30', '2026-12-03']],
  ['Practice on Tuesday, Friday and Saturday.', [2, 5, 6], ['2026-11-24', '2026-11-27', '2026-11-28', '2026-12-01', '2026-12-04', '2026-12-05']],
  ['Practice every day except Wednesday.', [0, 1, 2, 4, 5, 6], ['2026-11-24', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-03', '2026-12-04', '2026-12-05']],
  ['Practice every weekday except Monday.', [2, 3, 4, 5], ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']],
  ['Study every Monday, Wednesday, and Friday.', [1, 3, 5], ['2026-11-25', '2026-11-27', '2026-11-30', '2026-12-02', '2026-12-04']],
] as const) {
  test(`checks exact eligible weekdays for "${prompt}"`, () => {
    const result = withIntent(prompt, { type: 'weekdays', days });
    assert.deepEqual(acceptedSchedule(result), { type: 'repeat', repeat: 'custom', customDates: dates });
    assert.equal(withIntent(prompt, { type: 'weekdays', days: [...days, [0, 1, 2, 3, 4, 5, 6].find(day => !days.some(value => value === day))] }).ok, false);
  });
}

test('exclusions also block supporting work scheduled on an excluded weekday', () => {
  const result = withIntent('Practice every day except Sunday.', { type: 'weekdays', days: [1, 2, 3, 4, 5, 6] }, {
    supporting: [step({ type: 'once', due: '2026-11-29' }, 'Review notes')],
  });
  assert.equal(result.ok, false);
});

test('weekly frequency and session duration are enforced on the primary activity', () => {
  const prompt = 'Exercise 30 minutes, five times per week for six weeks.';
  const title = 'Exercise for 30 minutes';
  assert.equal(withIntent(prompt, { type: 'weekdays', days: [1, 2, 3, 4, 5] }, { title }).ok, true);
  assert.equal(withIntent(prompt, { type: 'weekdays', days: [1, 2, 3, 4] }, { title }).ok, false);
  assert.equal(withIntent(prompt, { type: 'weekdays', days: [1, 2, 3, 4, 5] }, { title: 'Exercise for 45 minutes' }).ok, false);
});

test('times weekly requires the requested number of weekdays rather than native single-day Weekly', () => {
  const prompt = 'Swim 20 minutes, 4 times weekly for 3 weeks.';
  const options = { title: 'Swim for 20 minutes' };
  assert.equal(withIntent(prompt, { type: 'repeat', repeat: 'weekly', repeatDay: 4 }, options).ok, false);
  assert.equal(withIntent(prompt, { type: 'weekdays', days: [1, 2, 4, 6] }, options).ok, true);
});

test('planning itself can be the requested primary activity', () => {
  const result = withIntent('Help me plan a three-day trip.', { type: 'none' }, {
    title: 'Plan a three-day itinerary',
  });
  assert.equal(result.ok, true);
});

for (const [prompt, schedule, deadline] of [
  ['Review finances monthly on day 31.', { type: 'repeat', repeat: 'monthly', repeatDay: 31 }, '2026-12-31'],
  ['Review finances on the first day of every month.', { type: 'repeat', repeat: 'monthly', repeatDay: 1 }, '2026-12-01'],
  ['Review milestones yearly on February 29.', { type: 'repeat', repeat: 'yearly', repeatMonth: 2, repeatDay: 29 }, '2028-02-29'],
  ['Review achievements every December 1.', { type: 'repeat', repeat: 'yearly', repeatMonth: 12, repeatDay: 1 }, '2026-12-01'],
  ['Practice every Friday.', { type: 'repeat', repeat: 'weekly', repeatDay: 5 }, '2026-11-27'],
  ['Practice every day.', { type: 'repeat', repeat: 'daily' }, '2026-11-24'],
  ['Practice once on 2026-12-02.', { type: 'once', due: '2026-12-02' }, '2026-12-02'],
  ['Practice as needed with no schedule.', { type: 'none' }, '2026-12-05'],
] as const) {
  test(`preserves the native schedule for "${prompt}"`, () => {
    assert.deepEqual(acceptedSchedule(withIntent(prompt, schedule, { deadline })), schedule);
  });
}

test('a date-bounded multi-weekday pattern can have one date but cannot invent one if none fits', () => {
  const schedule = { type: 'weekdays', days: [1, 4] };
  assert.deepEqual(acceptedSchedule(withIntent('Practice every Monday and Thursday.', schedule, { deadline: '2026-11-26' })), {
    type: 'repeat', repeat: 'custom', customDates: ['2026-11-26'],
  });
  assert.equal(withIntent('Practice every Monday and Thursday.', schedule, { deadline: '2026-11-25' }).ok, false);
  assert.equal(withIntent('Practice every Monday and Thursday.', { type: 'weekdays', days: [4, 5] }, { deadline: '2026-11-26' }).ok, false);
});

for (const [prompt, customDates, deadline] of [
  ['Practice English only on November 26, November 28, and December 2, 2026.', ['2026-11-26', '2026-11-28', '2026-12-02'], '2026-12-02'],
  ['Practice only on 2027-01-05, 2027-03-10 and 2027-05-09.', ['2027-01-05', '2027-03-10', '2027-05-09'], '2027-05-10'],
] as const) {
  test(`checks the complete finite list in "${prompt}"`, () => {
    const schedule = { type: 'repeat', repeat: 'custom', customDates };
    assert.deepEqual(acceptedSchedule(withIntent(prompt, schedule, { deadline })), schedule);
    assert.equal(withIntent(prompt, { ...schedule, customDates: customDates.slice(1) }, { deadline }).ok, false);
  });
}

test('compact weekday schedules enforce the Custom Dates cap without capping Daily', () => {
  const start = new Date(`${todayCivil}T00:00:00Z`);
  const selected: string[] = [];
  for (const date = new Date(start); selected.length < 2001; date.setUTCDate(date.getUTCDate() + 1)) {
    if (date.getUTCDay() !== 0) selected.push(date.toISOString().slice(0, 10));
  }
  const schedule = { type: 'weekdays', days: [1, 2, 3, 4, 5, 6] };
  assert.deepEqual(acceptedSchedule(withIntent('Practice daily except Sunday.', schedule, { deadline: selected[1999] })), {
    type: 'repeat', repeat: 'custom', customDates: selected.slice(0, 2000),
  });
  const overflow = withIntent('Practice daily except Sunday.', schedule, { deadline: selected[2000] });
  assert.equal(overflow.ok, false);
  if (!overflow.ok) assert.match(overflow.error, /2000/);
  assert.equal(withIntent('Practice daily.', { type: 'repeat', repeat: 'daily' }, { deadline: selected[2000] }).ok, true);
});

test('a broad starter plan can pass, empty plans are rejected, and repeated titles are flagged for editing', () => {
  assert.equal(withIntent('Improve my health.', { type: 'none' }, { title: 'Take a short walk' }).ok, true);
  const duplicate = withIntent('Improve my health.', { type: 'none' }, {
    title: 'Take a short walk', supporting: [step({ type: 'none' }, 'Take a short walk!')],
  });
  assert.ok(duplicate.ok && duplicate.warnings.some(warning => /duplicate/i.test(warning)));
  assert.equal(parseGeneratedSuggestion(suggestion([]), { todayCivil, prompt: 'Improve my health.' }).ok, false);
});

test('generic monthly intent still requires a monthly activity and rejects an administrative substitute', () => {
  const prompt = 'Review finances every month.';
  assert.equal(withIntent(prompt, { type: 'repeat', repeat: 'monthly', repeatDay: 12 }, {
    title: 'Review income and expenses', deadline: '2026-12-31',
  }).ok, true);
  assert.equal(withIntent(prompt, { type: 'once', due: '2026-12-04' }, { title: 'Review income and expenses' }).ok, false);
  assert.equal(withIntent(prompt, { type: 'repeat', repeat: 'monthly', repeatDay: 12 }, {
    title: 'Schedule the review', deadline: '2026-12-31',
  }).ok, false);
});

test('an unnecessary clarification response for a recognized starter goal is rejected', () => {
  const clarification = { ok: false, message: 'Please provide details.', questions: ['Which area?'] };
  for (const prompt of ['Improve my health.', 'Learn programming.', 'Build better habits.', 'Become more productive.']) {
    assert.equal(parseGeneratedSuggestion(clarification, { todayCivil, prompt }).ok, false);
  }
  assert.equal(parseGeneratedSuggestion(clarification, { todayCivil, prompt: 'Help?' }).ok, true);
});

test('generated suggestion uses the supplied deadline before validating its steps', () => {
  const input = suggestion([step({ type: 'once', due: '2026-12-12' })]);
  input.suggestion.deadline = '2026-12-01';
  const result = parseGeneratedSuggestion(input, { todayCivil, requestedDeadline: '2026-12-24' });
  assert.equal(result.ok && result.value.ok && result.value.suggestion.deadline, '2026-12-24');
});

test('generated suggestion keeps a valid model deadline when none is supplied', () => {
  const result = parseGeneratedSuggestion(suggestion([]), { todayCivil });
  assert.equal(result.ok && result.value.ok && result.value.suggestion.deadline, '2026-12-31');
});

for (const [due, accepted] of [
  ['2026-11-01', false],
  ['2026-11-24', true],
  ['2026-12-10', true],
  ['2026-12-31', true],
  ['2027-01-01', false],
  ['2026-11-31', false],
] as const) {
  test(`generated once date ${due} has expected validity for November 24 through December 31`, () => {
    const result = parseGeneratedSuggestion(suggestion([step({ type: 'once', due })]), { todayCivil });
    assert.equal(result.ok, accepted);
  });
}

for (const deadline of ['2026-11-01', '2026-11-31']) {
  test(`generated suggestion rejects invalid goal deadline ${deadline}`, () => {
    const input = suggestion([]);
    input.suggestion.deadline = deadline;
    assert.equal(parseGeneratedSuggestion(input, { todayCivil }).ok, false);
  });
}
