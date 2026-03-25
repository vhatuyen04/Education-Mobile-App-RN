import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { Pill } from '../components/Pill';
import { Button } from '../components/Button';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';

type Field = authApi.LeaderboardField;

export function RankingScreen() {
  const { state } = useAuth();
  const [field, setField] = useState<Field>('Sport');

  const listRef = useRef<FlatList<authApi.LeaderboardEntry> | null>(null);

  const [page, setPage] = useState<authApi.LeaderboardFieldPageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingScrollIndex, setPendingScrollIndex] = useState<number | null>(null);

  const limit = 50;

  const refresh = useCallback(async (opts?: { offset?: number; scrollToIndex?: number | null }) => {
    const token = state.accessToken;
    if (!token) return;

    setLoading(true);
    try {
      const resp = await authApi.getLeaderboardField(token, { field, limit, offset: opts?.offset ?? 0 });
      setPage(resp);
      if (opts?.scrollToIndex !== undefined) setPendingScrollIndex(opts.scrollToIndex);
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [state.accessToken, field]);

  const loadMore = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;
    if (loading || loadingMore) return;
    if (!page) return;
    if (page.offset + page.limit >= page.total) return;

    setLoadingMore(true);
    try {
      const resp = await authApi.getLeaderboardField(token, { field, limit, offset: page.offset + page.limit });
      setPage(prev => {
        if (!prev) return resp;
        return {
          ...resp,
          leaders: [...prev.leaders, ...resp.leaders],
          offset: prev.offset,
        };
      });
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to load'));
    } finally {
      setLoadingMore(false);
    }
  }, [field, limit, loading, loadingMore, page, state.accessToken]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  useEffect(() => {
    if (pendingScrollIndex === null) return;
    const idx = pendingScrollIndex;
    setPendingScrollIndex(null);
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
      } catch {
        // ignore
      }
    });
  }, [pendingScrollIndex, page?.leaders?.length]);

  const list = page?.leaders ?? [];
  const yourRank = page?.me?.rank ?? null;
  const topUser = page?.topUser ?? null;

  const rangeText = useMemo(() => {
    if (!page || list.length === 0) return null;
    const from = page.offset + 1;
    const to = page.offset + list.length;
    return `${from}–${to} of ${page.total}`;
  }, [list.length, page]);

  const moveToMyRank = useCallback(async () => {
    const r = page?.me?.rank ?? null;
    if (!r) {
      toast('No rank yet');
      return;
    }
    const targetOffset = Math.floor((r - 1) / limit) * limit;
    const indexInPage = (r - 1) - targetOffset;
    await refresh({ offset: targetOffset, scrollToIndex: indexInPage });
  }, [limit, page?.me?.rank, refresh]);

  const header = (
    <View style={styles.content}>
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hTitle}>Ranking</Text>
          <View style={styles.hSub}>
            <Pill dot>Leaderboards</Pill>
          </View>
        </View>
      </View>

      <Card>
        <View style={styles.tabs}>
          {(['Sport', 'Academy', 'Entertainment'] as const).map(t => (
            <Pressable
              key={t}
              onPress={() => setField(t)}
              style={({ pressed }) => [styles.tab, field === t ? styles.tabOn : null, pressed ? { opacity: 0.9 } : null]}
            >
              <Text style={[styles.tabText, field === t ? styles.tabTextOn : null]}>{t}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => toast('Add fields (demo)')}
            style={({ pressed }) => [styles.tab, pressed ? { opacity: 0.9 } : null]}
          >
            <Text style={styles.tabText}>+ Add fields</Text>
          </Pressable>
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.meta}>Top user: {topUser ?? '—'}</Text>
        {rangeText ? <Text style={styles.meta}>Showing: {rangeText}</Text> : null}

        <View style={{ height: 12 }} />
      </Card>
    </View>
  );

  const footer = (
    <View style={styles.content}>
      <Card>
        {loadingMore ? <Text style={styles.meta}>Loading…</Text> : null}
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.muted}>
            You are currently rank <Text style={styles.bold}>{yourRank ?? '—'}</Text> in <Text style={styles.bold}>{field}</Text> field.
          </Text>
          <Button title="Move" small onPress={moveToMyRank} />
        </View>
      </Card>
      <View style={{ height: 30 }} />
    </View>
  );

  return (
    <Screen style={{ padding: 0 }}>
      <FlatList
        ref={r => {
          listRef.current = r;
        }}
        data={list}
        keyExtractor={item => item.userId}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: 0 }}
        renderItem={({ item }) => (
          <View style={[styles.content, { paddingBottom: 0 }]}
            >
            <View style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>Top {item.rank} · {item.name}</Text>
                <Text style={styles.meta}>Points: {item.points}</Text>
              </View>
              <Button title="Profile" small onPress={() => toast('View profile (todo)')} />
            </View>
          </View>
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          void loadMore();
        }}
        refreshing={loading}
        onRefresh={() => {
          void refresh();
        }}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.content}>
              <Card>
                <Text style={styles.meta}>No data yet.</Text>
              </Card>
            </View>
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 14,
    paddingBottom: 30,
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  hTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '900',
  },
  hSub: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tab: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
  },
  tabOn: {
    backgroundColor: colors.primary,
    borderColor: 'transparent',
  },
  tabText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  tabTextOn: {
    color: '#06101f',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 14,
  },
  name: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  muted: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  bold: {
    color: colors.text,
    fontWeight: '900',
  },
});
