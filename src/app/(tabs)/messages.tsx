import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchConversationMessages,
  fetchFriendsCircle,
  markSnapDirectMessageViewed,
  sendDirectMessage,
  toggleDirectMessageReaction,
} from '@/api/social';
import { InlineNotice, RevealOnAppear } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';
import { DirectMessageRecord } from '@/types/database';

const DM_REACTION_EMOJIS = ['❤️', '🔥', '🥹', '😂', '👍'] as const;

const QUICK_NUDGE_CHIPS = [
  'Miss you ❤️',
  'Post your #KeepIt! 📸',
  'Where are you? 📍',
] as const;

const PARTNER_REPLIES = [
  'Just saw this! Grabbing coffee right now ☕️❤️',
  'Posting my #KeepIt in 2 mins, wait till you see the view 📸✨',
  'Miss you more!! Meet up later tonight? 🥹',
  'Haha stoppp 😂 I was literally about to text you the exact same thing!',
] as const;

const FRIEND_REPLIES = [
  'Yo!! Just dropped my #KeepIt moment, check the filter 🔥',
  'Down to link up at the cafe in 20? 📍✨',
  'Lmaoo wait that is actually iconic 😂🔥',
  'Sending good vibes!! Let’s keep the streak alive 📸',
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

  const peers = useMemo<PeerOption[]>(() => {
    const list: PeerOption[] = [];
    const partnerPeerId =
      partner?.id ??
      (couple
        ? couple.user_a_id === userId
          ? couple.user_b_id ?? 'partner_default'
          : couple.user_a_id
        : 'partner_default');

    list.push({
      id: partnerPeerId,
      displayName: partner?.display_name ?? 'Partner',
      username: partner?.username ?? 'partner',
      roleLabel: 'Partner',
      accentColor: partner?.banner_color ?? '#D95D39',
      avatarPath: partner?.avatar_path ?? null,
      isPartner: true,
    });

    for (const fr of friendsQuery.data ?? []) {
      if (fr.friend_id === partnerPeerId) continue;
      list.push({
        id: fr.friend_id,
        displayName: fr.friend_profile.display_name,
        username: fr.friend_profile.username ?? fr.friend_id,
        roleLabel: fr.relationship === 'bestie' ? 'Bestie' : 'Friend',
        accentColor: fr.friend_profile.banner_color ?? '#8B5CF6',
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
        accentColor: '#0EA5E9',
        avatarPath: null,
        isPartner: false,
      });
    }

    return list;
  }, [partner, couple, userId, friendsQuery.data, params.peerId, params.peerName]);

  const [selectedPeerId, setSelectedPeerId] = useState<string>(() => params.peerId ?? '');

  useEffect(() => {
    if (params.peerId) {
      setSelectedPeerId(params.peerId);
    }
  }, [params.peerId]);

  const activePeer = useMemo<PeerOption>(() => {
    return peers.find((p) => p.id === selectedPeerId) ?? peers[0];
  }, [peers, selectedPeerId]);

  const messagesQuery = useQuery({
    queryKey: ['direct-messages', userId, activePeer.id],
    enabled: Boolean(user?.id && activePeer?.id),
    queryFn: () =>
      fetchConversationMessages({
        userId,
        peerId: activePeer.id,
        peerName: activePeer.displayName,
      }),
    refetchInterval: 8_000,
  });

  const [draftText, setDraftText] = useState('');
  const [snapOnceMode, setSnapOnceMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Snap Once active 15s countdowns: messageId -> remaining seconds (15..1)
  const [snapCountdowns, setSnapCountdowns] = useState<Record<string, number>>({});
  const snapCountdownsRef = useRef<Record<string, number>>({});
  snapCountdownsRef.current = snapCountdowns;
  const tickIntervalRef = useRef<number | undefined>(undefined);
  const scrollRef = useRef<{ scrollToEnd?: (opts?: { animated?: boolean }) => void } | null>(null);

  const hasActiveCountdowns = Object.keys(snapCountdowns).length > 0;

  useEffect(() => {
    if (!hasActiveCountdowns) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = undefined;
      return;
    }

    tickIntervalRef.current = setInterval(() => {
      const current = snapCountdownsRef.current;
      const next: Record<string, number> = {};
      const expiredIds: string[] = [];

      for (const [msgId, secs] of Object.entries(current)) {
        if (secs <= 1) {
          expiredIds.push(msgId);
        } else {
          next[msgId] = secs - 1;
        }
      }

      setSnapCountdowns(next);

      if (expiredIds.length > 0) {
        for (const msgId of expiredIds) {
          void markSnapDirectMessageViewed({
            coupleId: couple?.id ?? null,
            messageId: msgId,
            viewerId: userId,
          }).then(() => {
            void queryClient.invalidateQueries({
              queryKey: ['direct-messages', userId, activePeer.id],
            });
          });
        }
      }
    }, 1000) as unknown as number;

    return () => {
      clearInterval(tickIntervalRef.current);
    };
  }, [hasActiveCountdowns, couple?.id, userId, activePeer.id, queryClient]);

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd?.({ animated: true });
    }, 90) as unknown as number;
    return () => {
      clearTimeout(timer);
    };
  }, [messagesQuery.data?.length, activePeer.id]);

  const triggerHaptic = () => {
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
  };

  const handleOpenSnapMessage = (msg: DirectMessageRecord) => {
    const alreadyViewed = (msg.viewed_by_user_ids ?? []).includes(userId);
    if (alreadyViewed) return;
    if (snapCountdowns[msg.id] !== undefined) return;

    triggerHaptic();
    setSnapCountdowns((prev) => ({
      ...prev,
      [msg.id]: 15,
    }));
  };

  const handleSendText = async (overrideText?: string) => {
    const content = (overrideText ?? draftText).trim();
    if (!content || sending) return;

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

  const handleSimulateReply = async () => {
    if (simulating) return;
    setErrorMsg(null);
    setSimulating(true);
    triggerHaptic();

    try {
      const pool = activePeer.isPartner ? PARTNER_REPLIES : FRIEND_REPLIES;
      const msgCount = messagesQuery.data?.length ?? 0;
      const useSnap = msgCount % 2 === 1;
      const sampleText = useSnap
        ? `Secret 15s Snap from ${activePeer.displayName}: Look how cute today’s moment turned out! 🔥👀`
        : pool[msgCount % pool.length];

      await sendDirectMessage({
        coupleId: couple?.id ?? null,
        senderId: activePeer.id,
        senderName: activePeer.displayName,
        recipientId: userId,
        text: sampleText,
        snapOnce: useSnap,
      });
      await queryClient.invalidateQueries({
        queryKey: ['direct-messages', userId, activePeer.id],
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not simulate reply.');
    } finally {
      setSimulating(false);
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
        queryKey: ['direct-messages', userId, activePeer.id],
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
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        {/* Header */}
        <RevealOnAppear revealKey="dm-header">
          <View
            style={[
              styles.headerRow,
              {
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.sm,
                paddingBottom: spacing.sm,
                borderBottomColor: colors.border,
              },
            ]}>
            <View style={styles.headerTitleCol}>
              <Text style={[styles.screenTitle, { color: colors.ink }]}>Messages</Text>
              <Text style={[styles.screenSub, { color: colors.inkMuted }]}>
                Chat & 15s Snaps with {activePeer.displayName}
              </Text>
            </View>

            <View style={styles.headerActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Simulate reply from ${activePeer.displayName}`}
                disabled={simulating}
                onPress={() => void handleSimulateReply()}
                style={[
                  styles.simButton,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                    borderRadius: radii.pill,
                    opacity: simulating ? 0.55 : 1,
                  },
                ]}>
                <Text style={[styles.simButtonText, { color: colors.ink }]}>
                  {simulating ? 'Typing…' : '✨ Simulate Reply'}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open Profile & Friends"
                onPress={() => router.push('/(tabs)/profile' as never)}
                style={[
                  styles.iconPillButton,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.pill,
                  },
                ]}>
                <Text style={[styles.iconPillText, { color: colors.ink }]}>👤</Text>
              </Pressable>
            </View>
          </View>
        </RevealOnAppear>

        {/* Top Conversation Switcher Strip */}
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
              const selected = peer.id === activePeer.id;
              const monogram = peer.displayName.trim().slice(0, 1).toUpperCase() || 'K';
              return (
                <Pressable
                  key={peer.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${peer.displayName} (${peer.roleLabel})`}
                  onPress={() => {
                    triggerHaptic();
                    setSelectedPeerId(peer.id);
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
                    style={[
                      styles.peerAvatarCircle,
                      { backgroundColor: peer.accentColor },
                    ]}>
                    {peer.avatarPath ? (
                      <Image
                        source={{ uri: peer.avatarPath }}
                        contentFit="cover"
                        style={styles.peerAvatarImg}
                      />
                    ) : (
                      <Text style={styles.peerAvatarLetter}>{monogram}</Text>
                    )}
                  </View>
                  <View style={styles.peerTextCol}>
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
                      {peer.isPartner ? '❤️ Partner' : peer.roleLabel}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {errorMsg ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
            <InlineNotice message={errorMsg} tone="error" />
          </View>
        ) : null}

        {/* Chat Message Thread */}
        <ScrollView
          ref={scrollRef as never}
          contentContainerStyle={[
            styles.threadContent,
            {
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.md,
              paddingBottom: spacing.xl,
              gap: spacing.md,
            },
          ]}>
          {messages.length === 0 ? (
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
                Send a note, react with emojis, or toggle 🔥 15s for a disappearing Snap Once message.
              </Text>
            </View>
          ) : (
            messages.map((msg) => {
              const isMine = msg.sender_id === userId;
              const isSnap = Boolean(msg.snap_once);
              const viewedList = msg.viewed_by_user_ids ?? [];
              const hasViewerOpened = viewedList.includes(userId);
              const peerOpenedMine = isMine && viewedList.some((id) => id !== userId);
              const activeRemainingSecs = snapCountdowns[msg.id];
              const isRevealedNow = activeRemainingSecs !== undefined;

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
                        📸 Replied to Moment · {msg.reply_moment_preview}
                      </Text>
                    </View>
                  ) : null}

                  {/* Message Bubble */}
                  {isSnap ? (
                    <Pressable
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
                        } else if (isMine && !hasViewerOpened && !isRevealedNow) {
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
                              ? '#2A1410'
                              : isMine
                                ? '#D95D39'
                                : colors.surfaceElevated,
                          borderColor: isRevealedNow
                            ? '#F97316'
                            : hasViewerOpened
                              ? colors.border
                              : '#F97316',
                          borderRadius: radii.card,
                        },
                      ]}>
                      {hasViewerOpened && !isRevealedNow ? (
                        <View style={styles.snapRow}>
                          <Text style={styles.snapIcon}>💨</Text>
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
                            <Text style={styles.snapLiveBadge}>🔥 SNAP ONCE</Text>
                            <View style={styles.countdownPill}>
                              <Text style={styles.countdownPillText}>{activeRemainingSecs}s</Text>
                            </View>
                          </View>
                          <Text style={styles.snapRevealedText}>{msg.text}</Text>
                        </View>
                      ) : (
                        <View style={styles.snapRow}>
                          <Text style={styles.snapIcon}>🔥</Text>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.snapStatusTitle,
                                { color: isMine ? '#FFFFFF' : colors.ink },
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
                                { color: isMine ? 'rgba(255,255,255,0.82)' : colors.inkMuted },
                              ]}>
                              Disappears 15 seconds after opening
                            </Text>
                          </View>
                        </View>
                      )}
                    </Pressable>
                  ) : (
                    <Pressable
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
                    </Pressable>
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
                          <Pressable
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
                          </Pressable>
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
                          <Pressable
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
                          </Pressable>
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
        <View
          style={[
            styles.composerContainer,
            {
              backgroundColor: colors.sheetSurface,
              borderTopColor: colors.border,
              paddingHorizontal: spacing.md,
              paddingTop: spacing.sm,
              paddingBottom: 96,
            },
          ]}>
          {/* Quick Emoji / Nudge Chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.nudgeChipsScroll}>
            {QUICK_NUDGE_CHIPS.map((chip) => (
              <Pressable
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
                <Text style={[styles.nudgeChipText, { color: colors.ink }]}>{chip}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.inputRow}>
            {/* Snap Once 15s Toggle */}
            <Pressable
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
                  backgroundColor: snapOnceMode ? '#D95D39' : colors.surface,
                  borderColor: snapOnceMode ? '#F97316' : colors.border,
                  borderRadius: radii.pill,
                },
              ]}>
              <Text
                style={[
                  styles.snapToggleLabel,
                  { color: snapOnceMode ? '#FFFFFF' : colors.inkMuted },
                ]}>
                🔥 15s
              </Text>
            </Pressable>

            <TextInput
              accessibilityLabel={`Message ${activePeer.displayName}`}
              value={draftText}
              onChangeText={setDraftText}
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
                  borderColor: snapOnceMode ? '#F97316' : colors.border,
                  color: colors.ink,
                  borderRadius: radii.pill,
                },
              ]}
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={!draftText.trim() || sending}
              onPress={() => void handleSendText()}
              style={[
                styles.sendBtn,
                {
                  backgroundColor: draftText.trim() ? colors.ink : colors.surfaceElevated,
                  borderRadius: radii.pill,
                  opacity: !draftText.trim() || sending ? 0.5 : 1,
                },
              ]}>
              <Text
                style={[
                  styles.sendBtnText,
                  { color: draftText.trim() ? colors.canvas : colors.inkMuted },
                ]}>
                Send
              </Text>
            </Pressable>
          </View>
        </View>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    gap: 10,
  },
  headerTitleCol: {
    flex: 1,
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
  simButton: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderCurve: 'continuous',
  },
  simButtonText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  iconPillButton: {
    borderWidth: 1,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPillText: {
    fontSize: 15,
  },
  switcherWrap: {
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  switcherScroll: {
    alignItems: 'center',
  },
  peerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingVertical: 6,
    paddingLeft: 7,
    paddingRight: 13,
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
    fontSize: 20,
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
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
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
    paddingHorizontal: 11,
    height: 42,
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
    height: 42,
    paddingHorizontal: 15,
    fontSize: 14,
    fontWeight: '500',
  },
  sendBtn: {
    height: 42,
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
