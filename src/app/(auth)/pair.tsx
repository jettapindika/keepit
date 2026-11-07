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
  RealtimeInvitePresence,
  RealtimeRedeemPayload,
  saveCompletedPairingLocally,
} from '@/api/pairing';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
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

  const initialPrefillCode =
    typeof params.code === 'string' && params.code.trim().length > 0
      ? normalizeInviteCode(params.code).slice(0, 6)
      : pendingInviteCode && pendingInviteCode.trim().length > 0
        ? normalizeInviteCode(pendingInviteCode).slice(0, 6)
        : '';

  const [partnerCode, setPartnerCode] = useState(initialPrefillCode);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const loadInvite = useCallback(
    async (forceRefresh = false) => {
      if (!user) return;
      setInviteError(null);
      if (forceRefresh) setRefreshingCode(true);
      else setLoadingInvite(true);

      try {
        const record = await createOrRefreshInvite(user.id, forceRefresh);
        setInviteRecord(record);
        if (record.state === 'active') {
          await useSessionStore.getState().refreshPairing();
          router.navigate('/(tabs)');
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
    if (!user) return;
    let cancelled = false;
    void createOrRefreshInvite(user.id, false)
      .then(async (record) => {
        if (cancelled) return;
        setInviteRecord(record);
        if (record.state === 'active') {
          await useSessionStore.getState().refreshPairing();
          router.navigate('/(tabs)');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setInviteError(err instanceof Error ? err.message : 'Could not generate invite code.');
      })
      .finally(() => {
        if (!cancelled) setLoadingInvite(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, router]);

  useEffect(() => {
    if (pendingInviteCode) {
      setPendingInviteCode(null);
    }
  }, [pendingInviteCode, setPendingInviteCode]);

  // Live countdown ticker for 24h invite expiry
  useEffect(() => {
    if (!inviteRecord?.invite_expires_at) return;
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 30_000);
    return () => clearInterval(timer);
  }, [inviteRecord?.invite_expires_at]);

  void nowTick;
  const remainingLabel = inviteRecord?.invite_expires_at
    ? formatRemainingTime(inviteRecord.invite_expires_at)
    : '';

  // Host Realtime invite room so a partner on another phone can discover & redeem this code live
  useEffect(() => {
    const client = supabase;
    if (
      !isSupabaseConfigured ||
      !client ||
      !user ||
      !inviteRecord?.invite_code ||
      inviteRecord.state === 'active'
    ) {
      return;
    }

    const code = normalizeInviteCode(inviteRecord.invite_code);
    const channelName = `keepit:invite:${code}`;
    const presencePayload: RealtimeInvitePresence = {
      couple: inviteRecord,
      hostProfile: user,
    };

    const room = client.channel(channelName, {
      config: {
        broadcast: { ack: true, self: false },
        presence: { key: `host_${user.id}` },
      },
    });

    room
      .on('broadcast', { event: 'WhoHasInvite' }, () => {
        void room
          .send({
            type: 'broadcast',
            event: 'invite_host_announce',
            payload: presencePayload,
          })
          .catch(() => {});
      })
      .on('broadcast', { event: 'invite_redeemed' }, (msg) => {
        const payload = msg.payload as RealtimeRedeemPayload | undefined;
        if (!payload?.couple || !payload?.joinerProfile) return;
        void saveCompletedPairingLocally({
          couple: payload.couple,
          partner: payload.joinerProfile,
          selfProfile: user,
        }).then(() => {
          if (Platform.OS !== 'web') {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          setPairing(payload.couple, payload.joinerProfile);
          router.navigate('/(tabs)');
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void room.track(presencePayload).catch(() => {});
        }
      });

    return () => {
      void client.removeChannel(room);
    };
  }, [user, inviteRecord, setPairing, router]);
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
      router.navigate('/(tabs)');
    } catch (err) {
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      setJoinError(err instanceof Error ? err.message : 'Could not pair with that code.');
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
                {user?.display_name ?? 'You'}
              </Text>
              <Text style={[styles.title, { color: colors.ink }]}>Pair with your partner</Text>
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
                label="Copy"
                accessibilityLabel="Copy Code"
                variant="secondary"
                disabled={loadingInvite || !inviteRecord}
                onPress={() => void handleCopyCode()}
                style={styles.flex}
              />
              <KeepItButton
                label="Refresh"
                accessibilityLabel="Refresh Code"
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

          </View>
          </RevealOnAppear>
          <KeepItButton
            label="Continue Solo / Without Partner"
            variant="secondary"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)');
              }
            }}
          />
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
