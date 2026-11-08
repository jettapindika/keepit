import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { deleteAccountAndAllData } from '@/api/extras';
import { unpairCurrentCouple } from '@/api/pairing';
import { requestRealtimeCatchUpSync } from '@/api/realtimeSync';
import { AppPressable, AppSwitch, PageHeader, SectionHeader } from '@/components/ui/ScreenKit';
import { InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { ANIMATION_SPEEDS, formatAnimationSpeedLabel } from '@/theme/motion';
import { APP_LAYOUT, ThemeMode, useKeepItTheme } from '@/theme/tokens';

const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: 'Dark', value: 'dark' },
  { label: 'Light', value: 'light' },
  { label: 'System', value: 'system' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, radii, spacing, type } = useKeepItTheme();
  const insets = useSafeAreaInsets();
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

  const [busy, setBusy] = useState<'unpair' | 'delete' | 'signout' | null>(null);
  const [confirmAction, setConfirmAction] = useState<'unpair' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const pendingPreference = useRef<(() => Promise<void>) | null>(null);
  const isPartnerPaired = Boolean(partner && couple && !couple.id.startsWith('solo_'));
  const partnerName = partner?.display_name ?? 'your partner';
  const updatePreference = async (action: () => Promise<void>) => {
    if (preferenceSaving) return;
    pendingPreference.current = action;
    setPreferenceError(null);
    setPreferenceSaving(true);
    try {
      await action();
      pendingPreference.current = null;
    } catch (err) {
      setPreferenceError(`This preference may not be saved. ${err instanceof Error ? err.message : 'Try saving it again.'}`);
    } finally {
      setPreferenceSaving(false);
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || !confirmAction || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); setConfirmAction(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, confirmAction]);

  useEffect(() => {
    if (!busy || Platform.OS === 'web') return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => back.remove();
  }, [busy]);

  const executeUnpair = async () => {
    if (!user) return;
    setError(null); setBusy('unpair');
    try {
      await unpairCurrentCouple(user.id);
      setPairing(null, null);
      router.replace('/(auth)/pair');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unpair right now. Try again.');
    } finally { setBusy(null); setConfirmAction(null); }
  };

  const executeDeleteAccount = async () => {
    if (!user) return;
    setError(null); setBusy('delete');
    try {
      await deleteAccountAndAllData({ userId: user.id });
      router.replace('/(auth)/welcome');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete account deletion. Try again.');
    } finally { setBusy(null); setConfirmAction(null); }
  };

  const requestUnpair = () => {
    if (Platform.OS === 'web') return setConfirmAction('unpair');
    Alert.alert(`Unpair from ${partnerName}?`, 'This dissolves your couple space and deletes shared Moments and streaks for both of you.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unpair & Wipe Shared Data', style: 'destructive', onPress: () => void executeUnpair() },
    ]);
  };
  const requestDeleteAccount = () => {
    if (Platform.OS === 'web') return setConfirmAction('delete');
    Alert.alert('Delete Account & All Data?', 'This permanently deletes your profile, couple pairing, Moment photos, statuses, and location history.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Everything Permanently', style: 'destructive', onPress: () => void executeDeleteAccount() },
    ]);
  };
  const executeSignOut = async () => {
    setError(null); setBusy('signout');
    try { await signOut(); router.replace('/(auth)/welcome'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not sign out right now. Try again.'); }
    finally { setBusy(null); }
  };
  const handlePullRefresh = async () => {
    if (pullRefreshing || busy !== null) return;
    setPullRefreshing(true);
    setError(null);
    try {
      await Promise.all([
        useSessionStore.getState().refreshPairing(),
        requestRealtimeCatchUpSync({ userId: user?.id, coupleId: couple?.id }),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}> 
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        alwaysBounceVertical
        overScrollMode="always"
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => void handlePullRefresh()}
            tintColor={colors.ink}
            colors={[colors.ink]}
            progressBackgroundColor={colors.surfaceElevated}
          />
        }
        contentContainerStyle={[styles.content, { paddingHorizontal: APP_LAYOUT.pageInset, paddingTop: spacing.lg, paddingBottom: APP_LAYOUT.tabBarClearance + insets.bottom }]}>
        <PageHeader title="Settings" subtitle="Account, couple space, and how KeepIt feels." onBack={busy ? undefined : () => { if (confirmAction) setConfirmAction(null); else router.replace('/(tabs)'); }} backLabel={confirmAction ? 'Cancel confirmation' : 'Back to Home'} />

        <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: radii.group, padding: APP_LAYOUT.cardPadding, gap: spacing.sm }]}>
          <SectionHeader title="Couple space" subtitle="Your shared archive and pairing status." />
          <Text style={[styles.body, { color: colors.ink, fontFamily: type.fontSans }]}>You: {user?.display_name ?? 'Unknown'}</Text>
          {email ? <Text style={[styles.muted, { color: colors.inkMuted }]}>{email}</Text> : null}
          <Text style={[styles.body, { color: colors.ink, fontFamily: type.fontSans }]}>Partner: {isPartnerPaired ? partnerName : 'Not paired (Solo)'}</Text>
          {isPartnerPaired && couple?.paired_at ? <Text style={[styles.muted, { color: colors.inkMuted }]}>Paired {new Date(couple.paired_at).toLocaleDateString()}</Text> : null}
          {!isPartnerPaired ? <KeepItButton label="Pair with Partner" variant="secondary" disabled={busy !== null} onPress={() => router.navigate('/(auth)/pair')} /> : null}
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: radii.group, padding: APP_LAYOUT.cardPadding, gap: spacing.lg }]}>
          <SectionHeader title="Appearance" subtitle="Use a light, dark, or device-matched palette." />
          <View accessibilityRole="radiogroup" accessibilityLabel="Theme" style={[styles.radioGroup, { backgroundColor: colors.canvas, borderColor: colors.controlBorder, borderRadius: radii.input }]}>
            {THEME_OPTIONS.map((option) => {
              const selected = themePreference === option.value;
              return <AppPressable key={option.value} accessibilityRole="radio" accessibilityLabel={`${option.label} theme`} accessibilityState={{ checked: selected, disabled: preferenceSaving, busy: preferenceSaving }} disabled={preferenceSaving} onPress={() => void updatePreference(() => setThemePreference(option.value))} style={[styles.radioOption, { backgroundColor: selected ? colors.surfaceElevated : 'transparent', borderRadius: radii.input - 2 }]}>
                <View style={[styles.radioDot, { borderColor: selected ? colors.ink : colors.controlBorder }]}>{selected ? <View style={[styles.radioDotInner, { backgroundColor: colors.ink }]} /> : null}</View>
                <Text style={[styles.radioText, { color: selected ? colors.ink : colors.inkMuted, fontFamily: type.fontSans }]}>{option.label}</Text>
              </AppPressable>;
            })}
          </View>
          {preferenceSaving ? <Text accessibilityLiveRegion="polite" style={[styles.muted, { color: colors.inkMuted }]}>Saving preferences…</Text> : null}
          {preferenceError ? <View style={{ gap: 8 }}><InlineNotice message={preferenceError} tone="error" /><KeepItButton label="Retry saving preference" variant="secondary" disabled={preferenceSaving} onPress={() => { if (pendingPreference.current) void updatePreference(pendingPreference.current); }} /></View> : null}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.switchRow}>
            <View style={styles.flex}><Text style={[styles.section, { color: colors.ink, fontFamily: type.fontSans }]}>Spring animations</Text><Text style={[styles.muted, { color: colors.inkMuted }]}>Use motion when moving through KeepIt.</Text></View>
            <AppSwitch accessibilityLabel="Enable spring animations" accessibilityState={{ checked: motionEnabled, disabled: preferenceSaving }} disabled={preferenceSaving} value={motionEnabled} onValueChange={(value) => void updatePreference(() => setMotionEnabled(value))} />
          </View>
          {motionEnabled ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={[styles.muted, { color: colors.inkMuted }]}>Animation speed: {formatAnimationSpeedLabel(motionSpeed)}</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel="Animation speed" style={styles.speedRow}>
                {ANIMATION_SPEEDS.map((speed) => {
                  const selected = motionSpeed === speed;
                  return <AppPressable key={speed} accessibilityRole="radio" accessibilityLabel={`Animation speed ${formatAnimationSpeedLabel(speed)}`} accessibilityState={{ checked: selected, disabled: preferenceSaving }} disabled={preferenceSaving} onPress={() => void updatePreference(() => setMotionSpeed(speed))} style={[styles.speedOption, { backgroundColor: selected ? colors.ink : colors.surfaceElevated, borderColor: selected ? colors.ink : colors.controlBorder, borderRadius: radii.input }]}><Text style={{ fontSize: 15, lineHeight: 22, color: selected ? colors.canvas : colors.ink, fontFamily: type.fontSans, fontWeight: '600' }}>{formatAnimationSpeedLabel(speed)}</Text></AppPressable>;
                })}
              </View>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, styles.dangerCard, { backgroundColor: colors.surface, borderColor: colors.danger, borderRadius: radii.group, padding: APP_LAYOUT.cardPadding, gap: spacing.md }]}>
          <SectionHeader title="Danger zone" subtitle="Unpairing removes shared Moments and streaks for both partners. Deleting your account permanently removes your profile, pairing, Moment photos, statuses, and location history." />
          {error ? <InlineNotice message={error} tone="error" /> : null}
          {confirmAction ? (
            <View style={[styles.confirmBox, { backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderRadius: radii.input }]}>
              <Text accessibilityRole="header" style={[styles.section, { color: colors.ink }]}>{confirmAction === 'unpair' ? `Unpair from ${partnerName}?` : 'Permanently delete your account?'}</Text>
              <Text style={[styles.body, { color: colors.ink }]}>{confirmAction === 'unpair' ? 'Your shared Moments and streaks will be deleted for both partners. This cannot be undone.' : 'Your profile, pairing, Moment photos, statuses, and location history will be permanently deleted. This cannot be undone.'}</Text>
              <View style={styles.confirmActions}>
                <KeepItButton label="Cancel" variant="secondary" disabled={busy !== null} onPress={() => setConfirmAction(null)} />
                <KeepItButton label={confirmAction === 'unpair' ? 'Confirm Unpair' : 'Confirm Delete Everything'} loadingLabel={confirmAction === 'unpair' ? 'Unpairing…' : 'Deleting account…'} variant="danger" disabled={busy !== null} loading={busy === confirmAction} onPress={() => void (confirmAction === 'unpair' ? executeUnpair() : executeDeleteAccount())} />
              </View>
            </View>
          ) : <>
            {isPartnerPaired ? <KeepItButton label={`Unpair from ${partnerName}`} loadingLabel="Unpairing…" variant="danger" loading={busy === 'unpair'} disabled={busy !== null} onPress={requestUnpair} /> : null}
            <KeepItButton label="Delete Account & All Data" loadingLabel="Deleting account…" variant="danger" loading={busy === 'delete'} disabled={busy !== null} onPress={requestDeleteAccount} />
          </>}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text style={[styles.muted, { color: colors.inkMuted }]}>Signing out keeps your account. You can sign in again later.</Text>
          <KeepItButton label="Sign Out" loadingLabel="Signing out…" variant="secondary" disabled={busy !== null || confirmAction !== null} loading={busy === 'signout'} onPress={() => void executeSignOut()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, width: '100%', maxWidth: 640, alignSelf: 'center', gap: 20 },
  card: {},
  dangerCard: { borderWidth: 1 },
  section: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
  muted: { fontSize: 13, lineHeight: 20 },
  radioGroup: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, padding: 3, gap: 4 },
  radioOption: { flex: 1, minWidth: 72, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 8 },
  radioDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDotInner: { width: 8, height: 8, borderRadius: 4 },
  radioText: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  divider: { height: 1, width: '100%' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, gap: 3 },
  speedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  speedOption: { minWidth: 88, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1 },
  confirmBox: { borderWidth: 1, padding: 14, gap: 12 },
  confirmActions: { gap: 8 },
});
