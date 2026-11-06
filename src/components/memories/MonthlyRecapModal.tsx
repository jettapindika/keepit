import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TogetherCollageCard } from '@/components/memories/TogetherCollageCard';
import { DualFrameMark, KeepItButton } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { MOCHY_SPRINGS, mochyTiming } from '@/theme/motion';
import { useKeepItTheme } from '@/theme/tokens';
import { MemoryDayRecord, StreakRecord } from '@/types/database';

export interface MonthlyRecapModalProps {
  visible: boolean;
  onClose: () => void;
  monthLabel: string;
  days: MemoryDayRecord[];
  streak: StreakRecord | null;
  myName: string;
  partnerName: string;
}

export function MonthlyRecapModal({
  visible,
  onClose,
  monthLabel,
  days,
  streak,
  myName,
  partnerName,
}: MonthlyRecapModalProps) {
  const { colors, radii, spacing, type } = useKeepItTheme();
  const motionEnabled = useSessionStore((s) => s.motionEnabled);
  const motionSpeed = useSessionStore((s) => s.motionSpeed);

  const [stepState, setStepState] = useState<{ openGen: number; idx: number }>({ openGen: 0, idx: 0 });
  const stepIndex = stepState.idx;
  // Computed strictly from real days[] records
  const recapMetrics = useMemo(() => {
    const togetherDays = [...days]
      .filter((d): d is MemoryDayRecord & { mine: NonNullable<MemoryDayRecord['mine']>; partner: NonNullable<MemoryDayRecord['partner']> } =>
        Boolean(d.mine && d.partner)
      )
      .sort((a, b) => (a.prompt_date < b.prompt_date ? -1 : 1));

    let totalMomentsPosted = 0;
    let onTimeMomentsCount = 0;

    for (const day of days) {
      if (day.mine) {
        totalMomentsPosted += 1;
        if (!day.mine.is_late) onTimeMomentsCount += 1;
      }
      if (day.partner) {
        totalMomentsPosted += 1;
        if (!day.partner.is_late) onTimeMomentsCount += 1;
      }
    }

    const onTimeRatePct =
      totalMomentsPosted > 0 ? Math.round((onTimeMomentsCount / totalMomentsPosted) * 100) : 0;

    // Compute longest consecutive completed-day run inside this month, bounded below by global longest streak if higher
    let monthBestRun = 0;
    let activeRun = 0;
    let prevEpochDay: number | null = null;

    for (const d of togetherDays) {
      const epochDay = Math.round(new Date(`${d.prompt_date}T00:00:00Z`).getTime() / 86_400_000);
      if (prevEpochDay !== null && epochDay - prevEpochDay === 1) {
        activeRun += 1;
      } else {
        activeRun = 1;
      }
      if (activeRun > monthBestRun) {
        monthBestRun = activeRun;
      }
      prevEpochDay = epochDay;
    }

    const longestStreak = Math.max(streak?.longest_count ?? 0, monthBestRun);

    return {
      sharedDaysCount: togetherDays.length,
      activeDaysCount: days.length,
      totalMomentsPosted,
      onTimeRatePct,
      longestStreak,
      highlights: [...togetherDays].reverse(),
    };
  }, [days, streak?.longest_count]);

  // Story deck: Slide 0 = Month Summary Overview, Slides 1..N = TogetherCollageCard highlight reel
  const totalSlides = 1 + recapMetrics.highlights.length;
  const clampedStep = Math.min(stepIndex, Math.max(0, totalSlides - 1));

  const deckScale = useSharedValue(1);
  const deckOpacity = useSharedValue(1);

  useEffect(() => {
    if (visible) {
      if (motionEnabled) {
        deckScale.set(0.94);
        deckOpacity.set(0);
        deckScale.set(withSpring(1, MOCHY_SPRINGS.popIn(motionSpeed)));
        deckOpacity.set(withTiming(1, mochyTiming(260, undefined, motionEnabled, motionSpeed)));
      } else {
        deckScale.set(1);
        deckOpacity.set(1);
      }
    }
  }, [visible, motionEnabled, motionSpeed, deckScale, deckOpacity]);

  const animateSlideChange = (nextIdx: number) => {
    const bounded = Math.max(0, Math.min(totalSlides - 1, nextIdx));
    if (bounded === clampedStep) return;

    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }

    setStepState((prev) => ({ openGen: prev.openGen, idx: bounded }));
    if (motionEnabled) {
      deckScale.set(0.96);
      deckOpacity.set(0.72);
      deckScale.set(withSpring(1, MOCHY_SPRINGS.popIn(motionSpeed)));
      deckOpacity.set(withTiming(1, mochyTiming(220, undefined, motionEnabled, motionSpeed)));
    }
  };

  const deckAnimatedStyle = useAnimatedStyle(() => ({
    opacity: deckOpacity.get(),
    transform: [{ scale: deckScale.get() }],
  }));

  const activeHighlight =
    clampedStep > 0 ? recapMetrics.highlights[clampedStep - 1] ?? null : null;

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent={false}
      onRequestClose={onClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
        <View style={[styles.shell, { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg }]}>
          {/* Story Progress Bars */}
          <View style={styles.progressTrackRow}>
            {Array.from({ length: totalSlides }).map((_, idx) => {
              const filled = idx <= clampedStep;
              return (
                <Pressable
                  key={`recap-seg-${idx}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Jump to recap slide ${idx + 1} of ${totalSlides}`}
                  onPress={() => animateSlideChange(idx)}
                  style={[
                    styles.progressSegmentHit,
                    { paddingVertical: 6 },
                  ]}>
                  <View
                    style={[
                      styles.progressSegmentBar,
                      {
                        backgroundColor: filled ? colors.ink : colors.surfaceElevated,
                        borderRadius: radii.pill,
                      },
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>

          {/* Top Bar: Month Label + Close Button */}
          <View style={styles.topHeader}>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.recapKicker,
                  { color: colors.inkMuted, letterSpacing: type.bodyTracking },
                ]}>
                Monthly Memory Recap · {clampedStep + 1} of {totalSlides}
              </Text>
              <Text
                style={[
                  styles.recapTitle,
                  { color: colors.ink, letterSpacing: type.titleTracking },
                ]}>
                {monthLabel}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close Monthly Recap"
              onPress={() => {
                if (Platform.OS !== 'web') {
                  void Haptics.selectionAsync();
                }
                onClose();
              }}
              style={[
                styles.closeButton,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                  borderRadius: radii.pill,
                },
              ]}>
              <Text style={[styles.closeButtonText, { color: colors.ink }]}>Close</Text>
            </Pressable>
          </View>

          {/* Animated Story Stage */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.scrollStage, { paddingVertical: spacing.md }]}>
            <Animated.View style={[styles.deckContainer, deckAnimatedStyle]}>
              {clampedStep === 0 ? (
                <View
                  style={[
                    styles.overviewCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.group,
                      padding: spacing.xl,
                      gap: spacing.xl,
                    },
                  ]}>
                  <View style={styles.overviewHeroRow}>
                    <DualFrameMark size={52} />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text
                        style={[
                          styles.coupleHeading,
                          { color: colors.ink, letterSpacing: type.titleTracking },
                        ]}>
                        {myName} & {partnerName}
                      </Text>
                      <Text style={[styles.overviewSub, { color: colors.inkMuted }]}>
                        {recapMetrics.sharedDaysCount > 0
                          ? `${recapMetrics.sharedDaysCount} Together ${
                              recapMetrics.sharedDaysCount === 1 ? 'collage' : 'collages'
                            } unlocked in ${monthLabel}.`
                          : `${recapMetrics.activeDaysCount} archived ${
                              recapMetrics.activeDaysCount === 1 ? 'day' : 'days'
                            } recorded in ${monthLabel}.`}
                      </Text>
                    </View>
                  </View>

                  {/* Primary Metric Highlight */}
                  <View
                    style={[
                      styles.primaryMetricCard,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                        borderRadius: radii.card,
                        padding: spacing.xl,
                      },
                    ]}>
                    <Text style={[styles.metricBigNumber, { color: colors.ink }]}>
                      {recapMetrics.sharedDaysCount}
                    </Text>
                    <Text style={[styles.metricLabel, { color: colors.ink }]}>
                      Shared Together Moments
                    </Text>
                    <Text style={[styles.metricDetail, { color: colors.inkMuted }]}>
                      {recapMetrics.totalMomentsPosted} total dual-camera{' '}
                      {recapMetrics.totalMomentsPosted === 1 ? 'post' : 'posts'} across{' '}
                      {recapMetrics.activeDaysCount}{' '}
                      {recapMetrics.activeDaysCount === 1 ? 'day' : 'days'}
                    </Text>
                  </View>

                  {/* Supporting Real Metrics Row */}
                  <View style={[styles.secondaryMetricsRow, { gap: spacing.md }]}>
                    <View
                      style={[
                        styles.secondaryMetricBox,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                          borderRadius: radii.card,
                          padding: spacing.lg,
                        },
                      ]}>
                      <Text style={[styles.secondaryMetricValue, { color: colors.ink }]}>
                        {recapMetrics.longestStreak}d
                      </Text>
                      <Text style={[styles.secondaryMetricLabel, { color: colors.inkMuted }]}>
                        Longest Streak
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.secondaryMetricBox,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                          borderRadius: radii.card,
                          padding: spacing.lg,
                        },
                      ]}>
                      <Text style={[styles.secondaryMetricValue, { color: colors.ink }]}>
                        {recapMetrics.onTimeRatePct}%
                      </Text>
                      <Text style={[styles.secondaryMetricLabel, { color: colors.inkMuted }]}>
                        On-Time Rate
                      </Text>
                    </View>
                  </View>

                  {recapMetrics.highlights.length === 0 ? (
                    <Text style={[styles.soloNote, { color: colors.inkMuted }]}>
                      Post on the same day together to unlock side-by-side Together highlight cards
                      in this reel.
                    </Text>
                  ) : null}
                </View>
              ) : activeHighlight ? (
                <TogetherCollageCard
                  key={`recap-collage-${activeHighlight.prompt_id}`}
                  revealKey={`recap-collage-${activeHighlight.prompt_id}`}
                  promptDate={activeHighlight.prompt_date}
                  myMoment={activeHighlight.mine}
                  partnerMoment={activeHighlight.partner}
                  myName={myName}
                  partnerName={partnerName}
                  streakCount={recapMetrics.longestStreak}
                />
              ) : null}
            </Animated.View>
          </ScrollView>

          {/* Bottom Stepped Deck Controls */}
          <View style={[styles.footerControls, { gap: spacing.md }]}>
            <KeepItButton
              label="Previous"
              variant="secondary"
              disabled={clampedStep === 0}
              onPress={() => animateSlideChange(clampedStep - 1)}
              style={{ flex: 1 }}
            />
            {clampedStep < totalSlides - 1 ? (
              <KeepItButton
                label={clampedStep === 0 ? 'View Highlights' : 'Next Memory'}
                variant="primary"
                onPress={() => animateSlideChange(clampedStep + 1)}
                style={{ flex: 1.4 }}
              />
            ) : (
              <KeepItButton
                label="Finish Recap"
                variant="primary"
                onPress={onClose}
                style={{ flex: 1.4 }}
              />
            )}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  shell: {
    flex: 1,
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  progressTrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressSegmentHit: {
    flex: 1,
  },
  progressSegmentBar: {
    height: 4,
    width: '100%',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  recapKicker: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  recapTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  closeButton: {
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 9,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  closeButtonText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  scrollStage: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  deckContainer: {
    width: '100%',
  },
  overviewCard: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  overviewHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  coupleHeading: {
    fontSize: 21,
    fontWeight: '700',
  },
  overviewSub: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  primaryMetricCard: {
    borderWidth: 1,
    gap: 4,
    borderCurve: 'continuous',
  },
  metricBigNumber: {
    fontSize: 44,
    fontWeight: '700',
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  metricDetail: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    marginTop: 2,
  },
  secondaryMetricsRow: {
    flexDirection: 'row',
  },
  secondaryMetricBox: {
    flex: 1,
    borderWidth: 1,
    gap: 4,
    borderCurve: 'continuous',
  },
  secondaryMetricValue: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  secondaryMetricLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  soloNote: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  footerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
  },
});
