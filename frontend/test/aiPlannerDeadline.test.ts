import assert from 'node:assert/strict';
import test from 'node:test';

import { choosePlannerDeadline, resolvePlannerDeadline } from '../src/components/aiPlannerDeadline.ts';

const now = new Date(2026, 10, 24, 12);

function assertDeadline(plan: string, expected: string, field = '') {
  const [year, month, day] = expected.split('-').map(Number);
  assert.deepEqual(resolvePlannerDeadline(plan, field, now), {
    kind: 'resolved',
    civil: expected,
    dueAt: new Date(year, month - 1, day, 23, 59, 59, 999).toISOString(),
  });
}

for (const [plan, expected] of [
  ['I want to attend a weekly English speaking club every Sunday, but my goal deadline is November 29, 2026.', '2026-11-29'],
  ['I want to review my finances on the first day of every month, with a goal deadline of December 1, 2026.', '2026-12-01'],
  ['Goal deadline: Nov 29, 2026', '2026-11-29'],
  ['Finish by 29 November 2026.', '2026-11-29'],
  ['Complete by Dec 1st, 2026.', '2026-12-01'],
  ['Goal deadline = 2026-11-29', '2026-11-29'],
  ['Deadline: 11/29/2026', '2026-11-29'],
  ['Deadline: 03/04/2027', '2027-03-04'],
  ['I want to finish in 6 weeks.', '2027-01-05'],
  ['I want to finish in 30 days.', '2026-12-24'],
  ['I want to finish within 2 months.', '2027-01-24'],
  ['Organize my laptop files and remove unnecessary downloads by December 20, 2026. I have no fixed routine or recurring schedule.', '2026-12-20'],
  ['Restore the mural by Aug 14, 2028. Keep it simple.', '2028-08-14'],
  ['Help me plan a three-day trip to Vienna. Complete the travel plan by December 15, 2026.', '2026-12-15'],
  ['Create an editable plan over the next four weeks.', '2026-12-22'],
  ['Draft the outline by December 1, 2026. Goal deadline: December 24, 2026.', '2026-12-24'],
  ['Meet on November 30, 2026. Finish by December 2nd, 2026.', '2026-12-02'],
  ['The goal runs until December 3rd, 2026.', '2026-12-03'],
  ['Finish by December 4th, 2026.', '2026-12-04'],
  ['Attend an English speaking club every Sunday until December 20, 2026.', '2026-12-20'],
  ['Practice English through March 17, 2027.', '2027-03-17'],
  ['Attend sessions until 2031-07-19.', '2031-07-19'],
  ['Through 19 July 2031.', '2031-07-19'],
  ['Finish by August 4, 2028.', '2028-08-04'],
  ['Complete before October 12, 2030.', '2030-10-11'],
  ['Finish before 2028-03-01.', '2028-02-29'],
  ['Before January 1, 2032.', '2031-12-31'],
  ['Goal deadline is January 31, 2029.', '2029-01-31'],
  ['Step 1: Rehearse until August 4, 2028. Goal deadline is August 9, 2028.', '2028-08-09'],
  ['Practice through March 17, 2027. Complete before March 18, 2027.', '2027-03-17'],
  ['Study mathematics every day except Sunday for the next 4 weeks. Study literature for the same 4 weeks, every day except Monday.', '2026-12-22'],
]) {
  test(`resolves the generation deadline for "${plan}"`, () => assertDeadline(plan, expected));
}

for (const [expected, formats] of [
  ['2027-03-17', ['March 17, 2027', '17 Mar 2027', '2027-03-17', '3/17/2027']],
  ['2028-08-04', ['August 4th, 2028', '4 Aug 2028', '2028-08-04', '08/04/2028']],
  ['2029-01-31', ['January 31st, 2029', '31 Jan 2029', '2029-01-31', '1/31/2029']],
  ['2030-10-12', ['October 12, 2030', '12 Oct 2030', '2030-10-12', '10/12/2030']],
  ['2028-02-29', ['February 29, 2028', '29 Feb 2028', '2028-02-29', '2/29/2028']],
] as const) {
  const contexts = ['Goal deadline is', 'Complete it by', 'Finish by', 'Goal runs until'];
  for (const [index, date] of formats.entries()) {
    const plan = `${contexts[index]} ${date}.`;
    test(`resolves ${expected} from "${plan}"`, () => assertDeadline(plan, expected));
  }
}

