import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { formatStatusRemaining } from '@/api/statuses';
import { AppPressable } from '@/components/ui/ScreenKit';
import { useKeepItTheme } from '@/theme/tokens';
import { CoupleEventRecord, StatusRecord } from '@/types/database';

interface StatusHeaderCardProps {
  partnerName: string;
  partnerStatus: StatusRecord | null;
  myStatus: StatusRecord | null;
  isPartnerPaired?: boolean;
  latestNudge?: CoupleEventRecord | null;
  currentUserId?: string;
  nudging?: boolean;
  nudgeFeedback?: string | null;
  loading?: boolean;
  statusError?: string | null;
  nudgeError?: string | null;
  onRetryStatus?: () => void;
  onRetryNudges?: () => void;
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
  nudgeFeedback,
  loading = false,
  statusError,
  nudgeError,
  onRetryStatus,
  onRetryNudges,
  onSendNudge,
  onPressPair,
  onOpenStatusSheet,
}: StatusHeaderCardProps) {
  const { colors, radii } = useKeepItTheme();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const partnerActive =
    partnerStatus && new Date(partnerStatus.expires_at).getTime() > now ? partnerStatus : null;
  const mine = myStatus && new Date(myStatus.expires_at).getTime() > now ? myStatus : null;
  const incomingNudge =
    latestNudge && latestNudge.actor_id !== currentUserId ? latestNudge : null;

  const myStatusLabel = loading
    ? 'Loading status…'
    : mine
      ? `${mine.emoji} ${mine.text}`
      : 'Set status…';

  const partnerSummary = isPartnerPaired
    ? partnerActive
      ? `${partnerName}: ${partnerActive.emoji} ${partnerActive.text}`
      : nudgeFeedback
        ? nudgeFeedback
        : incomingNudge
          ? `${partnerName} nudged you`
          : `${partnerName} · Nudge`
    : 'Pair partner';

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radii.card,
        },
      ]}>
      <AppPressable
        accessibilityRole="button"
        accessibilityLabel={
          mine
            ? `Edit your status: ${mine.emoji} ${mine.text} (${formatStatusRemaining(mine.expires_at)})`
            : 'Set your status'
        }
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          onOpenStatusSheet();
        }}
        style={styles.myStatusZone}>
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor: mine ? colors.success : colors.inkMuted,
            },
          ]}
        />
        <View style={styles.textColumn}>
          <Text
            numberOfLines={1}
            style={[
              styles.primaryText,
              { color: mine ? colors.ink : colors.inkMuted },
            ]}>
            {myStatusLabel}
          </Text>
          {mine ? (
            <Text
              numberOfLines={1}
              style={[styles.subText, { color: colors.inkMuted }]}>
              You · {formatStatusRemaining(mine.expires_at)}
            </Text>
          ) : null}
        </View>
      </AppPressable>

      {statusError && onRetryStatus ? (
        <AppPressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading statuses"
          onPress={onRetryStatus}
          style={[
            styles.secondaryChip,
            {
              backgroundColor: colors.dangerSoft,
              borderColor: colors.danger,
              borderRadius: radii.pill,
            },
          ]}>
          <Text numberOfLines={1} style={[styles.chipText, { color: colors.danger }]}>
            Retry
          </Text>
        </AppPressable>
      ) : nudgeError && onRetryNudges ? (
        <AppPressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading nudges"
          onPress={onRetryNudges}
          style={[
            styles.secondaryChip,
            {
              backgroundColor: colors.dangerSoft,
              borderColor: colors.danger,
              borderRadius: radii.pill,
            },
          ]}>
          <Text numberOfLines={1} style={[styles.chipText, { color: colors.danger }]}>
            Retry
          </Text>
        </AppPressable>
      ) : isPartnerPaired ? (
        <AppPressable
          accessibilityRole="button"
          accessibilityLabel={
            partnerActive
              ? `${partnerName}'s status: ${partnerActive.emoji} ${partnerActive.text}. Tap to nudge ${partnerName}`
              : `Nudge ${partnerName}`
          }
          accessibilityState={{ busy: nudging, disabled: nudging || !onSendNudge }}
          disabled={nudging || !onSendNudge}
          onPress={() => {
            if (!onSendNudge) return;
            if (Platform.OS !== 'web') void Haptics.selectionAsync();
            onSendNudge();
          }}
          style={[
            styles.secondaryChip,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: partnerActive ? colors.controlBorder : colors.border,
              borderRadius: radii.pill,
            },
          ]}>
          <Text
            numberOfLines={1}
            style={[
              styles.chipText,
              { color: partnerActive ? colors.ink : colors.inkMuted },
            ]}>
            {nudging ? 'Nudging…' : partnerSummary}
          </Text>
        </AppPressable>
      ) : onPressPair ? (
        <AppPressable
          accessibilityRole="button"
          accessibilityLabel="Pair with partner"
          onPress={onPressPair}
          style={[
            styles.secondaryChip,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.border,
              borderRadius: radii.pill,
            },
          ]}>
          <Text numberOfLines={1} style={[styles.chipText, { color: colors.ink }]}>
            + Partner
          </Text>
        </AppPressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 56,
    minHeight: 56,
    maxHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  myStatusZone: {
    flex: 1,
    minWidth: 96,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  textColumn: {
    flex: 1,
    justifyContent: 'center',
  },
  primaryText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  subText: {
    fontSize: 11,
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
  },
  secondaryChip: {
    maxWidth: 200,
    minHeight: 44,
    paddingHorizontal: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  chipText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
