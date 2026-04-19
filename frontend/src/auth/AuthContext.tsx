import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

import * as authApi from '../api/auth';

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
const KEY_LAST_USER_ID = 'auth_last_user_id_v1';
const KEY_INBOX_BASE = 'notif_inbox_v1';

function safeParseInbox(raw: string | null): Array<{ id: string; receivedAt: number; title: string; body: string; data?: any | null }> {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map(x => ({
        id: String(x?.id ?? ''),
        receivedAt: Number(x?.receivedAt ?? 0),
        title: String(x?.title ?? ''),
        body: String(x?.body ?? ''),
        data: x?.data && typeof x.data === 'object' ? x.data : null,
      }))
      .filter(x => x.id && Number.isFinite(x.receivedAt));
  } catch {
    return [];
  }
}

async function setSecure(key: string, value: string | null) {
  if (value === null) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  await SecureStore.setItemAsync(key, value);
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
    const userId = String(resp.user?.id ?? '');
    await Promise.all([
      setSecure(KEY_ACCESS, resp.accessToken),
      setSecure(KEY_REFRESH, resp.refreshToken),
      setSecure(KEY_USER, JSON.stringify(resp.user)),
      AsyncStorage.setItem(KEY_LAST_USER_ID, userId),
    ]);

    try {
      if (userId) {
        const anonKey = `${KEY_INBOX_BASE}_anon`;
        const userKey = `${KEY_INBOX_BASE}_${userId}`;
        const [anonRaw, userRaw] = await Promise.all([AsyncStorage.getItem(anonKey), AsyncStorage.getItem(userKey)]);
        const anonItems = safeParseInbox(anonRaw);
        if (anonItems.length) {
          const userItems = safeParseInbox(userRaw);
          const byId = new Map<string, any>();
          for (const it of [...anonItems, ...userItems]) byId.set(String(it.id), it);
          const merged = Array.from(byId.values()).sort((a, b) => Number(b.receivedAt) - Number(a.receivedAt)).slice(0, 200);
          await Promise.all([AsyncStorage.setItem(userKey, JSON.stringify(merged)), AsyncStorage.removeItem(anonKey)]);
        }
      }
    } catch {
    }

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

    await Promise.all([setSecure(KEY_ACCESS, null), setSecure(KEY_REFRESH, null), setSecure(KEY_USER, null)]);
    setState({ user: null, accessToken: null, refreshToken: null, isRestoring: false });

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
