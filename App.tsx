import 'react-native-gesture-handler';

import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootStack } from './src/navigation/RootStack';

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <RootStack />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
