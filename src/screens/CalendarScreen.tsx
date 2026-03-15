import React from 'react';
import { Text } from 'react-native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';

export function CalendarScreen() {
  return (
    <Screen>
      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>Calendar</Text>
        <Text style={{ color: colors.muted, marginTop: 6 }}>To be ported from HTML demo.</Text>
      </Card>
    </Screen>
  );
}
