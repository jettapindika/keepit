import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { formatLateDuration } from '@/api/moments';
import { RevealOnAppear } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { MOCHY_SPRINGS } from '@/theme/motion';
import { useKeepItTheme } from '@/theme/tokens';
import { MomentRecord } from '@/types/database';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface TogetherCollageCardProps {
  promptDate: string;
  myMoment: MomentRecord;
  partnerMoment: MomentRecord;
  myName: string;
  partnerName: string;
  streakCount?: number;
  revealKey?: string;
}

interface CollageHalfPaneProps {
  moment: MomentRecord;
  authorName: string;
  side: 'left' | 'right';
}

function CollageHalfPane({ moment, authorName, side }: CollageHalfPaneProps) {
  const { colors, radii } = useKeepItTheme();
  const motionEnabled = useSessionStore((s) => s.motionEnabled);
  const motionSpeed = useSessionStore((s) => s.motionSpeed);
  const [swapped, setSwapped] = useState(false);

  const paneScale = useSharedValue(1);
  const pipScale = useSharedValue(1);

  const paneAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: paneScale.get() }],
  }));

  const pipAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pipScale.get() }],
  }));

  const backUri = moment.back_photo_url ?? moment.back_photo_path;
  const frontUri = moment.front_photo_url ?? moment.front_photo_path;
  const mainSource = swapped ? frontUri : backUri;
  const pipSource = swapped ? backUri : frontUri;

  const postedTime = new Date(moment.posted_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleSwap = () => {
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
    if (motionEnabled) {
      pipScale.set(0.88);
      pipScale.set(withSpring(1, MOCHY_SPRINGS.popIn(motionSpeed)));
    }
    setSwapped((prev) => !prev);
  };

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`Swap ${authorName} front and back lens in Together collage`}
      onPressIn={() => {
        if (!motionEnabled) return;
        paneScale.set(withSpring(0.985, MOCHY_SPRINGS.pressIn(motionSpeed)));
      }}
      onPressOut={() => {
        if (!motionEnabled) {
          paneScale.set(1);
          return;
        }
        paneScale.set(withSpring(1, MOCHY_SPRINGS.pressRelease(motionSpeed)));
      }}
      onPress={handleSwap}
      style={[styles.halfPane, paneAnimatedStyle]}>
      <Image
        source={{ uri: mainSource }}
        placeholder={{ blurhash: moment.back_blurhash }}
        contentFit="cover"
        transition={180}
        style={styles.fullFill}
      />

      {/* Top author & timing tag */}
      <View
        style={[
          styles.paneAuthorTag,
          side === 'left' ? styles.anchorTopLeft : styles.anchorTopRight,
          {
            backgroundColor: colors.chromeGlass,
            borderColor: colors.chromeOutline,
            borderRadius: radii.pill,
          },
        ]}>
        <Text numberOfLines={1} style={[styles.paneAuthorText, { color: colors.ink }]}>
          {authorName}
        </Text>
        <Text style={[styles.paneTimeText, { color: colors.inkMuted }]}>
          · {postedTime}
        </Text>
      </View>

      {/* Late status tag when applicable */}
      {moment.is_late ? (
        <View
          style={[
            styles.lateChip,
            side === 'left' ? styles.anchorBottomRight : styles.anchorBottomLeft,
            {
              backgroundColor: colors.canvas,
              borderColor: colors.warning,
              borderRadius: radii.pill,
            },
          ]}>
          <Text style={[styles.lateChipText, { color: colors.warning }]}>
            {formatLateDuration(moment.late_by_seconds)}
          </Text>
        </View>
      ) : null}

      {/* Mini Selfie PIP anchored to outer bottom corner */}
      <Animated.View
        style={[
          styles.miniPipAnchor,
          side === 'left' ? styles.anchorBottomLeft : styles.anchorBottomRight,
          pipAnimatedStyle,
        ]}>
        <View
          style={[
            styles.miniPipFrame,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.canvas,
            },
          ]}>
          <Image source={{ uri: pipSource }} contentFit="cover" style={styles.fullFill} />
        </View>
      </Animated.View>
    </AnimatedPressable>
  );
}

