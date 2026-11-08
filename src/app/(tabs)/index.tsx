import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchRecentNudges, sendPartnerNudge } from '@/api/extras';
import {
  DEFAULT_WARM_BLURHASH,
  fetchTodayMomentBundle,
  isMomentPromptCheckIn,
  updateMomentCaption,
} from '@/api/moments';
import { requestRealtimeCatchUpSync } from '@/api/realtimeSync';
import { fetchCoupleStatuses } from '@/api/statuses';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { DualMomentCard, LockedMomentCard } from '@/components/moment/MomentCards';
import { StatusHeaderCard } from '@/components/status/StatusHeaderCard';
import {
  DualFrameMark,
  InlineNotice,
  KeepItButton,
  RevealOnAppear,
  SkeletonBlock,
} from '@/components/ui/Primitives';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { useSessionStore } from '@/store/sessionStore';
import { APP_LAYOUT, useKeepItTheme } from '@/theme/tokens';
import {
  MomentRecord,
  PartnerMomentView,
} from '@/types/database';

type FeedPostItem =
  | { kind: 'partner'; moment: PartnerMomentView; postedAt: string }
  | { kind: 'friend'; moment: MomentRecord; postedAt: string }
  | { kind: 'mine'; moment: MomentRecord; postedAt: string };

