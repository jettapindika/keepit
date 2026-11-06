import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatStatusRemaining } from '@/api/statuses';
import { useKeepItTheme } from '@/theme/tokens';
import { StatusRecord } from '@/types/database';

interface StatusHeaderCardProps {
  partnerName: string;
  partnerStatus: StatusRecord | null;
  myStatus: StatusRecord | null;
  onOpenStatusSheet: () => void;
}

export function StatusHeaderCard({
  partnerName,
  partnerStatus,
  myStatus,
  onOpenStatusSheet,
}: StatusHeaderCardProps) {
  const { colors, radii, spacing } = useKeepItTheme();
  const [, setTick] = useState(0);

  // Re-evaluate remaining minutes every 30s so expired statuses disappear in place
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const partnerActive =
    partnerStatus && new Date(partnerStatus.expires_at).getTime() > Date.now()
      ? partnerStatus
      : null;

  const myActive =
    myStatus && new Date(myStatus.expires_at).getTime() > Date.now() ? myStatus : null;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radii.card,
          padding: spacing.lg,
          gap: spacing.md,
        },
      ]}>
      {/* Partner Status Row */}
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
          {partnerActive ? (
            <>
              <Text style={[styles.partnerPrimary, { color: colors.ink }]}>
                {partnerName}: {partnerActive.emoji} {partnerActive.text}
              </Text>
              <Text style={[styles.partnerMeta, { color: colors.inkMuted }]}>
                Expires in {formatStatusRemaining(partnerActive.expires_at).replace(' left', '')}
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.partnerPrimary, { color: colors.ink }]}>
                {partnerName} has no active status
              </Text>
              <Text style={[styles.partnerMeta, { color: colors.inkMuted }]}>
                Updates appear here in realtime when {partnerName} shares one
              </Text>
            </>
          )}
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* Your Status Action Row */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          myActive
            ? `Your status: ${myActive.emoji} ${myActive.text}. Tap to update`
            : 'Set your status'
        }
        onPress={onOpenStatusSheet}
        style={[
          styles.myRow,
          {
            backgroundColor: colors.surfaceElevated,
            borderColor: myActive ? colors.accent : colors.border,
            borderRadius: radii.input,
          },
        ]}>
        <View style={styles.flex}>
          <Text style={[styles.myTitle, { color: colors.ink }]}>
            {myActive
              ? `You: ${myActive.emoji} ${myActive.text}`
              : 'Share what you’re up to'}
          </Text>
          <Text style={[styles.myMeta, { color: colors.inkMuted }]}>
            {myActive
              ? `${formatStatusRemaining(myActive.expires_at)} · Tap to change`
              : 'Pick a preset (In class, On my way...) or custom status'}
          </Text>
        </View>

        <View
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
              { color: myActive ? colors.accent : colors.onAccent },
            ]}>
            {myActive ? 'Edit' : 'Set Status'}
          </Text>
        </View>
      </Pressable>
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
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  partnerPrimary: {
    fontSize: 15,
    fontWeight: '700',
  },
  partnerMeta: {
    fontSize: 12,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  divider: {
    height: 1,
    width: '100%',
  },
  myRow: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderCurve: 'continuous',
  },
  myTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  myMeta: {
    fontSize: 12,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  actionChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    minHeight: 32,
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  actionChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