export function TogetherCollageCard({
  promptDate,
  myMoment,
  partnerMoment,
  myName,
  partnerName,
  streakCount,
  revealKey,
}: TogetherCollageCardProps) {
  const { colors, radii, spacing, type } = useKeepItTheme();

  const parsedDate = new Date(`${promptDate}T12:00:00Z`);
  const formattedDate = Number.isNaN(parsedDate.getTime())
    ? promptDate
    : parsedDate.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

  const bothOnTime = !myMoment.is_late && !partnerMoment.is_late;

  return (
    <RevealOnAppear revealKey={revealKey ?? `together:${promptDate}`}>
      <View
        style={[
          styles.outerCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.group,
            padding: spacing.lg,
            gap: spacing.md,
          },
        ]}>
        {/* Top Metadata Stamp: Date + Shared Streak Tag */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text
              style={[
                styles.togetherKicker,
                { color: colors.inkMuted, letterSpacing: type.bodyTracking },
              ]}>
              Together · {bothOnTime ? 'On time' : 'Captured'}
            </Text>
            <Text
              style={[
                styles.dateTitle,
                { color: colors.ink, letterSpacing: type.titleTracking },
              ]}>
              {formattedDate}
            </Text>
          </View>

          {typeof streakCount === 'number' && streakCount > 0 ? (
            <View
              style={[
                styles.streakTag,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                  borderRadius: radii.pill,
                },
              ]}>
              <View style={[styles.streakDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.streakTagText, { color: colors.ink }]}>
                {streakCount}d streak
              </Text>
            </View>
          ) : null}
        </View>

        {/* Side-by-Side Split Daily Collage: Left = Partner, Right = You */}
        <View
          style={[
            styles.splitStage,
            {
              backgroundColor: colors.canvas,
              borderColor: colors.border,
              borderRadius: radii.photo,
            },
          ]}>
          <CollageHalfPane
            moment={partnerMoment}
            authorName={partnerName}
            side="left"
          />
          <View style={[styles.centerSeam, { backgroundColor: colors.canvas }]} />
          <CollageHalfPane moment={myMoment} authorName={myName} side="right" />
        </View>

        {/* Dual Captions Underneath */}
        <View style={[styles.captionsGrid, { gap: spacing.sm }]}>
          <View
            style={[
              styles.captionTile,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                borderRadius: radii.input,
                padding: spacing.md,
              },
            ]}>
            <Text numberOfLines={1} style={[styles.captionAuthor, { color: colors.ink }]}>
              {partnerName}
            </Text>
            <Text
              numberOfLines={2}
              style={[
                styles.captionCopy,
                { color: partnerMoment.caption ? colors.ink : colors.inkMuted },
              ]}>
              {partnerMoment.caption ? `“${partnerMoment.caption}”` : 'No note left.'}
            </Text>
          </View>

          <View
            style={[
              styles.captionTile,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                borderRadius: radii.input,
                padding: spacing.md,
              },
            ]}>
            <Text numberOfLines={1} style={[styles.captionAuthor, { color: colors.ink }]}>
              {myName}
            </Text>
            <Text
              numberOfLines={2}
              style={[
                styles.captionCopy,
                { color: myMoment.caption ? colors.ink : colors.inkMuted },
              ]}>
              {myMoment.caption ? `“${myMoment.caption}”` : 'No note left.'}
            </Text>
          </View>
        </View>
      </View>
    </RevealOnAppear>
  );
}

const styles = StyleSheet.create({
  outerCard: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerLeft: {
    flex: 1,
    gap: 2,
  },
  togetherKicker: {
    fontSize: 12,
    fontWeight: '600',
  },
  dateTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  streakTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderCurve: 'continuous',
  },
  streakDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  streakTagText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.25,
  },
  splitStage: {
    flexDirection: 'row',
    width: '100%',
    aspectRatio: 1.06,
    overflow: 'hidden',
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  halfPane: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  centerSeam: {
    width: 2,
    height: '100%',
  },
  fullFill: {
    width: '100%',
    height: '100%',
  },
  paneAuthorTag: {
    position: 'absolute',
    top: 10,
    maxWidth: '86%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderCurve: 'continuous',
  },
  anchorTopLeft: {
    left: 10,
  },
  anchorTopRight: {
    right: 10,
  },
  paneAuthorText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  paneTimeText: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  miniPipAnchor: {
    position: 'absolute',
    bottom: 10,
  },
  anchorBottomLeft: {
    left: 10,
  },
  anchorBottomRight: {
    right: 10,
  },
  miniPipFrame: {
    width: 56,
    height: 74,
    borderRadius: 13,
    borderWidth: 2,
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  lateChip: {
    position: 'absolute',
    bottom: 10,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderCurve: 'continuous',
  },
  lateChipText: {
    fontSize: 10,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  captionsGrid: {
    flexDirection: 'row',
  },
  captionTile: {
    flex: 1,
    borderWidth: 1,
    gap: 4,
    borderCurve: 'continuous',
  },
  captionAuthor: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  captionCopy: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
});
