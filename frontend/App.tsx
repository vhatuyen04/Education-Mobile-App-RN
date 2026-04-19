import 'react-native-gesture-handler';

import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { RootStack } from './src/navigation/RootStack';
import { AuthProvider } from './src/auth/AuthContext';
import { SettingsProvider } from './src/settings/SettingsContext';
import { appendInbox } from './src/notifications/inbox';
import { autoScheduleRemindersForSignedInUser } from './src/notifications/scheduler';

export default function App() {
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    const subRecv = Notifications.addNotificationReceivedListener(n => {
      const title = String(n.request.content?.title ?? 'Notification');
      const body = String(n.request.content?.body ?? '');
      const data = (n.request.content as any)?.data ?? null;
      void appendInbox({
        receivedAt: Date.now(),
        title,
        body,
        data,
      });
    });

    const subResp = Notifications.addNotificationResponseReceivedListener(r => {
      const content = r.notification.request.content;
      const title = String(content?.title ?? 'Notification');
      const body = String(content?.body ?? '');
      const data = (content as any)?.data ?? null;
      void appendInbox({
        receivedAt: Date.now(),
        title,
        body,
        data,
      });
    });

    if (Platform.OS === 'android') {
      void Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
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
          <NavigationContainer>
            <StatusBar style="light" />
            <RootStack />
          </NavigationContainer>
        </SettingsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
