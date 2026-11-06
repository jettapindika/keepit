import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useKeepItTheme } from '@/theme/tokens';

export default function MemoriesPlaceholderScreen() {
  const { colors, radii, spacing } = useKeepItTheme();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <View style={[styles.container, { padding: spacing.xl }]}>
        <Text style={[styles.title, { color: colors.ink }]}>Memories</Text>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.card,
              padding: spacing.xl,
            },
          ]}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>No archived Moments yet</Text>
          <Text style={[styles.body, { color: colors.inkMuted }]}>
            Once you and your partner capture your daily Moments, your shared calendar, side-by-side
            Together collages, and monthly recap build here (Step 4.6).
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    flex: 1,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  card: {
    borderWidth: 1,
    gap: 8,
    borderCurve: 'continuous',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
});
