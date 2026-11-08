import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  buildInviteDeepLink,
  buildInviteShareMessage,
  createOrRefreshInvite,
  extractInviteCodeFromText,
  formatInviteCodeDisplay,
  normalizeInviteCode,
  redeemInviteCode,
  RealtimeInvitePresence,
  RealtimeRedeemPayload,
  saveCompletedPairingLocally,
} from '@/api/pairing';
import { buildInviteChannelTopic } from '@/api/realtimeSync';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { AppTextInput, PageHeader } from '@/components/ui/ScreenKit';
import { useSessionStore } from '@/store/sessionStore';
import { APP_LAYOUT, useKeepItTheme } from '@/theme/tokens';
import { CoupleRecord } from '@/types/database';

type PairOperation = 'invite' | 'refresh' | 'join' | 'copy' | 'share' | 'paste' | 'signout';

function formatRemainingTime(expiresAtIso: string, now: number): string {
  const diffMs = new Date(expiresAtIso).getTime() - now;
  if (diffMs <= 0) return 'Code expired';
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes.toString().padStart(2, '0')}m left` : `${minutes}m left`;
}

export default function PairScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const { colors, radii } = useKeepItTheme();
  const user = useSessionStore((s) => s.user);
  const pendingInviteCode = useSessionStore((s) => s.pendingInviteCode);
  const setPendingInviteCode = useSessionStore((s) => s.setPendingInviteCode);
  const setPairing = useSessionStore((s) => s.setPairing);
  const signOut = useSessionStore((s) => s.signOut);
  const [inviteRecord, setInviteRecord] = useState<CoupleRecord | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [operation, setOperation] = useState<PairOperation | null>(null);
  const operationRef = useRef<PairOperation | null>(null);
  const mounted = useRef(true);
  const completingPairing = useRef(false);
  const [savingPairing, setSavingPairing] = useState(false);
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const incomingCodeParam = (() => {
    const rawCode =
      typeof params.code === 'string' && params.code.trim()
        ? params.code
        : pendingInviteCode ?? '';
    return (extractInviteCodeFromText(rawCode) || normalizeInviteCode(rawCode)).slice(0, 6);
  })();
  const [partnerCode, setPartnerCode] = useState<string | null>(null);
  const effectivePartnerCode = partnerCode ?? incomingCodeParam;
  const busy = loadingInvite || operation !== null || savingPairing;
  const navigationBusy = savingPairing || (operation !== null && operation !== 'invite');
  const inviteExpired = Boolean(inviteRecord?.invite_expires_at && new Date(inviteRecord.invite_expires_at).getTime() <= nowTick);
  const remainingLabel = inviteRecord?.invite_expires_at ? formatRemainingTime(inviteRecord.invite_expires_at, nowTick) : '';
  const inviteUsable = Boolean(inviteRecord && !inviteExpired);

  const startOperation = (next: PairOperation) => {
    if (operationRef.current || completingPairing.current) return false;
    operationRef.current = next;
    setOperation(next);
    return true;
  };
  const finishOperation = () => {
    operationRef.current = null;
    if (mounted.current) setOperation(null);
  };

  const loadInvite = useCallback(async (forceRefresh = false) => {
    if (!user || operationRef.current || completingPairing.current) return;
    operationRef.current = forceRefresh ? 'refresh' : 'invite';
    setOperation(operationRef.current);
    setInviteError(null);
    setCopiedNotice(null);
    if (!forceRefresh) setLoadingInvite(true);
    try {
      const record = await createOrRefreshInvite(user.id, forceRefresh);
      if (!mounted.current) return;
      setInviteRecord(record);
      setNowTick(Date.now());
      if (record.state === 'active') {
        await useSessionStore.getState().refreshPairing();
        if (mounted.current) router.navigate('/(tabs)');
      }
    } catch (err) {
      if (mounted.current) setInviteError(err instanceof Error ? err.message : 'Could not generate your invite. Please try again.');
    } finally {
      operationRef.current = null;
      if (mounted.current) {
        setLoadingInvite(false);
        setOperation(null);
      }
    }
  }, [user, router]);

  useEffect(() => {
    mounted.current = true;
    void loadInvite();
    return () => {
      mounted.current = false;
    };
  }, [loadInvite]);

  useEffect(() => {
    if (pendingInviteCode) setPendingInviteCode(null);
  }, [pendingInviteCode, setPendingInviteCode]);


  useEffect(() => {
    if (!copiedNotice) return;
    const timer = setTimeout(() => setCopiedNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [copiedNotice]);
  useEffect(() => {
    if (!inviteRecord?.invite_expires_at) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [inviteRecord?.invite_expires_at]);

  const leavePairing = useCallback(() => {
    if ((operationRef.current && operationRef.current !== 'invite') || completingPairing.current) return;
    Keyboard.dismiss();
    if (typeof params.code === 'string' && params.code) router.replace('/(tabs)');
    else if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [params.code, router]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        leavePairing();
        return true;
      });
      return () => subscription.remove();
    }
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        leavePairing();
      };
      document.addEventListener('keydown', onKeyDown);
      return () => document.removeEventListener('keydown', onKeyDown);
    }
  }, [leavePairing]);

  // Host Realtime invite room so a partner on another device can discover & redeem this code live.
  useEffect(() => {
    const client = supabase;
    if (!isSupabaseConfigured || !client || !user || !inviteRecord?.invite_code || inviteRecord.state === 'active') return;
    let active = true;
    const code = normalizeInviteCode(inviteRecord.invite_code);
    const presencePayload: RealtimeInvitePresence = { couple: inviteRecord, hostProfile: user };
    const room = client.channel(buildInviteChannelTopic(code), {
      config: { broadcast: { ack: true, self: false }, presence: { key: `host_${user.id}` } },
    });
    room
      .on('broadcast', { event: 'WhoHasInvite' }, () => {
        void room.send({ type: 'broadcast', event: 'invite_host_announce', payload: presencePayload }).catch(() => {});
      })
      .on('broadcast', { event: 'invite_redeemed' }, (msg) => {
        const payload = msg.payload as RealtimeRedeemPayload | undefined;
        if (!active || !payload?.couple || !payload?.joinerProfile || completingPairing.current) return;
        completingPairing.current = true;
        setSavingPairing(true);
        void saveCompletedPairingLocally({ couple: payload.couple, partner: payload.joinerProfile, selfProfile: user })
          .then(() => {
            if (!active || !mounted.current) return;
            if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            setInviteRecord(payload.couple);
            setPairing(payload.couple, payload.joinerProfile);
            router.navigate('/(tabs)');
          })
          .catch((err) => {
            completingPairing.current = false;
            if (active && mounted.current) setSavingPairing(false);
            if (active && mounted.current) setInviteError(err instanceof Error ? err.message : 'Could not save your pairing. Please try again.');
          });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void room.track(presencePayload).catch(() => {});
      });
    return () => {
      active = false;
      void client.removeChannel(room);
    };
  }, [user, inviteRecord, setPairing, router]);

  const handleCopyOrShare = async (share: boolean) => {
    if (!inviteRecord || loadingInvite || !startOperation(share ? 'share' : 'copy')) return;
    setInviteError(null);
    setCopiedNotice(null);
    try {
      if (inviteRecord.invite_expires_at && new Date(inviteRecord.invite_expires_at).getTime() <= Date.now()) {
        setNowTick(Date.now());
        throw new Error('This invite has expired. Create a new code before sharing it.');
      }
      const link = buildInviteDeepLink(inviteRecord.invite_code);
      const message = buildInviteShareMessage(inviteRecord.invite_code);
      if (share && Platform.OS !== 'web') {
        try {
          await Share.share(
            Platform.OS === 'ios'
              ? { title: 'Pair with me on KeepIt', message, url: link }
              : { title: 'Pair with me on KeepIt', message },
            { dialogTitle: 'Share KeepIt Partner Invite' }
          );
        } catch {
          const copied = await Clipboard.setStringAsync(message);
          if (!copied) {
            throw new Error(
              'Could not open the share sheet or copy the invite link. Copy the code manually.'
            );
          }
          if (mounted.current) setCopiedNotice('Invite link and code copied.');
          void Haptics.selectionAsync().catch(() => {});
        }
      } else {
        if (
          share &&
          Platform.OS === 'web' &&
          typeof navigator !== 'undefined' &&
          typeof navigator.share === 'function'
        ) {
          try {
            await navigator.share({ title: 'Pair with me on KeepIt', text: message });
            if (mounted.current) setCopiedNotice('Invite link shared.');
            return;
          } catch {
            // Fall back to copying to clipboard when web share is dismissed or unsupported
          }
        }
        const copied = await Clipboard.setStringAsync(share ? message : inviteRecord.invite_code);
        if (!copied) throw new Error('Clipboard access was unavailable. Select the invite code and copy it manually.');
        if (mounted.current) setCopiedNotice(share ? 'Invite link and code copied.' : 'Invite code copied.');
        if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
      }
    } catch (err) {
      if (mounted.current) setInviteError(err instanceof Error ? err.message : share ? 'Could not share this invite. Please try again.' : 'Could not copy the code. Select it and copy manually.');
    } finally {
      finishOperation();
    }
  };

  const handlePaste = async () => {
    if (loadingInvite || !startOperation('paste')) return;
    setJoinError(null);
    try {
      const text = await Clipboard.getStringAsync();
      const normalized = extractInviteCodeFromText(text) || normalizeInviteCode(text);
      if (normalized.length !== 6) throw new Error('Copy a KeepIt invite link or 6-character code, or enter it below.');
      if (mounted.current) setPartnerCode(normalized);
    } catch (err) {
      if (mounted.current) setJoinError(err instanceof Error ? err.message : 'Clipboard access was unavailable. Enter the code instead.');
    } finally {
      finishOperation();
    }
  };

  const handleJoinPartner = async () => {
    if (!user || loadingInvite || effectivePartnerCode.length !== 6 || !startOperation('join')) return;
    setJoinError(null);
    Keyboard.dismiss();
    try {
      const snapshot = await redeemInviteCode(user.id, normalizeInviteCode(effectivePartnerCode));
      if (!mounted.current) return;
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPairing(snapshot.couple, snapshot.partner);
      router.navigate('/(tabs)');
    } catch (err) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      if (mounted.current) setJoinError(err instanceof Error ? err.message : 'Could not pair with that code. Please try again.');
    } finally {
      finishOperation();
    }
  };

  const handleSignOut = async () => {
    if (loadingInvite || !startOperation('signout')) return;
    setScreenError(null);
    try {
      await signOut();
      if (mounted.current) router.replace('/(auth)/welcome');
    } catch (err) {
      if (mounted.current) setScreenError(err instanceof Error ? err.message : 'Could not sign out. Please try again.');
    } finally {
      finishOperation();
    }
  };

  const handlePullRefresh = async () => {
    if (pullRefreshing || busy) return;
    setPullRefreshing(true);
    try {
      await useSessionStore.getState().refreshPairing();
      const latestCouple = useSessionStore.getState().couple;
      if (latestCouple && !latestCouple.id.startsWith('solo_') && latestCouple.state === 'active') {
        if (mounted.current) router.navigate('/(tabs)');
        return;
      }
      await loadInvite(false);
    } finally {
      if (mounted.current) setPullRefreshing(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined} style={styles.flex}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          alwaysBounceVertical
          overScrollMode="always"
          refreshControl={
            <RefreshControl
              refreshing={pullRefreshing}
              onRefresh={() => void handlePullRefresh()}
              tintColor={colors.ink}
              colors={[colors.ink]}
              progressBackgroundColor={colors.surface}
            />
          }
          contentContainerStyle={styles.scrollContent}>
          <PageHeader
            title="Pair with partner"
            subtitle="Share your code or enter theirs."
            onBack={navigationBusy ? undefined : leavePairing}
            backLabel="Back"
            backDisabled={navigationBusy}
          />
          {savingPairing ? <InlineNotice message="Saving your pairing…" tone="info" /> : null}
          {screenError ? <InlineNotice message={screenError} tone="error" /> : null}

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
            <View style={styles.codeHeaderRow}>
              <Text style={[styles.actionText, { color: colors.ink }]}>Your invite code</Text>
              {remainingLabel ? <Text accessibilityLiveRegion="polite" style={[styles.secondary, { color: colors.inkMuted }]}>{remainingLabel}</Text> : null}
            </View>

            <View style={[styles.codeBox, { backgroundColor: colors.canvas, borderColor: colors.controlBorder, borderRadius: radii.input }]}>
              {loadingInvite || operation === 'refresh' ? (
                <View accessibilityLiveRegion="polite" style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={colors.ink} />
                  <Text style={[styles.body, { color: colors.inkMuted }]}>Creating code…</Text>
                </View>
              ) : inviteRecord ? (
                <Text selectable accessibilityLabel={`Your invite code: ${inviteRecord.invite_code.split('').join(' ')}`} style={[styles.codeDisplay, { color: colors.ink }]}>{formatInviteCodeDisplay(inviteRecord.invite_code)}</Text>
              ) : (
                <Text style={[styles.body, { color: colors.inkMuted }]}>Code unavailable</Text>
              )}
            </View>

            {inviteExpired ? <InlineNotice message="This code expired. Create a new one." tone="info" /> : null}
            {copiedNotice ? <InlineNotice message={copiedNotice} tone="success" /> : null}
            {inviteError ? <InlineNotice message={inviteError} tone="error" /> : null}

            {!inviteRecord || inviteExpired ? (
              <KeepItButton label={inviteExpired ? 'Create New Code' : 'Try Again'} loading={operation === 'invite' || operation === 'refresh'} loadingLabel="Creating…" disabled={busy} onPress={() => void loadInvite(inviteExpired)} />
            ) : (
              <View style={styles.secondaryRow}>
                <KeepItButton label={Platform.OS === 'web' ? 'Copy Link' : 'Share'} loading={operation === 'share'} loadingLabel="Sharing…" disabled={busy || !inviteUsable} onPress={() => void handleCopyOrShare(true)} style={styles.secondaryButton} />
                <KeepItButton label="Copy Code" variant="secondary" loading={operation === 'copy'} loadingLabel="Copying…" disabled={busy || !inviteUsable} onPress={() => void handleCopyOrShare(false)} style={styles.secondaryButton} />
                <KeepItButton label="New Code" accessibilityLabel="Refresh Code" variant="ghost" loading={operation === 'refresh'} loadingLabel="Refreshing…" disabled={busy} onPress={() => void loadInvite(true)} />
              </View>
            )}
          </View>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
            <Text style={[styles.actionText, { color: colors.ink }]}>Enter partner’s code</Text>
            <View style={styles.joinRow}>
              <AppTextInput
                accessibilityLabel="Partner 6-character invite code"
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                value={effectivePartnerCode}
                editable={!busy}
                placeholder="ABC-123"
                returnKeyType="go"
                onChangeText={(value) => {
                  setJoinError(null);
                  const extracted = extractInviteCodeFromText(value);
                  setPartnerCode(extracted || normalizeInviteCode(value).slice(0, 6));
                }}
                onSubmitEditing={() => void handleJoinPartner()}
                style={[styles.partnerInput, { flex: 1 }]}
              />
              <KeepItButton label="Paste" variant="secondary" loading={operation === 'paste'} loadingLabel="…" disabled={busy} onPress={() => void handlePaste()} />
            </View>
            {joinError ? <InlineNotice message={joinError} tone="error" /> : null}
            <KeepItButton label="Connect Partner" loading={operation === 'join'} loadingLabel="Connecting…" disabled={busy || effectivePartnerCode.length !== 6} onPress={() => void handleJoinPartner()} />
          </View>

          <View style={styles.soloBlock}>
            <KeepItButton label="Continue Solo" variant="secondary" disabled={navigationBusy} onPress={leavePairing} />
            <KeepItButton label="Sign Out" variant="ghost" loading={operation === 'signout'} loadingLabel="Signing Out…" disabled={busy} onPress={() => void handleSignOut()} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, maxWidth: APP_LAYOUT.maxContentWidth, width: '100%', alignSelf: 'center', gap: 16, paddingHorizontal: APP_LAYOUT.pageInset, paddingTop: 12, paddingBottom: 32 },
  actionText: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
  secondary: { fontSize: 13, lineHeight: 20, fontVariant: ['tabular-nums'] },
  card: { padding: 16, gap: 12, borderWidth: 1, borderCurve: 'continuous' },
  codeHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  codeBox: { minHeight: 68, padding: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  codeDisplay: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: 2.5, fontVariant: ['tabular-nums'], textAlign: 'center' },
  loadingRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  secondaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  secondaryButton: { flexGrow: 1, flexBasis: 110 },
  joinRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  partnerInput: { minHeight: 50, fontSize: 17, lineHeight: 24, fontWeight: '600', textAlign: 'center', fontVariant: ['tabular-nums'] },
  soloBlock: { gap: 8 },
});
