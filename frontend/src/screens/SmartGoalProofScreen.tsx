import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { colors } from '../theme/colors';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../api/auth';
import { rankingAwardMessage } from '../motivation/completionMessage';

export function SmartGoalProofScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { state } = useAuth();

  const goalId = String(route?.params?.goalId ?? '');
  const goalTitle = String(route?.params?.goalTitle ?? '');
  const requirementTextFromRoute = (route?.params?.requirementText ?? null) as string | null;

  const [goalRequirement, setGoalRequirement] = useState<string | null>(null);

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [status, setStatus] = useState<authApi.SmartGoalProofStatus | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [challengeCode, setChallengeCode] = useState<string | null>(null);
  const [challengeExpiresAt, setChallengeExpiresAt] = useState<string | null>(null);
  const [proofClosed, setProofClosed] = useState(false);

  const [polling, setPolling] = useState(false);
  const awardedRef = useRef(false);

  const canSubmit = useMemo(() => {
    if (attemptId && status === 'PENDING_UPLOAD') return true;
    if (!videoUri) return false;
    if (!attemptId) return true;
    return status === 'PENDING_UPLOAD' || status === null;
  }, [attemptId, status, videoUri]);

  useEffect(() => {
    const token = state.accessToken;
    if (!token) return;
    if (!goalId) return;

    let cancelled = false;
    (async () => {
      try {
        try {
          const g = await authApi.getGoal(token, goalId);
          if (!cancelled) {
            setGoalRequirement((g.goal as any).requirement ?? null);
          }
        } catch {
          // ignore
        }

        try {
          const opened = await authApi.openRankingProof(token, goalId);
          if (!cancelled) {
            setAttemptId(opened.attemptId);
            setStatus(opened.status);
            setFeedback(opened.aiFeedback ?? null);
            setChallengeCode(opened.challengeCode);
            setChallengeExpiresAt(opened.challengeExpiresAt);
            const expiresAt = opened.challengeExpiresAt ? new Date(opened.challengeExpiresAt).getTime() : NaN;
            const closed = Number.isFinite(expiresAt) && Date.now() > expiresAt;
            setProofClosed(closed);
            if (opened.status === 'PENDING_REVIEW') setPolling(true);
            if (opened.status === 'APPROVED' || opened.status === 'REJECTED' || opened.status === 'PENDING_REVIEW' || closed) return;
          }
        } catch (e: any) {
          const message = String(e?.message ?? '');
          if (!cancelled && message === 'Challenge expired') {
            setProofClosed(true);
            setFeedback(message);
          }
        }

        const resp = await authApi.getLatestSmartGoalProofAttempt(token, goalId);
        if (cancelled) return;
        const a = resp.attempt;
        if (!a) return;
        if (a.status === 'APPROVED') {
          setAttemptId(a.id);
          setStatus('APPROVED');
          setFeedback(a.aiFeedback ?? null);
          return;
        }

        setAttemptId(a.id);
        setStatus(a.status);
        setFeedback(a.aiFeedback ?? null);
        setProofUrl(a.proofUrl ?? null);
        if (a.status === 'PENDING_REVIEW') {
          setPolling(true);
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [goalId, state.accessToken]);

  const requirementText = useMemo(() => {
    const fromGoal = String(goalRequirement ?? '').trim();
    if (fromGoal) return fromGoal;
    const fromRoute = String(requirementTextFromRoute ?? '').trim();
    return fromRoute || null;
  }, [goalRequirement, requirementTextFromRoute]);

  const pickVideo = useCallback(async () => {
    if (status === 'PENDING_REVIEW' || status === 'APPROVED' || proofClosed) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast('Permission denied. Please allow media access.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 1,
    });

    if ((result as any).canceled) return;
    const asset = (result as any).assets?.[0];
    const uri = asset?.uri;
    if (!uri) {
      toast('No video selected.');
      return;
    }

    setVideoUri(uri);
  }, [proofClosed, status]);

  const submit = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;
    if (proofClosed || status === 'APPROVED' || status === 'PENDING_REVIEW') return;
    if (!videoUri && !(attemptId && status === 'PENDING_UPLOAD')) return;

    setUploading(true);
    try {
      if (attemptId && status === 'PENDING_UPLOAD' && !videoUri) {
        const submitted = await authApi.submitSmartGoalProof(token, goalId, attemptId);
        setStatus(submitted.attempt.status);
        setFeedback(submitted.attempt.aiFeedback ?? null);
        setPolling(true);
        toast('Submitted. Waiting for verification…');
        return;
      }

      const localVideoUri = videoUri;
      if (!localVideoUri) {
        throw new Error('No video selected');
      }

      const extMatch = /\.([a-zA-Z0-9]+)(\?|#|$)/.exec(localVideoUri);
      const fileExt = (extMatch?.[1] ?? 'mp4').toLowerCase();
      const contentType = fileExt === 'mov' ? 'video/quicktime' : 'video/mp4';

      const presign = await authApi.presignSmartGoalProof(token, goalId, {
        requirementText: requirementText ?? undefined,
        contentType,
        fileExt,
      });

      setAttemptId(presign.attemptId);
      setStatus(presign.status);
      setProofUrl(presign.proofUrl ?? null);
      setChallengeCode(presign.challengeCode);
      setChallengeExpiresAt(presign.challengeExpiresAt);

      const uploadType =
        (FileSystem as any)?.FileSystemUploadType?.BINARY_CONTENT ??
        (FileSystem as any)?.FileSystemUploadType?.BINARY ??
        0;
      const up = await FileSystem.uploadAsync(presign.uploadUrl, localVideoUri, {
        httpMethod: 'PUT',
        headers: {
          'Content-Type': contentType,
        },
        uploadType,
      });

      if (up.status < 200 || up.status >= 300) {
        throw new Error(`Upload failed (${up.status})`);
      }

      const submitted = await authApi.submitSmartGoalProof(token, goalId, presign.attemptId);
      setStatus(submitted.attempt.status);
      setFeedback(submitted.attempt.aiFeedback ?? null);
      setPolling(true);
      toast('Submitted. Waiting for verification…');
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? 'Failed to upload');
      toast(msg);
    } finally {
      setUploading(false);
    }
  }, [attemptId, goalId, proofClosed, requirementText, state.accessToken, status, videoUri]);

  useEffect(() => {
    if (!polling) return;
    if (!attemptId) return;
    const token = state.accessToken;
    if (!token) return;

    let cancelled = false;
    const t = setInterval(async () => {
      try {
        const resp = await authApi.getSmartGoalProofAttempt(token, goalId, attemptId);
        if (cancelled) return;
        setStatus(resp.attempt.status);
        setFeedback(resp.attempt.aiFeedback ?? null);
        setProofUrl(resp.attempt.proofUrl ?? null);

        if (resp.attempt.status === 'APPROVED') {
          if (!awardedRef.current) {
            awardedRef.current = true;
            toast(rankingAwardMessage(resp.attempt.awardedPoints ?? 0));
          }
          setPolling(false);
        }

        if (resp.attempt.status === 'REJECTED' || resp.attempt.status === 'NEEDS_CLARIFICATION') {
          setPolling(false);
        }
      } catch {
        // ignore transient
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [attemptId, goalId, nav, polling, state.accessToken]);

  const viewUploaded = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;
    if (!attemptId) return;

    try {
      const resp = await authApi.presignMySmartGoalProofView(token, goalId, attemptId);
      const ok = await Linking.canOpenURL(resp.url);
      if (!ok) {
        toast('Cannot open URL');
        return;
      }
      await Linking.openURL(resp.url);
    } catch (e: any) {
      toast(String(e?.message ?? 'Failed to open'));
    }
  }, [attemptId, goalId, state.accessToken]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.title}>{goalTitle}</Text>
        <Text style={styles.meta}>Ranking proof is optional. It does not change goal completion or XP.</Text>

        <Card>
          <Text style={styles.sectionTitle}>Show these in the video</Text>
          <Text style={styles.body}>Username: {state.user?.name || 'Add a username on your profile first.'}</Text>
          <Text style={styles.body}>Challenge code: {challengeCode || 'No challenge code is available.'}</Text>
          <Text style={styles.meta}>The proof must be submitted within 3 days of finishing the goal.</Text>
          {challengeExpiresAt ? <Text style={styles.meta}>Record and submit before {new Date(challengeExpiresAt).toLocaleString()}.</Text> : null}
          {proofClosed ? <Text style={styles.meta}>This deadline has passed, so this goal can no longer be submitted for ranking.</Text> : null}
          <Text style={styles.body}>Both the username and the challenge code must be clearly visible in the video.</Text>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Requirement the video must demonstrate</Text>
          <Text style={styles.body}>{requirementText || 'No requirement provided.'}</Text>
        </Card>

        <View style={{ height: 12 }} />

        <Card>

          <Text style={styles.sectionTitle}>Upload ranking video</Text>
          <Text style={styles.body}>Use the existing private upload. A direct object link is not used for playback.</Text>

          <View style={{ height: 10 }} />

          {videoUri ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.meta} numberOfLines={1}>
                Selected: {videoUri}
              </Text>
            </View>
          ) : null}

          {attemptId ? (
            <>
              <View style={{ height: 10 }} />
              <Button title="View uploaded video" small onPress={() => void viewUploaded()} />
            </>
          ) : null}

          {proofClosed || status === 'APPROVED' || status === 'PENDING_REVIEW' ? null : (
            <>
              <View style={{ height: 10 }} />
              <Button title={videoUri ? 'Change video' : 'Pick video'} onPress={pickVideo} />
            </>
          )}

          {proofClosed || status === 'APPROVED' ? null : (
            <>
              <View style={{ height: 10 }} />
              <Button
                title={
                  uploading
                    ? 'Uploading…'
                    : status === 'PENDING_REVIEW'
                      ? 'Waiting for admin review…'
                      : 'Submit for Ranking'
                }
                onPress={() => void submit()}
                variant="primary"
                disabled={status === 'PENDING_REVIEW' || uploading}
              />
            </>
          )}

          <View style={{ height: 12 }} />

          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Text style={styles.meta}>Status:</Text>
            <Badge>{status === 'NEEDS_CLARIFICATION' ? 'REJECTED' : (status ?? '—')}</Badge>
          </View>

          {feedback ? (
            <Text style={[styles.body, { marginTop: 10, color: colors.warning }]}>Feedback: {feedback}</Text>
          ) : null}

          {status === 'REJECTED' ? (
            <Text style={[styles.body, { marginTop: 10 }]}>This proof was rejected. Goal completion and XP stay unchanged, and no ranking points were awarded. You can submit another video with the same challenge code.</Text>
          ) : null}
          {status === 'NEEDS_CLARIFICATION' ? (
            <Text style={[styles.body, { marginTop: 10 }]}>This proof was rejected. Goal completion and XP stay unchanged, and no ranking points were awarded. You can submit another video with the same challenge code.</Text>
          ) : null}
          {status === 'APPROVED' ? (
            <Text style={[styles.body, { marginTop: 10 }]}>Ranking points were awarded once for this goal. Another submission cannot award them again.</Text>
          ) : null}

          <View style={{ height: 12 }} />
          <Button
            title="View history uploaded proof"
            onPress={() => nav.navigate('Progress', { focusProofs: true })}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: 16,
    paddingBottom: 30,
    gap: 10,
  },
  title: {
    color: 'white',
    fontSize: 20,
    fontWeight: '800',
  },
  sectionTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  body: {
    color: 'rgba(255,255,255,0.88)',
    lineHeight: 20,
  },
  meta: {
    color: 'rgba(255,255,255,0.65)',
  },
});
