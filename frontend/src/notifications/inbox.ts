import AsyncStorage from '@react-native-async-storage/async-storage';

type InboxItem = {
  id: string;
  receivedAt: number;
  title: string;
  body: string;
};

const KEY_INBOX = 'notif_inbox_v1';
const MAX_ITEMS = 200;

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
      }))
      .filter(x => x.id && Number.isFinite(x.receivedAt));
  } catch {
    return [];
  }
}

export async function getInbox(): Promise<InboxItem[]> {
  const raw = await AsyncStorage.getItem(KEY_INBOX);
  const items = safeParse(raw);
  items.sort((a, b) => b.receivedAt - a.receivedAt);
  return items;
}

export async function appendInbox(item: Omit<InboxItem, 'id'> & { id?: string }): Promise<void> {
  const id = String(item.id ?? `${item.receivedAt}-${Math.random().toString(16).slice(2)}`);
  const next: InboxItem = {
    id,
    receivedAt: item.receivedAt,
    title: item.title,
    body: item.body,
  };

  const prev = await getInbox();
  const merged = [next, ...prev].slice(0, MAX_ITEMS);
  await AsyncStorage.setItem(KEY_INBOX, JSON.stringify(merged));
}

export async function clearInbox(): Promise<void> {
  await AsyncStorage.removeItem(KEY_INBOX);
}

export async function removeInboxItem(id: string): Promise<void> {
  const prev = await getInbox();
  const next = prev.filter(x => x.id !== id);
  await AsyncStorage.setItem(KEY_INBOX, JSON.stringify(next));
}

export type { InboxItem };
