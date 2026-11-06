import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { unpairCurrentCouple } from '@/api/pairing';
import { InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { ThemeMode, useKeepItTheme } from '@/theme/tokens';

const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, radii, spacing } = useKeepItTheme();

  const user = useSessionStore((s) => s.user);
  const email = useSessionStore((s) => s.email);
  const partner = useSessionStore((s) => s.partner);
  const couple = useSessionStore((s) => s.couple);
  const themePreference = useSessionStore((s) => s.themePreference);
  const setThemePreference = useSessionStore((s) => s.setThemePreference);
  const setPairing = useSessionStore((s) => s.setPairing);
  const signOut = useSessionStore((s) => s.signOut);

  const [unpairing, setUnpairing] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const partnerName = partner?.display_name ?? 'your partner';

  const executeUnpair = async () => {
    if (!user) return;
    setError(null);
    setUnpairing(true);
    try {
      await unpairCurrentCouple(user.id);
      setPairing(null, null);
      router.replace('/(auth)/pair');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unpair right now. Try again.');
    } finally {
      setUnpairing(false);
      setConfirmUnpair(false);
    }
  };

  const requestUnpair = () => {
    if (Platform.OS === 'web') {
      setConfirmUnpair(true);
      return;
    }

    Alert.alert(
      `Unpair from ${partnerName}?`,
      'This dissolves your couple space immediately and deletes shared Moments and streaks for both of you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair & Wipe Shared Data',
          style: 'destructive',
          onPress: () => void executeUnpair(),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
        ]}>
        <Text style={[styles.title, { color: colors.ink }]}>Settings & Privacy</Text>

        {/* Couple Profile */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.card,
              padding: spacing.xl,
              gap: spacing.sm,
            },
          ]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>Couple space</Text>
          <Text style={[styles.rowLabel, { color: colors.ink }]}>
            You: {user?.display_name ?? 'Unknown'} {email ? `(${email})` : ''}
          </Text>
          <Text style={[styles.rowLabel, { color: colors.ink }]}>Partner: {partnerName}</Text>
          {couple?.paired_at ? (
            <Text style={[styles.muted, { color: colors.inkMuted }]}>
              Paired on {new Date(couple.paired_at).toLocaleDateString()}
            </Text>
          ) : null}
        </View>

        {/* Theme Segmented Selector */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.card,
              padding: spacing.xl,
              gap: spacing.md,
            },
          ]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>Appearance</Text>
          <View
            accessibilityRole="radiogroup"
            style={[
              styles.segmentedTrack,
              {
                backgroundColor: colors.canvas,
                borderColor: colors.border,
                borderRadius: radii.input,
              },
            ]}>
            {THEME_OPTIONS.map((opt) => {
              const selected = themePreference === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => void setThemePreference(opt.value)}
                  style={[
                    styles.segmentOption,
                    {
                      backgroundColor: selected ? colors.surfaceElevated : 'transparent',
                      borderRadius: radii.input - 2,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.segmentText,
                      {
                        color: selected ? colors.ink : colors.inkMuted,
                        fontWeight: selected ? '700' : '500',
                      },
                    ]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Danger Zone */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.card,
              padding: spacing.xl,
              gap: spacing.md,
            },
          ]}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>Pairing & account</Text>
          <Text style={[styles.muted, { color: colors.inkMuted }]}>
            Unpairing immediately disconnects both accounts and removes shared Moments and streaks.
          </Text>

          {error ? <InlineNotice message={error} tone="error" /> : null}

          {confirmUnpair ? (
            <View style={{ gap: 10 }}>
              <InlineNotice
                message={`Confirm unpairing from ${partnerName}? Shared Moments and streaks will be deleted immediately.`}
                tone="error"
              />
              <KeepItButton
                label="Confirm Unpair"
                variant="danger"
                loading={unpairing}
                onPress={() => void executeUnpair()}
              />
              <KeepItButton
                label="Cancel"
                variant="secondary"
                disabled={unpairing}
                onPress={() => setConfirmUnpair(false)}
              />
            </View>
          ) : (
            <KeepItButton
              label={`Unpair from ${partnerName}`}
              variant="danger"
              loading={unpairing}
              onPress={requestUnpair}
            />
          )}

          <KeepItButton
            label="Sign Out"
            variant="secondary"
            disabled={unpairing}
            onPress={() => {
              void signOut().then(() => router.replace('/(auth)/welcome'));
            }}
          />
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
    gap: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  card: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  rowLabel: {
    fontSize: 15,
    lineHeight: 22,
  },
  muted: {
    fontSize: 14,
    lineHeight: 20,
  },
  segmentedTrack: {
    flexDirection: 'row',
    borderWidth: 1,
    padding: 3,
    gap: 4,
    borderCurve: 'continuous',
  },
  segmentOption: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  segmentText: {
    fontSize: 14,
  },
});
