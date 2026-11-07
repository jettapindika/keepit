import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchRecentNudges, sendPartnerNudge } from '@/api/extras';
import {
  DEFAULT_WARM_BLURHASH,
  fetchTodayMomentBundle,
  updateMomentCaption,
} from '@/api/moments';
import { fetchCoupleStatuses } from '@/api/statuses';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { TogetherCollageCard } from '@/components/memories/TogetherCollageCard';
import { DualMomentCard, LockedMomentCard } from '@/components/moment/MomentCards';
import { StatusHeaderCard } from '@/components/status/StatusHeaderCard';
import {
  DualFrameMark,
  InlineNotice,
  KeepItButton,
  RevealOnAppear,
  SkeletonBlock,
} from '@/components/ui/Primitives';
import { WidgetPreviewCard } from '@/components/widget/WidgetPreviewCard';
import { useMomentCountdown } from '@/hooks/useMomentCountdown';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';
import {
  MAX_DAILY_MOMENTS_PER_DAY,
  MomentRecord,
  PartnerMomentView,
} from '@/types/database';

type HomeViewTab = 'partner' | 'mine' | 'friends' | 'together';

export default function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors, radii, spacing } = useKeepItTheme();

  const user = useSessionStore((s) => s.user);
  const partner = useSessionStore((s) => s.partner);
  const couple = useSessionStore((s) => s.couple);

  const isPartnerPaired = Boolean(partner && couple && !couple.id.startsWith('solo_'));
  const [selectedTab, setSelectedTab] = useState<HomeViewTab | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nudging, setNudging] = useState(false);
  const [nudgeFeedback, setNudgeFeedback] = useState<string | null>(null);
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
  const countdown = useMomentCountdown(bundle?.prompt.trigger_at);

  const widgetSync = useWidgetSync({
    partnerName,
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
  const partnerMoment = bundle?.partner ?? partnerMomentsToday[0] ?? null;
  const dailyPostCount = bundle?.dailyPostCount ?? myMomentsToday.length;
  const maxDailyPosts = bundle?.maxDailyPosts ?? MAX_DAILY_MOMENTS_PER_DAY;
  const canPostMore = dailyPostCount < maxDailyPosts;

  const bothUnlocked = Boolean(myMoment && partnerMoment && !partnerMoment.locked);
  const streakCount = bundle?.streak?.current_count ?? 0;

  const defaultTab: HomeViewTab =
    myMoment && !partnerMoment
      ? 'mine'
      : partnerMoment
        ? 'partner'
        : isPartnerPaired
          ? 'partner'
          : 'mine';
  const activeTab: HomeViewTab = selectedTab ?? defaultTab;

  const nonSnapMyMoment = myMomentsToday.find((m) => !m.snap_once) ?? null;
  const nonSnapPartnerMoment =
    partnerMomentsToday.find((pm) => !pm.locked && !pm.snap_once) ?? null;

  const refreshMoments = async () => {
    if (!couple?.id) return;
    await queryClient.invalidateQueries({ queryKey: ['today-moment', couple.id] });
    await queryClient.invalidateQueries({ queryKey: ['month-memories', couple.id] });
    await queryClient.invalidateQueries({ queryKey: ['user-posts'] });
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
    }
  };

  const handleSendNudge = async () => {
    if (!couple || !user) return;
    setNudging(true);
    setNudgeFeedback(null);
    try {
      await sendPartnerNudge({
        coupleId: couple.id,
        userId: user.id,
        note: `Thinking of you, ${partnerName}`,
      });
      setNudgeFeedback(`Sent a nudge to ${partnerName}.`);
      await queryClient.invalidateQueries({ queryKey: ['couple-nudges', couple.id] });
    } catch (err) {
      setNudgeFeedback(err instanceof Error ? err.message : 'Could not send nudge.');
    } finally {
      setNudging(false);
    }
  };

  const unlockedPartnerAsRecord: MomentRecord | null =
    bothUnlocked && nonSnapPartnerMoment && couple && bundle
      ? {
          id: nonSnapPartnerMoment.id,
          couple_id: couple.id,
          prompt_id: bundle.prompt.id,
          user_id: nonSnapPartnerMoment.user_id,
          author_name: nonSnapPartnerMoment.author_name ?? partnerName,
          author_username: nonSnapPartnerMoment.author_username,
          author_avatar: nonSnapPartnerMoment.author_avatar,
          back_photo_path: nonSnapPartnerMoment.back_photo_path ?? '',
          front_photo_path: nonSnapPartnerMoment.front_photo_path ?? '',
          back_blurhash: nonSnapPartnerMoment.back_blurhash || DEFAULT_WARM_BLURHASH,
          collage_photo_path: null,
          caption: nonSnapPartnerMoment.caption,
          captured_at: nonSnapPartnerMoment.captured_at,
          posted_at: nonSnapPartnerMoment.posted_at,
          late_by_seconds: nonSnapPartnerMoment.late_by_seconds,
          is_late: nonSnapPartnerMoment.is_late,
          retake_count: nonSnapPartnerMoment.retake_count,
          daily_index: nonSnapPartnerMoment.daily_index,
          lat: nonSnapPartnerMoment.lat ?? null,
          lng: nonSnapPartnerMoment.lng ?? null,
          location_label: nonSnapPartnerMoment.location_label,
          music_track: nonSnapPartnerMoment.music_track,
          tagged_users: nonSnapPartnerMoment.tagged_users,
          overlays: nonSnapPartnerMoment.overlays,
          visibility: nonSnapPartnerMoment.visibility,
          snap_once: false,
          snap_duration_seconds: nonSnapPartnerMoment.snap_duration_seconds,
          viewed_by_user_ids: nonSnapPartnerMoment.viewed_by_user_ids,
          snap_opened_at_by_user: nonSnapPartnerMoment.snap_opened_at_by_user,
          comments: nonSnapPartnerMoment.comments,
          reactions: nonSnapPartnerMoment.reactions,
          watermark_tag: nonSnapPartnerMoment.watermark_tag ?? '#KeepIt',
          media_type: nonSnapPartnerMoment.media_type,
          video_uri: nonSnapPartnerMoment.video_uri,
          video_duration_seconds: nonSnapPartnerMoment.video_duration_seconds,
          filter_preset: nonSnapPartnerMoment.filter_preset,
          back_photo_url:
            nonSnapPartnerMoment.back_photo_url ?? nonSnapPartnerMoment.back_photo_path,
          front_photo_url:
            nonSnapPartnerMoment.front_photo_url ?? nonSnapPartnerMoment.front_photo_path,
        }
      : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.xl,
            paddingBottom: 148,
          },
        ]}>
        <RevealOnAppear revealKey="home-header">
          <View style={styles.headerBlock}>
            <View style={styles.topRow}>
              <View style={styles.brandColumn}>
                <Text style={[styles.wordmark, { color: colors.ink }]}>KeepIt</Text>
                <Text style={[styles.subHeader, { color: colors.inkMuted }]}>
                  {isPartnerPaired
                    ? `${user?.display_name ?? 'You'} & ${partnerName}`
                    : `${user?.display_name ?? 'You'} · ${user?.is_private ? 'Private Dump' : 'Solo & Friends Circle'}`}
                </Text>
              </View>

              <View
                style={[
                  styles.streakBadge,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surfaceElevated,
                    borderRadius: radii.pill,
                  },
                ]}>
                <Text style={[styles.streakText, { color: colors.ink }]}>
                  {streakCount}d streak
                </Text>
              </View>
            </View>

            <View style={styles.quickNavRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open Memories Calendar"
                onPress={() => router.navigate('/(tabs)/memories')}
                style={[
                  styles.quickNavPill,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.pill,
                  },
                ]}>
                <Text pointerEvents="none" style={[styles.quickNavText, { color: colors.ink }]}>Memories</Text>
              </Pressable>

              {/* DMs are directly in the bottom dock; keep header utilities focused on Memories, Settings, and Pairing */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open Settings"
                onPress={() => router.navigate('/(tabs)/settings')}
                style={[
                  styles.quickNavPill,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.pill,
                  },
                ]}>
                <Text pointerEvents="none" style={[styles.quickNavText, { color: colors.inkMuted }]}>Settings</Text>
              </Pressable>

              {!isPartnerPaired ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Optional: Pair with a Partner"
                  onPress={() => router.navigate('/(auth)/pair')}
                  style={[
                    styles.quickNavPill,
                    {
                      backgroundColor: colors.accentSoft,
                      borderColor: colors.accent,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text pointerEvents="none" style={[styles.quickNavText, { color: colors.ink }]}>
                    + Pair Partner
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </RevealOnAppear>

        <RevealOnAppear revealKey="home-status">
          <StatusHeaderCard
            partnerName={partnerName}
            partnerStatus={statusQuery.data?.partner ?? null}
            myStatus={statusQuery.data?.mine ?? null}
            isPartnerPaired={isPartnerPaired}
            latestNudge={nudgesQuery.data?.[0] ?? null}
            currentUserId={user?.id}
            nudging={nudging}
            nudgeFeedback={nudgeFeedback}
            onSendNudge={isPartnerPaired ? () => void handleSendNudge() : undefined}
            onPressPair={() => router.push('/(auth)/pair')}
            onOpenStatusSheet={() => router.push('/status-sheet')}
          />
        </RevealOnAppear>

        <RevealOnAppear revealKey="home-daily-quota">
          <View
            style={[
              styles.quotaCard,
              {
                backgroundColor: colors.surface,
                borderColor:
                  countdown.phase === 'late' && dailyPostCount === 0
                    ? colors.warning
                    : colors.border,
                borderRadius: radii.group,
                padding: spacing.lg,
              },
            ]}>
            <View style={styles.quotaTopRow}>
              <View style={styles.flex}>
                <Text style={[styles.quotaTitle, { color: colors.ink }]}>
                  Today’s Moments: {dailyPostCount} / {maxDailyPosts} posted
                </Text>
                <Text style={[styles.quotaSubtitle, { color: colors.inkMuted }]}>
                  {countdown.phase === 'live'
                    ? `Live window open · ${countdown.formattedTimer}`
                    : countdown.phase === 'upcoming'
                      ? `Next window in ${countdown.formattedTimer}`
                      : canPostMore
                        ? `You can capture ${maxDailyPosts - dailyPostCount} more Moment${
                            maxDailyPosts - dailyPostCount === 1 ? '' : 's'
                          } today`
                        : 'All 5 daily slots filled'}
                </Text>
              </View>

              <View
                accessibilityLabel={`${dailyPostCount} of ${maxDailyPosts} daily Moments posted`}
                style={styles.dotsRow}>
                {[0, 1, 2, 3, 4].map((slotIdx) => {
                  const filled = slotIdx < dailyPostCount;
                  return (
                    <View
                      key={slotIdx}
                      style={[
                        styles.quotaDot,
                        {
                          backgroundColor: filled ? colors.ink : colors.surfaceElevated,
                          borderColor: filled ? colors.ink : colors.border,
                        },
                      ]}
                    />
                  );
                })}
              </View>
            </View>

            <KeepItButton
              label={
                !canPostMore
                  ? `Daily Limit Reached (${dailyPostCount}/${maxDailyPosts})`
                  : dailyPostCount === 0
                    ? `Capture Moment (${dailyPostCount}/${maxDailyPosts})`
                    : `Take Another Photo (+) · ${dailyPostCount}/${maxDailyPosts}`
              }
              disabled={!canPostMore}
              onPress={() => openCameraModal()}
            />

            {canPostMore ? (
              <View style={styles.quickCameraChipsRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Launch Front Camera"
                  onPress={() =>
                    openCameraModal({ initialLens: 'front', initialMode: 'photo' })
                  }
                  style={[
                    styles.cameraModeChip,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text pointerEvents="none" style={[styles.cameraModeChipText, { color: colors.ink }]}>
                    Front Camera
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Launch Dual Video Camera"
                  onPress={() =>
                    openCameraModal({ initialLens: 'back', initialMode: 'video' })
                  }
                  style={[
                    styles.cameraModeChip,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text pointerEvents="none" style={[styles.cameraModeChipText, { color: colors.ink }]}>
                    Video
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Launch Back Camera"
                  onPress={() =>
                    openCameraModal({ initialLens: 'back', initialMode: 'photo' })
                  }
                  style={[
                    styles.cameraModeChip,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text pointerEvents="none" style={[styles.cameraModeChipText, { color: colors.inkMuted }]}>
                    Back Lens
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </RevealOnAppear>

        {actionError || bundleQuery.isError ? (
          <View style={{ gap: spacing.xs }}>
            <InlineNotice
              message={
                actionError ??
                (bundleQuery.error instanceof Error
                  ? bundleQuery.error.message
                  : 'Could not sync today’s Moments.')
              }
              tone="error"
            />
            {bundleQuery.isError ? (
              <KeepItButton
                label="Retry Sync"
                variant="secondary"
                onPress={() => void bundleQuery.refetch()}
              />
            ) : null}
          </View>
        ) : null}
        <View
          accessibilityRole="tablist"
          style={[
            styles.switcherTrack,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.input,
            },
          ]}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'partner' }}
            onPress={() => setSelectedTab('partner')}
            style={[
              styles.switcherTab,
              {
                backgroundColor:
                  activeTab === 'partner' ? colors.surfaceElevated : 'transparent',
                borderRadius: radii.input - 2,
              },
            ]}>
            <Text
              numberOfLines={1}
              style={[
                styles.switcherText,
                {
                  color: activeTab === 'partner' ? colors.ink : colors.inkMuted,
                  fontWeight: activeTab === 'partner' ? '700' : '500',
                },
              ]}>
              Partner
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'mine' }}
            onPress={() => setSelectedTab('mine')}
            style={[
              styles.switcherTab,
              {
                backgroundColor:
                  activeTab === 'mine' ? colors.surfaceElevated : 'transparent',
                borderRadius: radii.input - 2,
              },
            ]}>
            <Text
              numberOfLines={1}
              style={[
                styles.switcherText,
                {
                  color: activeTab === 'mine' ? colors.ink : colors.inkMuted,
                  fontWeight: activeTab === 'mine' ? '700' : '500',
                },
              ]}>
              Yours ({dailyPostCount}/{maxDailyPosts})
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'friends' }}
            onPress={() => setSelectedTab('friends')}
            style={[
              styles.switcherTab,
              {
                backgroundColor:
                  activeTab === 'friends' ? colors.surfaceElevated : 'transparent',
                borderRadius: radii.input - 2,
              },
            ]}>
            <Text
              numberOfLines={1}
              style={[
                styles.switcherText,
                {
                  color: activeTab === 'friends' ? colors.ink : colors.inkMuted,
                  fontWeight: activeTab === 'friends' ? '700' : '500',
                },
              ]}>
              Friends ({friendMomentsToday.length})
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'together' }}
            onPress={() => setSelectedTab('together')}
            style={[
              styles.switcherTab,
              {
                backgroundColor:
                  activeTab === 'together' ? colors.surfaceElevated : 'transparent',
                borderRadius: radii.input - 2,
              },
            ]}>
            <Text
              numberOfLines={1}
              style={[
                styles.switcherText,
                {
                  color: activeTab === 'together' ? colors.ink : colors.inkMuted,
                  fontWeight: activeTab === 'together' ? '700' : '500',
                },
              ]}>
              Together
            </Text>
          </Pressable>
        </View>

        {bundleQuery.isLoading && !bundle ? (
          <SkeletonBlock height={360} label="Loading today's Moments..." />
        ) : activeTab === 'partner' ? (
          partnerMomentsToday.length > 0 ? (
            partnerMomentsToday[0].locked ? (
              <LockedMomentCard
                partnerName={partnerName}
                postedAtIso={partnerMomentsToday[0].posted_at}
                lateBySeconds={partnerMomentsToday[0].late_by_seconds}
                isLate={partnerMomentsToday[0].is_late}
                onCaptureMine={() => openCameraModal()}
              />
            ) : (
              <RevealOnAppear revealKey={`partner-unlocked-${partnerMomentsToday[0].id}`}>
                <View style={styles.feedStack}>
                  <View
                    style={[
                      styles.unlockedBanner,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                        borderRadius: radii.card,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.sm,
                      },
                    ]}>
                    <View style={[styles.unlockedDot, { backgroundColor: colors.success }]} />
                    <Text style={[styles.unlockedBannerText, { color: colors.ink }]}>
                      Reciprocal Moment unlocked · Both you and {partnerName} posted today
                    </Text>
                  </View>
                  {partnerMomentsToday.map((pm) => (
                    <DualMomentCard
                      key={pm.id}
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
                  ))}
                </View>
              </RevealOnAppear>
            )
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
                {isPartnerPaired ? `Waiting on ${partnerName}` : 'No partner paired yet'}
              </Text>
              <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>
                {isPartnerPaired
                  ? `${partnerName} hasn’t shared today’s Moment yet.`
                  : 'Pair with your partner using a 6-character invite code to share daily Moments together.'}
              </Text>
              <View style={styles.emptyActionsStack}>
                {isPartnerPaired ? (
                  <KeepItButton
                    label={`Nudge ${partnerName}`}
                    variant="secondary"
                    loading={nudging}
                    onPress={() => void handleSendNudge()}
                  />
                ) : (
                  <KeepItButton
                    label="Pair with Partner (Invite Code)"
                    variant="secondary"
                    onPress={() => router.push('/(auth)/pair')}
                  />
                )}
              </View>
            </View>
          )
        ) : activeTab === 'mine' ? (
          myMomentsToday.length > 0 ? (
            <View style={styles.feedStack}>
              {myMomentsToday.map((item, idx) => (
                <View key={item.id} style={styles.momentItemBlock}>
                  {myMomentsToday.length > 1 ? (
                    <View style={styles.momentIndexHeader}>
                      <Text style={[styles.momentIndexLabel, { color: colors.inkMuted }]}>
                        Moment #{item.daily_index ?? myMomentsToday.length - idx} of{' '}
                        {maxDailyPosts}
                      </Text>
                    </View>
                  ) : null}
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
                </View>
              ))}

              {canPostMore ? (
                <KeepItButton
                  label={`Post Another Moment (${dailyPostCount}/${maxDailyPosts})`}
                  variant="secondary"
                  onPress={() => openCameraModal()}
                />
              ) : null}
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
                No Moment posted today
              </Text>
              <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>
                Share up to {maxDailyPosts} dual-camera photos or videos each day with{' '}
                {partnerName} and your inner circle.
              </Text>
              <KeepItButton
                label="Open Dual Camera"
                onPress={() => openCameraModal()}
              />
            </View>
          )
        ) : activeTab === 'friends' ? (
          <View style={styles.feedStack}>
            <View
              style={[
                styles.friendsBanner,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.card,
                  padding: spacing.md,
                },
              ]}>
              <View style={styles.flex}>
                <Text style={[styles.friendsBannerTitle, { color: colors.ink }]}>
                  Friends Circle
                </Text>
                <Text style={[styles.friendsBannerSub, { color: colors.inkMuted }]}>
                  React, comment, save, or share 9:16 stories from your circle
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add Friend"
                onPress={() => router.navigate('/(tabs)/profile' as never)}
                style={[
                  styles.addFriendBtn,
                  {
                    backgroundColor: colors.accent,
                    borderRadius: radii.pill,
                  },
                ]}>
                <Text style={[styles.addFriendBtnText, { color: colors.onAccent }]}>
                  + Add Friend
                </Text>
              </Pressable>
            </View>

            {friendMomentsToday.length > 0 ? (
              friendMomentsToday.map((fm) => (
                <DualMomentCard
                  key={fm.id}
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
              ))
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
                  No friend Moments yet
                </Text>
                <KeepItButton
                  label="Add Friend"
                  variant="secondary"
                  onPress={() => router.navigate('/(tabs)/profile' as never)}
                />
              </View>
            )}
          </View>
        ) : bothUnlocked && nonSnapMyMoment && unlockedPartnerAsRecord ? (
          <TogetherCollageCard
            promptDate={bundle!.prompt.prompt_date}
            myMoment={nonSnapMyMoment}
            partnerMoment={unlockedPartnerAsRecord}
            myName={user?.display_name ?? 'You'}
            partnerName={partnerName}
            streakCount={streakCount}
            revealKey={`home-together-${bundle!.prompt.id}`}
          />
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
              Together Collage Locked
            </Text>
            <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>
              {isPartnerPaired
                ? `Once both you and ${partnerName} post a Moment today, your side-by-side dual collage unlocks automatically.`
                : 'Pair with a partner and both post a Moment today to unlock your side-by-side dual collage.'}
            </Text>
            <View style={styles.emptyActionsStack}>
              {!myMoment ? (
                <KeepItButton
                  label="Capture Your Moment"
                  onPress={() => openCameraModal()}
                />
              ) : null}
              {!isPartnerPaired ? (
                <KeepItButton
                  label="Pair with Partner"
                  variant="secondary"
                  onPress={() => router.push('/(auth)/pair')}
                />
              ) : null}
            </View>
          </View>
        )}

        <WidgetPreviewCard
          snapshot={widgetSync.snapshot}
          lastSyncedAt={widgetSync.lastSyncedAt}
          onPressCaptureLocked={() => openCameraModal()}
          onPressOpenApp={() => setSelectedTab('partner')}
          onPressSyncNow={widgetSync.forceSync}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    gap: 18,
  },
  headerBlock: {
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandColumn: {
    gap: 2,
  },
  wordmark: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.9,
  },
  subHeader: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  streakBadge: {
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderCurve: 'continuous',
  },
  streakText: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  quickNavRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickNavPill: {
    minHeight: 40,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  quickNavText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  quotaCard: {
    borderWidth: 1,
    gap: 12,
    borderCurve: 'continuous',
  },
  quotaTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  quotaTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  quotaSubtitle: {
    fontSize: 13,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  quotaDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
  },
  quickCameraChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cameraModeChip: {
    minHeight: 40,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  cameraModeChipText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  switcherTrack: {
    flexDirection: 'row',
    borderWidth: 1,
    padding: 3,
    gap: 3,
    borderCurve: 'continuous',
  },
  switcherTab: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  switcherText: {
    fontSize: 12,
    letterSpacing: -0.2,
  },
  feedStack: {
    gap: 18,
  },
  momentItemBlock: {
    gap: 8,
  },
  momentIndexHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  momentIndexLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  friendsBanner: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderCurve: 'continuous',
  },
  friendsBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  friendsBannerSub: {
    fontSize: 12,
    marginTop: 2,
  },
  addFriendBtn: {
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  addFriendBtnText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  emptyCard: {
    borderWidth: 1,
    alignItems: 'center',
    gap: 12,
    borderCurve: 'continuous',
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginTop: 4,
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  emptyActionsStack: {
    width: '100%',
    gap: 10,
    marginTop: 4,
  },
  unlockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  unlockedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  unlockedBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
