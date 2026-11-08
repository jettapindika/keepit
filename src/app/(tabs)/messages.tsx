import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { requestRealtimeCatchUpSync } from '@/api/realtimeSync';
import {
  fetchConversationMessages,
  fetchFriendsCircle,
  getSnapDmRemainingSeconds,
  isSnapDmExpiredForViewer,
  markSnapDirectMessageViewed,
  sendDirectMessage,
  toggleDirectMessageReaction,
} from '@/api/social';
import { InlineNotice, KeepItButton, RevealOnAppear, SkeletonBlock } from '@/components/ui/Primitives';
import { AppPressable, AppTextInput, PageHeader } from '@/components/ui/ScreenKit';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';
import { DirectMessageRecord } from '@/types/database';

const DM_REACTION_EMOJIS = ['❤️', '🔥', '🥹', '😂', '👍'] as const;

const QUICK_NUDGE_CHIPS = [
  'Miss you',
  'Post your #KeepIt',
  'Where are you?',
] as const;


interface PeerOption {
  id: string;
  displayName: string;
  username: string;
  roleLabel: string;
  accentColor: string;
  avatarPath: string | null;
  isPartner: boolean;
}

export default function MessagesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ peerId?: string; peerName?: string }>();
  const queryClient = useQueryClient();
  const { colors, radii, spacing } = useKeepItTheme();
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const user = useSessionStore((s) => s.user);
  const partner = useSessionStore((s) => s.partner);
  const couple = useSessionStore((s) => s.couple);

  const userId = user?.id ?? 'local_guest';
  const myName = user?.display_name ?? 'You';

  const friendsQuery = useQuery({
    queryKey: ['friends-list', userId],
    enabled: Boolean(user?.id),
    queryFn: () =>
      fetchFriendsCircle({
        userId,
        partner,
      }),
  });

  const isPartnerPaired = Boolean(partner && couple && !couple.id.startsWith('solo_'));

  const peers = useMemo<PeerOption[]>(() => {
    const list: PeerOption[] = [];
    const partnerPeerId =
      partner?.id ??
      (couple && !couple.id.startsWith('solo_')
        ? couple.user_a_id === userId
          ? couple.user_b_id ?? 'partner_default'
          : couple.user_a_id
        : null);

    if (isPartnerPaired && partnerPeerId) {
      list.push({
        id: partnerPeerId,
        displayName: partner?.display_name ?? 'Partner',
        username: partner?.username ?? 'partner',
        roleLabel: 'Partner',
        accentColor: '#1E1E21',
        avatarPath: partner?.avatar_path ?? null,
        isPartner: true,
      });
    }

    for (const fr of friendsQuery.data ?? []) {
      if (partnerPeerId && fr.friend_id === partnerPeerId) continue;
      list.push({
        id: fr.friend_id,
        displayName: fr.friend_profile.display_name,
        username: fr.friend_profile.username ?? fr.friend_id,
        roleLabel: fr.relationship === 'bestie' ? 'Bestie' : 'Friend',
        accentColor: '#1E1E21',
        avatarPath: fr.friend_profile.avatar_path ?? null,
        isPartner: false,
      });
    }

    if (params.peerId && !list.some((p) => p.id === params.peerId)) {
      list.push({
        id: params.peerId,
        displayName: params.peerName ?? 'Friend',
        username: (params.peerName ?? 'friend').toLowerCase().replace(/[^a-z0-9]/g, ''),
        roleLabel: 'Friend',
        accentColor: '#1E1E21',
        avatarPath: null,
        isPartner: false,
      });
    }



    return list;
  }, [isPartnerPaired, partner, couple, userId, friendsQuery.data, params.peerId, params.peerName]);

  const [manualPeerId, setManualPeerId] = useState<string | null>(null);
  const effectiveSelectedPeerId = manualPeerId ?? params.peerId ?? '';

  const activePeer = useMemo<PeerOption | null>(() => {
    if (peers.length === 0) return null;
    return peers.find((p) => p.id === effectiveSelectedPeerId) ?? peers[0];
  }, [peers, effectiveSelectedPeerId]);

  const messagesQuery = useQuery({
    queryKey: ['direct-messages', userId, activePeer?.id ?? 'none'],
    enabled: Boolean(user?.id && activePeer?.id),
    queryFn: () =>
      fetchConversationMessages({
        userId,
        peerId: activePeer!.id,
        peerName: activePeer!.displayName,
      }),
    refetchInterval: 8_000,
  });

  const [draftText, setDraftText] = useState('');
  const [snapOnceMode, setSnapOnceMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const handlePullRefresh = async () => {
    if (pullRefreshing) return;
    setPullRefreshing(true);
    setErrorMsg(null);
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync().catch(() => {});
    }
    try {
      await Promise.all([
        useSessionStore.getState().refreshPairing(),
        requestRealtimeCatchUpSync({ userId, coupleId: couple?.id }),
      ]);
      const { promise: delayPromise, resolve: resolveDelay } = Promise.withResolvers<void>();
      setTimeout(resolveDelay, 200);
      await delayPromise;
      await Promise.all([
        friendsQuery.refetch(),
        messagesQuery.refetch(),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  };
  // Snap Once active 15s countdowns + sender local preview toggle
  const [snapCountdowns, setSnapCountdowns] = useState<Record<string, number>>({});
  const [senderPreviewOpenIds, setSenderPreviewOpenIds] = useState<Record<string, boolean>>({});
  const tickIntervalRef = useRef<number | undefined>(undefined);
  const scrollRef = useRef<{ scrollToEnd?: (opts?: { animated?: boolean }) => void } | null>(null);

  // Derive persisted remaining seconds for any in-progress Snap Once DMs without setState-in-effect
  const persistedCountdowns = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of messagesQuery.data ?? []) {
      if (!m.snap_once || m.sender_id === userId) continue;
      const rem = getSnapDmRemainingSeconds(m, userId);
      if (rem !== null && rem > 0) {
        out[m.id] = rem;
      }
    }
    return out;
  }, [messagesQuery.data, userId]);

  useEffect(() => {
    const list = messagesQuery.data ?? [];
    for (const m of list) {
      if (!m.snap_once || m.sender_id === userId) continue;
      const rem = getSnapDmRemainingSeconds(m, userId);
      if (rem === 0 && !(m.viewed_by_user_ids ?? []).includes(userId)) {
        void markSnapDirectMessageViewed({
          coupleId: couple?.id ?? null,
          messageId: m.id,
          viewerId: userId,
          expired: true,
        }).then(() => {
          void queryClient.invalidateQueries({
            queryKey: ['direct-messages', userId, activePeer?.id],
          });
        });
      }
    }
  }, [messagesQuery.data, userId, couple?.id, activePeer?.id, queryClient]);

  const mergedCountdowns: Record<string, number> = {
    ...persistedCountdowns,
    ...snapCountdowns,
  };
  const hasActiveCountdowns = Object.keys(mergedCountdowns).length > 0;

  useEffect(() => {
    if (!hasActiveCountdowns) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = undefined;
      return;
    }

    tickIntervalRef.current = setInterval(() => {
      const expiredIds: string[] = [];
      setSnapCountdowns((current) => {
        const combined = { ...persistedCountdowns, ...current };
        const next: Record<string, number> = {};
        for (const [msgId, secs] of Object.entries(combined)) {
          if (secs <= 1) {
            expiredIds.push(msgId);
          } else {
            next[msgId] = secs - 1;
          }
        }
        return next;
      });

      if (expiredIds.length > 0) {
        for (const msgId of expiredIds) {
          void markSnapDirectMessageViewed({
            coupleId: couple?.id ?? null,
            messageId: msgId,
            viewerId: userId,
            expired: true,
          }).then(() => {
            void queryClient.invalidateQueries({
              queryKey: ['direct-messages', userId, activePeer?.id],
            });
          });
        }
      }
    }, 1000) as unknown as number;

    return () => {
      clearInterval(tickIntervalRef.current);
    };
  }, [hasActiveCountdowns, persistedCountdowns, couple?.id, userId, activePeer?.id, queryClient]);

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd?.({ animated: true });
    }, 90) as unknown as number;
    return () => {
      clearTimeout(timer);
    };
  }, [messagesQuery.data?.length, activePeer?.id]);

  const triggerHaptic = () => {
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
  };

  const handleOpenSnapMessage = (msg: DirectMessageRecord) => {
    if (msg.sender_id === userId) {
      triggerHaptic();
      setSenderPreviewOpenIds((prev) => ({
        ...prev,
        [msg.id]: !prev[msg.id],
      }));
      return;
    }
    if (isSnapDmExpiredForViewer(msg, userId)) return;
    if (snapCountdowns[msg.id] !== undefined) return;

    triggerHaptic();
    const rem = getSnapDmRemainingSeconds(msg, userId) ?? 15;
    setSnapCountdowns((prev) => ({
      ...prev,
      [msg.id]: rem,
    }));
    void markSnapDirectMessageViewed({
      coupleId: couple?.id ?? null,
      messageId: msg.id,
      viewerId: userId,
      expired: false,
    });
  };

  const handleSendText = async (overrideText?: string) => {
    const content = (overrideText ?? draftText).trim();
    if (!content || sending || !activePeer) return;

    setErrorMsg(null);
    setSending(true);
    triggerHaptic();

    try {
      await sendDirectMessage({
        coupleId: couple?.id ?? null,
        senderId: userId,
        senderName: myName,
        recipientId: activePeer.id,
        text: content,
        snapOnce: snapOnceMode,
      });
      if (overrideText === undefined) {
        setDraftText('');
      }
      await queryClient.invalidateQueries({
        queryKey: ['direct-messages', userId, activePeer.id],
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not send message.');
    } finally {
      setSending(false);
    }
  };


  const handleToggleReaction = async (messageId: string, emoji: string) => {
    triggerHaptic();
    try {
      await toggleDirectMessageReaction({
        coupleId: couple?.id ?? null,
        messageId,
        userId,
        emoji,
      });
      setActiveReactionMsgId(null);
      await queryClient.invalidateQueries({
        queryKey: ['direct-messages', userId, activePeer?.id],
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not update reaction.');
    }
  };

  const messages = messagesQuery.data ?? [];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        {/* Header */}
        <RevealOnAppear revealKey="dm-header">
          <View style={[styles.headerWrap, { paddingHorizontal: spacing.lg }]}> 
            <PageHeader
              title="Messages"
              subtitle={
                activePeer
                  ? `Chat and 15s Snaps with ${activePeer.displayName}`
                  : 'Pair with a partner or add friends to start chatting'
              }
              onBack={() => router.navigate('/(tabs)')}
              backLabel="Back to Home"
              action={
                <AppPressable
                  accessibilityRole="button"
                  accessibilityLabel="Open Profile and Friends"
                  onPress={() => router.navigate('/(tabs)/profile' as never)}
                  style={[styles.headerAction, { backgroundColor: colors.surface, borderColor: colors.controlBorder, borderRadius: radii.input }]}
                >
                  <Text style={[styles.iconPillText, { color: colors.ink }]}>Friends</Text>
                </AppPressable>
              }
            />
          </View>
        </RevealOnAppear>

        {/* Top Conversation Switcher Strip */}
        {peers.length > 0 ? (
          <View
            style={[
              styles.switcherWrap,
              {
                borderBottomColor: colors.border,
                backgroundColor: colors.sheetSurface,
              },
            ]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[
                styles.switcherScroll,
                { paddingHorizontal: spacing.lg, gap: spacing.sm },
              ]}>
              {peers.map((peer) => {
                const selected = peer.id === activePeer?.id;
                const monogram = peer.displayName.trim().slice(0, 1).toUpperCase() || 'K';
                return (
                  <AppPressable
                    key={peer.id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${peer.displayName} (${peer.roleLabel})`}
                    onPress={() => {
                      triggerHaptic();
                      setManualPeerId(peer.id);
                      setActiveReactionMsgId(null);
                    }}
                    style={[
                      styles.peerPill,
                      {
                        backgroundColor: selected ? colors.ink : colors.surface,
                        borderColor: selected ? colors.ink : colors.border,
                        borderRadius: radii.pill,
                      },
                    ]}>
                    <View
                      pointerEvents="none"
                      style={[
                        styles.peerAvatarCircle,
                        { backgroundColor: selected ? colors.surfaceElevated : colors.badgeBg },
                      ]}>
                      {peer.avatarPath ? (
                        <Image
                          source={{ uri: peer.avatarPath }}
                          contentFit="cover"
                          style={styles.peerAvatarImg}
                        />
                      ) : (
                        <Text style={[styles.peerAvatarLetter, { color: selected ? colors.ink : colors.badgeFg }]}>{monogram}</Text>
                      )}
                    </View>
                    <View pointerEvents="none" style={styles.peerTextCol}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.peerNameText,
                          { color: selected ? colors.canvas : colors.ink },
                        ]}>
                        {peer.displayName}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.peerRoleText,
                          { color: selected ? colors.canvas : colors.inkMuted, opacity: selected ? 0.78 : 1 },
                        ]}>
                        {peer.isPartner ? 'Partner' : peer.roleLabel}
                      </Text>
                    </View>
                  </AppPressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {friendsQuery.isError ? (
          <View style={{ maxWidth: 640, width: '100%', alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.xs }}>
            <InlineNotice message="Could not load your conversation list." tone="error" />
            <KeepItButton label="Retry Friends" variant="secondary" onPress={() => void friendsQuery.refetch()} />
          </View>
        ) : null}
        {errorMsg || messagesQuery.isError ? (
          <View style={{ maxWidth: 640, width: '100%', alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.xs }}>
            <InlineNotice
              message={
                errorMsg ??
                (messagesQuery.error instanceof Error
                  ? messagesQuery.error.message
                  : 'Could not load conversation messages.')
              }
              tone="error"
            />
            {messagesQuery.isError ? (
              <KeepItButton label="Retry Messages" variant="secondary" onPress={() => void messagesQuery.refetch()} />
            ) : null}
          </View>
        ) : null}
        {/* Chat Message Thread */}
        <ScrollView
          ref={scrollRef as never}
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
          contentContainerStyle={[
            styles.threadContent,
            {
              width: '100%',
              maxWidth: 640,
              alignSelf: 'center',
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.md,
              paddingBottom: spacing.xl,
              gap: spacing.md,
            },
          ]}>
          {!activePeer ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.card,
                  padding: spacing.xl,
                },
              ]}>
              <Text style={[styles.emptyTitle, { color: colors.ink }]}>
                No conversations yet
              </Text>
              <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>
                Pair with your partner or add friends to your Friends Circle on your Profile to send messages and 15s disappearing Snaps.
              </Text>
            </View>
          ) : messagesQuery.isLoading && messages.length === 0 ? (
            <SkeletonBlock height={140} label="Loading conversation..." />
          ) : messages.length === 0 ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.card,
                  padding: spacing.xl,
                },
              ]}>
              <Text style={[styles.emptyTitle, { color: colors.ink }]}>
                Say hi to {activePeer.displayName}
              </Text>
              <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>
                Send a note, react to a message, or toggle 15s Snap for a disappearing message.
              </Text>
            </View>
          ) : (
            messages.map((msg) => {
              const isMine = msg.sender_id === userId;
              const isSnap = Boolean(msg.snap_once);
              const viewedList = msg.viewed_by_user_ids ?? [];
              const isExpiredSnap = isSnap && isSnapDmExpiredForViewer(msg, userId);
              const hasViewerOpened = !isMine && isExpiredSnap;
              const peerOpenedMine = isMine && (isExpiredSnap || viewedList.some((id) => id !== userId));
              const activeRemainingSecs = !isMine ? mergedCountdowns[msg.id] : undefined;
              const isRevealedNow = isMine
                ? Boolean(senderPreviewOpenIds[msg.id]) && !peerOpenedMine
                : activeRemainingSecs !== undefined && !hasViewerOpened;
              const reactionsMap = msg.reactions ?? {};
              const reactionEntries = Object.entries(reactionsMap);
              const showReactionPicker = activeReactionMsgId === msg.id;

              const timeLabel = new Date(msg.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <View
                  key={msg.id}
                  style={[
                    styles.messageRowWrap,
                    { alignItems: isMine ? 'flex-end' : 'flex-start' },
                  ]}>
                  {/* Reply Moment Preview if present */}
                  {msg.reply_moment_preview ? (
                    <View
                      style={[
                        styles.momentReplyPreview,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                          borderRadius: radii.input,
                        },
                      ]}>
                      <Text
                        numberOfLines={2}
                        style={[styles.momentReplyLabel, { color: colors.inkMuted }]}>
                        Replied to Moment · {msg.reply_moment_preview}
                      </Text>
                    </View>
                  ) : null}

                  {/* Message Bubble */}
                  {isSnap ? (
                    <AppPressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        hasViewerOpened
                          ? 'Expired Snap Once message'
                          : isRevealedNow
                            ? `Snap Once message open, ${activeRemainingSecs} seconds left`
                            : 'Tap to open 15 second Snap Once message'
                      }
                      onPress={() => {
                        if (!isMine && !hasViewerOpened && !isRevealedNow) {
                          handleOpenSnapMessage(msg);
                        } else if (isMine && !peerOpenedMine) {
                          handleOpenSnapMessage(msg);
                        } else {
                          setActiveReactionMsgId((prev) => (prev === msg.id ? null : msg.id));
                        }
                      }}
                      onLongPress={() =>
                        setActiveReactionMsgId((prev) => (prev === msg.id ? null : msg.id))
                      }
                      style={[
                        styles.bubble,
                        styles.snapBubble,
                        {
                          backgroundColor: hasViewerOpened
                            ? colors.surface
                            : isRevealedNow
                              ? colors.surfaceElevated
                              : isMine
                                ? colors.accentSoft
                                : colors.surfaceElevated,
                          borderColor: isRevealedNow
                            ? colors.warning
                            : hasViewerOpened
                              ? colors.border
                              : colors.warning,
                          borderRadius: radii.card,
                        },
                      ]}>
                      {hasViewerOpened && !isRevealedNow ? (
                        <View style={styles.snapRow}>
                          <Text style={[styles.snapIcon, { color: colors.inkMuted }]}>15s</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.snapStatusTitle, { color: colors.inkMuted }]}>
                              Opened · Expired
                            </Text>
                            <Text style={[styles.snapHintText, { color: colors.placeholder }]}>
                              15s Snap disappeared
                            </Text>
                          </View>
                        </View>
                      ) : isRevealedNow ? (
                        <View style={{ gap: 6 }}>
                          <View style={styles.snapCountdownHeader}>
                            <Text style={[styles.snapLiveBadge, { color: colors.warning }]}>
                              {isMine ? 'YOUR SNAP PREVIEW (TAP TO HIDE)' : 'SNAP ONCE'}
                            </Text>
                            {!isMine && activeRemainingSecs !== undefined ? (
                              <View style={[styles.countdownPill, { backgroundColor: colors.warning }]}>
                                <Text style={[styles.countdownPillText, { color: '#000000' }]}>
                                  {activeRemainingSecs}s
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={[styles.snapRevealedText, { color: colors.ink }]}>{msg.text}</Text>
                        </View>
                      ) : (
                        <View style={styles.snapRow}>
                          <Text style={[styles.snapIcon, { color: colors.warning }]}>15s</Text>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.snapStatusTitle,
                                { color: colors.ink },
                              ]}>
                              {isMine
                                ? peerOpenedMine
                                  ? 'Snap Viewed by recipient'
                                  : 'Sent 15s Snap (Tap to preview)'
                                : 'Tap to view 15s Snap'}
                            </Text>
                            <Text
                              style={[
                                styles.snapHintText,
                                { color: colors.inkMuted },
                              ]}>
                              Disappears 15 seconds after opening
                            </Text>
                          </View>
                        </View>
                      )}
                    </AppPressable>
                  ) : (
                    <AppPressable
                      accessibilityRole="button"
                      accessibilityLabel={`${msg.sender_name}: ${msg.text}. Tap to react`}
                      onPress={() => {
                        triggerHaptic();
                        setActiveReactionMsgId((prev) => (prev === msg.id ? null : msg.id));
                      }}
                      style={[
                        styles.bubble,
                        {
                          backgroundColor: isMine ? colors.ink : colors.surface,
                          borderColor: isMine ? colors.ink : colors.border,
                          borderRadius: radii.card,
                        },
                      ]}>
                      {msg.media_uri ? (
                        <Image
                          source={{ uri: msg.media_uri }}
                          contentFit="cover"
                          style={[styles.dmMediaImage, { borderRadius: radii.input }]}
                        />
                      ) : null}
                      <Text
                        style={[
                          styles.messageText,
                          { color: isMine ? colors.canvas : colors.ink },
                        ]}>
                        {msg.text}
                      </Text>
                    </AppPressable>
                  )}

                  {/* Existing Reactions */}
                  {reactionEntries.length > 0 ? (
                    <View style={styles.reactionPillsRow}>
                      {DM_REACTION_EMOJIS.map((emoji) => {
                        const reactors = reactionEntries
                          .filter(([, e]) => e === emoji)
                          .map(([uid]) => uid);
                        if (reactors.length === 0) return null;
                        const mineReacted = reactors.includes(userId);
                        return (
                          <AppPressable
                            key={emoji}
                            accessibilityRole="button"
                            accessibilityLabel={`Toggle ${emoji} reaction`}
                            onPress={() => void handleToggleReaction(msg.id, emoji)}
                            style={[
                              styles.reactionBadge,
                              {
                                backgroundColor: mineReacted
                                  ? colors.accentSoft
                                  : colors.surfaceElevated,
                                borderColor: mineReacted ? colors.ink : colors.border,
                                borderRadius: radii.pill,
                              },
                            ]}>
                            <Text style={[styles.reactionBadgeText, { color: colors.ink }]}>
                              {emoji} {reactors.length > 1 ? reactors.length : ''}
                            </Text>
                          </AppPressable>
                        );
                      })}
                    </View>
                  ) : null}

                  {/* Quick Reaction Picker Bar */}
                  {showReactionPicker ? (
                    <View
                      style={[
                        styles.reactionPickerBar,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      {DM_REACTION_EMOJIS.map((emoji) => {
                        const selectedEmoji = reactionsMap[userId] === emoji;
                        return (
                          <AppPressable
                            key={emoji}
                            accessibilityRole="button"
                            accessibilityLabel={`React with ${emoji}`}
                            onPress={() => void handleToggleReaction(msg.id, emoji)}
                            style={[
                              styles.reactionChoiceBtn,
                              selectedEmoji && {
                                backgroundColor: colors.accentSoft,
                                borderRadius: radii.pill,
                              },
                            ]}>
                            <Text style={styles.reactionChoiceEmoji}>{emoji}</Text>
                          </AppPressable>
                        );
                      })}
                    </View>
                  ) : null}

                  <Text style={[styles.timestampLabel, { color: colors.placeholder }]}>
                    {isMine ? 'You' : msg.sender_name} · {timeLabel}
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>

        {/* Composer Bar */}
        {activePeer ? (
          <View
            style={[
              styles.composerContainer,
              {
                backgroundColor: colors.sheetSurface,
                borderTopColor: colors.border,
                paddingHorizontal: spacing.md,
                paddingTop: spacing.sm,
                paddingBottom: keyboardVisible ? Math.max(insets.bottom, spacing.sm) : 148,
                width: '100%',
                maxWidth: 640,
                alignSelf: 'center',
              },
            ]}>
            {/* Quick Emoji / Nudge Chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.nudgeChipsScroll}>
              {QUICK_NUDGE_CHIPS.map((chip) => (
                <AppPressable
                  key={chip}
                  accessibilityRole="button"
                  accessibilityLabel={`Send quick message: ${chip}`}
                  disabled={sending}
                  onPress={() => void handleSendText(chip)}
                  style={[
                    styles.nudgeChip,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text pointerEvents="none" style={[styles.nudgeChipText, { color: colors.ink }]}>{chip}</Text>
                </AppPressable>
              ))}
            </ScrollView>

            <View style={styles.inputRow}>
              {/* Snap Once 15s Toggle */}
              <AppPressable
                accessibilityRole="switch"
                accessibilityState={{ checked: snapOnceMode }}
                accessibilityLabel="Toggle 15 second Snap Once disappearing message"
                onPress={() => {
                  triggerHaptic();
                  setSnapOnceMode((prev) => !prev);
                }}
                style={[
                  styles.snapToggleBtn,
                  {
                    backgroundColor: snapOnceMode ? colors.accentSoft : colors.surface,
                    borderColor: snapOnceMode ? colors.warning : colors.border,
                    borderRadius: radii.pill,
                  },
                ]}>
                <Text
                  pointerEvents="none"
                  style={[
                    styles.snapToggleLabel,
                    { color: snapOnceMode ? colors.warning : colors.inkMuted },
                  ]}>
                  15s Snap
                </Text>
              </AppPressable>

              <AppTextInput
                accessibilityLabel={`Message ${activePeer.displayName}`}
                value={draftText}
                onChangeText={setDraftText}
                onFocus={() => { if (Platform.OS === 'web') setKeyboardVisible(true); }}
                onBlur={() => { if (Platform.OS === 'web') setKeyboardVisible(false); }}
                placeholder={
                  snapOnceMode
                    ? `Send 15s disappearing Snap to ${activePeer.displayName}…`
                    : `Message ${activePeer.displayName}…`
                }
                placeholderTextColor={colors.placeholder}
                maxLength={400}
                returnKeyType="send"
                onSubmitEditing={() => void handleSendText()}
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.controlBorder,
                    color: colors.ink,
                    borderRadius: 10,
                  },
                ]}
              />

              <AppPressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                disabled={!draftText.trim() || sending}
                onPress={() => void handleSendText()}
                style={[
                  styles.sendBtn,
                  {
                    backgroundColor: draftText.trim() ? colors.ink : colors.surfaceElevated,
                    borderRadius: 10,
                    opacity: !draftText.trim() || sending ? 0.5 : 1,
                  },
                ]}>
                <Text
                  style={[
                    styles.sendBtnText,
                    { color: draftText.trim() ? colors.canvas : colors.inkMuted },
                  ]}>
                  {sending ? 'Sending…' : 'Send'}
                </Text>
              </AppPressable>
            </View>
          </View>
        ) : null}
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
  headerWrap: {
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerAction: {
    minHeight: 44,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    gap: 10,
  },
  headerTitleCol: {
    flex: 1,
    minWidth: 160,
    gap: 2,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  screenSub: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconPillButton: {
    borderWidth: 1,
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  switcherWrap: {
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  switcherScroll: {
    alignItems: 'center',
  },
  peerPill: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingVertical: 6,
    paddingLeft: 8,
    paddingRight: 14,
    gap: 8,
    borderCurve: 'continuous',
  },
  peerAvatarCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  peerAvatarImg: {
    width: 30,
    height: 30,
  },
  peerAvatarLetter: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  peerTextCol: {
    maxWidth: 118,
  },
  peerNameText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  peerRoleText: {
    fontSize: 11,
    fontWeight: '600',
  },
  threadContent: {
    flexGrow: 1,
  },
  emptyCard: {
    borderWidth: 1,
    alignItems: 'center',
    gap: 6,
    marginTop: 24,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  messageRowWrap: {
    gap: 5,
  },
  momentReplyPreview: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: '82%',
  },
  momentReplyLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  bubble: {
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 11,
    maxWidth: '84%',
    gap: 8,
    borderCurve: 'continuous',
  },
  snapBubble: {
    minWidth: 220,
  },
  snapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  snapIcon: {
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  snapStatusTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  snapHintText: {
    fontSize: 12,
    fontWeight: '500',
  },
  snapCountdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  snapLiveBadge: {
    color: '#FDBA74',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  countdownPill: {
    backgroundColor: '#F97316',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countdownPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  snapRevealedText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  dmMediaImage: {
    width: 210,
    height: 150,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  reactionPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  reactionBadge: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  reactionBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  reactionPickerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 4,
  },
  reactionChoiceBtn: {
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  reactionChoiceEmoji: {
    fontSize: 17,
  },
  timestampLabel: {
    fontSize: 11,
    fontWeight: '500',
    paddingHorizontal: 4,
  },
  composerContainer: {
    borderTopWidth: 1,
    gap: 8,
  },
  nudgeChipsScroll: {
    gap: 8,
    paddingVertical: 2,
  },
  nudgeChip: {
    minHeight: 40,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  nudgeChipText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  snapToggleBtn: {
    borderWidth: 1,
    paddingHorizontal: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snapToggleLabel: {
    fontSize: 12,
    fontWeight: '800',
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: 15,
    fontSize: 14,
    fontWeight: '500',
  },
  sendBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
});
