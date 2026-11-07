import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { formatStatusRemaining } from '@/api/statuses';
import { useSessionStore } from '@/store/sessionStore';
import { MOCHY_SPRINGS } from '@/theme/motion';
import { useKeepItTheme } from '@/theme/tokens';
import { CoupleEventRecord, StatusRecord } from '@/types/database';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface StatusHeaderCardProps {
  partnerName: string;
  partnerStatus: StatusRecord | null;
  myStatus: StatusRecord | null;
  isPartnerPaired?: boolean;
  latestNudge?: CoupleEventRecord | null;
  currentUserId?: string;
  nudging?: boolean;
  nudgeFeedback?: string | null;
  onSendNudge?: () => void;
  onPressPair?: () => void;
  onOpenStatusSheet: () => void;
}

export function StatusHeaderCard({
  partnerName,
  partnerStatus,
  myStatus,
  isPartnerPaired = true,
  latestNudge,
  currentUserId,
  nudging = false,
  nudgeFeedback = null,
  onSendNudge,
  onPressPair,
  onOpenStatusSheet,
}: StatusHeaderCardProps) {
  const { colors, radii, spacing } = useKeepItTheme();
  const motionEnabled = useSessionStore((s) => s.motionEnabled);
  const motionSpeed = useSessionStore((s) => s.motionSpeed);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const nudgeScale = useSharedValue(1);
  const myRowScale = useSharedValue(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const nudgeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: nudgeScale.get() }],
  }));

  const myRowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: myRowScale.get() }],
  }));

  const partnerActive =
    partnerStatus && new Date(partnerStatus.expires_at).getTime() > nowMs
      ? partnerStatus
      : null;

  const myActive =
    myStatus && new Date(myStatus.expires_at).getTime() > nowMs ? myStatus : null;
  const incomingNudge =
    latestNudge && latestNudge.actor_id !== currentUserId ? latestNudge : null;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radii.group,
          padding: spacing.lg,
          gap: spacing.md,
        },
      ]}>
      {/* Partner Status + Nudge Row */}
      <View style={styles.partnerRow}>
        <View
          style={[
            styles.liveDot,
            {
              backgroundColor: partnerActive ? colors.success : colors.border,
            },
          ]}
        />
        <View style={styles.flex}>
          {!isPartnerPaired ? (
            <>
              <Text style={[styles.partnerPrimary, { color: colors.ink }]}>
                No partner paired yet
              </Text>
              <Text style={[styles.partnerMeta, { color: colors.inkMuted }]}>
                Connect with an invite code to share status & nudges
              </Text>
            </>
          ) : partnerActive ? (
            <>
              <Text style={[styles.partnerPrimary, { color: colors.ink }]}>
                {partnerName}: {partnerActive.emoji} {partnerActive.text}
              </Text>
              <Text style={[styles.partnerMeta, { color: colors.inkMuted }]}>
                Expires in {formatStatusRemaining(partnerActive.expires_at).replace(' left', '')}
              </Text>
            </>
          ) : (
            <Text style={[styles.partnerPrimary, { color: colors.ink }]}>
              {partnerName} has no active status
            </Text>
          )}
        </View>

        {isPartnerPaired && onSendNudge ? (
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={`Nudge ${partnerName}`}
            disabled={nudging}
            onPressIn={() => {
              if (!motionEnabled) return;
              nudgeScale.set(withSpring(0.88, MOCHY_SPRINGS.pressIn(motionSpeed)));
            }}
            onPressOut={() => {
              if (!motionEnabled) return;
              nudgeScale.set(withSpring(1, MOCHY_SPRINGS.popIn(motionSpeed)));
            }}
            onPress={() => {
              if (Platform.OS !== 'web') {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }
              onSendNudge();
            }}
            style={[
              styles.nudgePill,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                borderRadius: radii.pill,
                opacity: nudging ? 0.5 : 1,
              },
              nudgeStyle,
            ]}>
            <Text pointerEvents="none" style={[styles.nudgeText, { color: colors.ink }]}>
              {nudging ? 'Sending...' : 'Nudge'}
            </Text>
          </AnimatedPressable>
        ) : !isPartnerPaired && onPressPair ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pair Partner"
            onPress={onPressPair}
            style={[
              styles.nudgePill,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                borderRadius: radii.pill,
              },
            ]}>
            <Text style={[styles.nudgeText, { color: colors.ink }]}>Pair</Text>
          </Pressable>
        ) : null}
      </View>

      {incomingNudge ? (
        <View
          style={[
            styles.nudgeAlertStrip,
            {
              backgroundColor: colors.accentSoft,
              borderRadius: radii.input,
            },
          ]}>
          <Text style={[styles.nudgeAlertText, { color: colors.ink }]}>
            {partnerName} nudged you: “{incomingNudge.payload?.note ?? 'Thinking of you'}”
          </Text>
        </View>
      ) : null}

      {nudgeFeedback ? (
        <Text style={[styles.feedbackText, { color: colors.inkMuted }]}>{nudgeFeedback}</Text>
      ) : null}

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* Your Status Action Row */}
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={
          myActive
            ? `Your status: ${myActive.emoji} ${myActive.text}. Tap to update`
            : 'Set your status'
        }
        onPressIn={() => {
          if (!motionEnabled) return;
          myRowScale.set(withSpring(0.985, MOCHY_SPRINGS.pressIn(motionSpeed)));
        }}
        onPressOut={() => {
          if (!motionEnabled) return;
          myRowScale.set(withSpring(1, MOCHY_SPRINGS.pressRelease(motionSpeed)));
        }}
        onPress={onOpenStatusSheet}
        style={[
          styles.myRow,
          {
            backgroundColor: colors.surfaceElevated,
            borderColor: myActive ? colors.inkMuted : colors.border,
            borderRadius: radii.card,
          },
          myRowStyle,
        ]}>
        <View pointerEvents="none" style={styles.flex}>
          <Text style={[styles.myTitle, { color: colors.ink }]}>
            {myActive
              ? `You: ${myActive.emoji} ${myActive.text}`
              : 'Share what you’re up to'}
          </Text>
          {myActive ? (
            <Text style={[styles.myMeta, { color: colors.inkMuted }]}>
              {formatStatusRemaining(myActive.expires_at)}
            </Text>
          ) : null}
        </View>

        <View
          pointerEvents="none"
          style={[
            styles.actionChip,
            {
              backgroundColor: myActive ? colors.accentSoft : colors.accent,
              borderRadius: radii.pill,
            },
          ]}>
          <Text
            style={[
              styles.actionChipText,
              { color: myActive ? colors.ink : colors.onAccent },
            ]}>
            {myActive ? 'Edit' : 'Set Status'}
          </Text>
        </View>
      </AnimatedPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  flex: {
    flex: 1,
  },
  partnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  partnerPrimary: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  partnerMeta: {
    fontSize: 12,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  nudgePill: {
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderCurve: 'continuous',
  },
  nudgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  nudgeAlertStrip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderCurve: 'continuous',
  },
  nudgeAlertText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  feedbackText: {
    fontSize: 12,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    width: '100%',
  },
  myRow: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderCurve: 'continuous',
  },
  myTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  myMeta: {
    fontSize: 12,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  actionChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    minHeight: 38,
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  actionChipText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
