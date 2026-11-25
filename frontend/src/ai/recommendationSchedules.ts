import { deviceCivilDate, utcMidnightIsoFromCivilText } from '../utils/recurrence';
import { parseScheduleShortText, scheduleDraftError, stepDateAfterGoalError, stepOutsideActiveRangeError, storedScheduleError } from '../utils/stepSchedule';
import type { AiGoalStepSchedule } from '../api/auth';

export function recommendationScheduleDrafts<T extends { scheduleText: string }>(steps: T[], deadline: string, now = new Date()) {
  const dueAt = utcMidnightIsoFromCivilText(deadline);
  const today = deviceCivilDate(now);
  return steps.map(step => {
    const schedule = parseScheduleShortText(step.scheduleText);
    const pastOnce = schedule.dueAt && schedule.dueAt.slice(0, 10) < today
      ? 'This proposed date is earlier than today. Choose a replacement in the schedule picker.'
      : null;
    const scheduleError = scheduleDraftError(step.scheduleText) ?? storedScheduleError(schedule)
      ?? pastOnce ?? stepDateAfterGoalError(schedule.dueAt, dueAt) ?? stepOutsideActiveRangeError(schedule, dueAt, today);
    return { ...step, scheduleError };
  });
}

export function recommendationStepFields(schedule: AiGoalStepSchedule) {
  if (schedule.type === 'once') return { dueAt: utcMidnightIsoFromCivilText(schedule.due) };
  if (schedule.type === 'none') return {};
  if (schedule.repeat === 'custom') return { repeat: 'custom', customDates: schedule.customDates ?? [] };
  return { repeat: schedule.repeat, repeatDay: schedule.repeatDay ?? null, repeatMonth: schedule.repeatMonth ?? null };
}
