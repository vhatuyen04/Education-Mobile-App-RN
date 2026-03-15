import React from 'react';
import { Text } from 'react-native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';

export function ProfileScreen() {
  return (
    <Screen>
      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>Profile</Text>
        <Text style={{ color: colors.muted, marginTop: 6 }}>To be ported (includes former Settings items).</Text>
      </Card>
    </Screen>
  );
}
