import type { GeneratedStepSchedule } from './aiSuggestion.js';
import { hasActionableGoalWording, isAdministrativeStep, primaryActionError, readScheduleIntent, readWeekdays, requestedDirectSchedule, requestsPlan, scheduleIntentError, startsWithScheduleListItem, supportingScheduleError, type Intent } from './aiScheduleIntent.js';

type Activity = { label: string; clause: string; intent: Intent; markers: string[] };
export type ActivitySchedules =
  | { kind: 'single'; activity?: Activity; actionable?: boolean; planningDeliverable?: boolean }
  | { kind: 'ambiguous' }
  | { kind: 'scoped'; activities: Activity[] };

type Step = { text: string; description?: string; schedule: GeneratedStepSchedule; activityIndex?: number | null };
type ActivityViolation = {
  rule?: string;
  code: 'schedule' | 'primary_action' | 'activity_mapping';
  error: string;
  activity?: string;
  stepNumber?: number;
};

export const ambiguousActivityMessage = 'Describe each activity and its schedule separately so the schedules can be matched reliably.';

function activityClauses(prompt: string): string[] {
  const clauses: string[] = [];
  for (const sentence of prompt.split(/[.!?](?:\s+|$)|[;\n]+/)) {
    let start = 0;
    for (const separator of sentence.matchAll(/\s*(?:,\s*(?:(?:and|then)\s+)?|\b(?:and|then)\s+)/gi)) {
      const left = sentence.slice(start, separator.index).trim();
      const offset = separator.index + separator[0].length;
      const right = sentence.slice(offset).trim();
      // A conjunction in a weekday or date list does not introduce another activity.
      if (startsWithScheduleListItem(right) || !readScheduleIntent(left) || !readScheduleIntent(right)) continue;
      clauses.push(left);
      start = offset;
    }
    clauses.push(sentence.slice(start).trim());
  }
  return clauses;
}

const contextWords = new Set('a an and at by each every for from goal help i in is it like me my next of on or our please same the this to want week weeks day days month months year years minute minutes hour hours will with would'.split(' '));

function activityWords(text: string): string[] {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  return [...new Set(words.filter(word => !contextWords.has(word)))];
}

export function readActivitySchedules(prompt: string): ActivitySchedules {
  const candidates = activityClauses(prompt).flatMap(clause => {
    const intent = readScheduleIntent(clause);
    if (!intent) return [];
    const label = clause.slice(0, intent.offset)
      .replace(/\s+(?:for|in|within)\s+(?:(?:the\s+)?(?:next|same)\s+)?(?:the\s+)?(?:\d+|[a-z]+)\s+(?:days?|weeks?|months?|years?)\W*$/i, '')
      .replace(/[\s,:-]+$/, '');
    return [{ label, clause, intent, words: activityWords(label) }];
  });
  if (candidates.length === 0) {
    const planningDeliverable = requestsPlan(prompt);
    return { kind: 'single', actionable: planningDeliverable || hasActionableGoalWording(prompt), planningDeliverable };
  }
  if (candidates.length === 1) {
    const { label, clause, intent, words } = candidates[0];
    return { kind: 'single', activity: { label, clause, intent, markers: words } };
  }

  const activities = candidates.map(({ label, clause, intent, words }, index) => ({
    label, clause, intent,
    markers: words.filter(word => !candidates.some((other, otherIndex) => otherIndex !== index && other.words.includes(word))),
  }));
  if (activities.some(activity => activity.intent.kind === 'invalid' || !activity.markers.length)) return { kind: 'ambiguous' };
  return { kind: 'scoped', activities };
}

export function scheduledActivities(scope: ActivitySchedules): Activity[] {
  if (scope.kind === 'scoped') return scope.activities;
  return scope.kind === 'single' && scope.activity && scope.activity.intent.kind !== 'invalid' ? [scope.activity] : [];
}

export function activityScheduleContext(activities: Activity[]) {
  return activities.map(({ label, markers, intent }, index) => {
    const { offset: _offset, ...schedule } = intent;
    return { activityIndex: index + 1, activity: label, distinguishingWords: markers, schedule, requiredDirectSchedule: requestedDirectSchedule(intent) };
  });
}

function inflects(word: string, root: string): boolean {
  return word === root || word === `${root}s` || word === `${root}es` ||
    word === `${root}ing` || word === `${root}${root.at(-1)}ing` ||
    (root.endsWith('e') && word === `${root.slice(0, -1)}ing`) ||
    (root.endsWith('y') && word === `${root.slice(0, -1)}ies`);
}

