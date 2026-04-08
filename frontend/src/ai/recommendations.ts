import AsyncStorage from '@react-native-async-storage/async-storage';

import * as authApi from '../api/auth';

export type AiGoalRecommendation = {
  id: string;
  createdAt: number;
  status: 'pending' | 'accepted' | 'rejected';
  suggestion: authApi.AiGoalSuggestion;
  contextSummary: string;
};

const KEY_RECOS = 'ai_goal_recos_v1';
const MAX_RECOS = 50;

function safeParse(raw: string | null): AiGoalRecommendation[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map(x => ({
        id: String(x?.id ?? ''),
        createdAt: Number(x?.createdAt ?? 0),
        status: (x?.status === 'accepted' || x?.status === 'rejected' ? x.status : 'pending') as AiGoalRecommendation['status'],
        suggestion: x?.suggestion as authApi.AiGoalSuggestion,
        contextSummary: String(x?.contextSummary ?? ''),
      }))
      .filter(x => x.id && Number.isFinite(x.createdAt) && x.suggestion && typeof x.suggestion === 'object');
  } catch {
    return [];
  }
}

async function setAll(items: AiGoalRecommendation[]) {
  await AsyncStorage.setItem(KEY_RECOS, JSON.stringify(items.slice(0, MAX_RECOS)));
}

export async function listRecommendations(): Promise<AiGoalRecommendation[]> {
  const raw = await AsyncStorage.getItem(KEY_RECOS);
  const items = safeParse(raw);
  items.sort((a, b) => b.createdAt - a.createdAt);
  return items;
}

export async function getRecommendation(id: string): Promise<AiGoalRecommendation | null> {
  const all = await listRecommendations();
  return all.find(x => x.id === id) ?? null;
}

export async function upsertRecommendation(rec: AiGoalRecommendation): Promise<void> {
  const all = await listRecommendations();
  const next = [rec, ...all.filter(x => x.id !== rec.id)];
  await setAll(next);
}

export async function setRecommendationStatus(id: string, status: AiGoalRecommendation['status']): Promise<void> {
  const all = await listRecommendations();
  const next = all.map(x => (x.id === id ? { ...x, status } : x));
  await setAll(next);
}

export async function removeRecommendation(id: string): Promise<void> {
  const all = await listRecommendations();
  const next = all.filter(x => x.id !== id);
  await setAll(next);
}
