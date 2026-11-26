import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
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
import { fetchTodayMomentBundle } from '@/api/moments';
import { unpairCurrentCouple } from '@/api/pairing';
import { requestRealtimeCatchUpSync } from '@/api/realtimeSync';
import { fetchCoupleStatuses } from '@/api/statuses';
import { AppPressable, AppSwitch, ConfirmModal, PageHeader, SectionHeader } from '@/components/ui/ScreenKit';
import { BentoTile } from '@/components/ui/BentoPrimitives';
import { InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { WidgetPreviewCard } from '@/components/widget/WidgetPreviewCard';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { useSessionStore } from '@/store/sessionStore';
import { ANIMATION_SPEEDS, AnimationSpeed } from '@/theme/motion';
import { APP_LAYOUT, ThemeMode, useKeepItTheme } from '@/theme/tokens';
import { announcePolite, handleRovingKeyDown } from '@/utils/a11y';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'System', value: 'system' },
];

const SPEED_OPTIONS: { label: string; value: AnimationSpeed }[] = [
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1 },
  { label: '1.5x', value: 1.5 },
  { label: '2x', value: 2 },
];

export default function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
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
  const widgetLayout = useSessionStore((s) => s.widgetLayout);
  const setWidgetLayout = useSessionStore((s) => s.setWidgetLayout);
  const mirrorFrontCamera = useSessionStore((s) => s.mirrorFrontCamera);
  const setMirrorFrontCamera = useSessionStore((s) => s.setMirrorFrontCamera);
  const setPairing = useSessionStore((s) => s.setPairing);
  const signOut = useSessionStore((s) => s.signOut);

  const [busy, setBusy] = useState<'unpair' | 'delete' | 'signout' | null>(null);
  const [confirmAction, setConfirmAction] = useState<'unpair' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [preferenceSaved, setPreferenceSaved] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const themeOptionRefs = useRef<(View | null)[]>([]);
  const speedOptionRefs = useRef<(View | null)[]>([]);
  const pendingPreference = useRef<(() => Promise<void>) | null>(null);
  const preferenceSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const isPartnerPaired = Boolean(partner && couple && !couple.id.startsWith('solo_'));
  const partnerName = partner?.display_name ?? 'your partner';
  const momentQuery = useQuery({
    queryKey: ['today-moment', couple?.id, user?.id],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () => fetchTodayMomentBundle({ coupleId: couple!.id, userId: user!.id }),
  });
  const statusQuery = useQuery({
    queryKey: ['couple-statuses', couple?.id, user?.id],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () => fetchCoupleStatuses({ coupleId: couple!.id, userId: user!.id }),
  });
  const widgetSync = useWidgetSync({
    partnerName: isPartnerPaired ? partnerName : 'You',
    myName: user?.display_name ?? 'You',
    coupleId: couple?.id,
    momentBundle: momentQuery.data,
    statusBundle: statusQuery.data,
    widgetLayout,
  });
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearTimeout(preferenceSavedTimer.current ?? undefined);
    };
  }, []);
  const updatePreference = async (action: () => Promise<void>) => {
    if (preferenceSaving) return;
    pendingPreference.current = action;
    setPreferenceError(null);
    setPreferenceSaved(false);
    setPreferenceSaving(true);
    try {
      await action();
      pendingPreference.current = null;
      if (!isMountedRef.current) return;
      setPreferenceSaved(true);
      clearTimeout(preferenceSavedTimer.current ?? undefined);
      preferenceSavedTimer.current = setTimeout(() => {
        if (isMountedRef.current) setPreferenceSaved(false);
      }, 2500);
    } catch (err) {
      if (isMountedRef.current) {
        setPreferenceError(`This preference may not be saved. ${err instanceof Error ? err.message : 'Try saving it again.'}`);
      }
    } finally {
      if (isMountedRef.current) setPreferenceSaving(false);
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['today-moment'] }),
        queryClient.invalidateQueries({ queryKey: ['couple-statuses'] }),
        queryClient.invalidateQueries({ queryKey: ['couple-locations'] }),
        queryClient.invalidateQueries({ queryKey: ['month-memories'] }),
        queryClient.invalidateQueries({ queryKey: ['couple-nudges'] }),
      ]);
      router.replace('/(auth)/pair');
    } catch (err) {
      if (isMountedRef.current) setError(err instanceof Error ? err.message : 'Could not unpair right now. Try again.');
    } finally {
      if (isMountedRef.current) {
        setBusy(null);
        setConfirmAction(null);
      }
    }
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
      if (isMountedRef.current) setPullRefreshing(false);
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
        <PageHeader title="Settings" subtitle="Account, couple space, and how KeepIt feels." onBack={busy ? undefined : () => router.navigate('/(tabs)')} backLabel="Back to Home" />

        <BentoTile variant="spotlight" pattern="dots" radius={radii.card} style={[styles.card, { paddingTop: APP_LAYOUT.cardPaddingTop, paddingHorizontal: APP_LAYOUT.cardPadding, paddingBottom: APP_LAYOUT.cardPaddingBottom, gap: spacing.sm }]}>
          <SectionHeader title="Couple space" subtitle="Your shared archive and pairing status." />
          <Text style={[styles.body, { color: colors.ink, fontFamily: type.fontSans }]}>You: {user?.display_name ?? 'Unknown'}</Text>
          {email ? <Text style={[styles.muted, { color: colors.inkMuted }]}>{email}</Text> : null}
          <Text style={[styles.body, { color: colors.ink, fontFamily: type.fontSans }]}>Partner: {isPartnerPaired ? partnerName : 'Not paired (Solo)'}</Text>
          {isPartnerPaired && couple?.paired_at ? <Text style={[styles.muted, { color: colors.inkMuted }]}>Paired {new Date(couple.paired_at).toLocaleDateString()}</Text> : null}
          {!isPartnerPaired ? <KeepItButton label="Pair with Partner" variant="secondary" disabled={busy !== null} onPress={() => router.navigate('/(auth)/pair')} /> : null}
        </BentoTile>

        <BentoTile variant="dark" radius={radii.card} style={[styles.card, { padding: APP_LAYOUT.cardPadding, gap: spacing.md }]}>
          <SectionHeader title="Appearance" />
          <View accessibilityRole="radiogroup" accessibilityLabel="Theme" style={[styles.segmentedTrack, { backgroundColor: colors.canvas, borderColor: colors.controlBorder, borderRadius: radii.input }]}>
            {THEME_OPTIONS.map((option, idx) => {
              const selected = themePreference === option.value;
              return (
                <AppPressable
                  key={option.value}
                  ref={(el) => {
                    themeOptionRefs.current[idx] = el as View | null;
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={`${option.label} theme`}
                  accessibilityState={{ checked: selected, disabled: preferenceSaving, busy: preferenceSaving }}
                  disabled={preferenceSaving}
                  onPress={() => {
                    void updatePreference(() => setThemePreference(option.value));
                    announcePolite(`Theme set to ${option.label}.`);
                  }}
                  {...(Platform.OS === 'web'
                    ? ({
                        onKeyDown: (event: unknown) =>
                          handleRovingKeyDown(event, idx, THEME_OPTIONS.length, (nextIndex) => {
                            const nextOpt = THEME_OPTIONS[nextIndex];
                            if (nextOpt && !preferenceSaving) {
                              void updatePreference(() => setThemePreference(nextOpt.value));
                              announcePolite(`Theme set to ${nextOpt.label}.`);
                              (themeOptionRefs.current[nextIndex] as unknown as { focus?: () => void } | null)?.focus?.();
                            }
                          }),
                      } as Record<string, unknown>)
                    : {})}
                  style={[
                    styles.segmentedOption,
                    {
                      backgroundColor: selected ? colors.primary : 'transparent',
                      borderRadius: radii.input - 2,
                    },
                  ]}
                >
                  <Text style={[styles.segmentedText, { color: selected ? colors.onAccent : colors.inkMuted, fontFamily: type.fontSans }]}>
                    {option.label}
                  </Text>
                </AppPressable>
              );
            })}
          </View>
          <View style={styles.switchRow}>
            <Text style={[styles.body, { color: colors.ink, fontFamily: type.fontSans, fontWeight: '600', flex: 1 }]}>Motion</Text>
            <AppSwitch accessibilityLabel="Enable motion animations" accessibilityState={{ checked: motionEnabled, disabled: preferenceSaving }} disabled={preferenceSaving} value={motionEnabled} onValueChange={(value) => void updatePreference(() => setMotionEnabled(value))} />
          </View>
          {motionEnabled ? (
            <View style={{ gap: 8 }}>
              <Text style={[styles.muted, { color: colors.inkMuted, fontFamily: type.fontSans }]}>
                Animation speed ({ANIMATION_SPEEDS.includes(motionSpeed as AnimationSpeed) ? `${motionSpeed}x` : `${motionSpeed}x`})
              </Text>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Animation speed"
                style={[
                  styles.segmentedTrack,
                  {
                    backgroundColor: colors.canvas,
                    borderColor: colors.controlBorder,
                    borderRadius: radii.input,
                  },
                ]}>
                {SPEED_OPTIONS.map((option, idx) => {
                  const selected = Math.abs(motionSpeed - option.value) < 0.01;
                  return (
                    <AppPressable
                      key={option.value}
                      ref={(el) => {
                        speedOptionRefs.current[idx] = el as View | null;
                      }}
                      accessibilityRole="radio"
                      accessibilityLabel={`Animation speed ${option.label}`}
                      accessibilityState={{ checked: selected, disabled: preferenceSaving }}
                      disabled={preferenceSaving}
                      onPress={() => {
                        void updatePreference(() => setMotionSpeed(option.value));
                        announcePolite(`Animation speed set to ${option.label}.`);
                      }}
                      {...(Platform.OS === 'web'
                        ? ({
                            onKeyDown: (event: unknown) =>
                              handleRovingKeyDown(event, idx, SPEED_OPTIONS.length, (nextIndex) => {
                                const nextOpt = SPEED_OPTIONS[nextIndex];
                                if (nextOpt && !preferenceSaving) {
                                  void updatePreference(() => setMotionSpeed(nextOpt.value));
                                  announcePolite(`Animation speed set to ${nextOpt.label}.`);
                                  (speedOptionRefs.current[nextIndex] as unknown as { focus?: () => void } | null)?.focus?.();
                                }
                              }),
                          } as Record<string, unknown>)
                        : {})}
                      style={[
                        styles.segmentedOption,
                        {
                          backgroundColor: selected ? colors.primary : 'transparent',
                          borderRadius: radii.input - 2,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.segmentedText,
                          {
                            color: selected ? colors.onAccent : colors.inkMuted,
                            fontFamily: type.fontSans,
                          },
                        ]}>
                        {option.label}
                      </Text>
                    </AppPressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          <View style={styles.switchRow}>
            <Text style={[styles.body, { color: colors.ink, fontFamily: type.fontSans, fontWeight: '600', flex: 1 }]}>Mirror front camera</Text>
            <AppSwitch accessibilityLabel="Mirror front camera photos" accessibilityState={{ checked: mirrorFrontCamera, disabled: preferenceSaving }} disabled={preferenceSaving} value={mirrorFrontCamera} onValueChange={(value) => void updatePreference(() => setMirrorFrontCamera(value))} />
          </View>
          <View style={styles.switchRow}>
            <Text style={[styles.body, { color: colors.ink, fontFamily: type.fontSans, fontWeight: '600', flex: 1 }]}>Side-by-side widget photos</Text>
            <AppSwitch accessibilityLabel="Show my photo and partner photo side by side on widget" accessibilityState={{ checked: widgetLayout === 'side_by_side', disabled: preferenceSaving }} disabled={preferenceSaving} value={widgetLayout === 'side_by_side'} onValueChange={(value) => void updatePreference(() => setWidgetLayout(value ? 'side_by_side' : 'partner_only'))} />
          </View>
          {preferenceSaving ? <Text accessibilityLiveRegion="polite" style={[styles.muted, { color: colors.inkMuted }]}>Saving…</Text> : null}
          {preferenceSaved ? <InlineNotice tone="success" message="Preferences saved." /> : null}
          {preferenceError ? <View style={{ gap: 8 }}><InlineNotice message={preferenceError} tone="error" /><KeepItButton label="Retry saving preference" variant="secondary" disabled={preferenceSaving} onPress={() => { if (pendingPreference.current) void updatePreference(pendingPreference.current); }} /></View> : null}
        </BentoTile>

        <WidgetPreviewCard
          snapshot={widgetSync.snapshot}
          lastSyncedAt={widgetSync.lastSyncedAt}
          widgetLayout={widgetLayout}
          onChangeWidgetLayout={(nextLayout) => void updatePreference(() => setWidgetLayout(nextLayout))}
          onPressOpenApp={() => router.navigate('/(tabs)')}
          onPressCaptureLocked={() => router.push('/camera')}
          onPressSyncNow={() => widgetSync.forceSync()}
          loading={momentQuery.isLoading}
          syncError={widgetSync.error}
        />

        <BentoTile variant="dark" radius={radii.card} style={[styles.card, { padding: APP_LAYOUT.cardPadding, gap: spacing.md }]}>
          <SectionHeader title="Session" subtitle="Signing out keeps your account. You can sign in again later." />
          <KeepItButton label="Sign Out" loadingLabel="Signing out…" variant="secondary" disabled={busy !== null || confirmAction !== null} loading={busy === 'signout'} onPress={() => void executeSignOut()} />
        </BentoTile>

        <View style={[styles.card, styles.dangerCard, { backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderRadius: radii.card, padding: APP_LAYOUT.cardPadding, gap: spacing.md }]}>
          <SectionHeader title="Danger zone" subtitle="Unpairing removes shared Moments and streaks for both partners. Deleting your account removes all KeepIt data." />
          {error ? <InlineNotice message={error} tone="error" /> : null}
          {isPartnerPaired ? <KeepItButton label={`Unpair from ${partnerName}`} loadingLabel="Unpairing…" variant="danger" loading={busy === 'unpair'} disabled={busy !== null} onPress={() => setConfirmAction('unpair')} /> : null}
          <KeepItButton label="Delete Account & All Data" loadingLabel="Deleting account…" variant="danger" loading={busy === 'delete'} disabled={busy !== null} onPress={() => setConfirmAction('delete')} />
        </View>
      </ScrollView>

      <ConfirmModal
        visible={confirmAction !== null}
        title={confirmAction === 'unpair' ? `Unpair from ${partnerName}?` : 'Delete account & all data?'}
        message={
          confirmAction === 'unpair'
            ? 'Your shared Moments and streaks will be deleted for both partners. This cannot be undone.'
            : 'Your profile, pairing, Moment photos, statuses, and location history will be permanently deleted. This cannot be undone.'
        }
        confirmLabel={confirmAction === 'unpair' ? 'Unpair & Delete Shared Data' : 'Delete Everything Permanently'}
        loadingLabel={confirmAction === 'unpair' ? 'Unpairing…' : 'Deleting account…'}
        loading={busy === 'unpair' || busy === 'delete'}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void (confirmAction === 'unpair' ? executeUnpair() : executeDeleteAccount())}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, width: '100%', maxWidth: 640, alignSelf: 'center', gap: 20 },
  card: { borderWidth: 1, borderCurve: 'continuous' },
  dangerCard: { borderWidth: 1 },
  section: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
  muted: { fontSize: 13, lineHeight: 20 },
  segmentedTrack: { flexDirection: 'row', borderWidth: 1, padding: 3, gap: 4 },
  segmentedOption: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segmentedText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
