import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '../theme/colors';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { Pill } from './Pill';
import { Step } from './StepEditorList';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import { markAppGoal } from '../motivation/appGoals';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

function normStepText(t: unknown) {
  return String(t ?? '')
    // Strip common invisible/format characters that make a step look blank.
    .replace(
      /[\u00A0\u180E\u2000-\u200F\u202A-\u202E\u202F\u205F\u2060\u2066-\u2069\u200B\u200C\u200D\u2007\u3000\u2800\u3164\uFEFF]/g,
      ' '
    )
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isScheduleTemplateText(t: unknown) {
  const s = normStepText(t);
  if (!s) return false;
  const lower = s.toLowerCase();
  const hasScheduleTokens =
    lower.includes('daily') || lower.includes('weekly') || lower.includes('monthly') || lower.includes('yearly') || lower.includes('once');
  if (!hasScheduleTokens) return false;

  // Remove schedule keywords + common schedule payload; if nothing meaningful remains, it's just a template.
  const remainder = lower
    .replace(/daily/g, '')
    .replace(/weekly/g, '')
    .replace(/monthly/g, '')
    .replace(/yearly/g, '')
    .replace(/once/g, '')
    .replace(/[:]/g, '')
    .replace(/[0-9\-|/.,]/g, '')
    .replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/g, '')
    .replace(/\s+/g, '')
    .replace(/[|｜¦∣]/g, '');

  return remainder.length === 0;
}

function isMeaningfulStepText(t: unknown) {
  const s = normStepText(t);
  if (!s) return false;
  // If AI outputs a schedule template (uses pipe separators), it's not a real step.
  if (/[|｜¦∣]/.test(s)) return false;
  if (isScheduleTemplateText(s)) return false;
  // If AI accidentally returns a schedule string as the step text, hide it.
  // Example: "daily | weekly:Mon | monthly:15 | yearly:01-15 | once:2026-06-06"
  const lower = s.toLowerCase();
  const hasScheduleTokens =
    lower.includes('daily') || lower.includes('weekly:') || lower.includes('monthly:') || lower.includes('yearly:') || lower.includes('once:');
  if (hasScheduleTokens) {
    const stripped = lower
      .replace(/daily/g, '')
      .replace(/weekly:/g, '')
      .replace(/monthly:/g, '')
      .replace(/yearly:/g, '')
      .replace(/once:/g, '')
      .replace(/[0-9\-|:/.]/g, '')
      .replace(/\b(mon|tue|wed|thu|fri|sat|sun)\b/g, '')
      .replace(/\s+/g, '')
      .replace(/\|/g, '');
    // If nothing remains besides schedule tokens, it's not a real step description.
    if (!/[a-z]/i.test(stripped)) return false;
  }

  // Require at least one alphabetic character to avoid rendering garbage like only numbers/symbols.
  return /[a-z]/i.test(s);
}

function sanitizePlannerSteps(input: Array<Step & { schedule?: authApi.AiGoalStepSchedule }>) {
  const out = (Array.isArray(input) ? input : [])
    .map(s => {
      const text = normStepText(s.text);
      if (!text) return null;

      const schedule = s.schedule;

      // If schedule is a placeholder/template string, drop it.
      if (schedule && schedule.type === 'repeat') {
        const rep = String((schedule as any).repeat ?? '').trim();
        const repLower = rep.toLowerCase();
        const tokenHits = [
          repLower.includes('daily'),
          repLower.includes('weekly'),
          repLower.includes('monthly'),
          repLower.includes('yearly'),
          repLower.includes('once'),
        ].filter(Boolean).length;

        // If it looks like the AI "options" template (contains multiple schedule tokens), treat as none.
        if (/[|｜¦∣]/.test(rep) || tokenHits >= 2) {
          return { ...s, text, schedule: { type: 'none' } as authApi.AiGoalStepSchedule };
        }
      }

      return { ...s, text, schedule };
    })
    .filter(Boolean) as Array<Step & { schedule?: authApi.AiGoalStepSchedule }>;

  return out.filter(s => isMeaningfulStepText(s.text));
}

