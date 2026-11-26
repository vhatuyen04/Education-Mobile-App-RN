import { deviceCivilDate, realCivilDate } from '../utils/recurrence';

// Only the dedicated date field is parsed on device. Goal prose goes to the model.
export function resolvePlannerDeadline(field: string, now = new Date()) {
  const text = field.trim();
  if (!text) return { kind: 'missing' } as const;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const civil = realCivilDate(us ? us[3] + '-' + us[1].padStart(2, '0') + '-' + us[2].padStart(2, '0') : text);
  if (!civil) return { kind: 'invalid' } as const;
  if (civil < deviceCivilDate(now)) return { kind: 'past' } as const;
  const [year, month, day] = civil.split('-').map(Number);
  const dueAt = new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
  return { kind: 'resolved', civil, dueAt } as const;
}
