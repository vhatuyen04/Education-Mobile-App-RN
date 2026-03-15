import React from 'react';
import { Text } from 'react-native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';

export function GoalDetailScreen() {
  return (
    <Screen>
      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>Goal detail</Text>
        <Text style={{ color: colors.muted, marginTop: 6 }}>Editable goal form will be ported next.</Text>
      </Card>
    </Screen>
  );
}
