import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';

export default function MapPlaceholderScreen() {
  const { colors, radii, spacing } = useKeepItTheme();
  const partnerName = useSessionStore((s) => s.partner?.display_name ?? 'your partner');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <View style={[styles.container, { padding: spacing.xl }]}>
        <Text style={[styles.title, { color: colors.ink }]}>Map & Location</Text>
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
          <Text style={[styles.cardTitle, { color: colors.ink }]}>
            Location is in Ghost mode by default
          </Text>
          <Text style={[styles.body, { color: colors.inkMuted }]}>
            Neither you nor {partnerName} is sharing coordinates yet. Live, On-Moment, and Ghost
            privacy controls with automatic partner notifications arrive in Step 4.5.
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
