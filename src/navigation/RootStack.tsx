import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { RootStackParamList } from './types';
import { BottomTabs } from './BottomTabs';
import { GoalDetailScreen } from '../screens/GoalDetailScreen';
import { TodayDetailsScreen } from '../screens/TodayDetailsScreen';
import { ScheduleWeekScreen } from '../screens/ScheduleWeekScreen';
import { colors } from '../theme/colors';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="Tabs" component={BottomTabs} options={{ headerShown: false }} />
      <Stack.Screen name="GoalDetail" component={GoalDetailScreen} options={{ title: 'Goal detail' }} />
      <Stack.Screen name="TodayDetails" component={TodayDetailsScreen} options={{ title: 'Details' }} />
      <Stack.Screen name="ScheduleWeek" component={ScheduleWeekScreen} options={{ title: 'Modify schedule' }} />
    </Stack.Navigator>
  );
}
