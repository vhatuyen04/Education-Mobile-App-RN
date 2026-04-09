import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'score_history_v2';

export type ScorePoint = { ts: number; score: number };

export async function getScoreHistory(): Promise<ScorePoint[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as any;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(v => ({ ts: Number(v?.ts ?? 0), score: Number(v?.score ?? 0) }))
      .filter(p => Number.isFinite(p.ts) && p.ts > 0 && Number.isFinite(p.score));
  } catch {
    return [];
  }
}

export async function setScoreHistory(points: ScorePoint[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(points));
}

export async function appendScorePoint(score: number, opts?: { ts?: number; maxPoints?: number }) {
  const ts = opts?.ts ?? Date.now();
  const maxPoints = opts?.maxPoints ?? 60;

  const prev = await getScoreHistory();
  const last = prev[prev.length - 1] ?? null;

  // Avoid duplicates if score didn't change.
  if (last && last.score === score) return prev;

  const next = [...prev, { ts, score }];
  const trimmed = next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
  await setScoreHistory(trimmed);
  return trimmed;
}
