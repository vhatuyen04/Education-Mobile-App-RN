import React, { useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { colors } from '../theme/colors';
import { LoginScreen } from '../screens/LoginScreen';
import { RegisterScreen } from '../screens/RegisterScreen';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack() {
  const [screen, setScreen] = useState<keyof AuthStackParamList>('Login');

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      {screen === 'Login' ? (
        <Stack.Screen name="Login">
          {() => <LoginScreen onGoRegister={() => setScreen('Register')} />}
        </Stack.Screen>
      ) : (
        <Stack.Screen name="Register">
          {() => <RegisterScreen onGoLogin={() => setScreen('Login')} />}
        </Stack.Screen>
      )}
    </Stack.Navigator>
  );
}
