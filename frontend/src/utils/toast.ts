import { Alert, Platform, ToastAndroid } from 'react-native';

// Android's system toast keeps about two lines, then adds an ellipsis.
const ANDROID_TOAST_LIMIT = 48;

export function toast(message: string) {
  if (!message) return;
  if (Platform.OS === 'android' && message.length <= ANDROID_TOAST_LIMIT) {
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return;
  }
  Alert.alert('SmartGoal', message);
}
