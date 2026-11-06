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
} from '@/components/ui/Primitives';
import { WidgetPreviewCard } from '@/components/widget/WidgetPreviewCard';
import { useMomentCountdown } from '@/hooks/useMomentCountdown';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';
import { MomentRecord } from '@/types/database';

type HomeViewTab = 'partner' | 'mine' | 'together';

export default function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors, radii, spacing } = useKeepItTheme();

  const user = useSessionStore((s) => s.user);
  const partner = useSessionStore((s) => s.partner);
  const couple = useSessionStore((s) => s.couple);

  const [activeTab, setActiveTab] = useState<HomeViewTab>('partner');
  const [actionError, setActionError] = useState<string | null>(null);
  const [nudging, setNudging] = useState(false);
  const [nudgeFeedback, setNudgeFeedback] = useState<string | null>(null);

  const partnerName = partner?.display_name ?? 'Your partner';
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

  // Realtime subscription to moments, statuses, and couple_events (nudges)
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

  const myMoment = bundle?.mine ?? null;
  const partnerMoment = bundle?.partner ?? null;
  const bothUnlocked = Boolean(myMoment && partnerMoment && !partnerMoment.locked);
  const streakCount = bundle?.streak?.current_count ?? 0;

  // Auto-select the best view tab as Moments arrive
  useEffect(() => {
    if (myMoment && !partnerMoment) {
      setActiveTab('mine');
    } else if (partnerMoment) {
      setActiveTab('partner');
    }
  }, [myMoment?.id, partnerMoment?.id]);

  const openCameraModal = () => {
    if (!bundle?.prompt) return;
    router.push({
      pathname: '/camera',
      params: {
        promptId: bundle.prompt.id,
        triggerAt: bundle.prompt.trigger_at,
        retakesUsed: String(myMoment?.retake_count ?? 0),
      },
    });
  };

  const handleSaveCaption = async (nextCaption: string) => {
    if (!myMoment || !user || !couple) return;
    setActionError(null);
    try {
      await updateMomentCaption({
        momentId: myMoment.id,
        userId: user.id,
        caption: nextCaption,
      });
      await queryClient.invalidateQueries({ queryKey: ['today-moment', couple.id] });
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

  const canRetakeMine = Boolean(
    myMoment && myMoment.retake_count < 2 && countdown.phase === 'live'
  );

  const unlockedPartnerAsRecord: MomentRecord | null =
    bothUnlocked && partnerMoment && couple && bundle
      ? {
          id: partnerMoment.id,
          couple_id: couple.id,
          prompt_id: bundle.prompt.id,
          user_id: partnerMoment.user_id,
          back_photo_path: partnerMoment.back_photo_path ?? '',
          front_photo_path: partnerMoment.front_photo_path ?? '',
          back_blurhash: partnerMoment.back_blurhash || DEFAULT_WARM_BLURHASH,
          collage_photo_path: null,
          caption: partnerMoment.caption,
          captured_at: partnerMoment.captured_at,
          posted_at: partnerMoment.posted_at,
          late_by_seconds: partnerMoment.late_by_seconds,
          is_late: partnerMoment.is_late,
          retake_count: partnerMoment.retake_count,
          lat: null,
          lng: null,
          back_photo_url: partnerMoment.back_photo_url ?? partnerMoment.back_photo_path,
          front_photo_url: partnerMoment.front_photo_url ?? partnerMoment.front_photo_path,
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
            paddingBottom: 118,
          },
        ]}>
        {/* Top Header */}
        <RevealOnAppear revealKey="home-header">
          <View style={styles.topRow}>
            <View>
              <Text style={[styles.wordmark, { color: colors.ink }]}>KeepIt</Text>
              <Text style={[styles.subHeader, { color: colors.inkMuted }]}>
                {user?.display_name ?? 'You'} & {partnerName}
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
        </RevealOnAppear>

        {/* Partner & Self Ephemeral Status + Nudge Card */}
        <RevealOnAppear revealKey="home-status">
          <StatusHeaderCard
            partnerName={partnerName}
            partnerStatus={statusQuery.data?.partner ?? null}
            myStatus={statusQuery.data?.mine ?? null}
            latestNudge={nudgesQuery.data?.[0] ?? null}
            currentUserId={user?.id}
            nudging={nudging}
            nudgeFeedback={nudgeFeedback}
            onSendNudge={() => void handleSendNudge()}
            onOpenStatusSheet={() => router.push('/status-sheet')}
          />
        </RevealOnAppear>

        {/* Live 2-Minute Prompt Banner (when user hasn't posted yet) */}
        {bundle?.prompt && !myMoment ? (
          <RevealOnAppear revealKey="home-prompt-banner">
            <View
              style={[
                styles.promptBanner,
                {
                  backgroundColor: colors.surface,
                  borderColor:
                    countdown.phase === 'late' ? colors.warning : colors.border,
                  borderRadius: radii.group,
                  padding: spacing.lg,
                },
              ]}>
              {countdown.phase === 'upcoming' ? (
                <>
                  <Text style={[styles.bannerTitle, { color: colors.ink }]}>
                    Next window in {countdown.formattedTimer}
                  </Text>
                </>
              ) : (
                <>
                  <View style={styles.bannerTopRow}>
                    <Text style={[styles.bannerTitle, { color: colors.ink }]}>
                      {countdown.phase === 'live'
                        ? 'Time for today’s Moment'
                        : 'Today’s window is open (Late)'}
                    </Text>
                    <Text
                      style={[
                        styles.bannerTimer,
                        {
                          color:
                            countdown.phase === 'live' ? colors.ink : colors.warning,
                        },
                      ]}>
                      {countdown.formattedTimer}
                    </Text>
                  </View>
                  {countdown.phase === 'late' ? (
                    <Text style={[styles.bannerBody, { color: colors.inkMuted }]}>
                      Post to unlock {partnerName}’s Moment.
                    </Text>
                  ) : null}
                  <KeepItButton
                    label={
                      countdown.phase === 'live'
                        ? `Capture Today’s Moment (${countdown.formattedTimer})`
                        : 'Post Late Moment'
                    }
                    onPress={openCameraModal}
                  />
                </>
              )}
            </View>
          </RevealOnAppear>
        ) : null}

        {actionError ? <InlineNotice message={actionError} tone="error" /> : null}

        {/* Switcher: Partner / Yours / Together (when both posted) */}
        {myMoment || partnerMoment ? (
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
              onPress={() => setActiveTab('partner')}
              style={[
                styles.switcherTab,
                {
                  backgroundColor:
                    activeTab === 'partner' ? colors.surfaceElevated : 'transparent',
                  borderRadius: radii.input - 2,
                },
              ]}>
              <Text
                style={[
                  styles.switcherText,
                  {
                    color: activeTab === 'partner' ? colors.ink : colors.inkMuted,
                    fontWeight: activeTab === 'partner' ? '700' : '500',
                  },
                ]}>
                {partnerName}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'mine' }}
              onPress={() => setActiveTab('mine')}
              style={[
                styles.switcherTab,
                {
                  backgroundColor:
                    activeTab === 'mine' ? colors.surfaceElevated : 'transparent',
                  borderRadius: radii.input - 2,
                },
              ]}>
              <Text
                style={[
                  styles.switcherText,
                  {
                    color: activeTab === 'mine' ? colors.ink : colors.inkMuted,
                    fontWeight: activeTab === 'mine' ? '700' : '500',
                  },
                ]}>
                Your Moment
              </Text>
            </Pressable>

            {bothUnlocked ? (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === 'together' }}
                onPress={() => setActiveTab('together')}
                style={[
                  styles.switcherTab,
                  {
                    backgroundColor:
                      activeTab === 'together' ? colors.surfaceElevated : 'transparent',
                    borderRadius: radii.input - 2,
                  },
                ]}>
                <Text
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
            ) : null}
          </View>
        ) : null}

        {/* Main Focal Area */}
        {activeTab === 'together' && bothUnlocked && myMoment && unlockedPartnerAsRecord ? (
          <TogetherCollageCard
            promptDate={bundle!.prompt.prompt_date}
            myMoment={myMoment}
            partnerMoment={unlockedPartnerAsRecord}
            myName={user?.display_name ?? 'You'}
            partnerName={partnerName}
            streakCount={streakCount}
            revealKey={`home-together-${bundle!.prompt.id}`}
          />
        ) : activeTab === 'partner' ? (
          partnerMoment ? (
            partnerMoment.locked ? (
              <LockedMomentCard
                partnerName={partnerName}
                postedAtIso={partnerMoment.posted_at}
                lateBySeconds={partnerMoment.late_by_seconds}
                isLate={partnerMoment.is_late}
                onCaptureMine={openCameraModal}
              />
            ) : (
              <DualMomentCard
                authorName={partnerName}
                backPhotoUrl={partnerMoment.back_photo_url ?? ''}
                frontPhotoUrl={partnerMoment.front_photo_url ?? ''}
                blurhash={partnerMoment.back_blurhash || DEFAULT_WARM_BLURHASH}
                caption={partnerMoment.caption}
                postedAtIso={partnerMoment.posted_at}
                lateBySeconds={partnerMoment.late_by_seconds}
                isLate={partnerMoment.is_late}
                retakeCount={partnerMoment.retake_count}
              />
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
                Waiting on {partnerName}
              </Text>
            </View>
          )
        ) : myMoment ? (
          <DualMomentCard
            authorName={user?.display_name ?? 'You'}
            backPhotoUrl={myMoment.back_photo_url ?? myMoment.back_photo_path}
            frontPhotoUrl={myMoment.front_photo_url ?? myMoment.front_photo_path}
            blurhash={myMoment.back_blurhash || DEFAULT_WARM_BLURHASH}
            caption={myMoment.caption}
            postedAtIso={myMoment.posted_at}
            lateBySeconds={myMoment.late_by_seconds}
            isLate={myMoment.is_late}
            retakeCount={myMoment.retake_count}
            editableCaption
            onSaveCaption={handleSaveCaption}
            canRetake={canRetakeMine}
            onRetake={openCameraModal}
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
              No Moment posted today
            </Text>
            {countdown.phase !== 'upcoming' ? (
              <KeepItButton label="Open Dual Camera" onPress={openCameraModal} />
            ) : null}
          </View>
        )}

        {/* Native iOS WidgetKit & Android Glance Live Preview + Sync */}
        <WidgetPreviewCard
          snapshot={widgetSync.snapshot}
          lastSyncedAt={widgetSync.lastSyncedAt}
          onPressCaptureLocked={openCameraModal}
          onPressOpenApp={() => setActiveTab('partner')}
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
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  promptBanner: {
    borderWidth: 1,
    gap: 10,
    borderCurve: 'continuous',
  },
  bannerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  bannerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  bannerTimer: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  bannerBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  switcherTrack: {
    flexDirection: 'row',
    borderWidth: 1,
    padding: 3,
    gap: 4,
    borderCurve: 'continuous',
  },
  switcherTab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  switcherText: {
    fontSize: 13,
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
  sandboxCard: {
    borderWidth: 1,
    gap: 10,
    borderCurve: 'continuous',
  },
  sandboxHeader: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  sandboxRow: {
    flexDirection: 'row',
    gap: 10,
  },
});
