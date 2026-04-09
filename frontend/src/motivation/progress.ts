import AsyncStorage from '@react-native-async-storage/async-storage';

export type LocalProgress = {
  xp: number;
  level: number;
  smartGoalPoints: number;
  goalStreakDays: number;
  lastGoalCompletedYmd: string | null;
};

const KEY = 'local_progress_v1';

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(ymdStr: string, deltaDays: number) {
  const [yy, mm, dd] = ymdStr.split('-').map(v => Number(v));
  const dt = new Date(yy, (mm ?? 1) - 1, dd ?? 1);
  dt.setDate(dt.getDate() + deltaDays);
  return ymd(dt);
}

function computeLevel(xp: number) {
  const lvl = Math.floor(xp / 100) + 1;
  return Math.max(1, lvl);
}

export async function getLocalProgress(): Promise<LocalProgress> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return { xp: 0, level: 1, smartGoalPoints: 0, goalStreakDays: 0, lastGoalCompletedYmd: null };
  try {
    const parsed = JSON.parse(raw) as Partial<LocalProgress>;
    const xp = Number(parsed.xp ?? 0);
    const smartGoalPoints = Number((parsed as any).smartGoalPoints ?? 0);
    const goalStreakDays = Number((parsed as any).goalStreakDays ?? 0);
    const lastGoalCompletedYmd =
      typeof (parsed as any).lastGoalCompletedYmd === 'string' ? ((parsed as any).lastGoalCompletedYmd as string) : null;
    const level = computeLevel(xp);
    return { xp, level, smartGoalPoints, goalStreakDays, lastGoalCompletedYmd };
  } catch {
    return { xp: 0, level: 1, smartGoalPoints: 0, goalStreakDays: 0, lastGoalCompletedYmd: null };
  }
}

export async function setLocalProgress(p: LocalProgress) {
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify({
      xp: p.xp,
      level: computeLevel(p.xp),
      smartGoalPoints: p.smartGoalPoints,
      goalStreakDays: p.goalStreakDays,
      lastGoalCompletedYmd: p.lastGoalCompletedYmd,
    })
  );
}

export type ProgressEvent =
  | { type: 'step_done'; xpDelta: number; newProgress: LocalProgress }
  | { type: 'step_undone'; xpDelta: number; newProgress: LocalProgress }
  | { type: 'goal_completed'; xpDelta: number; newProgress: LocalProgress; goalStreakChanged: boolean };

export async function applyStepToggle(opts: { done: boolean; now?: Date }): Promise<ProgressEvent> {
  const prev = await getLocalProgress();

  if (!opts.done) {
    const xpDelta = 0;
    const next = { ...prev, level: computeLevel(prev.xp) };
    await setLocalProgress(next);
    return { type: 'step_undone', xpDelta, newProgress: next };
  }

  const xpDelta = 0;
  const next: LocalProgress = { ...prev, level: computeLevel(prev.xp) };
  await setLocalProgress(next);
  return { type: 'step_done', xpDelta, newProgress: next };
}

export async function applyGoalCompletedBonus(opts?: { now?: Date }): Promise<ProgressEvent> {
  const now = opts?.now ?? new Date();
  const today = ymd(now);
  const prev = await getLocalProgress();

  const xpDelta = 50;
  const xp = prev.xp + xpDelta;
  const smartGoalPoints = (prev.smartGoalPoints ?? 0) + 1;

  let goalStreakDays = prev.goalStreakDays;
  let lastGoalCompletedYmd = prev.lastGoalCompletedYmd;
  let goalStreakChanged = false;

  if (!lastGoalCompletedYmd) {
    goalStreakDays = 1;
    lastGoalCompletedYmd = today;
    goalStreakChanged = true;
  } else if (lastGoalCompletedYmd === today) {
    // already completed a goal today; keep streak
  } else if (addDays(lastGoalCompletedYmd, 1) === today) {
    goalStreakDays = Math.max(0, goalStreakDays) + 1;
    lastGoalCompletedYmd = today;
    goalStreakChanged = true;
  } else {
    goalStreakDays = 1;
    lastGoalCompletedYmd = today;
    goalStreakChanged = true;
  }

  const next: LocalProgress = { xp, level: computeLevel(xp), smartGoalPoints, goalStreakDays, lastGoalCompletedYmd };
  await setLocalProgress(next);
  return { type: 'goal_completed', xpDelta, newProgress: next, goalStreakChanged };
}
