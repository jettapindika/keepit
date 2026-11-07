import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { KeepItButton, RevealOnAppear } from '@/components/ui/Primitives';
import { AppPressable } from '@/components/ui/ScreenKit';
import { useKeepItTheme } from '@/theme/tokens';
import { MomentRecord, PartnerMomentView, StreakDayNode, StreakRecord } from '@/types/database';
import {
  getCurrentAndNextChapter,
  MAX_GRACE_SHIELDS,
  STREAK_MILESTONES,
} from '@/utils/streakEngine';

export interface SharedPulseCardProps {
  streak: StreakRecord | null | undefined;
  myMoment: MomentRecord | null;
  partnerMoment: PartnerMomentView | null;
  myName: string;
  partnerName: string;
  isPartnerPaired: boolean;
  nudging?: boolean;
  onCaptureMine?: () => void;
  onNudgePartner?: () => void;
  onOpenMemories?: () => void;
  onPressPair?: () => void;
}

export function SharedPulseCard({
  streak,
  myMoment,
  partnerMoment,
  myName,
  partnerName,
  isPartnerPaired,
  nudging = false,
  onCaptureMine,
  onNudgePartner,
  onOpenMemories,
  onPressPair,
}: SharedPulseCardProps) {
  const { colors, radii, type } = useKeepItTheme();
  const [expanded, setExpanded] = useState(false);

  const currentCount = streak?.current_count ?? 0;
  const longestCount = Math.max(streak?.longest_count ?? 0, currentCount);
  const graceShields = streak?.grace_shields ?? (currentCount >= 3 ? 1 : 0);
  const goldenSyncCount = streak?.golden_sync_count ?? 0;

  const myPosted = Boolean(myMoment);
  const partnerPosted = Boolean(partnerMoment);
  const bothPosted = myPosted && partnerPosted;
  const myOnTime = Boolean(myMoment && !myMoment.is_late);
  const partnerOnTime = Boolean(partnerMoment && !partnerMoment.is_late);
  const goldenToday = bothPosted && myOnTime && partnerOnTime;

  const { current: currentChapter, next: nextChapter, progressRatio, daysRemaining } =
    getCurrentAndNextChapter(currentCount);

  const statusHeadline = !isPartnerPaired
    ? 'Solo archive'
    : bothPosted
      ? goldenToday
        ? `${currentCount}d · Golden Sync`
        : `${currentCount}d in sync`
      : myPosted
        ? `${currentCount}d · Waiting on ${partnerName}`
        : partnerPosted
          ? `${partnerName} posted · Unlock ${currentCount + 1}d`
          : currentCount > 0
            ? `${currentCount}d pulse`
            : 'Start Day 1';

  const statusSubline = !isPartnerPaired
    ? 'Pair to unlock dual rings & shields'
    : nextChapter
      ? `${currentChapter ? `${currentChapter.title} · ` : ''}${daysRemaining}d to ${nextChapter.title} · ${graceShields}/${MAX_GRACE_SHIELDS} Shields`
      : `All chapters unlocked · ${graceShields}/${MAX_GRACE_SHIELDS} Shields`;

  const recentChain: StreakDayNode[] = streak?.recent_chain ?? [];

  return (
    <RevealOnAppear revealKey={`shared-pulse-${currentCount}-${myPosted}-${partnerPosted}`}>
      <View
        style={[
          styles.compactCard,
          {
            backgroundColor: colors.surface,
            borderRadius: radii.card,
            borderColor: goldenToday ? colors.success : colors.border,
          },
        ]}>
        {/* Single Compact Strip (Tap to toggle 7-day chain & details) */}
        <AppPressable
          accessibilityRole="button"
          accessibilityLabel={`${statusHeadline}. ${statusSubline}. ${expanded ? 'Collapse' : 'Expand'} 7-day pulse details`}
          accessibilityState={{ expanded }}
          onPress={() => {
            if (Platform.OS !== 'web') void Haptics.selectionAsync();
            setExpanded((prev) => !prev);
          }}
          style={styles.stripRow}>
          {/* Compact 42px Interlocking Rings */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.dualRingCompact}>
            <View
              style={[
                styles.ringSmall,
                {
                  backgroundColor: colors.canvas,
                  borderColor: myPosted ? (myOnTime ? colors.success : colors.ink) : colors.controlBorder,
                  borderStyle: myPosted ? 'solid' : 'dashed',
                },
              ]}>
              <Text style={[styles.ringSmallText, { color: myPosted ? colors.ink : colors.inkMuted }]}>
                {myName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View
              style={[
                styles.ringSmall,
                styles.ringSmallPartner,
                {
                  backgroundColor: colors.canvas,
                  borderColor: partnerPosted
                    ? partnerOnTime
                      ? colors.success
                      : colors.ink
                    : colors.controlBorder,
                  borderStyle: partnerPosted ? 'solid' : 'dashed',
                },
              ]}>
              <Text
                style={[
                  styles.ringSmallText,
                  { color: partnerPosted ? colors.ink : colors.inkMuted },
                ]}>
                {isPartnerPaired ? partnerName.slice(0, 1).toUpperCase() : '+'}
              </Text>
            </View>
          </View>

          {/* Headline + Subline + Slim Progress Bar */}
          <View style={styles.stripCopy}>
            <View style={styles.stripTitleRow}>
              <Text
                numberOfLines={1}
                style={[styles.stripHeadline, { color: colors.ink, fontFamily: type.fontSans }]}>
                {statusHeadline}
              </Text>
              <Text
                style={[
                  styles.expandCue,
                  { color: colors.inkMuted, fontFamily: type.fontMono },
                ]}>
                {expanded ? 'Hide' : '7d ▾'}
              </Text>
            </View>
            <Text numberOfLines={1} style={[styles.stripSub, { color: colors.inkMuted }]}>
              {statusSubline}
            </Text>
            {nextChapter ? (
              <View style={[styles.slimProgressTrack, { backgroundColor: colors.canvas }]}>
                <View
                  style={[
                    styles.slimProgressFill,
                    {
                      backgroundColor: goldenToday ? colors.success : colors.ink,
                      width: `${Math.max(8, Math.round(progressRatio * 100))}%`,
                    },
                  ]}
                />
              </View>
            ) : null}
          </View>
        </AppPressable>

        {/* Expandable 7-Day Chain + Contextual Action */}
        {expanded ? (
          <View style={[styles.expandedDrawer, { borderTopColor: colors.border }]}>
            {recentChain.length > 0 ? (
              <View style={styles.chainSection}>
                <View style={styles.chainHeader}>
                  <Text style={[styles.chainTitle, { color: colors.inkMuted }]}>Last 7 days</Text>
                  <Text
                    style={[
                      styles.chainMeta,
                      { color: goldenSyncCount > 0 ? colors.success : colors.inkMuted },
                    ]}>
                    {goldenSyncCount} Golden {goldenSyncCount === 1 ? 'Sync' : 'Syncs'} · Best {longestCount}d
                  </Text>
                </View>
                <View style={styles.chainRow}>
                  {recentChain.map((node, index) => {
                    const isToday = index === recentChain.length - 1;
                    const isFilled = node.state === 'golden' || node.state === 'synced';
                    const isShield = node.state === 'shield';
                    const isHalf = node.state === 'half';

                    const bgColor =
                      node.state === 'golden'
                        ? colors.success
                        : node.state === 'synced'
                          ? colors.ink
                          : colors.canvas;

                    const fgColor = isFilled ? colors.canvas : colors.ink;
                    const borderColor =
                      node.state === 'golden'
                        ? colors.success
                        : isShield || isFilled || isHalf || isToday
                          ? colors.ink
                          : colors.border;

                    const statusTag =
                      node.state === 'golden' || node.state === 'synced'
                        ? '2/2'
                        : isShield
                          ? 'SHD'
                          : isHalf
                            ? '1/2'
                            : isToday
                              ? '0/2'
                              : '–';

                    return (
                      <View
                        key={node.date}
                        accessibilityLabel={`${node.date}: ${node.state}`}
                        style={[
                          styles.chainNode,
                          {
                            backgroundColor: bgColor,
                            borderColor,
                            borderStyle: isHalf ? 'dashed' : 'solid',
                            borderRadius: radii.input,
                          },
                        ]}>
                        <Text style={[styles.chainDayLabel, { color: fgColor }]}>{node.dayLabel}</Text>
                        <Text
                          style={[
                            styles.chainStateLabel,
                            {
                              color: isFilled ? colors.canvas : colors.inkMuted,
                              fontFamily: type.fontMono,
                            },
                          ]}>
                          {statusTag}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {!isPartnerPaired && onPressPair ? (
              <KeepItButton label="Pair with Partner" variant="secondary" onPress={onPressPair} />
            ) : !myPosted && onCaptureMine ? (
              <KeepItButton
                label={
                  partnerPosted
                    ? `Post Yours to Unlock Day ${currentCount + 1}`
                    : `Capture Today’s Moment`
                }
                onPress={onCaptureMine}
              />
            ) : myPosted && !partnerPosted && isPartnerPaired && onNudgePartner ? (
              <KeepItButton
                label={`Nudge ${partnerName} for Day ${currentCount + 1}`}
                loading={nudging}
                loadingLabel="Sending nudge…"
                variant="secondary"
                onPress={onNudgePartner}
              />
            ) : bothPosted && onOpenMemories ? (
              <KeepItButton
                label="Open Couple Archive"
                variant="secondary"
                onPress={onOpenMemories}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </RevealOnAppear>
  );
}

export interface StreakMilestoneShelfProps {
  streak: StreakRecord | null | undefined;
}

export function StreakMilestoneShelf({ streak }: StreakMilestoneShelfProps) {
  const { colors, radii, type } = useKeepItTheme();
  const currentCount = streak?.current_count ?? 0;
  const longestCount = Math.max(streak?.longest_count ?? 0, currentCount);
  const graceShields = streak?.grace_shields ?? (currentCount >= 3 ? 1 : 0);
  const goldenSyncCount = streak?.golden_sync_count ?? 0;
  const unlockedSet = new Set<number>(streak?.unlocked_milestones ?? []);
  for (const m of STREAK_MILESTONES) {
    if (longestCount >= m.days) unlockedSet.add(m.days);
  }

  const { next: nextChapter } = getCurrentAndNextChapter(currentCount);

  return (
    <View style={[styles.shelfCard, { backgroundColor: colors.surface, borderRadius: radii.card }]}>
      {/* Single 4-Stat Compact Bar */}
      <View style={styles.compactStatsRow}>
        <View style={styles.statCell}>
          <Text style={[styles.statNum, { color: colors.ink, fontFamily: type.fontSans }]}>
            {currentCount}d
          </Text>
          <Text style={[styles.statCaption, { color: colors.inkMuted }]}>Pulse</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statCell}>
          <Text style={[styles.statNum, { color: colors.ink, fontFamily: type.fontSans }]}>
            {longestCount}d
          </Text>
          <Text style={[styles.statCaption, { color: colors.inkMuted }]}>Best</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statCell}>
          <Text style={[styles.statNum, { color: colors.success, fontFamily: type.fontSans }]}>
            {goldenSyncCount}
          </Text>
          <Text style={[styles.statCaption, { color: colors.inkMuted }]}>On-Time</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statCell}>
          <Text style={[styles.statNum, { color: colors.ink, fontFamily: type.fontSans }]}>
            {graceShields}/{MAX_GRACE_SHIELDS}
          </Text>
          <Text style={[styles.statCaption, { color: colors.inkMuted }]}>Shields</Text>
        </View>
      </View>

      {/* Single Horizontal Scrollable Milestone Pill Strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chapterStrip}>
        {STREAK_MILESTONES.map((chapter) => {
          const unlocked = unlockedSet.has(chapter.days);
          const isNext = nextChapter?.days === chapter.days;
          const remaining = Math.max(0, chapter.days - currentCount);

          return (
            <View
              key={chapter.days}
              style={[
                styles.chapterChip,
                {
                  backgroundColor: unlocked ? colors.ink : colors.canvas,
                  borderColor: unlocked
                    ? colors.ink
                    : isNext
                      ? colors.controlBorder
                      : colors.border,
                  borderStyle: !unlocked && isNext ? 'dashed' : 'solid',
                  borderRadius: radii.input,
                },
              ]}>
              <Text
                style={[
                  styles.chipDays,
                  { color: unlocked ? colors.canvas : colors.ink, fontFamily: type.fontMono },
                ]}>
                {chapter.days}d · {chapter.title}
              </Text>
              <Text
                style={[
                  styles.chipMeta,
                  { color: unlocked ? colors.canvas : colors.inkMuted },
                ]}>
                {unlocked ? `#${chapter.stampCode}` : isNext ? `${remaining}d left` : 'Locked'}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  compactCard: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    gap: 10,
  },
  stripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
  },
  dualRingCompact: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ringSmall: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringSmallPartner: {
    marginLeft: -10,
  },
  ringSmallText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  stripCopy: {
    flex: 1,
    minWidth: 140,
    gap: 3,
  },
  stripTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  stripHeadline: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    flexShrink: 1,
  },
  expandCue: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  stripSub: {
    fontSize: 12,
    lineHeight: 16,
  },
  slimProgressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 2,
  },
  slimProgressFill: {
    height: '100%',
    borderRadius: 2,
  },
  expandedDrawer: {
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 10,
  },
  chainSection: {
    gap: 6,
  },
  chainHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  chainTitle: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  chainMeta: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  chainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 5,
  },
  chainNode: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    gap: 1,
  },
  chainDayLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  chainStateLabel: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '600',
  },
  shelfCard: {
    padding: 14,
    gap: 12,
  },
  compactStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statNum: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '600',
  },
  statCaption: {
    fontSize: 11,
    lineHeight: 14,
  },
  statDivider: {
    width: 1,
    height: 28,
  },
  chapterStrip: {
    gap: 8,
    paddingRight: 4,
  },
  chapterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    gap: 2,
  },
  chipDays: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  chipMeta: {
    fontSize: 11,
    lineHeight: 14,
  },
});
