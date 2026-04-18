import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

import * as authApi from '../api/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

type AuthState = {
  user: authApi.AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isRestoring: boolean;
};

type AuthContextValue = {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  updateName: (name: string) => Promise<void>;
  changePassword: (params: { oldPassword: string; newPassword: string; confirmNewPassword: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const KEY_ACCESS = 'auth_access_token';
const KEY_REFRESH = 'auth_refresh_token';
const KEY_USER = 'auth_user';

async function setSecure(key: string, value: string | null) {
  if (value === null) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function clearInboxForUserIds(userIds: Array<string | null | undefined>) {
  const base = 'notif_inbox_v1';
  const keys = userIds.map(id => (id ? `${base}_${id}` : `${base}_anon`));
  await Promise.all(keys.map(k => AsyncStorage.removeItem(k)));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    refreshToken: null,
    isRestoring: true,
  });

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [accessToken, refreshToken, userJson] = await Promise.all([
          SecureStore.getItemAsync(KEY_ACCESS),
          SecureStore.getItemAsync(KEY_REFRESH),
          SecureStore.getItemAsync(KEY_USER),
        ]);

        const user = userJson ? (JSON.parse(userJson) as authApi.AuthUser) : null;

        if (!mounted) return;
        setState({ user, accessToken, refreshToken, isRestoring: false });
      } catch {
        if (!mounted) return;
        setState({ user: null, accessToken: null, refreshToken: null, isRestoring: false });
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  async function applyAuth(resp: authApi.AuthResponse) {
    await Promise.all([
      setSecure(KEY_ACCESS, resp.accessToken),
      setSecure(KEY_REFRESH, resp.refreshToken),
      setSecure(KEY_USER, JSON.stringify(resp.user)),
    ]);

    await clearInboxForUserIds([null, resp.user?.id]);

    setState({ user: resp.user, accessToken: resp.accessToken, refreshToken: resp.refreshToken, isRestoring: false });
  }

  async function signIn(email: string, password: string) {
    const resp = await authApi.login(email.trim(), password);
    await applyAuth(resp);
  }

  async function register(email: string, password: string, name?: string) {
    const resp = await authApi.register(email.trim(), password, name?.trim() ? name.trim() : undefined);
    await applyAuth(resp);
  }

  async function updateName(name: string) {
    const accessToken = state.accessToken;
    const user = state.user;

    if (!accessToken || !user) {
      throw new Error('Not signed in');
    }

    const nextName = name.trim();
    if (!nextName) {
      throw new Error('Name is required');
    }

    const resp = await authApi.updateMeName(accessToken, nextName);
    await setSecure(KEY_USER, JSON.stringify(resp.user));
    setState(s => ({ ...s, user: resp.user }));
  }

  async function changePassword(params: { oldPassword: string; newPassword: string; confirmNewPassword: string }) {
    const accessToken = state.accessToken;
    const user = state.user;

    if (!accessToken || !user) {
      throw new Error('Not signed in');
    }

    await authApi.changeMyPassword(accessToken, params);
  }

  async function signOut() {
    const refresh = state.refreshToken;
    const prevUserId = state.user?.id ?? null;

    await Promise.all([setSecure(KEY_ACCESS, null), setSecure(KEY_REFRESH, null), setSecure(KEY_USER, null)]);
    setState({ user: null, accessToken: null, refreshToken: null, isRestoring: false });

    await clearInboxForUserIds([prevUserId, null]);

    if (refresh) {
      try {
        await authApi.logout(refresh);
      } catch {
        // ignore
      }
    }
  }

  const value = useMemo<AuthContextValue>(() => ({ state, signIn, register, updateName, changePassword, signOut }), [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
