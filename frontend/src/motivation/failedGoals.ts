import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'failed_goals_v1';

export type FailedReason = 'expired' | 'gave_up';

type MapValue = Record<string, FailedReason>;

async function getMap(): Promise<MapValue> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as MapValue;
  } catch {
    return {};
  }
}

async function setMap(m: MapValue) {
  await AsyncStorage.setItem(KEY, JSON.stringify(m));
}

export async function markFailedGoal(goalId: string, reason: FailedReason) {
  const id = String(goalId);
  if (!id) return;
  const m = await getMap();
  m[id] = reason;
  await setMap(m);
}

export async function unmarkFailedGoal(goalId: string) {
  const id = String(goalId);
  if (!id) return;
  const m = await getMap();
  if (m[id]) {
    delete m[id];
    await setMap(m);
  }
}

export async function getFailedGoalsMap(): Promise<MapValue> {
  return await getMap();
}

export async function getFailedReason(goalId: string): Promise<FailedReason | null> {
  const id = String(goalId);
  if (!id) return null;
  const m = await getMap();
  return (m[id] as FailedReason) ?? null;
}
