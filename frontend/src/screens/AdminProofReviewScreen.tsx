import React, { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
  const [sessionHiddenIds, setSessionHiddenIds] = useState<Record<string, boolean>>({});
  const isAdmin = state.user?.role === 'ADMIN';

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [pendingResp, approvedResp, rejectedResp, clarificationResp] = await Promise.all([
        authApi.adminListProofAttempts(token, { status: 'PENDING_REVIEW' }),
        authApi.adminListProofAttempts(token, { status: 'APPROVED' }),
        authApi.adminListProofAttempts(token, { status: 'REJECTED' }),
        authApi.adminListProofAttempts(token, { status: 'NEEDS_CLARIFICATION' }),
      ]);
      const byNewestVerification = (a: Attempt, b: Attempt) => {
        const aTime = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
        const bTime = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
        return bTime - aTime;
      };
      setReviewingAttempts([...(pendingResp.attempts ?? [])].sort(byNewestVerification));
      setVerifiedAttempts([...(approvedResp.attempts ?? []), ...(rejectedResp.attempts ?? []), ...(clarificationResp.attempts ?? [])].sort(byNewestVerification));
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [token]);

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
    const feedback = (feedbackDraft[a.id] ?? '').trim();
    try {
      await authApi.adminDecideProofAttempt(token, a.id, {
        decision,
        feedback: feedback || null,
      });
      toast(decision === 'APPROVE' ? 'Approved' : 'Rejected');
      await refresh();
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed'));
    }
  }

  function hideVerified(a: Attempt) {
    setSessionHiddenIds(prev => ({ ...prev, [a.id]: true }));
  }

  async function dismissVerified(a: Attempt) {
    if (!token) return;
    try {
      await authApi.adminHideProofAttempt(token, a.id);
      setVerifiedAttempts(prev => prev.filter(item => item.id !== a.id));
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to remove from this list'));
    }
  }

  const visibleVerifiedAttempts = useMemo(
    () => verifiedAttempts.filter(a => !sessionHiddenIds[a.id]),
    [verifiedAttempts, sessionHiddenIds]
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
            <Text style={styles.meta}>Username: {a.username || '—'}</Text>
            <Text style={styles.meta}>Expected code</Text>
            <Text style={styles.expectedCode}>{a.challengeCode || '—'}</Text>
            <Text style={styles.body}>The username and this expected code must be shown in the video.</Text>
            <Text style={styles.meta}>Email: {a.userEmail || a.userId}</Text>
            <Text style={styles.body}>{a.goalTitle || a.goalId}</Text>
            <Text style={styles.meta}>{a.goalDescription || 'No description.'}</Text>
            <Text style={styles.body}>Requirement: {a.requirement || a.requirementText || 'No requirement provided.'}</Text>
            <Text style={styles.meta}>Difficulty: {a.difficultyScore ?? '—'}</Text>
            <Text style={styles.meta}>Potential ranking points: {a.potentialRankingPoints ?? '—'}</Text>
            <Text style={styles.meta}>Moderation: {a.moderationStatus || 'Not clear'}</Text>
            <Text style={styles.meta}>{a.moderationNote || 'No moderation note.'}</Text>
            {a.moderationLimitation && !(a.moderationNote ?? '').includes(a.moderationLimitation) ? (
              <Text style={styles.meta}>{a.moderationLimitation}</Text>
            ) : null}

            <View style={{ height: 10 }} />
            <Button title="Play video" small onPress={() => void viewAttempt(a)} />

            <View style={{ height: 10 }} />
            <Text style={styles.meta}>Feedback</Text>
            <View style={{ height: 6 }} />
            <TextInput
              value={feedbackDraft[a.id] ?? ''}
              onChangeText={t => setFeedbackDraft(prev => ({ ...prev, [a.id]: t }))}
              placeholder="Optional feedback"
              placeholderTextColor={colors.muted}
              style={styles.input}
              multiline
            />

            <View style={{ height: 10 }} />
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
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
          <Text style={styles.meta}>Hide clears a proof until this screen reloads. Delete keeps it off this list. Neither one removes the user's proof.</Text>
        </Card>

        {visibleVerifiedAttempts.map(a => (
          <Card key={a.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.itemTitle} numberOfLines={1}>
                Attempt {a.id.slice(0, 8)}
              </Text>
              <Badge>{a.status === 'NEEDS_CLARIFICATION' ? 'REJECTED' : a.status}</Badge>
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
              <Button title="Play video" small onPress={() => void viewAttempt(a)} />
              {a.status === 'APPROVED' || a.status === 'REJECTED' || a.status === 'NEEDS_CLARIFICATION' ? <Button title="Hide" onPress={() => hideVerified(a)} /> : null}
              {a.status === 'APPROVED' || a.status === 'REJECTED' || a.status === 'NEEDS_CLARIFICATION' ? <Button title="Delete" onPress={() => void dismissVerified(a)} /> : null}
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
  expectedCode: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
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
