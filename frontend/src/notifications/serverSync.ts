import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import * as authApi from '../api/auth';
import { appendInbox, rememberUnseen } from './inbox';

const ALERTED_MAX = 200;

let inflight: Promise<void> | null = null;

function syncKey(userId: string) {
  return `notif_last_sync_v1_${userId || 'anon'}`;
}

function alertedKey(userId: string) {
  return `notif_phone_alerted_v1_${userId || 'anon'}`;
}

async function readAlerted(userId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(alertedKey(userId));
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map(x => String(x)));
  } catch {
    return new Set();
  }
}

async function writeAlerted(userId: string, ids: Set<string>) {
  const list = Array.from(ids).slice(-ALERTED_MAX);
  await AsyncStorage.setItem(alertedKey(userId), JSON.stringify(list));
}

async function ensureNotifyPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync();
  return !!req.granted;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    });
  } catch {
  }
}

async function presentOnPhone(title: string, body: string, data: Record<string, unknown>) {
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: 'default',
    },
    trigger: null,
  });
}

async function run(accessToken: string, userId: string) {
  const key = syncKey(userId);
  const raw = await AsyncStorage.getItem(key);
  const sinceMs = raw ? Number(raw) : null;
  const hadWatermark = !!(sinceMs && Number.isFinite(sinceMs) && sinceMs > 0);
  const resp = await authApi.listMyNotifications(accessToken, {
    sinceMs: hadWatermark ? sinceMs! : undefined,
  });
  const list = resp.notifications ?? [];
  const alerted = hadWatermark ? await readAlerted(userId) : new Set<string>();
  let canAlert = false;
  if (hadWatermark && list.length) {
    canAlert = await ensureNotifyPermission();
  }

  let phoneAlerts = 0;
  for (const n of list) {
    const receivedAt = n.createdAt ? new Date(n.createdAt).getTime() : Date.now();
    const titleRaw = String(n.title ?? '').trim();
    const bodyRaw = String(n.body ?? '').trim();
    if (!titleRaw && !bodyRaw) continue;
    if (titleRaw === 'Notification' && !bodyRaw) continue;
    const title = titleRaw || 'Reminder';
    const baseData = n.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : {};
    const inboxId = `srv_${n.id}`;
    const inserted = await appendInbox({
      id: inboxId,
      receivedAt: Number.isFinite(receivedAt) ? receivedAt : Date.now(),
      title,
      body: bodyRaw,
      data: baseData,
    });
    if (inserted && hadWatermark) await rememberUnseen(inboxId);
    if (!canAlert || alerted.has(n.id) || phoneAlerts >= 5) continue;
    try {
      await presentOnPhone(title, bodyRaw, {
        ...baseData,
        serverSync: true,
        serverNotificationId: n.id,
      });
      alerted.add(n.id);
      phoneAlerts += 1;
    } catch {
    }
  }

  if (hadWatermark && alerted.size) {
    await writeAlerted(userId, alerted);
  }
  await AsyncStorage.setItem(key, String(Date.now()));
}

export function syncServerNotifications(accessToken: string, userId: string): Promise<void> {
  if (!accessToken) return Promise.resolve();
  if (inflight) return inflight;
  inflight = run(accessToken, userId)
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
