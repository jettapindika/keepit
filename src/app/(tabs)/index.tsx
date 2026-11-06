import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  DEFAULT_WARM_BLURHASH,
  fetchTodayMomentBundle,
  simulateSandboxPartnerMoment,
  simulateSandboxPromptState,
  updateMomentCaption,
} from '@/api/moments';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { DualMomentCard, LockedMomentCard } from '@/components/moment/MomentCards';
import { DualFrameMark, InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { useMomentCountdown } from '@/hooks/useMomentCountdown';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';

export default function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors, radii, spacing } = useKeepItTheme();

  const user = useSessionStore((s) => s.user);
  const partner = useSessionStore((s) => s.partner);
  const couple = useSessionStore((s) => s.couple);

  const [activeTab, setActiveTab] = useState<'partner' | 'mine'>('partner');
  const [actionError, setActionError] = useState<string | null>(null);

  const partnerName = partner?.display_name ?? 'Your partner';
  const partnerId =
    couple && user
      ? (couple.user_a_id === user.id ? couple.user_b_id : couple.user_a_id) ?? 'sandbox_partner_maya'
      : 'sandbox_partner_maya';

  const bundleQuery = useQuery({
    queryKey: ['today-moment', couple?.id, user?.id],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () =>
      fetchTodayMomentBundle({
        coupleId: couple!.id,
        userId: user!.id,
      }),
  });

  // Realtime subscription to public.moments so partner posts unlock/appear live
  useEffect(() => {
    const client = supabase;
    if (!couple?.id || !isSupabaseConfigured || !client) return;

    const channel = client
      .channel(`moments:${couple.id}`)
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
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [couple?.id, queryClient]);

  const bundle = bundleQuery.data;
  const countdown = useMomentCountdown(bundle?.prompt.trigger_at);

  const myMoment = bundle?.mine ?? null;
  const partnerMoment = bundle?.partner ?? null;
  const streakCount = bundle?.streak?.current_count ?? 0;

  // Auto-select the most relevant view tab when data arrives
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

  const canRetakeMine = Boolean(
    myMoment && myMoment.retake_count < 2 && countdown.phase === 'live'
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
        ]}>
        {/* Top Header */}
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
                borderColor: colors.accent,
                backgroundColor: colors.accentSoft,
                borderRadius: radii.pill,
              },
            ]}>
            <Text style={[styles.streakText, { color: colors.accent }]}>
              {streakCount}d streak
            </Text>
          </View>
        </View>

        {/* Live 2-Minute Prompt Banner (when user hasn't posted yet) */}
        {bundle?.prompt && !myMoment ? (
          <View
            style={[
              styles.promptBanner,
              {
                backgroundColor:
                  countdown.phase === 'live' ? colors.accentSoft : colors.surface,
                borderColor:
                  countdown.phase === 'live'
                    ? colors.accent
                    : countdown.phase === 'late'
                      ? colors.warning
                      : colors.border,
                borderRadius: radii.card,
                padding: spacing.lg,
              },
            ]}>
            {countdown.phase === 'upcoming' ? (
              <>
                <Text style={[styles.bannerTitle, { color: colors.ink }]}>
                  Today’s window hasn’t opened yet
                </Text>
                <Text style={[styles.bannerBody, { color: colors.inkMuted }]}>
                  Both phones will ring at the same random moment today ({countdown.formattedTimer}{' '}
                  until window).
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
                          countdown.phase === 'live' ? colors.accent : colors.warning,
                      },
                    ]}>
                    {countdown.formattedTimer}
                  </Text>
                </View>
                <Text style={[styles.bannerBody, { color: colors.inkMuted }]}>
                  {countdown.phase === 'live'
                    ? 'Capture your front and back photo within 2 minutes.'
                    : `The 2-minute window passed, but you can still post (${countdown.formattedTimer}) to unlock ${partnerName}’s Moment.`}
                </Text>
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
        ) : null}

        {actionError ? <InlineNotice message={actionError} tone="error" /> : null}

        {/* Switcher between Partner & Yours when at least one Moment exists */}
        {(myMoment || partnerMoment) ? (
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
                {partnerName}’s Moment
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
          </View>
        ) : null}

        {/* Main Focal Area */}
        {activeTab === 'partner' ? (
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
                  borderRadius: radii.card,
                  padding: spacing.xl,
                },
              ]}>
              <DualFrameMark size={48} />
              <Text style={[styles.emptyTitle, { color: colors.ink }]}>
                {partnerName} hasn’t posted today’s Moment yet
              </Text>
              <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>
                {myMoment
                  ? `Your Moment is posted and waiting. As soon as ${partnerName} captures theirs, it unlocks right here.`
                  : `Post your Moment first so ${partnerName} gets a notification to unlock yours.`}
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
                borderRadius: radii.card,
                padding: spacing.xl,
              },
            ]}>
            <DualFrameMark size={48} />
            <Text style={[styles.emptyTitle, { color: colors.ink }]}>
              You haven’t posted today’s Moment
            </Text>
            <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>
              Capture your back and front camera together to unlock today’s shared memory.
            </Text>
            {countdown.phase !== 'upcoming' ? (
              <KeepItButton label="Open Dual Camera" onPress={openCameraModal} />
            ) : null}
          </View>
        )}

        {/* Sandbox Simulator Controls (only when Supabase URL is unset) */}
        {!isSupabaseConfigured && couple && bundle?.prompt ? (
          <View
            style={[
              styles.sandboxCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.card,
                padding: spacing.lg,
              },
            ]}>
            <Text style={[styles.sandboxHeader, { color: colors.inkMuted }]}>
              Local Sandbox Controls
            </Text>
            <View style={styles.sandboxRow}>
              <KeepItButton
                label={`Simulate ${partnerName} Posts`}
                variant="secondary"
                onPress={() => {
                  void simulateSandboxPartnerMoment({
                    coupleId: couple.id,
                    promptId: bundle.prompt.id,
                    partnerId,
                    partnerName,
                    postLate: false,
                  }).then(() =>
                    queryClient.invalidateQueries({ queryKey: ['today-moment', couple.id] })
                  );
                }}
                style={styles.flex}
              />
              <KeepItButton
                label="Simulate Late Window"
                variant="secondary"
                onPress={() => {
                  void simulateSandboxPromptState({
                    coupleId: couple.id,
                    mode: 'late_window',
                  }).then(() =>
                    queryClient.invalidateQueries({ queryKey: ['today-moment', couple.id] })
                  );
                }}
                style={styles.flex}
              />
            </View>
          </View>
        ) : null}
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
    gap: 20,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wordmark: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  subHeader: {
    fontSize: 13,
    fontWeight: '500',
  },
  streakBadge: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderCurve: 'continuous',
  },
  streakText: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  promptBanner: {
    borderWidth: 1.5,
    gap: 10,
    borderCurve: 'continuous',
  },
  bannerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bannerTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  bannerTimer: {
    fontSize: 15,
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
    fontSize: 14,
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
  },
  sandboxRow: {
    flexDirection: 'row',
    gap: 10,
  },
});