function makeId() {
  return `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatWeekday(d: number | undefined) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (d === undefined || d === null) return '';
  const idx = Number(d);
  if (!Number.isFinite(idx) || idx < 0 || idx > 6) return '';
  return days[idx];
}

function parseWeekdayToken(token: string): number | null {
  const t = token.trim().toLowerCase();
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
  if (t in map) return map[t];
  const n = Number(t);
  if (Number.isFinite(n) && n >= 0 && n <= 6) return n;
  return null;
}

function scheduleToShortText(s?: authApi.AiGoalStepSchedule) {
  if (!s || s.type === 'none') return '';
  if (s.type === 'once') return `once:${s.due}`;
  const r = (s.repeat ?? '').trim();
  // Drop AI placeholder/template schedule strings.
  const rLowerAll = r.toLowerCase();
  const tokenHits = [
    rLowerAll.includes('daily'),
    rLowerAll.includes('weekly'),
    rLowerAll.includes('monthly'),
    rLowerAll.includes('yearly'),
    rLowerAll.includes('once'),
  ].filter(Boolean).length;
  if (/[|｜¦∣]/.test(r) || tokenHits >= 2) return '';
  const rLower = r.toLowerCase();
  if (rLower === 'daily') return 'daily';
  if (rLower === 'weekly') return s.repeatDay !== undefined ? `weekly:${formatWeekday(s.repeatDay) || String(s.repeatDay)}` : 'weekly';
  if (rLower === 'monthly') return s.repeatDay !== undefined ? `monthly:${String(s.repeatDay)}` : 'monthly';
  if (rLower === 'yearly') {
    const mm = s.repeatMonth !== undefined ? String(s.repeatMonth).padStart(2, '0') : '';
    const dd = s.repeatDay !== undefined ? String(s.repeatDay).padStart(2, '0') : '';
    return mm && dd ? `yearly:${mm}-${dd}` : 'yearly';
  }
  return `repeat:${r}`;
}

function parseScheduleShortText(input: string): authApi.AiGoalStepSchedule {
  const raw = String(input ?? '').trim();
  if (!raw) return { type: 'none' };

  // Reject the placeholder/template string format ("daily | weekly:Mon | ...").
  if (/[|｜¦∣]/.test(raw)) return { type: 'none' };

  const lower = raw.toLowerCase();
  if (lower.startsWith('once:')) {
    const due = raw.slice(5).trim();
    return { type: 'once', due };
  }

  if (lower === 'daily') return { type: 'repeat', repeat: 'daily' };

  if (lower === 'weekly') return { type: 'repeat', repeat: 'weekly' };
  if (lower.startsWith('weekly:')) {
    const tok = raw.slice(7).trim();
    const dow = parseWeekdayToken(tok);
    return { type: 'repeat', repeat: 'weekly', ...(dow !== null ? { repeatDay: dow } : null) } as any;
  }

  if (lower === 'monthly') return { type: 'repeat', repeat: 'monthly' };
  if (lower.startsWith('monthly:')) {
    const tok = raw.slice(8).trim();
    const day = Number(tok);
    return { type: 'repeat', repeat: 'monthly', ...(Number.isFinite(day) ? { repeatDay: day } : null) } as any;
  }

  if (lower === 'yearly') return { type: 'repeat', repeat: 'yearly' };
  if (lower.startsWith('yearly:')) {
    const tok = raw.slice(7).trim();
    const m = tok.match(/^(\d{1,2})\s*[-/.,]\s*(\d{1,2})$/);
    if (m) {
      const month = Number(m[1]);
      const day = Number(m[2]);
      return { type: 'repeat', repeat: 'yearly', ...(Number.isFinite(month) ? { repeatMonth: month } : null), ...(Number.isFinite(day) ? { repeatDay: day } : null) } as any;
    }
    return { type: 'repeat', repeat: 'yearly' };
  }

  if (lower.startsWith('repeat:')) {
    const repeat = raw.slice(7).trim();
    return repeat ? { type: 'repeat', repeat } : { type: 'none' };
  }

  return { type: 'repeat', repeat: raw };
}

function formatDateYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(raw: string): Date | null {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseDmy(raw: string): Date | null {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toEndOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function clampToDeadline(d: Date, deadline: Date) {
  return d.getTime() > deadline.getTime() ? new Date(deadline) : d;
}

function nextOrSameWeekday(from: Date, targetDow: number) {
  const base = new Date(from);
  base.setHours(0, 0, 0, 0);
  const cur = base.getDay();
  const delta = (targetDow - cur + 7) % 7;
  const out = new Date(base);
  out.setDate(out.getDate() + delta);
  return out;
}

function countRepeatOccurrencesUntilDeadline(params: {
  repeat: string;
  repeatDay?: number;
  repeatMonth?: number;
  start: Date;
  deadline: Date;
}): { count: number; lastOccurrence: Date | null } {
  const repeat = params.repeat.trim().toLowerCase();
  const start0 = new Date(params.start);
  start0.setHours(0, 0, 0, 0);
  const dl0 = toEndOfDay(params.deadline);

  if (dl0.getTime() < start0.getTime()) return { count: 0, lastOccurrence: null };

  if (repeat === 'daily') {
    const dayMs = 24 * 60 * 60 * 1000;
    const days = Math.floor((dl0.getTime() - start0.getTime()) / dayMs) + 1;
    const last = new Date(start0.getTime() + (days - 1) * dayMs);
    return { count: Math.max(0, days), lastOccurrence: last };
  }

  if (repeat === 'weekly') {
    const dow = params.repeatDay;
    if (dow === undefined || dow === null || !Number.isFinite(Number(dow))) return { count: 0, lastOccurrence: null };
    const target = Number(dow);
    if (target < 0 || target > 6) return { count: 0, lastOccurrence: null };

    let first = nextOrSameWeekday(start0, target);
    if (first.getTime() < start0.getTime()) first = nextOrSameWeekday(new Date(start0.getTime() + 24 * 60 * 60 * 1000), target);
    if (first.getTime() > dl0.getTime()) return { count: 0, lastOccurrence: null };

    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const diff = dl0.getTime() - first.getTime();
    const n = Math.floor(diff / weekMs) + 1;
    const last = new Date(first.getTime() + (n - 1) * weekMs);
    return { count: Math.max(0, n), lastOccurrence: last };
  }

  if (repeat === 'monthly') {
    const day = params.repeatDay;
    if (day === undefined || day === null || !Number.isFinite(Number(day))) return { count: 0, lastOccurrence: null };
    const targetDay = Math.max(1, Math.min(31, Number(day)));

    let y = start0.getFullYear();
    let m = start0.getMonth();
    let cand = new Date(y, m, targetDay);
    if (cand.getTime() < start0.getTime()) {
      m += 1;
      cand = new Date(y, m, targetDay);
    }
    if (cand.getTime() > dl0.getTime()) return { count: 0, lastOccurrence: null };

    let count = 0;
    let last: Date | null = null;
    while (cand.getTime() <= dl0.getTime() && count < 400) {
      count += 1;
      last = new Date(cand);
      m += 1;
      cand = new Date(y, m, targetDay);
      y = cand.getFullYear();
    }
    return { count, lastOccurrence: last };
  }

  if (repeat === 'yearly') {
    const mm = params.repeatMonth;
    const dd = params.repeatDay;
    if (mm === undefined || mm === null || dd === undefined || dd === null) return { count: 0, lastOccurrence: null };
    const month = Number(mm);
    const day = Number(dd);
    if (!Number.isFinite(month) || !Number.isFinite(day)) return { count: 0, lastOccurrence: null };
    if (month < 1 || month > 12) return { count: 0, lastOccurrence: null };
    if (day < 1 || day > 31) return { count: 0, lastOccurrence: null };

    let y = start0.getFullYear();
    let cand = new Date(y, month - 1, day);
    if (cand.getTime() < start0.getTime()) {
      y += 1;
      cand = new Date(y, month - 1, day);
    }
    if (cand.getTime() > dl0.getTime()) return { count: 0, lastOccurrence: null };

    let count = 0;
    let last: Date | null = null;
    while (cand.getTime() <= dl0.getTime() && count < 50) {
      count += 1;
      last = new Date(cand);
      y += 1;
      cand = new Date(y, month - 1, day);
    }
    return { count, lastOccurrence: last };
  }

  return { count: 0, lastOccurrence: null };
}

function normalizeAiStepSchedule(schedule: authApi.AiGoalStepSchedule | undefined, deadlineYmd: string) {
  if (!schedule) return schedule;
  if (schedule.type !== 'repeat') return schedule;

  // Sometimes AI returns multiple schedule options as one string ("daily | weekly:Mon | ...").
  // Treat that as invalid/no schedule.
  const rawRepeat = String((schedule as any).repeat ?? '').trim();
  if (!rawRepeat || /[|｜¦∣]/.test(rawRepeat)) return { type: 'none' } as any;

  const dl = parseYmd(deadlineYmd) ?? parseDmy(deadlineYmd);
  if (!dl) return schedule;

  const repeat = String(schedule.repeat ?? '').trim().toLowerCase();
  if (!repeat) return { type: 'none' } as authApi.AiGoalStepSchedule;

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const { count, lastOccurrence } = countRepeatOccurrencesUntilDeadline({
    repeat,
    repeatDay: schedule.repeatDay,
    repeatMonth: schedule.repeatMonth,
    start,
    deadline: dl,
  });

  // If it can happen 2+ times before the deadline, keep the repeat schedule.
  if (count >= 2) return schedule;

  // Otherwise convert to once, at the last possible occurrence on/before the deadline.
  const pick = lastOccurrence ? clampToDeadline(lastOccurrence, dl) : new Date(dl);
  const ymd = formatDateYmd(pick);
  return { type: 'once', due: ymd } as authApi.AiGoalStepSchedule;
}

type PlanDeadline = { date: Date; label: string };

function parseDeadlineFromPlanText(planText: string): PlanDeadline | null {
  const txt = String(planText ?? '');

  const absMatch = txt.match(/\b(?:by|before|until|deadline\s*[:=]?)\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})\b/i);
  if (absMatch?.[1]) {
    const d = parseYmd(absMatch[1]) ?? parseDmy(absMatch[1]);
    if (d) return { date: d, label: absMatch[1] };
  }

  const relMatch =
    txt.match(/\b(?:in|within|for)\s*(\d+)\s*(day|days|week|weeks|month|months)\b/i) ??
    txt.match(/\b(\d+)\s*[- ]\s*(day|days|week|weeks|month|months)\b/i);
  if (relMatch?.[1] && relMatch?.[2]) {
    const n = Number(relMatch[1]);
    const unit = relMatch[2].toLowerCase();
    if (!Number.isFinite(n) || n <= 0) return null;
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const d = new Date(base);
    if (unit.startsWith('day')) d.setDate(d.getDate() + n);
    else if (unit.startsWith('week')) d.setDate(d.getDate() + n * 7);
    else if (unit.startsWith('month')) d.setMonth(d.getMonth() + n);
    return { date: d, label: `${n} ${unit}` };
  }

  return null;
}

function isSimilarDeadline(a: Date, b: Date) {
  const ms = Math.abs(a.getTime() - b.getTime());
  const days = ms / (1000 * 60 * 60 * 24);
  return days <= 3;
}

function inferFieldFromText(text: string): 'Sport' | 'Academy' | 'Entertainment' {
  const t = (text || '').toLowerCase();
  if (t.includes('gym') || t.includes('run') || t.includes('basket') || t.includes('swim') || t.includes('fitness')) return 'Sport';
  if (t.includes('thesis') || t.includes('study') || t.includes('exam') || t.includes('database') || t.includes('ielts')) return 'Academy';
  if (t.includes('game') || t.includes('lol') || t.includes('movie') || t.includes('music')) return 'Entertainment';
  return 'Academy';
}

function defaultGoalTitle(text: string) {
  const firstLine = (text || '').trim().split(/\r?\n/)[0] || 'My new plan';
  return firstLine.length > 46 ? `${firstLine.slice(0, 46)}…` : firstLine;
}

export function AiPlannerModal({ visible, onClose, onSaved }: Props) {
  const { state } = useAuth();
  const [planText, setPlanText] = useState('');
  const [deadline, setDeadline] = useState('');
  const [intensity, setIntensity] = useState<'Light' | 'Normal' | 'Hard'>('Normal');

  const [aiHelp, setAiHelp] = useState<{ message: string; questions: string[] } | null>(null);
  const [dirty, setDirty] = useState(false);

  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);

  const [goalTitle, setGoalTitle] = useState('');
  const [goalField, setGoalField] = useState<'Sport' | 'Academy' | 'Entertainment'>('Academy');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [goalRequirement, setGoalRequirement] = useState('');
  const [goalPointsAwarded, setGoalPointsAwarded] = useState<number | null>(null);
  const [goalXpAwarded, setGoalXpAwarded] = useState<number | null>(null);
  const [steps, setSteps] = useState<Array<Step & { schedule?: authApi.AiGoalStepSchedule }>>([]);

  const displaySteps = useMemo(() => sanitizePlannerSteps(steps), [steps]);
  const stepCount = displaySteps.length;

  const templates = useMemo(
    () => [
      { label: 'Study plan', text: 'Study plan: I want to study ___ for ___ weeks.' },
      { label: 'Fitness plan', text: 'Fitness plan: I want to improve ___ in ___ weeks.' },
      { label: 'Thesis plan', text: 'Thesis plan: I want to finish chapter ___ by ___.' },
      { label: 'Balanced week', text: 'Balanced week: I need to balance study, sport and rest. I want 1 main goal and small daily tasks.' },
    ],
    []
  );

  function resetGenerated() {
    setGenerated(false);
    setGoalTitle('');
    setGoalField('Academy');
    setGoalDeadline(deadline);
    setGoalRequirement('');
    setGoalPointsAwarded(null);
    setGoalXpAwarded(null);
    setSteps([]);
    setAiHelp(null);
    setDirty(false);
  }

  const closeAndReset = useCallback(() => {
    resetGenerated();
    onClose();
  }, [onClose, resetGenerated]);

  async function resolveDeadlineForPlan(override?: string): Promise<string | null> {
    const input = String(override ?? deadline ?? '').trim();
    const fromPlan = parseDeadlineFromPlanText(planText);

    if (fromPlan && !input) {
      const auto = formatDateYmd(fromPlan.date);
      setDeadline(auto);
      return auto;
    }

    if (!fromPlan) {
      return input || null;
    }

    if (!input) {
      const auto = formatDateYmd(fromPlan.date);
      setDeadline(auto);
      return auto;
    }

    const inputDate = parseYmd(input) ?? parseDmy(input);
    if (!inputDate) {
      return input;
    }

    if (isSimilarDeadline(fromPlan.date, inputDate)) {
      return input;
    }

    const planChoice = formatDateYmd(fromPlan.date);
    const inputChoice = formatDateYmd(inputDate);

    return new Promise(resolve => {
      Alert.alert(
        'Choose deadline',
        `Your plan mentions a deadline that differs from the Deadline field.\n\nFrom plan: ${planChoice}\nFrom field: ${inputChoice}`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => resolve(null),
          },
          {
            text: `Use ${planChoice}`,
            onPress: () => {
              setDeadline(planChoice);
              resolve(planChoice);
            },
          },
          {
            text: `Use ${inputChoice}`,
            onPress: () => resolve(inputChoice),
          },
        ]
      );
    });
  }

  function insertTemplate(t: string) {
    setPlanText(t);
    setAiHelp(null);
    if (generated) setDirty(true);
  }

  function addStep() {
    setSteps(prev => [...prev, { id: makeId(), text: 'New step', schedule: { type: 'none' } }]);
  }

  function removeStep(id: string) {
    setSteps(prev => prev.filter(s => s.id !== id));
  }

  function parseDeadlineToISOEndOfDay(v: string, opts?: { mustBeFuture?: boolean }): string | null {
    const raw = v.trim();
    if (!raw) return null;

    // Accept ISO datetime strings too.
    if (raw.includes('T')) {
      const iso = new Date(raw);
      if (!Number.isNaN(iso.getTime())) {
        iso.setHours(23, 59, 59, 999);

        if (opts?.mustBeFuture) {
          const now = new Date();
          const today0 = new Date(now);
          today0.setHours(0, 0, 0, 0);
          if (iso.getTime() < today0.getTime()) return null;
        }

        return iso.toISOString();
      }
    }

    const parsed = parseYmd(raw) ?? parseDmy(raw);
    if (!parsed) return null;
    const d = new Date(parsed);

    d.setHours(23, 59, 59, 999);

    if (opts?.mustBeFuture) {
      const now = new Date();
      const today0 = new Date(now);
      today0.setHours(0, 0, 0, 0);
      if (d.getTime() < today0.getTime()) return null;
    }

    return d.toISOString();
  }

  async function generate() {
    if (!planText.trim()) {
      toast('Please describe your plan first');
      return;
    }

    if (planText.includes('___')) {
      toast('Please fill in the blanks (___) in your plan first.');
      return;
    }

    const resolvedDeadline = await resolveDeadlineForPlan();
    if (!resolvedDeadline) {
      toast('Please enter a deadline (or mention it in your plan like “in 6 weeks”).');
      return;
    }

    const dl = parseDeadlineToISOEndOfDay(resolvedDeadline, { mustBeFuture: true });
    if (!dl) {
      toast('Please enter a valid future deadline');
      return;
    }

    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }

    setGenerated(false);
    setAiHelp(null);
    setDirty(false);
    setLoading(true);

    try {
      const resp = await authApi.aiSuggestGoal(token, { prompt: planText.trim(), deadline: dl, intensity });
      if (!resp.ok) {
        setAiHelp({ message: resp.message, questions: resp.questions ?? [] });
        return;
      }

      setGoalTitle(resp.suggestion.title || defaultGoalTitle(planText));
      setGoalField(resp.suggestion.field);
      setGoalDeadline(resp.suggestion.deadline || resolvedDeadline);
      setGoalRequirement(resp.suggestion.requirement || '');
      setGoalPointsAwarded(typeof (resp.suggestion as any).pointsAwarded === 'number' ? (resp.suggestion as any).pointsAwarded : null);
      setGoalXpAwarded(typeof (resp.suggestion as any).xpAwarded === 'number' ? (resp.suggestion as any).xpAwarded : null);
      const effectiveDeadline = resp.suggestion.deadline || resolvedDeadline;
      const mapped = resp.suggestion.steps.map(s => ({
        id: makeId(),
        text: s.text,
        schedule: normalizeAiStepSchedule(s.schedule, effectiveDeadline),
      }));
      const sanitized = sanitizePlannerSteps(mapped);
      setSteps(sanitized);
      setGenerated(true);
      setDirty(false);
      toast('SmartGoal suggestion ready');
    } catch (e: any) {
      toast(String(e?.message ?? 'AI failed'));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    const title = goalTitle.trim();
    const nonEmptySteps = sanitizePlannerSteps(steps);
    const stepTexts = nonEmptySteps.map(s => s.text);
    if (!title) {
      toast('Goal title is required');
      return;
    }
    if (stepTexts.length === 0) {
      toast('Please add at least 1 step');
      return;
    }

    const token = state.accessToken;
    if (!token) {
      toast('Not signed in');
      return;
    }

    if (loading) return;
    setLoading(true);
    try {
      const resolvedDeadline = await resolveDeadlineForPlan(goalDeadline || deadline);
      if (!resolvedDeadline) return;

      const dueIso = parseDeadlineToISOEndOfDay(resolvedDeadline, { mustBeFuture: true });
      if (!dueIso) {
        toast('Please enter a valid future deadline');
        return;
      }

      const created = await authApi.createGoal(token, {
        title,
        description: planText.trim() ? planText.trim() : null,
        requirement: goalRequirement.trim() ? goalRequirement.trim() : null,
        rankField: goalField,
        dueAt: dueIso,
        pointsAwarded: goalPointsAwarded ?? undefined,
        xpAwarded: goalXpAwarded ?? undefined,
      });

      const goalId = created.goal.id;
      await markAppGoal(goalId);

      const allSteps = nonEmptySteps
        .map((s, idx) => ({ s, idx, text: s.text.trim() }))
        .filter(x => x.text);

      for (const { s, idx, text } of allSteps) {
        const schedule = (s.schedule ?? { type: 'none' }) as authApi.AiGoalStepSchedule;
        const body: any = { text, order: idx };

        if (schedule.type === 'once') {
          const d = parseYmd(schedule.due);
          if (d) {
            d.setHours(23, 59, 59, 999);
            body.dueAt = d.toISOString();
          }
        } else if (schedule.type === 'repeat') {
          body.repeat = schedule.repeat;
          body.repeatDay = schedule.repeatDay ?? null;
          body.repeatMonth = schedule.repeatMonth ?? null;
        }

        await authApi.createGoalStep(token, goalId, body);
      }

      toast('Saved');
      onSaved?.();
      resetGenerated();
      onClose();
    } catch (e: any) {
      toast(String(e?.message ?? 'Save failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={closeAndReset}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeAndReset} />

        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>SmartGoal Planner</Text>
            <Pressable onPress={closeAndReset} hitSlop={10}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.mutedSmall}>Describe your plan. SmartGoal will suggest 1 goal and a checklist. Requirement is determined completely by the SmartGoal app.</Text>

            <View style={styles.field}>
              <Text style={styles.label}>Your plan</Text>
              <TextInput
                value={planText}
                onChangeText={t => {
                  setPlanText(t);
                  setAiHelp(null);
                  if (generated) setDirty(true);
                }}
                placeholder="Example: I want to prepare for database exam in 3 weeks."
                placeholderTextColor={colors.muted}
                multiline
                style={styles.textarea}
              />
            </View>

            <View style={styles.chipsRow}>
              {templates.map(t => (
                <Pressable key={t.label} onPress={() => insertTemplate(t.text)} style={styles.chip}>
                  <Text style={styles.chipText}>{t.label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Deadline</Text>
                <TextInput
                  value={deadline}
                  onChangeText={t => {
                    setDeadline(t);
                    setAiHelp(null);
                    if (generated) setDirty(true);
                  }}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
                <Text style={[styles.mutedSmall, { marginTop: 6 }]}>Example: 2027-01-01</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Intensity</Text>
                <View style={styles.selectRow}>
                  {(['Light', 'Normal', 'Hard'] as const).map(v => (
                    <Pressable
                      key={v}
                      onPress={() => {
                        setIntensity(v);
                        setAiHelp(null);
                        if (generated) setDirty(true);
                      }}
                      style={[styles.selectOpt, intensity === v ? styles.selectOptOn : null]}
                    >
                      <Text style={[styles.selectText, intensity === v ? styles.selectTextOn : null]}>{v}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

            <View style={{ height: 10 }} />
            <Button title={generated ? 'Regenerate' : 'Generate suggestions'} variant="primary" full onPress={generate} />

            {loading ? <Text style={[styles.mutedSmall, { marginTop: 10 }]}>Thinking…</Text> : null}

            {generated && dirty ? (
              <Text style={[styles.mutedSmall, { marginTop: 10 }]}>Plan updated. Tap Regenerate to update the goal.</Text>
            ) : null}

            {aiHelp ? (
              <Card style={{ marginTop: 12 }}>
                <Text style={[styles.cardTitle, { marginBottom: 6 }]}>AI needs more info</Text>
                <Text style={styles.mutedSmall}>{aiHelp.message}</Text>
                {aiHelp.questions?.length ? (
                  <View style={{ marginTop: 10, gap: 6 }}>
                    {aiHelp.questions.map((q, i) => (
                      <Text key={`${i}_${q}`} style={styles.mutedSmall}>
                        {i + 1}. {q}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </Card>
            ) : null}

            {generated ? (
              <View style={{ marginTop: 12, gap: 12 }}>
                <Card>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>Suggested goal</Text>
                  </View>

                  <View style={[styles.field, { marginTop: 10 }]}
                  >
                    <Text style={styles.label}>Goal title</Text>
                    <Text style={styles.stepItemText}>{goalTitle}</Text>
                  </View>

                  <View style={[styles.field, { marginTop: 10 }]}
                  >
                    <Text style={styles.label}>Requirement</Text>
                    <Text style={styles.mutedSmall}>{goalRequirement || '—'}</Text>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <Pill>Field: {goalField}</Pill>
                    <Pill>Deadline: {goalDeadline || deadline || '—'}</Pill>
                    {typeof goalPointsAwarded === 'number' ? <Pill>Points: {goalPointsAwarded}</Pill> : null}
                    {typeof goalXpAwarded === 'number' ? <Pill>XP: {goalXpAwarded}</Pill> : null}
                  </View>
                </Card>

                <Card>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>Steps</Text>
                    <Badge>{stepCount} steps</Badge>
                  </View>

                  <View style={{ marginTop: 10 }}>
                    <View style={{ gap: 10 }}>
                      {displaySteps.map((s, idx) => (
                        <View key={s.id} style={styles.stepItemRow}>
                          <Text style={styles.stepNum}>{idx + 1}.</Text>
                          <View style={styles.stepTextCol}>
                            <Text style={styles.stepItemText}>{s.text}</Text>
                          </View>
                          <View style={styles.stepScheduleCol}>
                            <TextInput
                              value={scheduleToShortText(s.schedule)}
                              onChangeText={t => {
                                setSteps(prev =>
                                  prev.map(p => {
                                    if (p.id !== s.id) return p;
                                    return { ...p, schedule: parseScheduleShortText(t) };
                                  })
                                );
                              }}
                              placeholder="daily | weekly:Mon | monthly:15 | yearly:01-15 | once:2027-01-01"
                              placeholderTextColor={colors.muted}
                              style={[styles.input, styles.stepScheduleInput]}
                            />
                            <Text style={styles.mutedSmall}>Optional. Leave empty to ignore.</Text>
                          </View>
                          <Pressable onPress={() => removeStep(s.id)} hitSlop={10} style={styles.stepRemove}>
                            <Text style={styles.stepRemoveText}>🗑</Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  </View>

                  <View style={{ height: 10 }} />
                  <Button title={'+ Add step'} full onPress={addStep} />
                </Card>

                <View style={{ gap: 8 }}>
                  <Button title={'Save'} variant="primary" full onPress={save} />
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingTop: 12,
    height: '90%',
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  close: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  mutedSmall: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  field: {
    marginTop: 10,
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 6,
  },
  textarea: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    borderRadius: 14,
    padding: 10,
    color: colors.text,
    fontWeight: '800',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: colors.text,
    fontWeight: '900',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
  },
  chipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  row2: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  selectRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectOpt: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
  },
  selectOptOn: {
    backgroundColor: colors.primary,
    borderColor: 'transparent',
  },
  selectText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  selectTextOn: {
    color: '#06101f',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  hint: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  stepRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 14,
  },
  stepRowDone: {
    opacity: 0.92,
  },
  stepCheck: {
    width: 18,
    height: 18,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCheckOn: {
    backgroundColor: colors.success,
    borderColor: 'transparent',
  },
  stepCheckMark: {
    color: colors.surface,
    fontWeight: '900',
    fontSize: 12,
    lineHeight: 12,
  },
  stepLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  stepText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
  stepItemRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 14,
  },
  stepNum: {
    color: colors.muted,
    fontWeight: '900',
    width: 20,
    textAlign: 'right',
    paddingTop: 1,
  },
  stepItemText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  stepTextCol: {
    flex: 1,
    minWidth: 0,
  },
  stepScheduleCol: {
    gap: 6,
    alignItems: 'flex-end',
    flexShrink: 1,
    maxWidth: 170,
  },
  stepScheduleInput: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    minWidth: 120,
    maxWidth: 170,
    flexShrink: 1,
  },
  stepRemove: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  stepRemoveText: {
    color: colors.danger,
    fontWeight: '900',
  },
});
