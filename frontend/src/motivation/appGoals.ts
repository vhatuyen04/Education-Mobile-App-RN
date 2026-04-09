import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'app_goals_v1';

type MapValue = Record<string, 1>;

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

export async function markAppGoal(goalId: string) {
  const id = String(goalId);
  if (!id) return;
  const m = await getMap();
  m[id] = 1;
  await setMap(m);
}

export async function unmarkAppGoal(goalId: string) {
  const id = String(goalId);
  if (!id) return;
  const m = await getMap();
  if (m[id]) {
    delete m[id];
    await setMap(m);
  }
}

export async function isAppGoal(goalId: string): Promise<boolean> {
  const id = String(goalId);
  if (!id) return false;
  const m = await getMap();
  return m[id] === 1;
}
