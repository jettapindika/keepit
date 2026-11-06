import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deleteAccountAndAllData } from '@/api/extras';
import { unpairCurrentCouple } from '@/api/pairing';
import { InlineNotice, KeepItButton, RevealOnAppear } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { ANIMATION_SPEEDS, formatAnimationSpeedLabel } from '@/theme/motion';
import { ThemeMode, useKeepItTheme } from '@/theme/tokens';

const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: 'Dark', value: 'dark' },
  { label: 'Light', value: 'light' },
  { label: 'System', value: 'system' },
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

  const motionEnabled = useSessionStore((s) => s.motionEnabled);
  const setMotionEnabled = useSessionStore((s) => s.setMotionEnabled);
  const motionSpeed = useSessionStore((s) => s.motionSpeed);
  const setMotionSpeed = useSessionStore((s) => s.setMotionSpeed);

  const setPairing = useSessionStore((s) => s.setPairing);
  const signOut = useSessionStore((s) => s.signOut);

  const [unpairing, setUnpairing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'unpair' | 'delete' | null>(null);
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
      setConfirmAction(null);
    }
  };

  const executeDeleteAccount = async () => {
    if (!user) return;
    setError(null);
    setDeleting(true);
    try {
      await deleteAccountAndAllData({ userId: user.id });
      router.replace('/(auth)/welcome');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not complete deletion right now. Nothing was half-left behind; try again.'
      );
    } finally {
      setDeleting(false);
      setConfirmAction(null);
    }
  };

  const requestUnpair = () => {
    if (Platform.OS === 'web') {
      setConfirmAction('unpair');
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

  const requestDeleteAccount = () => {
    if (Platform.OS === 'web') {
      setConfirmAction('delete');
      return;
    }

    Alert.alert(
      'Delete Account & All Data?',
      'This permanently deletes your profile, couple pairing, Moment photos, statuses, and location history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything Permanently',
          style: 'destructive',
          onPress: () => void executeDeleteAccount(),
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
          {
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.xl,
            paddingBottom: 118,
          },
        ]}>
        <RevealOnAppear revealKey="settings-header">
          <Text style={[styles.title, { color: colors.ink }]}>Settings & Privacy</Text>
        </RevealOnAppear>

        {/* Group 1: Couple Space */}
        <RevealOnAppear revealKey="settings-couple">
          <View
            style={[
              styles.groupCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.group,
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
                Paired on {new Date(couple.paired_at).toLocaleDateString()} · Strictly 2 members
              </Text>
            ) : null}
          </View>
        </RevealOnAppear>

        {/* Group 2: Mochy Appearance & Motion */}
        <RevealOnAppear revealKey="settings-appearance">
          <View
            style={[
              styles.groupCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.group,
                padding: spacing.xl,
                gap: spacing.lg,
              },
            ]}>
            <View style={{ gap: spacing.sm }}>
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
                      accessibilityLabel={opt.label}
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

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* Mochy AppMotion Controls */}
            <View style={{ gap: spacing.md }}>
              <View style={styles.switchRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.sectionTitle, { color: colors.ink }]}>Spring animations</Text>
                  <Text style={[styles.muted, { color: colors.inkMuted }]}>
                    Squish-and-rebound buttons, stretching tab pill, and cascade reveals
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Enable spring animations"
                  value={motionEnabled}
                  onValueChange={(val) => void setMotionEnabled(val)}
                  trackColor={{ false: colors.border, true: colors.inkMuted }}
                  thumbColor={colors.ink}
                />
              </View>

              {motionEnabled ? (
                <View style={{ gap: spacing.xs }}>
                  <Text style={[styles.subLabel, { color: colors.inkMuted }]}>
                    Animation speed ({formatAnimationSpeedLabel(motionSpeed)})
                  </Text>
                  <View style={styles.speedRow}>
                    {ANIMATION_SPEEDS.map((spd) => {
                      const active = motionSpeed === spd;
                      return (
                        <Pressable
                          key={spd}
                          accessibilityRole="button"
                          accessibilityLabel={`Animation speed ${formatAnimationSpeedLabel(spd)}`}
                          accessibilityState={{ selected: active }}
                          onPress={() => void setMotionSpeed(spd)}
                          style={[
                            styles.speedChip,
                            {
                              backgroundColor: active ? colors.accent : colors.surfaceElevated,
                              borderColor: active ? colors.accent : colors.border,
                              borderRadius: radii.pill,
                            },
                          ]}>
                          <Text
                            style={[
                              styles.speedChipText,
                              { color: active ? colors.onAccent : colors.inkMuted },
                            ]}>
                            {formatAnimationSpeedLabel(spd)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        </RevealOnAppear>

        {/* Group 3: PrivacyGuarantees */}
        <RevealOnAppear revealKey="settings-privacy">
          <View
            style={[
              styles.groupCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.group,
                padding: spacing.xl,
                gap: spacing.sm,
              },
            ]}>
            <Text style={[styles.sectionTitle, { color: colors.ink }]}>Privacy guarantees</Text>
            <Text style={[styles.muted, { color: colors.inkMuted }]}>
              · Location starts in Ghost mode (off) until you explicitly opt in on the Map tab.
            </Text>
            <Text style={[styles.muted, { color: colors.inkMuted }]}>
              · {partnerName} receives an automatic alert every time location sharing turns on or
              off.
            </Text>
            <Text style={[styles.muted, { color: colors.inkMuted }]}>
              · Moment photos stay locked on the server until both partners post for the day.
            </Text>
          </View>
        </RevealOnAppear>

        {/* Group 4: Danger Zone (Unpair + Delete All Data) */}
        <RevealOnAppear revealKey="settings-danger">
          <View
            style={[
              styles.groupCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.group,
                padding: spacing.xl,
                gap: spacing.md,
              },
            ]}>
            <Text style={[styles.sectionTitle, { color: colors.ink }]}>Unpair & data control</Text>
            <Text style={[styles.muted, { color: colors.inkMuted }]}>
              Unpairing disconnects both accounts and removes shared Moments and streaks. Deleting
              your account permanently purges your profile, auth login, and all stored media.
            </Text>

            {error ? <InlineNotice message={error} tone="error" /> : null}

            {confirmAction === 'unpair' ? (
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
                  onPress={() => setConfirmAction(null)}
                />
              </View>
            ) : confirmAction === 'delete' ? (
              <View style={{ gap: 10 }}>
                <InlineNotice
                  message="Confirm permanent deletion? Your account, couple space, Moments, statuses, and location data will be wiped."
                  tone="error"
                />
                <KeepItButton
                  label="Confirm Delete Everything"
                  accessibilityLabel="Delete Account & All Data Permanently"
                  variant="danger"
                  loading={deleting}
                  onPress={() => void executeDeleteAccount()}
                />
                <KeepItButton
                  label="Cancel"
                  variant="secondary"
                  disabled={deleting}
                  onPress={() => setConfirmAction(null)}
                />
              </View>
            ) : (
              <>
                <KeepItButton
                  label={`Unpair from ${partnerName}`}
                  variant="danger"
                  loading={unpairing}
                  disabled={deleting}
                  onPress={requestUnpair}
                />
                <KeepItButton
                  label="Delete Account & All Data"
                  variant="danger"
                  loading={deleting}
                  disabled={unpairing}
                  onPress={requestDeleteAccount}
                />
              </>
            )}

            <KeepItButton
              label="Sign Out"
              variant="secondary"
              disabled={unpairing || deleting}
              onPress={() => {
                void signOut().then(() => router.replace('/(auth)/welcome'));
              }}
            />
          </View>
        </RevealOnAppear>
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
    gap: 18,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -1.0,
  },
  groupCard: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  subLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  rowLabel: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  muted: {
    fontSize: 13,
    lineHeight: 19,
  },
  divider: {
    height: 1,
    width: '100%',
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
    letterSpacing: -0.2,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  speedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  speedChip: {
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 6,
    minHeight: 32,
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  speedChipText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
