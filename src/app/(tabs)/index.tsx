import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { AppPressable as Pressable, PageHeader, SectionHeader } from '@/components/ui/ScreenKit';
import { WidgetPreviewCard } from '@/components/widget/WidgetPreviewCard';
import { useMomentCountdown } from '@/hooks/useMomentCountdown';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { useSessionStore } from '@/store/sessionStore';
import { APP_LAYOUT, useKeepItTheme } from '@/theme/tokens';
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
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: APP_LAYOUT.pageInset,
            paddingTop: 20,
            paddingBottom: APP_LAYOUT.tabBarClearance,
          },
        ]}>
        <PageHeader
          title="Today"
          subtitle={isPartnerPaired ? `${user?.display_name ?? 'You'} & ${partnerName}` : 'Your daily life, from both sides of the camera.'}
          action={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Messages"
              accessibilityHint="Open chat and 15-second Snaps"
              accessibilityShowsLargeContentViewer
              accessibilityLargeContentTitle="Messages"
              onPress={() => router.navigate('/(tabs)/messages')}
              style={[
                styles.chatIconButton,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.controlBorder,
                  borderRadius: radii.input,
                },
              ]}>
              <SymbolView
                name={{ ios: 'bubble.left.and.bubble.right', android: 'chat_bubble', web: 'chat_bubble' }}
                tintColor={colors.ink}
                size={21}
              />
            </Pressable>
          }
        />
        <View style={styles.quickCameraChipsRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => router.navigate('/(tabs)/settings')} style={[styles.cameraModeChip, { backgroundColor: colors.surface, borderRadius: radii.input }]}><Text style={[styles.cameraModeChipText, { color: colors.ink }]}>Settings</Text></Pressable>
          {!isPartnerPaired ? <Pressable accessibilityRole="button" onPress={() => router.navigate('/(auth)/pair')} style={[styles.cameraModeChip, { backgroundColor: colors.surface, borderRadius: radii.input }]}><Text style={[styles.cameraModeChipText, { color: colors.ink }]}>Pair with partner</Text></Pressable> : null}
        </View>

        <View style={[styles.quotaCard, { backgroundColor: colors.surface, borderRadius: radii.group, padding: 20 }]}>
          <SectionHeader title="Keep a little of today" subtitle={bundleQuery.isLoading ? 'Loading your daily capture allowance…' : bundleQuery.isError ? 'Capture allowance could not be refreshed.' : `${dailyPostCount} of ${maxDailyPosts} daily Moments posted`} />
          {bundle ? <>
            <View accessibilityLabel={`${dailyPostCount} of ${maxDailyPosts} daily slots used`} style={styles.dotsRow}>
              {Array.from({ length: maxDailyPosts }, (_, index) => <View key={index} style={[styles.quotaDot, { backgroundColor: index < dailyPostCount ? colors.ink : colors.surfaceElevated, borderColor: colors.controlBorder }]} />)}
            </View>
            <Text style={[styles.quotaSubtitle, { color: colors.inkMuted }]}>{countdown.phase === 'live' ? `Capture window open · ${countdown.formattedTimer}` : countdown.phase === 'upcoming' ? `Next window in ${countdown.formattedTimer}` : canPostMore ? `${maxDailyPosts - dailyPostCount} more Moment${maxDailyPosts - dailyPostCount === 1 ? '' : 's'} available today` : 'Your daily slots are full. Come back tomorrow.'}</Text>
          </> : null}
          <KeepItButton label={!canPostMore ? 'Daily limit reached' : dailyPostCount ? 'Capture another Moment' : 'Capture your Moment'} disabled={!canPostMore || !bundle || bundleQuery.isLoading} onPress={() => openCameraModal()} />
          {canPostMore && bundle ? <View style={styles.quickCameraChipsRow}>
            {([{ label: 'Front photo', lens: 'front', mode: 'photo' }, { label: 'Back photo', lens: 'back', mode: 'photo' }, { label: 'Dual video', lens: 'back', mode: 'video' }] as const).map((camera) => <Pressable key={camera.label} accessibilityRole="button" accessibilityLabel={`Capture ${camera.label.toLowerCase()}`} onPress={() => openCameraModal({ initialLens: camera.lens, initialMode: camera.mode })} style={[styles.cameraModeChip, { backgroundColor: colors.surfaceElevated, borderRadius: radii.input }]}><Text style={[styles.cameraModeChipText, { color: colors.ink }]}>{camera.label}</Text></Pressable>)}
          </View> : null}
        </View>

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
          statusError={statusQuery.isError ? 'Could not refresh statuses. Previously loaded statuses may be out of date.' : null}
          nudgeError={nudgesQuery.isError ? 'Could not load recent nudges.' : null}
          onRetryStatus={() => void statusQuery.refetch()}
          onRetryNudges={() => void nudgesQuery.refetch()}
          onSendNudge={isPartnerPaired ? () => void handleSendNudge() : undefined}
          onPressPair={() => router.navigate('/(auth)/pair')}
          onOpenStatusSheet={() => router.push('/status-sheet')}
        />

        <SectionHeader title="Today’s Moments" subtitle={bundle && streakCount > 0 ? `${streakCount}-day streak · Yours, theirs, and your circle` : 'Choose whose day to catch up on.'} />

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
        <View accessibilityRole="tablist" accessibilityLabel="Moment feeds" style={styles.switcherTrack}>
          {([{ id: 'mine', label: 'Yours' }, { id: 'partner', label: 'Partner' }, { id: 'friends', label: 'Friends' }, { id: 'together', label: 'Together' }] as const).map((tab) => <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: activeTab === tab.id }} onPress={() => setSelectedTab(tab.id)} style={[styles.switcherTab, { backgroundColor: activeTab === tab.id ? colors.accent : colors.surface, borderRadius: radii.input }]}><Text style={[styles.switcherText, { color: activeTab === tab.id ? colors.onAccent : colors.ink }]}>{tab.label}</Text></Pressable>)}
        </View>

        {bundleQuery.isLoading && !bundle ? (
          <SkeletonBlock height={240} label="Loading today’s Moments…" />
        ) : bundleQuery.isError && !bundle ? (
          <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>Your feeds are unavailable until sync succeeds. Retry above to load today’s Moments.</Text>
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
                    <View style={[styles.unlockedDot, { backgroundColor: colors.inkMuted }]} />
                    <Text style={[styles.unlockedBannerText, { color: colors.ink }]}>
                      Both you and {partnerName} have shared today
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
                    onPress={() => router.navigate('/(auth)/pair')}
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
                  onPress={() => router.navigate('/(auth)/pair')}
                />
              ) : null}
            </View>
          </View>
        )}

        <WidgetPreviewCard
          snapshot={widgetSync.snapshot}
          lastSyncedAt={widgetSync.lastSyncedAt}
          loading={bundleQuery.isLoading || statusQuery.isLoading}
          syncError={widgetSync.error}
          onPressCaptureLocked={() => openCameraModal()}
          onPressOpenApp={() => setSelectedTab(widgetSync.snapshot?.partnerName === 'You' ? 'mine' : 'partner')}
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
    maxWidth: APP_LAYOUT.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: 24,
  },
  chatIconButton: {
    width: 44,
    height: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  quotaCard: {
    gap: 12,
    borderCurve: 'continuous',
  },
  quotaSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  quotaDot: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    borderWidth: 1,
  },
  quickCameraChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cameraModeChip: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  cameraModeChipText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  switcherTrack: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  switcherTab: {
    flexGrow: 1,
    flexBasis: 110,
    minHeight: 48,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  switcherText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
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
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
  },
  friendsBanner: {
    flexWrap: 'wrap',
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
    fontSize: 13,
    lineHeight: 20,
  },
  addFriendBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  addFriendBtnText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  emptyCard: {
    alignItems: 'center',
    gap: 12,
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
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
  },
});
