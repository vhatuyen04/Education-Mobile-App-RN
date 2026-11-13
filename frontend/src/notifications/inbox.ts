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

const inboxListeners = new Set<() => void>();

export function subscribeInboxChanged(listener: () => void): () => void {
  inboxListeners.add(listener);
  return () => {
    inboxListeners.delete(listener);
  };
}

function emitInboxChanged() {
  for (const listener of inboxListeners) listener();
}

export async function countUnseenInbox(): Promise<number> {
  const unseen = await readUnseen();
  if (!unseen.length) return 0;
  const items = await getInbox();
  const live = new Set(items.map(x => x.id));
  return unseen.filter(id => live.has(id)).length;
}

export async function rememberUnseen(id: string): Promise<void> {
  const key = await unseenKey();
  const prev = await readUnseen();
  if (prev.includes(id)) return;
  await AsyncStorage.setItem(key, JSON.stringify([id, ...prev].slice(0, MAX_ITEMS)));
  emitInboxChanged();
}

export async function markBellSeen(): Promise<void> {
  await AsyncStorage.setItem(await unseenKey(), '[]');
}

async function readUnseen(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(await unseenKey());
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.map(x => String(x)).filter(Boolean);
  } catch {
    return [];
  }
}

async function unseenKey(): Promise<string> {
  const inboxKey = await getInboxKey();
  const userId = inboxKey.startsWith(`${KEY_INBOX}_`) ? inboxKey.slice(KEY_INBOX.length + 1) : 'anon';
  return `notif_bell_unseen_v1_${userId}`;
}

export async function appendInbox(item: Omit<InboxItem, 'id'> & { id?: string }): Promise<boolean> {
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
  if (prev.some(x => x.id === id)) return false;
  const merged = [next, ...prev].slice(0, MAX_ITEMS);
  await AsyncStorage.setItem(key, JSON.stringify(merged));
  emitInboxChanged();
  return true;
}

export async function clearInbox(): Promise<void> {
  const key = await getInboxKey();
  await AsyncStorage.removeItem(key);
  emitInboxChanged();
}

export async function removeInboxItem(id: string): Promise<void> {
  const key = await getInboxKey();
  const prev = await getInbox();
  const next = prev.filter(x => x.id !== id);
  await AsyncStorage.setItem(key, JSON.stringify(next));
  emitInboxChanged();
}

export async function removeInboxItemsByRecoId(recoId: string): Promise<void> {
  const key = await getInboxKey();
  const prev = await getInbox();
  const rid = String(recoId);
  const next = prev.filter(x => String((x as any)?.data?.recoId ?? '') !== rid);
  await AsyncStorage.setItem(key, JSON.stringify(next));
  emitInboxChanged();
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
    emitInboxChanged();
  }
}

export type { InboxItem };