for (const [plan, kind] of [
  ['Goal deadline is February 30, 2027. I can finish in 6 weeks.', 'invalid'],
  ['Goal deadline is February 29, 2027.', 'invalid'],
  ['Finish by April 31, 2027.', 'invalid'],
  ['Finish by December 2th, 2026.', 'invalid'],
  ['Goal deadline is November 23, 2026.', 'past'],
  ['Goal deadline: 2026-11-23.', 'past'],
  ['Meet the tutor on November 29, 2026 and submit the worksheet by 2026-12-01.', 'missing'],
  ['Goal deadline: 2026-12-01 or 2026-12-24.', 'ambiguous'],
  ['Goal deadline: December 1, 2026. Goal deadline: December 24, 2026.', 'ambiguous'],
  ['Practice through March 17, 2027. Finish by March 24, 2027.', 'ambiguous'],
  ['Practice until December 20, 2026 or January 10, 2027.', 'ambiguous'],
  ['Keep practicing until February 30, 2027.', 'invalid'],
  ['Practice through November 23, 2026.', 'past'],
  ['Complete before November 24, 2026.', 'past'],
  ['Meet with the tutor on March 17, 2027.', 'missing'],
  ["Don't start practicing until March 17, 2027.", 'missing'],
] as const) {
  test(`reports ${kind} for "${plan}"`, () => {
    assert.equal(resolvePlannerDeadline(plan, '', now).kind, kind);
  });
}

test('conflicting deadlines require a choice, and cancellation returns no deadline', async () => {
  for (const choice of ['plan', 'field', null] as const) {
    let asked = 0;
    const result = await choosePlannerDeadline('Practice for the next 4 weeks.', '2026-12-20', async conflict => {
      asked++;
      assert.equal(conflict.plan.civil, '2026-12-22');
      assert.equal(conflict.field.civil, '2026-12-20');
      return choice;
    }, now);
    assert.equal(asked, 1);
    assert.equal(result?.kind === 'resolved' ? result.civil : null, choice === 'plan' ? '2026-12-22' : choice === 'field' ? '2026-12-20' : null);
  }
});

test('single, equivalent and unparseable text deadlines do not interrupt generation', async () => {
  for (const [plan, field] of [['Archive notes.', '2027-03-17'], ['Archive notes by March 17, 2027.', ''],
    ['Archive notes by March 17, 2027.', '2027-03-17'], ['Archive notes 3 days a week.', '2027-03-17'],
    ['Plan a 3-day visit.', '2027-03-17'], ['Archive notes by sometime next spring.', '2027-03-17']]) {
    const result = await choosePlannerDeadline(plan, field, () => assert.fail('unexpected conflict'), now);
    assert.ok(result?.kind === 'resolved' && result.civil === '2027-03-17');
  }
});

test('an invalid or past field date is reported without falling back to the plan', () => {
  assert.equal(resolvePlannerDeadline('Finish in 6 weeks.', '2027-02-30', now).kind, 'invalid');
  assert.equal(resolvePlannerDeadline('Finish in 6 weeks.', '2026-11-23', now).kind, 'past');
});

for (const plan of [
  'Finish in 6 to 8 weeks.',
  'Complete the project within 12-18 days.',
  'Allow 2–3 months to finish.',
  'Finish between 20 and 25 days from now.',
  'Finish in two weeks to one month.',
]) {
  test(`reports a relative range as ambiguous in "${plan}"`, () => {
    assert.equal(resolvePlannerDeadline(plan, '', now).kind, 'ambiguous');
  });
}

test('word-number durations keep the same scheduling convention', () => {
  assertDeadline('Exercise for six weeks.', '2027-01-05');
});
