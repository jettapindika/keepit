import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DualFrameMark } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';

export default function HomeScreen() {
  const { colors, radii, spacing } = useKeepItTheme();
  const user = useSessionStore((s) => s.user);
  const partner = useSessionStore((s) => s.partner);
  const couple = useSessionStore((s) => s.couple);

  const partnerName = partner?.display_name ?? 'Your partner';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
        ]}>
        <View style={styles.topRow}>
          <Text style={[styles.wordmark, { color: colors.ink }]}>KeepIt</Text>
          <View
            style={[
              styles.streakBadge,
              {
                borderColor: colors.accent,
                backgroundColor: colors.accentSoft,
                borderRadius: radii.pill,
              },
            ]}>
            <Text style={[styles.streakText, { color: colors.accent }]}>Day 1</Text>
          </View>
        </View>

        <View
          style={[
            styles.pairedBanner,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.card,
              padding: spacing.xl,
            },
          ]}>
          <DualFrameMark size={52} />
          <Text style={[styles.heroTitle, { color: colors.ink }]}>
            {user?.display_name ?? 'You'} & {partnerName} are paired
          </Text>
          <Text style={[styles.heroBody, { color: colors.inkMuted }]}>
            Both phones will ring together at a random time today for your 2-minute Moment window.
            Daily Moment capture, dual-camera PIP, and reciprocal unlock ship in Step 4.2.
          </Text>
          {couple?.paired_at ? (
            <Text style={[styles.meta, { color: colors.inkMuted }]}>
              Connected {new Date(couple.paired_at).toLocaleDateString()}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flexGrow: 1,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    gap: 24,
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
  streakBadge: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderCurve: 'continuous',
  },
  streakText: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  pairedBanner: {
    borderWidth: 1,
    alignItems: 'center',
    gap: 12,
    borderCurve: 'continuous',
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginTop: 4,
  },
  heroBody: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  meta: {
    fontSize: 13,
    marginTop: 4,
  },
});
