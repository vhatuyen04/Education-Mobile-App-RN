import 'react-native-gesture-handler';

import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import { RootStack } from './src/navigation/RootStack';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { SettingsProvider } from './src/settings/SettingsContext';
import { appendInbox, rememberUnseen } from './src/notifications/inbox';
import { autoScheduleRemindersForSignedInUser } from './src/notifications/scheduler';
import { syncServerNotifications } from './src/notifications/serverSync';
import { getRecommendation } from './src/ai/recommendations';

export default function App() {
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    const subRecv = Notifications.addNotificationReceivedListener(n => {
      const reqId = String((n as any)?.request?.identifier ?? '');
      const titleRaw = String(n.request.content?.title ?? '').trim();
      const bodyRaw = String(n.request.content?.body ?? '').trim();
      const data = (n.request.content as any)?.data ?? null;
      void (async () => {
        if ((data as any)?.serverSync) return;
        if (!titleRaw && !bodyRaw) return;
        if (titleRaw === 'Notification' && !bodyRaw) return;
        if ((data as any)?.type === 'ai_goal_reco') {
          const rid = String((data as any)?.recoId ?? '').trim();
          if (!rid || !(await getRecommendation(rid))) {
            if (reqId) {
              try {
                await Notifications.dismissNotificationAsync(reqId);
              } catch {
              }
            }
            return;
          }
        }
        const title = titleRaw || 'Reminder';
        const body = bodyRaw;
        try {
          const rawUser = await SecureStore.getItemAsync('auth_user');
          const user = rawUser ? JSON.parse(rawUser) : null;
          const curUserId = String(user?.id ?? '').trim();
          const ownerUserId = String((data as any)?.ownerUserId ?? '').trim();
          if (ownerUserId && curUserId && ownerUserId !== curUserId) return;
        } catch {
        }
        const scheduledForMs = Number((data as any)?.scheduledForMs ?? NaN);
        const ts = Number.isFinite(scheduledForMs)
          ? scheduledForMs
          : (n as any)?.date instanceof Date
            ? (n as any).date.getTime()
            : Date.now();
        const inboxId = reqId ? `expo_${reqId}` : `${ts}-${Math.random().toString(16).slice(2)}`;
        const inserted = await appendInbox({
          id: inboxId,
          receivedAt: ts,
          title,
          body,
          data,
        });
        if (inserted) await rememberUnseen(inboxId);
      })();
    });

    const subResp = Notifications.addNotificationResponseReceivedListener(r => {
      const content = r.notification.request.content;
      const reqId = String((r as any)?.notification?.request?.identifier ?? '');
      const titleRaw = String(content?.title ?? '').trim();
      const bodyRaw = String(content?.body ?? '').trim();
      const data = (content as any)?.data ?? null;
      void (async () => {
        if ((data as any)?.serverSync) return;
        if (!titleRaw && !bodyRaw) return;
        if (titleRaw === 'Notification' && !bodyRaw) return;
        if ((data as any)?.type === 'ai_goal_reco') {
          const rid = String((data as any)?.recoId ?? '').trim();
          if (!rid || !(await getRecommendation(rid))) {
            if (reqId) {
              try {
                await Notifications.dismissNotificationAsync(reqId);
              } catch {
              }
            }
            return;
          }
        }
        const title = titleRaw || 'Reminder';
        const body = bodyRaw;
        try {
          const rawUser = await SecureStore.getItemAsync('auth_user');
          const user = rawUser ? JSON.parse(rawUser) : null;
          const curUserId = String(user?.id ?? '').trim();
          const ownerUserId = String((data as any)?.ownerUserId ?? '').trim();
          if (ownerUserId && curUserId && ownerUserId !== curUserId) return;
        } catch {
        }
        const scheduledForMs = Number((data as any)?.scheduledForMs ?? NaN);
        const ts = Number.isFinite(scheduledForMs)
          ? scheduledForMs
          : (r as any)?.notification?.date instanceof Date
            ? (r as any).notification.date.getTime()
            : Date.now();
        const inboxId = reqId ? `expo_${reqId}` : `${ts}-${Math.random().toString(16).slice(2)}`;
        const inserted = await appendInbox({
          id: inboxId,
          receivedAt: ts,
          title,
          body,
          data,
        });
        if (inserted) await rememberUnseen(inboxId);
      })();
    });

    if (Platform.OS === 'android') {
      void Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      }).catch(() => {});
    }

    void autoScheduleRemindersForSignedInUser();

    const subApp = AppState.addEventListener('change', s => {
      if (s === 'active') {
        void autoScheduleRemindersForSignedInUser();
      }
    });

    return () => {
      subRecv.remove();
      subResp.remove();
      subApp.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SettingsProvider>
          <ServerNotificationBridge />
          <NavigationContainer>
            <StatusBar style="light" />
            <RootStack />
          </NavigationContainer>
        </SettingsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function ServerNotificationBridge() {
  const { state } = useAuth();
  const token = state.accessToken;
  const userId = String(state.user?.id ?? '');

  useEffect(() => {
    if (state.isRestoring || !token) return;
    const tick = () => {
      void syncServerNotifications(token, userId);
    };
    tick();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') tick();
    }, 15000);
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') tick();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [state.isRestoring, token, userId]);

  return null;
}
