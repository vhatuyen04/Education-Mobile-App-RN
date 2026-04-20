import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

type InboxItem = {
  id: string;
  receivedAt: number;
  title: string;
  body: string;
  data?: Record<string, any> | null;
};

const KEY_INBOX = 'notif_inbox_v1';
const MAX_ITEMS = 200;
const KEY_LAST_USER_ID = 'auth_last_user_id_v1';

async function getInboxKey(): Promise<string> {
  try {
    const raw = await SecureStore.getItemAsync('auth_user');
    if (!raw) {
      try {
        const last = await AsyncStorage.getItem(KEY_LAST_USER_ID);
        const id = String(last ?? '').trim();
        if (id) return `${KEY_INBOX}_${id}`;
      } catch {
      }
      return `${KEY_INBOX}_anon`;
    }
    const user = JSON.parse(raw);
    const id = String(user?.id ?? '');
    if (!id) return `${KEY_INBOX}_anon`;
    return `${KEY_INBOX}_${id}`;
  } catch {
    return `${KEY_INBOX}_anon`;
  }
}

function safeParse(raw: string | null): InboxItem[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map(x => ({
        id: String(x?.id ?? ''),
        receivedAt: Number(x?.receivedAt ?? 0),
        title: String(x?.title ?? ''),
        body: String(x?.body ?? ''),
        data: x?.data && typeof x.data === 'object' ? (x.data as any) : null,
      }))
      .filter(x => x.id && Number.isFinite(x.receivedAt));
  } catch {
    return [];
  }
}

export async function getInbox(): Promise<InboxItem[]> {
  const key = await getInboxKey();
  const raw = await AsyncStorage.getItem(key);
  const items = safeParse(raw);
  const bySemantic = new Map<string, InboxItem>();
  for (const it of items) {
    const d: any = it.data ?? null;
    const scheduledForMs = Number(d?.scheduledForMs ?? NaN);
    const kind = String(d?.kind ?? '').trim();
    const entityId = String(d?.eventId ?? d?.goalId ?? d?.stepId ?? '').trim();
    const semanticKey = kind && entityId && Number.isFinite(scheduledForMs)
      ? `k:${kind}|id:${entityId}|t:${Math.floor(scheduledForMs)}`
      : `id:${it.id}`;
    const prev = bySemantic.get(semanticKey);
    if (!prev || it.receivedAt > prev.receivedAt) bySemantic.set(semanticKey, it);
  }
  const unique = Array.from(bySemantic.values());
  unique.sort((a, b) => b.receivedAt - a.receivedAt);
  return unique;
}

export async function appendInbox(item: Omit<InboxItem, 'id'> & { id?: string }): Promise<void> {
  const id = String(item.id ?? `${item.receivedAt}-${Math.random().toString(16).slice(2)}`);
  const next: InboxItem = {
    id,
    receivedAt: item.receivedAt,
    title: item.title,
    body: item.body,
    data: item.data ?? null,
  };

  const key = await getInboxKey();
  const prev = await getInbox();
  if (prev.some(x => x.id === id)) return;
  const merged = [next, ...prev].slice(0, MAX_ITEMS);
  await AsyncStorage.setItem(key, JSON.stringify(merged));
}

export async function clearInbox(): Promise<void> {
  const key = await getInboxKey();
  await AsyncStorage.removeItem(key);
}

export async function removeInboxItem(id: string): Promise<void> {
  const key = await getInboxKey();
  const prev = await getInbox();
  const next = prev.filter(x => x.id !== id);
  await AsyncStorage.setItem(key, JSON.stringify(next));
}

export async function removeInboxItemsByRecoId(recoId: string): Promise<void> {
  const key = await getInboxKey();
  const prev = await getInbox();
  const rid = String(recoId);
  const next = prev.filter(x => String((x as any)?.data?.recoId ?? '') !== rid);
  await AsyncStorage.setItem(key, JSON.stringify(next));
}

export async function pruneAiRecoInboxItems(validRecoIds: Set<string>): Promise<void> {
  const key = await getInboxKey();
  const prev = await getInbox();
  const next = prev.filter(x => {
    const d: any = x.data ?? null;
    if (d?.type !== 'ai_goal_reco') return true;
    const rid = String(d?.recoId ?? '').trim();
    if (!rid) return false;
    return validRecoIds.has(rid);
  });
  if (next.length !== prev.length) {
    await AsyncStorage.setItem(key, JSON.stringify(next));
  }
}

export type { InboxItem };
