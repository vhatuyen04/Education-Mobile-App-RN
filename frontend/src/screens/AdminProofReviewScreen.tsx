import React, { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { colors } from '../theme/colors';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';

type Attempt = authApi.AdminSmartGoalProofAttempt;

export function AdminProofReviewScreen() {
  const nav = useNavigation<any>();
  const { state } = useAuth();
  const token = state.accessToken;

  const [loading, setLoading] = useState(false);
  const [reviewingAttempts, setReviewingAttempts] = useState<Attempt[]>([]);
  const [verifiedAttempts, setVerifiedAttempts] = useState<Attempt[]>([]);
  const [feedbackDraft, setFeedbackDraft] = useState<Record<string, string>>({});
  const [autoAiEnabled, setAutoAiEnabled] = useState(false);
  const [autoAiSettingBusy, setAutoAiSettingBusy] = useState(false);
  const [aiBusyIds, setAiBusyIds] = useState<Record<string, boolean>>({});
  const [hiddenVerifiedIds, setHiddenVerifiedIds] = useState<Record<string, boolean>>({});

  const isAdmin = state.user?.role === 'ADMIN';

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const settingResp = await authApi.adminGetAutoAiReviewSetting(token);
      if (!autoAiSettingBusy) setAutoAiEnabled(Boolean(settingResp?.enabled));

      const [pendingResp, approvedResp, rejectedResp] = await Promise.all([
        authApi.adminListProofAttempts(token, { status: 'PENDING_REVIEW' }),
        authApi.adminListProofAttempts(token, { status: 'APPROVED' }),
        authApi.adminListProofAttempts(token, { status: 'REJECTED' }),
      ]);
      setReviewingAttempts(pendingResp.attempts ?? []);
      setVerifiedAttempts([...(approvedResp.attempts ?? []), ...(rejectedResp.attempts ?? [])]);
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [token, autoAiSettingBusy]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const headerRight = useMemo(
    () => (
      <Pressable onPress={() => nav.goBack()} style={({ pressed }) => [styles.iconBtn, pressed ? { opacity: 0.85 } : null]}>
        <Text style={styles.iconText}>←</Text>
      </Pressable>
    ),
    [nav]
  );

  async function viewAttempt(a: Attempt) {
    if (!token) return;
    try {
      const resp = await authApi.adminPresignProofAttemptView(token, a.id);
      const ok = await Linking.canOpenURL(resp.url);
      if (!ok) {
        toast('Cannot open URL');
        return;
      }
      await Linking.openURL(resp.url);
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to open'));
    }
  }

  async function decide(a: Attempt, decision: 'APPROVE' | 'REJECT') {
    if (!token) return;
    try {
      await authApi.adminDecideProofAttempt(token, a.id, {
        decision,
        feedback: (feedbackDraft[a.id] ?? '').trim() || null,
      });
      toast(decision === 'APPROVE' ? 'Approved' : 'Rejected');
      await refresh();
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed'));
    }
  }

  async function aiReview(a: Attempt, opts?: { skipRefresh?: boolean }) {
    if (!token) return;
    if (aiBusyIds[a.id]) return;
    setAiBusyIds(prev => ({ ...prev, [a.id]: true }));
    try {
      await authApi.adminAiReviewProofAttempt(token, a.id);
      toast('AI reviewed');
      if (!opts?.skipRefresh) await refresh();
    } catch (e: any) {
      toast(String(e?.message ?? 'AI review failed'));
    } finally {
      setAiBusyIds(prev => {
        const next = { ...prev };
        delete next[a.id];
        return next;
      });
    }
  }

  async function toggleAutoAi(next: boolean) {
    if (!token) return;
    if (autoAiSettingBusy) return;
    setAutoAiSettingBusy(true);
    setAutoAiEnabled(next);
    try {
      const resp = await authApi.adminSetAutoAiReviewSetting(token, { enabled: next });
      setAutoAiEnabled(Boolean(resp?.enabled));
      await refresh();
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed'));
      setAutoAiEnabled(!next);
    } finally {
      setAutoAiSettingBusy(false);
    }
  }

  const visibleVerifiedAttempts = useMemo(
    () => verifiedAttempts.filter(a => !hiddenVerifiedIds[a.id]),
    [verifiedAttempts, hiddenVerifiedIds]
  );

  useFocusEffect(
    useCallback(() => {
      if (!autoAiEnabled) return;
      if (!token) return;
      if (loading) return;
      if (reviewingAttempts.length === 0) return;

      let canceled = false;
      (async () => {
        const batch = [...reviewingAttempts];
        for (const a of batch) {
          if (canceled) return;
          await aiReview(a, { skipRefresh: true });
        }
        if (canceled) return;
        await refresh();
      })();

      return () => {
        canceled = true;
      };
    }, [autoAiEnabled, token, loading, reviewingAttempts, refresh])
  );

  if (!isAdmin) {
    return (
      <Screen>
        <Card>
          <Text style={styles.title}>Admin</Text>
          <Text style={styles.meta}>Forbidden</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hTitle}>Admin</Text>
            <Text style={styles.meta}>Proof verification</Text>
          </View>
          {headerRight}
        </View>

        <Card>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Reviewing</Text>
            <Badge>{loading ? 'Loading…' : String(reviewingAttempts.length)}</Badge>
          </View>
          <View style={{ height: 10 }} />

          <View style={styles.rowBetween}>
            <Button title="Refresh" small onPress={() => void refresh()} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={styles.meta}>Auto sending to AI</Text>
              <Switch value={autoAiEnabled} onValueChange={v => void toggleAutoAi(v)} />
            </View>
          </View>
        </Card>

        {reviewingAttempts.map(a => (
          <Card key={a.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.itemTitle} numberOfLines={1}>
                Attempt {a.id.slice(0, 8)}
              </Text>
              <Badge>{a.status}</Badge>
            </View>

            <View style={{ height: 6 }} />
            <Text style={styles.meta} numberOfLines={1}>
              User: {a.userEmail || a.userId}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              Goal: {a.goalTitle || a.goalId}
            </Text>

            <View style={{ height: 8 }} />
            <Text style={styles.body}>{a.requirementText || 'No requirement provided.'}</Text>

            <View style={{ height: 10 }} />
            <Button title="View video" small onPress={() => void viewAttempt(a)} />

            <View style={{ height: 10 }} />
            <Text style={styles.meta}>Feedback (optional)</Text>
            <View style={{ height: 6 }} />
            <TextInput
              value={feedbackDraft[a.id] ?? ''}
              onChangeText={t => setFeedbackDraft(prev => ({ ...prev, [a.id]: t }))}
              placeholder="Reason / feedback"
              placeholderTextColor={colors.muted}
              style={styles.input}
              multiline
            />

            <View style={{ height: 10 }} />
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              <Button title={aiBusyIds[a.id] ? 'AI reviewing…' : 'AI Review'} onPress={() => void aiReview(a)} />
              <Button title="Approve" variant="primary" onPress={() => void decide(a, 'APPROVE')} />
              <Button title="Reject" onPress={() => void decide(a, 'REJECT')} />
            </View>
          </Card>
        ))}

        {reviewingAttempts.length === 0 && !loading ? (
          <Card>
            <Text style={styles.meta}>No pending attempts.</Text>
          </Card>
        ) : null}

        <View style={{ height: 14 }} />

        <Card>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Verified</Text>
            <Badge>{loading ? 'Loading…' : String(visibleVerifiedAttempts.length)}</Badge>
          </View>
          <View style={{ height: 10 }} />
          <Text style={styles.meta}>Approved and rejected proofs are shown here. You can hide them to keep the list clean.</Text>
        </Card>

        {visibleVerifiedAttempts.map(a => (
          <Card key={a.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.itemTitle} numberOfLines={1}>
                Attempt {a.id.slice(0, 8)}
              </Text>
              <Badge>{a.status}</Badge>
            </View>

            <View style={{ height: 6 }} />
            <Text style={styles.meta} numberOfLines={1}>
              User: {a.userEmail || a.userId}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              Goal: {a.goalTitle || a.goalId}
            </Text>

            <View style={{ height: 8 }} />
            <Text style={styles.body}>{a.aiFeedback || 'No feedback.'}</Text>

            <View style={{ height: 10 }} />
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              <Button title="View video" small onPress={() => void viewAttempt(a)} />
              <Button title="Hide" onPress={() => setHiddenVerifiedIds(prev => ({ ...prev, [a.id]: true }))} />
            </View>
          </Card>
        ))}

        {visibleVerifiedAttempts.length === 0 && !loading ? (
          <Card>
            <Text style={styles.meta}>No verified attempts.</Text>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 14,
    paddingBottom: 40,
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
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  body: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  itemTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: colors.text,
    fontWeight: '900',
    minHeight: 44,
  },
});
