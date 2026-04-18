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
import { applyGoalCompletedBonus } from '../motivation/progress';
import { messageForProgressEvent } from '../motivation/messages';

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

        const resp = await authApi.getLatestSmartGoalProofAttempt(token, goalId);
        if (cancelled) return;
        const a = resp.attempt;
        if (!a) return;
        if (a.status === 'APPROVED') return;

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

    try {
      const token = state.accessToken;
      if (token && attemptId && status === 'PENDING_UPLOAD') {
        await authApi.deleteSmartGoalProofAttempt(token, goalId, attemptId);
      }
    } catch {
      // ignore
    }

    setVideoUri(uri);
    setAttemptId(null);
    setStatus(null);
    setFeedback(null);
    setProofUrl(null);
  }, [attemptId, goalId, state.accessToken, status]);

  const submit = useCallback(async () => {
    const token = state.accessToken;
    if (!token) return;
    if (!videoUri && !(attemptId && status === 'PENDING_UPLOAD')) return;

    setUploading(true);
    try {
      console.log('[SmartGoalProof] submit:start', { goalId, videoUri, attemptId, status });

      if (attemptId && status === 'PENDING_UPLOAD' && !videoUri) {
        console.log('[SmartGoalProof] submitAttemptOnly:start', { attemptId });
        const submitted = await authApi.submitSmartGoalProof(token, goalId, attemptId);
        console.log('[SmartGoalProof] submitAttemptOnly:done', submitted);
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

      console.log('[SmartGoalProof] presign:ok', presign);

      setAttemptId(presign.attemptId);
      setStatus(presign.status);
      setProofUrl(presign.proofUrl);

      const uploadType =
        (FileSystem as any)?.FileSystemUploadType?.BINARY_CONTENT ??
        (FileSystem as any)?.FileSystemUploadType?.BINARY ??
        0;

      try {
        console.log('[SmartGoalProof] uploadType', uploadType, 'FileSystemUploadType', (FileSystem as any)?.FileSystemUploadType);
      } catch {
        // ignore
      }

      console.log('[SmartGoalProof] upload:start', { uploadUrl: presign.uploadUrl, contentType, fileExt });
      const up = await FileSystem.uploadAsync(presign.uploadUrl, localVideoUri, {
        httpMethod: 'PUT',
        headers: {
          'Content-Type': contentType,
        },
        uploadType,
      });

      console.log('[SmartGoalProof] upload:done', { status: up.status, headers: (up as any).headers, bodyLen: String((up as any).body ?? '').length });

      if (up.status < 200 || up.status >= 300) {
        throw new Error(`Upload failed (${up.status})`);
      }

      console.log('[SmartGoalProof] submitAttempt:start', { attemptId: presign.attemptId });
      const submitted = await authApi.submitSmartGoalProof(token, goalId, presign.attemptId);
      console.log('[SmartGoalProof] submitAttempt:done', submitted);
      setStatus(submitted.attempt.status);
      setFeedback(submitted.attempt.aiFeedback ?? null);
      setPolling(true);
      toast('Submitted. Waiting for verification…');
    } catch (e: any) {
      console.log('[SmartGoalProof] submit:error', e);
      const msg = String(e?.message ?? e ?? 'Failed to upload');
      toast(msg);
    } finally {
      setUploading(false);
    }
  }, [attemptId, goalId, requirementText, state.accessToken, status, videoUri]);

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
            const localEv = await applyGoalCompletedBonus();
            const msg = messageForProgressEvent(localEv);
            toast(`${msg} +1 point.`);
          }
          setPolling(false);
          nav.goBack();
        }

        if (resp.attempt.status === 'REJECTED') {
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

  const simulate = useCallback(
    async (decision: 'APPROVE' | 'REJECT') => {
      const token = state.accessToken;
      if (!token) return;
      if (!attemptId) return;
      try {
        const resp = await authApi.mockReviewSmartGoalProof(token, goalId, attemptId, {
          decision,
          feedback: decision === 'APPROVE' ? 'Mock approved.' : 'Mock rejected.',
        });
        setStatus(resp.attempt.status);
        setFeedback(resp.attempt.aiFeedback ?? null);
        if (resp.attempt.status === 'APPROVED') {
          setPolling(true);
        }
      } catch (e: any) {
        toast(String(e?.message ?? 'Failed'));
      }
    },
    [attemptId, goalId, state.accessToken]
  );

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

        <Card>
          <Text style={styles.sectionTitle}>Requirement</Text>
          <Text style={styles.body}>{requirementText || 'No requirement provided.'}</Text>
        </Card>

        <View style={{ height: 12 }} />

        <Card>

          <Text style={styles.sectionTitle}>Upload proof (video)</Text>
          <Text style={styles.body}>Upload a short video that matches the requirement above.</Text>

          <View style={{ height: 10 }} />

          {videoUri ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.meta} numberOfLines={1}>
                Selected: {videoUri}
              </Text>
            </View>
          ) : null}

          {attemptId && proofUrl ? (
            <>
              <View style={{ height: 10 }} />
              <Button title="View uploaded video" small onPress={() => void viewUploaded()} />
            </>
          ) : null}

          <View style={{ height: 10 }} />

          <Button title={videoUri ? 'Change video' : 'Pick video'} onPress={pickVideo} />

          <View style={{ height: 10 }} />

          <Button
            title={uploading ? 'Uploading…' : status === 'PENDING_REVIEW' ? 'Waiting for verification…' : 'Submit proof'}
            onPress={() => void submit()}
            variant="primary"
          />

          <View style={{ height: 12 }} />

          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Text style={styles.meta}>Status:</Text>
            <Badge>{status ?? '—'}</Badge>
          </View>

          {feedback ? (
            <Text style={[styles.body, { marginTop: 10, color: colors.warning }]}>Feedback: {feedback}</Text>
          ) : null}

          {status === 'REJECTED' ? (
            <Text style={[styles.body, { marginTop: 10 }]}>Verification rejected. Your goal is still active. No XP was awarded.</Text>
          ) : null}

          {__DEV__ && attemptId ? (
            <View style={{ marginTop: 14, flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              <Button title="Mock approve" small onPress={() => simulate('APPROVE')} />
              <Button title="Mock reject" small onPress={() => simulate('REJECT')} />
            </View>
          ) : null}
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
