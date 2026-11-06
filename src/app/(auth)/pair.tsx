import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  buildInviteDeepLink,
  createOrRefreshInvite,
  formatInviteCodeDisplay,
  normalizeInviteCode,
  redeemInviteCode,
  simulateSandboxPartnerJoin,
} from '@/api/pairing';
import { isSupabaseConfigured } from '@/api/supabase';
import { InlineNotice, KeepItButton, RevealOnAppear } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';
import { CoupleRecord } from '@/types/database';

function formatRemainingTime(expiresAtIso: string): string {
  const diffMs = new Date(expiresAtIso).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes.toString().padStart(2, '0')}m left`;
}

export default function PairScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const { colors, radii, spacing } = useKeepItTheme();

  const user = useSessionStore((s) => s.user);
  const pendingInviteCode = useSessionStore((s) => s.pendingInviteCode);
  const setPendingInviteCode = useSessionStore((s) => s.setPendingInviteCode);
  const setPairing = useSessionStore((s) => s.setPairing);
  const signOut = useSessionStore((s) => s.signOut);
  const [inviteRecord, setInviteRecord] = useState<CoupleRecord | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [refreshingCode, setRefreshingCode] = useState(false);
  const [joining, setJoining] = useState(false);
  const [copiedNotice, setCopiedNotice] = useState(false);

  const [partnerCode, setPartnerCode] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [remainingLabel, setRemainingLabel] = useState('');

  const loadInvite = useCallback(
    async (forceRefresh = false) => {
      if (!user) return;
      setInviteError(null);
      if (forceRefresh) setRefreshingCode(true);
      else setLoadingInvite(true);

      try {
        const record = await createOrRefreshInvite(user.id, forceRefresh);
        setInviteRecord(record);
        setRemainingLabel(formatRemainingTime(record.invite_expires_at));
        if (record.state === 'active') {
          await useSessionStore.getState().refreshPairing();
          router.replace('/(tabs)');
        }
      } catch (err) {
        setInviteError(err instanceof Error ? err.message : 'Could not generate invite code.');
      } finally {
        setLoadingInvite(false);
        setRefreshingCode(false);
      }
    },
    [user, router]
  );

  useEffect(() => {
    void loadInvite(false);
  }, [loadInvite]);

  // Pre-fill partner code when opened from keepit://pair?code=XXXXXX deep link
  useEffect(() => {
    const raw =
      typeof params.code === 'string' && params.code.trim().length > 0
        ? params.code
        : pendingInviteCode;
    if (raw && raw.trim().length > 0) {
      setPartnerCode(normalizeInviteCode(raw).slice(0, 6));
      if (pendingInviteCode) setPendingInviteCode(null);
    }
  }, [params.code, pendingInviteCode, setPendingInviteCode]);

  // Live countdown ticker for 24h invite expiry
  useEffect(() => {
    if (!inviteRecord?.invite_expires_at) return;
    setRemainingLabel(formatRemainingTime(inviteRecord.invite_expires_at));
    const timer = setInterval(() => {
      setRemainingLabel(formatRemainingTime(inviteRecord.invite_expires_at));
    }, 30_000);
    return () => clearInterval(timer);
  }, [inviteRecord?.invite_expires_at]);

  const handleShareInvite = async () => {
    if (!inviteRecord) return;
    const link = buildInviteDeepLink(inviteRecord.invite_code);
    const formatted = formatInviteCodeDisplay(inviteRecord.invite_code);
    const shareMessage = `Join me on KeepIt so we can share our daily Moment together.\nInvite code: ${formatted}\nLink: ${link}`;

    if (Platform.OS === 'web') {
      await Clipboard.setStringAsync(shareMessage);
      setCopiedNotice(true);
      setTimeout(() => setCopiedNotice(false), 2500);
      return;
    }

    await Share.share({
      message: shareMessage,
      url: link,
    });
  };

  const handleCopyCode = async () => {
    if (!inviteRecord) return;
    await Clipboard.setStringAsync(inviteRecord.invite_code);
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 2500);
  };

  const handleJoinPartner = async () => {
    if (!user) return;
    setJoinError(null);
    setJoining(true);
    try {
      const snapshot = await redeemInviteCode(user.id, partnerCode);
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setPairing(snapshot.couple, snapshot.partner);
      router.replace('/(tabs)');
    } catch (err) {
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      setJoinError(err instanceof Error ? err.message : 'Could not pair with that code.');
    } finally {
      setJoining(false);
    }
  };

  const handleSandboxPair = async () => {
    if (!user) return;
    setJoinError(null);
    setJoining(true);
    try {
      const snapshot = await simulateSandboxPartnerJoin(user.id, 'Maya');
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setPairing(snapshot.couple, snapshot.partner);
      router.replace('/(tabs)');
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Sandbox pairing failed.');
    } finally {
      setJoining(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.scrollContent,
            { paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl },
          ]}>
          <RevealOnAppear revealKey="pair-header">
            <View style={styles.headerBlock}>
              <Text style={[styles.greeting, { color: colors.inkMuted }]}>
                Signed in as {user?.display_name ?? 'You'}
              </Text>
              <Text style={[styles.title, { color: colors.ink }]}>Pair with your partner</Text>
              <Text style={[styles.subtitle, { color: colors.inkMuted }]}>
                Share your 6-character invite link or enter your partner’s code. A KeepIt space holds
                two people and closes once connected.
              </Text>
            </View>
          </RevealOnAppear>

          {/* Card 1: Share your code */}
          <RevealOnAppear revealKey="pair-card-share">
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.card,
                padding: spacing.xl,
                gap: spacing.lg,
              },
            ]}>
            <View style={styles.cardHeaderRow}>
              <Text style={[styles.sectionTitle, { color: colors.ink }]}>Your invite code</Text>
              {remainingLabel ? (
                <Text style={[styles.expiryText, { color: colors.inkMuted }]}>
                  {remainingLabel}
                </Text>
              ) : null}
            </View>

            <View
              style={[
                styles.codeBox,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                  borderRadius: radii.input,
                },
              ]}>
              <Text selectable style={[styles.codeDisplay, { color: colors.ink }]}>
                {loadingInvite
                  ? '···-···'
                  : inviteRecord
                    ? formatInviteCodeDisplay(inviteRecord.invite_code)
                    : '------'}
              </Text>
            </View>

            {copiedNotice ? (
              <InlineNotice message="Invite copied to clipboard." tone="success" />
            ) : null}
            {inviteError ? <InlineNotice message={inviteError} tone="error" /> : null}

            <KeepItButton
              label="Share Invite Link"
              disabled={loadingInvite || !inviteRecord}
              onPress={() => void handleShareInvite()}
            />

            <View style={styles.secondaryRow}>
              <KeepItButton
                label="Copy Code"
                variant="secondary"
                disabled={loadingInvite || !inviteRecord}
                onPress={() => void handleCopyCode()}
                style={styles.flex}
              />
              <KeepItButton
                label="Refresh Code"
                variant="secondary"
                loading={refreshingCode}
                disabled={loadingInvite}
                onPress={() => void loadInvite(true)}
                style={styles.flex}
              />
            </View>
          </View>
          </RevealOnAppear>

          {/* Card 2: Enter partner's code */}
          <RevealOnAppear revealKey="pair-card-join">
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.card,
                padding: spacing.xl,
                gap: spacing.lg,
              },
            ]}>
            <Text style={[styles.sectionTitle, { color: colors.ink }]}>
              Have your partner’s code?
            </Text>

            <TextInput
              accessibilityLabel="Partner 6-character invite code"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              value={partnerCode}
              placeholder="K9P4M2"
              placeholderTextColor={colors.inkMuted}
              onChangeText={(val) => {
                setJoinError(null);
                setPartnerCode(normalizeInviteCode(val).slice(0, 6));
              }}
              onSubmitEditing={() => void handleJoinPartner()}
              style={[
                styles.partnerInput,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                  color: colors.ink,
                  borderRadius: radii.input,
                },
              ]}
            />

            {joinError ? <InlineNotice message={joinError} tone="error" /> : null}

            <KeepItButton
              label="Connect Our KeepIt"
              loading={joining}
              disabled={partnerCode.length !== 6}
              onPress={() => void handleJoinPartner()}
            />

            {!isSupabaseConfigured ? (
              <KeepItButton
                label="Simulate Partner ‘Maya’ Joining (Sandbox)"
                variant="secondary"
                disabled={joining}
                onPress={() => void handleSandboxPair()}
              />
            ) : null}
          </View>
          </RevealOnAppear>
          <KeepItButton
            label="Sign Out"
            variant="ghost"
            onPress={() => {
              void signOut().then(() => router.replace('/(auth)/welcome'));
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
    gap: 20,
  },
  headerBlock: {
    gap: 6,
  },
  greeting: {
    fontSize: 13,
    fontWeight: '600',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -1.0,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: -0.25,
    lineHeight: 22,
  },
  card: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  expiryText: {
    fontSize: 13,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  codeBox: {
    borderWidth: 1,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  codeDisplay: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 4,
    fontVariant: ['tabular-nums'],
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  partnerInput: {
    minHeight: 54,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 5,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    borderCurve: 'continuous',
  },
});
