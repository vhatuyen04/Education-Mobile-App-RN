import { Alert, Platform, ToastAndroid } from 'react-native';

export function toast(message: string) {
  if (!message) return;
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return;
  }
  Alert.alert(message);
}
