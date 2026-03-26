import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import type { TabsParamList } from './types';
import { HomeScreen } from '../screens/HomeScreen';
import { CalendarScreen } from '../screens/CalendarScreen';
import { GoalsScreen } from '../screens/GoalsScreen';
import { RankingScreen } from '../screens/RankingScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { colors } from '../theme/colors';
import { useSettings } from '../settings/SettingsContext';

const Tab = createBottomTabNavigator<TabsParamList>();

export function BottomTabs() {
  const { settings } = useSettings();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
        },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.muted,
        tabBarIcon: ({ color, size, focused }) => {
          const iconText = (() => {
            switch (route.name) {
              case 'Home':
                return '⌂';
              case 'Calendar':
                return '📅';
              case 'Goals':
                return '✓';
              case 'Ranking':
                return '🏆';
              case 'Profile':
                return '👤';
              default:
                return '•';
            }
          })();
          return (
            <Text
              style={{
                color,
                fontSize: Math.max(12, Math.min(22, size)),
                lineHeight: Math.max(14, Math.min(24, size + 2)),
                fontWeight: focused ? '900' : '800',
                textAlign: 'center',
              }}
            >
              {iconText}
            </Text>
          );
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Calendar" component={CalendarScreen} />
      <Tab.Screen name="Goals" component={GoalsScreen} />
      {settings.rankingMode ? <Tab.Screen name="Ranking" component={RankingScreen} /> : null}
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
