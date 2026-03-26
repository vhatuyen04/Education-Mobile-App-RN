import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

import type { LeaderboardField } from '../api/auth';
import { colors } from '../theme/colors';

export type AppSettings = {
  rankingMode: boolean;
  interestedFields: LeaderboardField[];
  hobbies: string;
  backgroundColor: string;
  isRestoring: boolean;
};

type SettingsContextValue = {
  settings: AppSettings;
  setRankingMode: (enabled: boolean) => Promise<void>;
  setInterestedFields: (fields: LeaderboardField[]) => Promise<void>;
  setHobbies: (hobbies: string) => Promise<void>;
  setBackgroundColor: (color: string) => Promise<void>;
  resetBackgroundColor: () => Promise<void>;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

const KEY_RANKING_MODE = 'settings_ranking_mode';
const KEY_FIELDS = 'settings_interested_fields';
const KEY_HOBBIES = 'settings_hobbies';
const KEY_BG = 'settings_background_color';

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>({
    rankingMode: true,
    interestedFields: ['Sport', 'Academy', 'Entertainment'],
    hobbies: '',
    backgroundColor: colors.bg,
    isRestoring: true,
  });

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [rankingMode, fieldsJson, hobbies, bg] = await Promise.all([
          SecureStore.getItemAsync(KEY_RANKING_MODE),
          SecureStore.getItemAsync(KEY_FIELDS),
          SecureStore.getItemAsync(KEY_HOBBIES),
          SecureStore.getItemAsync(KEY_BG),
        ]);

        const parsedFields = fieldsJson ? (JSON.parse(fieldsJson) as unknown) : null;
        const allowed: LeaderboardField[] = ['Sport', 'Academy', 'Entertainment'];
        const normalizedFields =
          Array.isArray(parsedFields) && parsedFields.every(v => allowed.includes(v as any))
            ? (parsedFields as LeaderboardField[])
            : null;

        if (!mounted) return;
        setSettings(s => ({
          ...s,
          rankingMode: rankingMode ? rankingMode === '1' : s.rankingMode,
          interestedFields: normalizedFields && normalizedFields.length > 0 ? normalizedFields : s.interestedFields,
          hobbies: hobbies ?? s.hobbies,
          backgroundColor: bg ?? s.backgroundColor,
          isRestoring: false,
        }));
      } catch {
        if (!mounted) return;
        setSettings(s => ({ ...s, isRestoring: false }));
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  async function setRankingMode(enabled: boolean) {
    setSettings(s => ({ ...s, rankingMode: enabled }));
    try {
      await SecureStore.setItemAsync(KEY_RANKING_MODE, enabled ? '1' : '0');
    } catch {
      // ignore
    }
  }

  async function setInterestedFields(fields: LeaderboardField[]) {
    const normalized: LeaderboardField[] = fields.length > 0 ? fields : ['Academy'];
    setSettings(s => ({ ...s, interestedFields: normalized }));
    try {
      await SecureStore.setItemAsync(KEY_FIELDS, JSON.stringify(normalized));
    } catch {
      // ignore
    }
  }

  async function setHobbies(hobbies: string) {
    setSettings(s => ({ ...s, hobbies }));
    try {
      await SecureStore.setItemAsync(KEY_HOBBIES, hobbies);
    } catch {
      // ignore
    }
  }

  async function setBackgroundColor(color: string) {
    setSettings(s => ({ ...s, backgroundColor: color }));
    try {
      await SecureStore.setItemAsync(KEY_BG, color);
    } catch {
      // ignore
    }
  }

  async function resetBackgroundColor() {
    setSettings(s => ({ ...s, backgroundColor: colors.bg }));
    try {
      await SecureStore.deleteItemAsync(KEY_BG);
    } catch {
      // ignore
    }
  }

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, setRankingMode, setInterestedFields, setHobbies, setBackgroundColor, resetBackgroundColor }),
    [settings]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