export default function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors, radii, spacing } = useKeepItTheme();

  const user = useSessionStore((s) => s.user);
  const partner = useSessionStore((s) => s.partner);
  const couple = useSessionStore((s) => s.couple);

  const isPartnerPaired = Boolean(partner && couple && !couple.id.startsWith('solo_'));
  const [actionError, setActionError] = useState<string | null>(null);
  const [nudging, setNudging] = useState(false);
  const [nudgeFeedback, setNudgeFeedback] = useState<string | null>(null);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const partnerName = partner?.display_name ?? 'Partner';
  const bundleQuery = useQuery({
    queryKey: ['today-moment', couple?.id, user?.id],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () =>
      fetchTodayMomentBundle({
        coupleId: couple!.id,
        userId: user!.id,
      }),
  });

  const statusQuery = useQuery({
    queryKey: ['couple-statuses', couple?.id, user?.id],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () =>
      fetchCoupleStatuses({
        coupleId: couple!.id,
        userId: user!.id,
      }),
    refetchInterval: 30_000,
  });

  const nudgesQuery = useQuery({
    queryKey: ['couple-nudges', couple?.id],
    enabled: Boolean(couple?.id),
    queryFn: () => fetchRecentNudges({ coupleId: couple!.id }),
  });

  useEffect(() => {
    const client = supabase;
    if (!couple?.id || !isSupabaseConfigured || !client) return;

    const channel = client
      .channel(`home:${couple.id}:${Date.now().toString(36)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'moments',
          filter: `couple_id=eq.${couple.id}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['today-moment', couple.id] });
          void queryClient.invalidateQueries({ queryKey: ['month-memories', couple.id] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'statuses',
          filter: `couple_id=eq.${couple.id}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['couple-statuses', couple.id] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'couple_events',
          filter: `couple_id=eq.${couple.id}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['couple-nudges', couple.id] });
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [couple?.id, queryClient]);

  const bundle = bundleQuery.data;

  // Keep background widget snapshot sync active without rendering extra cards on Home
  useWidgetSync({
    partnerName: isPartnerPaired ? partnerName : 'You',
    coupleId: couple?.id,
    momentBundle: bundle,
    statusBundle: statusQuery.data,
  });

  const myMomentsToday: MomentRecord[] =
    bundle?.myMomentsToday ?? (bundle?.mine ? [bundle.mine] : []);
  const partnerMomentsToday: PartnerMomentView[] =
    bundle?.partnerMomentsToday ?? (bundle?.partner ? [bundle.partner] : []);
  const friendMomentsToday: MomentRecord[] = bundle?.friendMomentsToday ?? [];

  const myMoment = bundle?.mine ?? myMomentsToday[0] ?? null;
  const feedPosts: FeedPostItem[] = [
    ...partnerMomentsToday.map((pm): FeedPostItem => ({
      kind: 'partner',
      moment: pm,
      postedAt: pm.posted_at,
    })),
    ...friendMomentsToday.map((fm): FeedPostItem => ({
      kind: 'friend',
      moment: fm,
      postedAt: fm.posted_at,
    })),
    ...myMomentsToday.map((mm): FeedPostItem => ({
      kind: 'mine',
      moment: mm,
      postedAt: mm.posted_at,
    })),
  ].sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1));

  const refreshMoments = async () => {
    if (!couple?.id) return;
    await queryClient.invalidateQueries({ queryKey: ['today-moment', couple.id] });
    await queryClient.invalidateQueries({ queryKey: ['month-memories', couple.id] });
    await queryClient.invalidateQueries({ queryKey: ['user-posts'] });
  };

  const handlePullRefresh = async () => {
    if (pullRefreshing) return;
    setPullRefreshing(true);
    setActionError(null);
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync().catch(() => {});
    }
    try {
      await Promise.all([
        useSessionStore.getState().refreshPairing(),
        requestRealtimeCatchUpSync({ userId: user?.id, coupleId: couple?.id }),
      ]);
      // Allow brief window for Realtime peer catch-up packets to land before reading cache
      const { promise: delayPromise, resolve: resolveDelay } = Promise.withResolvers<void>();
      setTimeout(resolveDelay, 220);
      await delayPromise;
      await Promise.all([
        bundleQuery.refetch(),
        statusQuery.refetch(),
        nudgesQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['friends-list'] }),
        queryClient.invalidateQueries({ queryKey: ['user-posts'] }),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  };
  const openCameraModal = (options?: {
    initialLens?: 'back' | 'front';
    initialMode?: 'photo' | 'video';
    replaceMomentId?: string;
    retakesUsed?: number;
  }) => {
    const todayDate = new Date().toISOString().slice(0, 10);
    const fallbackPromptId = couple?.id ? `prompt_${couple.id}_${todayDate}` : `prompt_${todayDate}`;
    router.push({
      pathname: '/camera',
      params: {
        promptId: bundle?.prompt.id ?? fallbackPromptId,
        triggerAt: bundle?.prompt.trigger_at ?? new Date().toISOString(),
        retakesUsed: String(options?.retakesUsed ?? myMoment?.retake_count ?? 0),
        ...(options?.replaceMomentId ? { replaceMomentId: options.replaceMomentId } : {}),
        ...(options?.initialLens ? { initialLens: options.initialLens } : {}),
        ...(options?.initialMode ? { initialMode: options.initialMode } : {}),
      },
    });
  };

  const handleSaveCaption = async (momentId: string, nextCaption: string) => {
    if (!user || !couple) return;
    setActionError(null);
    try {
      await updateMomentCaption({
        momentId,
        userId: user.id,
        caption: nextCaption,
      });
      await refreshMoments();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update note.');
      throw err;
    }
  };

  const handleSendNudge = async () => {
    if (!couple || !user || nudging || !isPartnerPaired) return;
    setNudging(true);
    setNudgeFeedback(null);
    try {
      await sendPartnerNudge({
        coupleId: couple.id,
        userId: user.id,
        note: `Thinking of you, ${partnerName}`,
      });
      setNudgeFeedback(`Nudged ${partnerName}`);
      await queryClient.invalidateQueries({ queryKey: ['couple-nudges', couple.id] });
    } catch (err) {
      setNudgeFeedback(err instanceof Error ? err.message : 'Could not send nudge.');
    } finally {
      setNudging(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        alwaysBounceVertical
        overScrollMode="always"
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => void handlePullRefresh()}
            tintColor={colors.ink}
            colors={[colors.ink]}
            progressBackgroundColor={colors.surfaceElevated}
          />
        }
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: 12,
            paddingTop: 8,
            paddingBottom: APP_LAYOUT.tabBarClearance,
          },
        ]}>
        <StatusHeaderCard
          partnerName={partnerName}
          partnerStatus={statusQuery.data?.partner ?? null}
          myStatus={statusQuery.data?.mine ?? null}
          isPartnerPaired={isPartnerPaired}
          latestNudge={nudgesQuery.data?.[0] ?? null}
          currentUserId={user?.id}
          nudging={nudging}
          nudgeFeedback={nudgeFeedback}
          loading={statusQuery.isLoading}
          statusError={
            statusQuery.isError
              ? 'Could not refresh statuses.'
              : null
          }
          nudgeError={nudgesQuery.isError ? 'Could not load nudges.' : null}
          onRetryStatus={() => void statusQuery.refetch()}
          onRetryNudges={() => void nudgesQuery.refetch()}
          onSendNudge={isPartnerPaired ? () => void handleSendNudge() : undefined}
          onPressPair={() => router.navigate('/(auth)/pair')}
          onOpenStatusSheet={() => router.push('/status-sheet')}
        />

        {actionError ? <InlineNotice message={actionError} tone="error" /> : null}
        {bundleQuery.isError ? (
          <View style={{ gap: spacing.xs }}>
            <InlineNotice
              message={
                bundleQuery.error instanceof Error
                  ? bundleQuery.error.message
                  : 'Could not sync today’s Moments.'
              }
              tone="error"
            />
            <KeepItButton
              label="Retry Sync"
              variant="secondary"
              onPress={() => void bundleQuery.refetch()}
            />
          </View>
        ) : null}

        {bundleQuery.isLoading && !bundle ? (
          <View style={styles.feedStack}>
            <SkeletonBlock height={420} label="Loading posts from your partner and friends…" />
          </View>
        ) : bundleQuery.isError && !bundle ? (
          <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>
            Your feed is unavailable until sync succeeds. Retry above to load posts.
          </Text>
        ) : feedPosts.length > 0 ? (
          <View style={styles.feedStack}>
            {feedPosts.map((entry) => {
              if (entry.kind === 'partner') {
                const pm = entry.moment;
                return pm.locked ? (
                  <LockedMomentCard
                    key={`partner-locked-${pm.id}`}
                    partnerName={pm.author_name ?? partnerName}
                    postedAtIso={pm.posted_at}
                    lateBySeconds={pm.late_by_seconds}
                    isLate={pm.is_late}
                    isPromptCheckIn={isMomentPromptCheckIn(pm)}
                    onCaptureMine={() => openCameraModal()}
                  />
                ) : (
                  <RevealOnAppear
                    key={`partner-${pm.id}`}
                    revealKey={`partner-unlocked-${pm.id}`}>
                    <DualMomentCard
                      moment={pm}
                      authorName={pm.author_name ?? partnerName}
                      backPhotoUrl={pm.back_photo_url ?? pm.back_photo_path ?? ''}
                      frontPhotoUrl={pm.front_photo_url ?? pm.front_photo_path ?? ''}
                      blurhash={pm.back_blurhash || DEFAULT_WARM_BLURHASH}
                      caption={pm.caption}
                      postedAtIso={pm.posted_at}
                      lateBySeconds={pm.late_by_seconds}
                      isLate={pm.is_late}
                      retakeCount={pm.retake_count}
                      currentUserId={user?.id}
                      coupleId={couple?.id}
                      isOwner={false}
                      onUpdated={refreshMoments}
                      onDeleted={refreshMoments}
                    />
                  </RevealOnAppear>
                );
              }

              if (entry.kind === 'friend') {
                const fm = entry.moment;
                return (
                  <RevealOnAppear
                    key={`friend-${fm.id}`}
                    revealKey={`friend-post-${fm.id}`}>
                    <DualMomentCard
                      moment={fm}
                      authorName={fm.author_name ?? 'Friend'}
                      backPhotoUrl={fm.back_photo_url ?? fm.back_photo_path}
                      frontPhotoUrl={fm.front_photo_url ?? fm.front_photo_path}
                      blurhash={fm.back_blurhash || DEFAULT_WARM_BLURHASH}
                      caption={fm.caption}
                      postedAtIso={fm.posted_at}
                      lateBySeconds={fm.late_by_seconds}
                      isLate={fm.is_late}
                      retakeCount={fm.retake_count}
                      currentUserId={user?.id}
                      coupleId={couple?.id}
                      isOwner={fm.user_id === user?.id}
                      onUpdated={refreshMoments}
                      onDeleted={refreshMoments}
                    />
                  </RevealOnAppear>
                );
              }

              const item = entry.moment;
              return (
                <RevealOnAppear key={`mine-${item.id}`} revealKey={`mine-post-${item.id}`}>
                  <DualMomentCard
                    moment={item}
                    authorName={item.author_name ?? user?.display_name ?? 'You'}
                    backPhotoUrl={item.back_photo_url ?? item.back_photo_path}
                    frontPhotoUrl={item.front_photo_url ?? item.front_photo_path}
                    blurhash={item.back_blurhash || DEFAULT_WARM_BLURHASH}
                    caption={item.caption}
                    postedAtIso={item.posted_at}
                    lateBySeconds={item.late_by_seconds}
                    isLate={item.is_late}
                    retakeCount={item.retake_count}
                    editableCaption
                    onSaveCaption={(nextCaption) => handleSaveCaption(item.id, nextCaption)}
                    canRetake={item.retake_count < 2}
                    onRetake={() =>
                      openCameraModal({
                        replaceMomentId: item.id,
                        retakesUsed: item.retake_count,
                      })
                    }
                    currentUserId={user?.id}
                    coupleId={couple?.id}
                    isOwner
                    onUpdated={refreshMoments}
                    onDeleted={refreshMoments}
                  />
                </RevealOnAppear>
              );
            })}
          </View>
        ) : (
          <View
            style={[
              styles.emptyCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.group,
                padding: spacing.xl,
              },
            ]}>
            <DualFrameMark size={48} />
            <Text style={[styles.emptyTitle, { color: colors.ink }]}>
              No posts in your feed yet
            </Text>
            <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>
              {isPartnerPaired
                ? `Posts from ${partnerName} and your friends appear here as soon as they share.`
                : 'Posts from your partner and friends appear here. Capture your Moment or add friends to fill your feed.'}
            </Text>
            <View style={styles.emptyActionsStack}>
              <KeepItButton
                label="Post a Moment"
                onPress={() => openCameraModal()}
              />
              {!isPartnerPaired ? (
                <KeepItButton
                  label="Add Friends"
                  variant="secondary"
                  onPress={() => router.navigate('/(tabs)/profile' as never)}
                />
              ) : null}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flexGrow: 1,
    maxWidth: APP_LAYOUT.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: 10,
  },
  feedStack: {
    gap: 14,
  },
  emptyCard: {
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  emptyTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
  emptyBody: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  emptyActionsStack: {
    width: '100%',
    gap: 10,
    marginTop: 4,
  },
});
