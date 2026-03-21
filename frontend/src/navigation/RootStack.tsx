import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { RootStackParamList } from './types';
import { BottomTabs } from './BottomTabs';
import { AuthStack } from './AuthStack';
import { GoalDetailScreen } from '../screens/GoalDetailScreen';
import { TodayDetailsScreen } from '../screens/TodayDetailsScreen';
import { ScheduleWeekScreen } from '../screens/ScheduleWeekScreen';
import { colors } from '../theme/colors';
import { useAuth } from '../auth/AuthContext';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootStack() {
  const { state } = useAuth();

  if (state.isRestoring) {
    return null;
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      {state.accessToken ? (
        <>
          <Stack.Screen name="Tabs" component={BottomTabs} options={{ headerShown: false }} />
          <Stack.Screen name="GoalDetail" component={GoalDetailScreen} options={{ title: 'Goal detail', headerShown: false }} />
          <Stack.Screen name="TodayDetails" component={TodayDetailsScreen} options={{ title: 'Details', headerShown: false }} />
          <Stack.Screen name="ScheduleWeek" component={ScheduleWeekScreen} options={{ title: 'Modify schedule', headerShown: false }} />
        </>
      ) : (
        <Stack.Screen name="Auth" component={AuthStack} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}
