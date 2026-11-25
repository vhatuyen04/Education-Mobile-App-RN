import { Platform } from 'react-native';

const override = process.env.EXPO_PUBLIC_API_BASE_URL;

export const API_BASE_URL =
  override && override.length > 0
    ? override
    : (Platform.select({
        android: 'http://10.0.2.2:4000',
        ios: 'http://localhost:4000',
        default: 'http://localhost:4000',
      }) as string);

if (__DEV__) console.info('SmartGoal API origin', new URL(API_BASE_URL).origin);