function namesActivity(words: string[], activity: Activity): boolean {
  const subjects = activityWords(activity.label).slice(1);
  const topicMarkers = activity.markers.filter(word => subjects.includes(word));
  const markers = topicMarkers.length ? topicMarkers : activity.markers;
  return markers.some(marker => words.some(word => inflects(word, marker) || inflects(marker, word)));
}

export function activityMetadataWarnings(
  activities: Activity[],
  { title, description = '', expectation = '' }: { title: string; description?: string; expectation?: string },
): string[] {
  const missingFrom = (text: string) => {
    const words = activityWords(text);
    return activities.filter(activity => !namesActivity(words, activity)).map(activity => activity.label);
  };
  const issues: string[] = [];
  const titleOmissions = missingFrom(title);
  // Only flag a clear partial title. Other named parts may be paraphrases.
  const otherTitleParts = title.split(/\s+(?:and|plus)\s+|[,;&+]/i)
    .filter(part => activityWords(part).length && missingFrom(part).length === activities.length);
  const hasExclusions = activities.some(({ intent }) => intent.kind === 'weekdays' && intent.restricted && (intent.days?.length ?? 7) < 7);
  if (hasExclusions && /\b(?:daily|every day|each day)\b(?!\s*[,;]?\s*(?:except|excluding|other than)\b)/i.test(title)) {
    issues.push('The title claims a daily schedule despite explicit weekday exclusions. Keep the schedule details in the description.');
  }
  if (!title.trim() || (titleOmissions.length > otherTitleParts.length && titleOmissions.length < activities.length)) {
    issues.push(`The title must cover the whole goal, including ${titleOmissions.join(', ')}. A concise umbrella title is allowed.`);
  }
  const descriptionOmissions = missingFrom(description);
  if (descriptionOmissions.length) issues.push(`The description must identify these activities by name: ${descriptionOmissions.join(', ')}.`);

  const expectationOmissions = missingFrom(expectation);
  const collective = /\b(?:both|all|each|every)\s+(?:(?:of|the|requested|scheduled|planned|listed|\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+)*(?:activit(?:y|ies)|subjects?|schedules?|parts?)\b|\b(?:combined|entire|whole)\s+(?:\p{L}+\s+)?(?:goal|plan)\b|\btheir respective schedules\b/iu;
  const allSessions = /\b(?:all|each|every)\s+(?:(?:of|the|requested|scheduled|planned|listed)\s+)*sessions?\b/i;
  if (expectationOmissions.length && !collective.test(expectation) &&
    !(expectationOmissions.length === activities.length && allSessions.test(expectation))) {
    issues.push(`The expectation must describe completion for the whole goal, including ${expectationOmissions.join(', ')}.`);
  }

  const clauses = activityClauses(description).map(text => {
    const words = activityWords(text);
    return { text, listed: activities.filter(activity => namesActivity(words, activity)) };
  });
  for (const activity of activities) {
    const intent = activity.intent;
    const namedClauses = clauses.filter(clause => clause.listed.includes(activity));
    if (intent.kind === 'weekdays' && intent.restricted && (intent.days?.length ?? 7) < 7 && namedClauses.length &&
      !namedClauses.some(clause => readWeekdays(clause.text).length)) {
      issues.push(`The description must preserve the weekday restrictions for "${activity.label}".`);
    }
    const conflicts = namedClauses.some(({ text, listed }) => {
      if (listed.length !== 1) return false;
      const stated = readScheduleIntent(text);
      if (intent.kind === 'weekdays' && stated?.kind === 'weekdays') {
        const expectedCount = intent.days?.length ?? intent.count;
        const statedCount = stated.days?.length ?? stated.count;
        return (expectedCount !== undefined && statedCount !== undefined && expectedCount !== statedCount) ||
          Boolean(stated.days && intent.days && stated.days.some(day => !intent.days?.includes(day)));
      }
      return intent.kind === 'dates' && stated?.kind === 'dates' &&
        (intent.dates.length !== stated.dates.length || stated.dates.some((date, index) => date !== intent.dates[index]));
    });
    if (conflicts) {
      issues.push(`The description gives "${activity.label}" a different schedule from the request.`);
    }
  }
  return issues;
}

type IndexedStep = { step: Step; index: number };

function validateActivity(
  prompt: string, intent: Intent | null, related: IndexedStep[], today: string, deadline: string,
  stepWeekdays: (number[] | undefined)[], activity?: string,
): ActivityViolation | null {
  let foundAction = false;
  let firstFailure: ActivityViolation | undefined;
  for (const { step, index } of related) {
    const stepNumber = index + 1;
    const violation = (code: ActivityViolation['code'], reason: string): ActivityViolation => ({
      code, activity, stepNumber,
      error: (activity ? `Activity "${activity}": ` : '') + reason.replace(/\bStep 1\b/, `Step ${stepNumber}`),
    });
    const declaredAction = typeof step.activityIndex === 'number';
    const actionError = primaryActionError(prompt, step);
    if (step.activityIndex !== null && !actionError) {
      const scheduleError = intent && scheduleIntentError(intent, step.schedule, today, deadline, stepWeekdays[index]);
      if (!scheduleError) {
        foundAction = true;
        continue;
      }
      const failure = { ...violation('schedule', scheduleError.error), rule: scheduleError.rule };
      if (declaredAction) return failure;
      // With older unlabelled responses this could be a supporting step. Check the other candidates.
      firstFailure ??= failure;
    } else if (declaredAction) {
      const administrative = isAdministrativeStep(prompt, step.text, step.description);
      const reason = administrative ? `${actionError} Mark preparation as supporting and include a concrete action that advances the goal.` : actionError!;
      const failure = { ...violation('primary_action', reason), rule: administrative ? 'preparation_only' : 'direct_action_wording' };
      // Without a required schedule, setup may accompany the action even if the model labelled both direct.
      if (!intent && administrative) {
        firstFailure ??= failure;
        continue;
      }
      return failure;
    } else if (actionError && !isAdministrativeStep(prompt, step.text, step.description)) {
      firstFailure ??= violation('primary_action', actionError);
    }
    const restriction = intent && supportingScheduleError(intent, step.schedule, today, deadline);
    if (restriction) return { ...violation('schedule', restriction), rule: 'support_within_permitted_dates' };
  }
  if (foundAction) return null;
  return firstFailure ?? {
    code: activity && !related.length ? 'activity_mapping' : 'primary_action', activity,
    error: `${activity ? `Activity "${activity}"` : 'The goal'} needs a step that directly performs the main activity.`,
  };
}

export function activityScheduleError(
  scope: ActivitySchedules | null, prompt: string, steps: Step[], today: string, deadline: string,
  stepWeekdays: (number[] | undefined)[],
): ActivityViolation | null {
  const activities = scope?.kind === 'scoped' ? scope.activities : [];
  const indexed = steps.map((step, index) => ({ step, index }));
  const invalid = indexed.find(({ step }) => step.activityIndex != null && step.activityIndex > (activities.length || 1));
  if (invalid) return { code: 'activity_mapping', stepNumber: invalid.index + 1, error: 'Use an activityIndex from the supplied request.' };
  if (!activities.length) {
    if (scope?.kind === 'single' && scope.planningDeliverable) {
      const recurring = indexed.find(({ step }) => step.schedule.type === 'repeat');
      if (recurring) return { code: 'schedule', rule: 'planning_step_nonrecurring', stepNumber: recurring.index + 1,
        error: 'No recurrence was requested for preparing the plan. Use Once or No Schedule for planning work.' };
    }
    return validateActivity(prompt, readScheduleIntent(prompt), indexed, today, deadline, stepWeekdays);
  }

  const groups = activities.map(() => [] as IndexedStep[]);
  const matching = (text: string) => {
    const words = activityWords(text);
    return activities.flatMap((activity, position) => namesActivity(words, activity) ? [position] : []);
  };
  for (const entry of indexed) {
    const { step, index } = entry;
    const titleMatches = matching(step.text);
    const matches = titleMatches.length ? titleMatches : matching(step.description ?? '');
    if (step.activityIndex != null) {
      const position = step.activityIndex - 1;
      if ((matches.length > 0 && !matches.includes(position)) || titleMatches.length > 1) {
        return { code: 'activity_mapping', stepNumber: index + 1, error: `Step ${index + 1} names a different or additional activity. Check its activityIndex and text.` };
      }
      groups[position].push(entry);
    } else if (matches.length > 1 && step.activityIndex !== null &&
      !matches.every(position => isAdministrativeStep(activities[position].clause, step.text, step.description))) {
      return { code: 'activity_mapping', stepNumber: index + 1, error: `Step ${index + 1} matches multiple activities. Give each activity its own direct step.` };
    } else {
      for (const position of matches) groups[position].push(entry);
    }
  }
  for (const [index, activity] of activities.entries()) {
    const error = validateActivity(activity.clause, activity.intent, groups[index], today, deadline, stepWeekdays, activity.label);
    if (error) return error;
  }
  return null;
}
