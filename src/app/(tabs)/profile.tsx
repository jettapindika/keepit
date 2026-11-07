import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  DEFAULT_WARM_BLURHASH,
  fetchTodayMomentBundle,
  fetchUserMomentsFeed,
  updateMomentCaption,
} from '@/api/moments';
import {
  addFriendByHandleOrCode,
  buildDefaultUsername,
  buildFriendCode,
  CURATED_MUSIC_TRACKS,
  fetchFriendsCircle,
  removeFriend,
} from '@/api/social';
import { DualMomentCard } from '@/components/moment/MomentCards';
import { InlineNotice, KeepItButton, RevealOnAppear, SkeletonBlock } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';
import { MomentRecord } from '@/types/database';

const BANNER_COLOR_SWATCHES = [
  '#1C1C1E',
  '#282830',
  '#3A3A3C',
  '#D95D39',
] as const;

const PRONOUN_PRESETS = ['she/her', 'he/him', 'they/them'] as const;

function makeAvatarSvgDataUri(bgHex: string, glyph: string, label: string): string {
  const safeLabel = label.replace(/[<>"'&]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect width="240" height="240" rx="120" fill="${bgHex}"/><circle cx="120" cy="120" r="106" fill="none" stroke="rgba(255,255,255,0.26)" stroke-width="5"/><text x="120" y="138" text-anchor="middle" font-family="system-ui, sans-serif" font-size="78" font-weight="800" fill="#FFFFFF">${glyph}</text><text x="120" y="205" text-anchor="middle" font-family="system-ui, sans-serif" font-size="18" font-weight="800" fill="#FFFFFF" opacity="0.9">${safeLabel}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const AVATAR_PRESETS = [
  {
    id: 'sunset_cam',
    label: 'Sunset Lens',
    uri: makeAvatarSvgDataUri('#D95D39', 'K', 'KEEPIT'),
  },
  {
    id: 'obsidian_dual',
    label: 'Obsidian Frame',
    uri: makeAvatarSvgDataUri('#1C1C1E', 'II', 'DUAL'),
  },
  {
    id: 'slate_vinyl',
    label: 'Slate Studio',
    uri: makeAvatarSvgDataUri('#282830', 'M', 'MOMENT'),
  },
  {
    id: 'graphite_film',
    label: '35mm Graphite',
    uri: makeAvatarSvgDataUri('#3A3A3C', '35', 'FILM'),
  },
] as const;
type ProfileSubTab = 'posts' | 'friends';

export default function ProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors, radii, spacing } = useKeepItTheme();

  const user = useSessionStore((s) => s.user);
  const partner = useSessionStore((s) => s.partner);
  const couple = useSessionStore((s) => s.couple);
  const updateProfile = useSessionStore((s) => s.updateProfile);

  const userId = user?.id ?? 'local_guest';
  const coupleId = couple?.id ?? null;

  const [subTab, setSubTab] = useState<ProfileSubTab>('posts');
  const [copiedCode, setCopiedCode] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const copyTimerRef = useRef<number | undefined>(undefined);
  const feedbackTimerRef = useRef<number | undefined>(undefined);

  // Edit Profile Modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftUsername, setDraftUsername] = useState('');
  const [draftBio, setDraftBio] = useState('');
  const [draftPronouns, setDraftPronouns] = useState('');
  const [draftMoodSong, setDraftMoodSong] = useState('');
  const [draftBannerColor, setDraftBannerColor] = useState<string>('#D95D39');
  const [draftWebsite, setDraftWebsite] = useState('');
  const [draftAvatarUri, setDraftAvatarUri] = useState('');
  const [draftIsPrivate, setDraftIsPrivate] = useState(false);
  const [draftDumpMode, setDraftDumpMode] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Add Friend state
  const [friendInput, setFriendInput] = useState('');
  const [friendRel, setFriendRel] = useState<'bestie' | 'friend'>('bestie');
  const [addingFriend, setAddingFriend] = useState(false);

  const bundleQuery = useQuery({
    queryKey: ['today-moment', coupleId, userId],
    enabled: Boolean(coupleId && user?.id),
    queryFn: () =>
      fetchTodayMomentBundle({
        coupleId: coupleId!,
        userId,
      }),
  });

  const userPostsQuery = useQuery({
    queryKey: ['user-posts', userId, coupleId],
    enabled: Boolean(user?.id),
    queryFn: () =>
      fetchUserMomentsFeed({
        userId,
        coupleId,
      }),
  });

  const friendsQuery = useQuery({
    queryKey: ['friends-list', userId],
    enabled: Boolean(user?.id),
    queryFn: () =>
      fetchFriendsCircle({
        userId,
        partner,
      }),
  });

  const myPosts = useMemo<MomentRecord[]>(() => {
    const map = new Map<string, MomentRecord>();
    for (const item of userPostsQuery.data ?? []) {
      map.set(item.id, item);
    }
    for (const item of bundleQuery.data?.myMomentsToday ?? []) {
      map.set(item.id, item);
    }
    if (bundleQuery.data?.mine) {
      map.set(bundleQuery.data.mine.id, bundleQuery.data.mine);
    }
    return Array.from(map.values()).sort((a, b) => (a.posted_at < b.posted_at ? 1 : -1));
  }, [userPostsQuery.data, bundleQuery.data]);

  const friendsList = friendsQuery.data ?? [];
  const streakCount = bundleQuery.data?.streak?.current_count ?? 0;

  const displayName = user?.display_name ?? 'KeepIt Creator';
  const username =
    user?.username || buildDefaultUsername(displayName, userId);
  const friendCode =
    user?.friend_code || buildFriendCode(userId, displayName) || 'KPT-204';
  const bannerColor = user?.banner_color ?? '#1C1C1E';
  const pronouns = user?.pronouns ?? '';
  const bio = user?.bio ?? '';
  const moodSong = user?.mood_song ?? '';
  const website = user?.website ?? '';
  const avatarPath = user?.avatar_path ?? null;
  const isPrivateAccount = Boolean(user?.is_private);
  const isDumpAccount = Boolean(user?.dump_mode);
  const isPartnerPaired = Boolean(partner && couple && !couple.id.startsWith('solo_'));
  const partnerName = partner?.display_name ?? 'Partner';
  const triggerHaptic = () => {
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
  };

  const showTemporaryFeedback = (msg: string) => {
    setProfileFeedback(msg);
    clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      setProfileFeedback(null);
    }, 3200) as unknown as number;
  };

  const handleCopyFriendCode = async () => {
    triggerHaptic();
    await Clipboard.setStringAsync(friendCode).catch(() => {});
    setCopiedCode(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      setCopiedCode(false);
    }, 2000) as unknown as number;
  };

  const openEditProfileModal = () => {
    triggerHaptic();
    setEditError(null);
    setDraftName(user?.display_name ?? '');
    setDraftUsername(username);
    setDraftBio(user?.bio ?? '');
    setDraftPronouns(user?.pronouns ?? '');
    setDraftMoodSong(user?.mood_song ?? '');
    setDraftBannerColor(user?.banner_color ?? '#1C1C1E');
    setDraftWebsite(user?.website ?? '');
    setDraftAvatarUri(user?.avatar_path ?? '');
    setDraftIsPrivate(Boolean(user?.is_private));
    setDraftDumpMode(Boolean(user?.dump_mode));
    setEditModalOpen(true);
  };

  const handleSaveProfile = async () => {
    setEditError(null);
    setSavingProfile(true);
    triggerHaptic();

    try {
      await updateProfile({
        displayName: draftName.trim(),
        username: draftUsername.trim().replace(/^@/, ''),
        bio: draftBio.trim(),
        pronouns: draftPronouns.trim(),
        moodSong: draftMoodSong.trim(),
        bannerColor: draftBannerColor,
        website: draftWebsite.trim(),
        avatarPath: draftAvatarUri.trim() ? draftAvatarUri.trim() : null,
        isPrivate: draftIsPrivate,
        dumpMode: draftDumpMode,
      });
      setEditModalOpen(false);
      showTemporaryFeedback('Profile updated! Your new aesthetic is live.');
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not update profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleOpenCameraNewPost = () => {
    triggerHaptic();
    const prompt = bundleQuery.data?.prompt;
    if (prompt) {
      router.push({
        pathname: '/camera',
        params: {
          promptId: prompt.id,
          triggerAt: prompt.trigger_at,
          retakesUsed: String(bundleQuery.data?.mine?.retake_count ?? 0),
        },
      });
      return;
    }
    router.push('/camera');
  };

  const handleRefreshPosts = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['user-posts'] }),
      queryClient.invalidateQueries({ queryKey: ['today-moment'] }),
      queryClient.invalidateQueries({ queryKey: ['month-memories'] }),
    ]);
  };

  const handleAddFriend = async () => {
    if (!friendInput.trim() || addingFriend) return;
    setProfileError(null);
    setAddingFriend(true);
    triggerHaptic();

    try {
      const added = await addFriendByHandleOrCode({
        userId,
        coupleId,
        query: friendInput,
        relationship: friendRel,
      });
      setFriendInput('');
      showTemporaryFeedback(
        `Added ${added.friend_profile.display_name} (@${added.friend_profile.username ?? 'friend'}) to your circle!`
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['friends-list', userId] }),
        queryClient.invalidateQueries({ queryKey: ['today-moment'] }),
      ]);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Could not add friend.');
    } finally {
      setAddingFriend(false);
    }
  };

  const handleRemoveFriend = async (friendRecordId: string, name: string) => {
    setProfileError(null);
    triggerHaptic();
    try {
      await removeFriend({
        userId,
        friendRecordId,
      });
      showTemporaryFeedback(`Removed ${name} from your Friends Circle.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['friends-list', userId] }),
        queryClient.invalidateQueries({ queryKey: ['today-moment'] }),
      ]);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Could not remove friend.');
    }
  };

  const handleOpenWebsite = (rawUrl: string) => {
    const cleaned = rawUrl.trim();
    if (!cleaned) return;
    const target = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    void Linking.openURL(target).catch(() => {});
  };

  const monogram = displayName.trim().slice(0, 1).toUpperCase() || 'K';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingBottom: 148,
        }}>
        {/* Top Banner & Quick Action Bar */}
        <RevealOnAppear revealKey="profile-banner">
          <View style={[styles.bannerBlock, { backgroundColor: bannerColor }]}>
            <View style={[styles.bannerOverlayRow, { paddingHorizontal: spacing.xl }]}>
              <View style={styles.brandTagPill}>
                <Text style={styles.brandTagText}>#KeepIt Social</Text>
              </View>

              <View style={styles.topQuickButtons}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open Memories Calendar"
                  onPress={() => {
                    triggerHaptic();
                    router.navigate('/(tabs)/memories');
                  }}
                  style={styles.bannerQuickBtn}>
                  <Text pointerEvents="none" style={styles.bannerQuickBtnText}>Memories</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open Settings"
                  onPress={() => {
                    triggerHaptic();
                    router.navigate('/(tabs)/settings');
                  }}
                  style={styles.bannerQuickBtn}>
                  <Text pointerEvents="none" style={styles.bannerQuickBtnText}>Settings</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </RevealOnAppear>

        {/* Avatar + Identity Card */}
        <View style={{ paddingHorizontal: spacing.xl }}>
          <View style={styles.avatarHeaderRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit profile avatar"
              onPress={openEditProfileModal}
              style={[
                styles.avatarOuterRing,
                {
                  backgroundColor: colors.canvas,
                  borderColor: colors.canvas,
                },
              ]}>
              {avatarPath ? (
                <Image
                  source={{ uri: avatarPath }}
                  contentFit="cover"
                  style={styles.avatarImage}
                />
              ) : (
                <View style={[styles.avatarMonogramCircle, { backgroundColor: bannerColor }]}>
                  <Text style={styles.avatarMonogramText}>{monogram}</Text>
                </View>
              )}
              <View
                style={[
                  styles.avatarEmojiBadge,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.canvas,
                  },
                ]}>
                <Text style={[styles.avatarEmojiBadgeText, { color: colors.ink }]}>+</Text>
              </View>
            </Pressable>

            <View style={styles.headerEditActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Copy Friend Code ${friendCode}`}
                onPress={() => void handleCopyFriendCode()}
                style={[
                  styles.friendCodePill,
                  {
                    backgroundColor: colors.surface,
                    borderColor: copiedCode ? colors.success : colors.border,
                    borderRadius: radii.pill,
                  },
                ]}>
                <Text pointerEvents="none" style={[styles.friendCodeLabel, { color: colors.inkMuted }]}>CODE</Text>
                <Text pointerEvents="none" style={[styles.friendCodeValue, { color: colors.ink }]}>
                  {copiedCode ? 'Copied ✓' : friendCode}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit Profile"
                onPress={openEditProfileModal}
                style={[
                  styles.editProfilePill,
                  {
                    backgroundColor: colors.ink,
                    borderRadius: radii.pill,
                  },
                ]}>
                <Text pointerEvents="none" style={[styles.editProfilePillText, { color: colors.canvas }]}>
                  Edit Profile
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Identity Details */}
          <View style={{ gap: 6, marginTop: spacing.sm }}>
            <View style={styles.nameAndPronounsRow}>
              <Text style={[styles.displayNameText, { color: colors.ink }]}>{displayName}</Text>
              {pronouns ? (
                <View
                  style={[
                    styles.pronounsPill,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.pronounsText, { color: colors.inkMuted }]}>{pronouns}</Text>
                </View>
              ) : null}
              {isPrivateAccount ? (
                <View
                  style={[
                    styles.pronounsPill,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.warning,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.pronounsText, { color: colors.warning }]}>
                    Private
                  </Text>
                </View>
              ) : null}
              {isDumpAccount ? (
                <View
                  style={[
                    styles.pronounsPill,
                    {
                      backgroundColor: colors.accentSoft,
                      borderColor: colors.accent,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.pronounsText, { color: colors.ink }]}>
                    Dump Acc
                  </Text>
                </View>
              ) : null}
            </View>

            <Text style={[styles.handleText, { color: colors.inkMuted }]}>@{username}</Text>

            {bio ? (
              <Text style={[styles.bioText, { color: colors.ink }]}>{bio}</Text>
            ) : null}

            {/* Badges Row: Mood Song + Website */}
            <View style={styles.badgesWrapRow}>
              {moodSong ? (
                <View
                  style={[
                    styles.metaBadgePill,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.metaBadgeText, { color: colors.ink }]}>
                    Track: {moodSong}
                  </Text>
                </View>
              ) : null}

              {website ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`Open website ${website}`}
                  onPress={() => handleOpenWebsite(website)}
                  style={[
                    styles.metaBadgePill,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.metaBadgeText, { color: colors.ink }]}>
                    {website.replace(/^https?:\/\//i, '')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Social Stats Bar */}
          <RevealOnAppear revealKey="profile-stats-bar">
            <View
              style={[
                styles.statsBarCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.card,
                  marginTop: spacing.lg,
                  paddingVertical: spacing.md,
                  paddingHorizontal: spacing.md,
                },
              ]}>
              <View style={styles.statCol}>
                <Text style={[styles.statValue, { color: colors.ink }]}>{myPosts.length}</Text>
                <Text style={[styles.statLabel, { color: colors.inkMuted }]}>Posts</Text>
              </View>

              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />

              <View style={styles.statCol}>
                <Text style={[styles.statValue, { color: colors.ink }]}>{streakCount}d</Text>
                <Text style={[styles.statLabel, { color: colors.inkMuted }]}>Day Streak</Text>
              </View>

              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />

              <View style={styles.statCol}>
                <Text style={[styles.statValue, { color: colors.ink }]}>{friendsList.length}</Text>
                <Text style={[styles.statLabel, { color: colors.inkMuted }]}>Friends</Text>
              </View>

              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isPartnerPaired ? `Paired with ${partnerName}` : 'Pair with a Partner (Optional)'
                }
                onPress={() => {
                  triggerHaptic();
                  router.navigate('/(auth)/pair');
                }}
                style={[styles.statCol, { flex: 1.35 }]}>
                <Text
                  numberOfLines={1}
                  style={[styles.statPartnerValue, { color: colors.ink }]}>
                  {isPartnerPaired ? partnerName : '+ Pair Partner'}
                </Text>
                <Text numberOfLines={1} style={[styles.statLabel, { color: colors.inkMuted }]}>
                  {isPartnerPaired ? `Paired with ${partnerName}` : 'Solo / Optional'}
                </Text>
              </Pressable>
            </View>
          </RevealOnAppear>

          {/* Quick Private / Dump Account Privacy Card */}
          <RevealOnAppear revealKey="profile-privacy-card">
            <View
              style={[
                styles.statsBarCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: isPrivateAccount ? colors.warning : colors.border,
                  borderRadius: radii.card,
                  marginTop: spacing.md,
                  paddingVertical: spacing.md,
                  paddingHorizontal: spacing.lg,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: spacing.md,
                },
              ]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '700' }}>
                  {isPrivateAccount
                    ? 'Private Dump Account Active'
                    : 'Public / Circle Account'}
                </Text>
                <Text style={{ color: colors.inkMuted, fontSize: 12 }}>
                  {isPrivateAccount
                    ? 'Only approved besties/partner can view your photo dump grid.'
                    : 'Switch on Private Mode anytime to use this as a private photo dump account.'}
                </Text>
              </View>
              <Switch
                accessibilityLabel="Toggle Private Dump Account mode"
                value={isPrivateAccount}
                onValueChange={(nextVal) => {
                  triggerHaptic();
                  void updateProfile({
                    displayName,
                    isPrivate: nextVal,
                    dumpMode: nextVal ? true : isDumpAccount,
                  }).then(() => {
                    showTemporaryFeedback(
                      nextVal
                        ? 'Switched to Private Dump Account mode.'
                        : 'Profile is now visible to your circle.'
                    );
                  });
                }}
                trackColor={{ false: colors.border, true: colors.warning }}
                thumbColor={colors.ink}
              />
            </View>
          </RevealOnAppear>

          {profileFeedback ? (
            <View style={{ marginTop: spacing.md }}>
              <InlineNotice message={profileFeedback} tone="success" />
            </View>
          ) : null}

          {profileError ? (
            <View style={{ marginTop: spacing.md }}>
              <InlineNotice message={profileError} tone="error" />
            </View>
          ) : null}

          {/* Profile Sub-Tabs Switcher */}
          <View
            style={[
              styles.subTabsTrack,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.pill,
                marginTop: spacing.lg,
              },
            ]}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: subTab === 'posts' }}
              accessibilityLabel="My Posts (CRUD)"
              onPress={() => {
                triggerHaptic();
                setSubTab('posts');
              }}
              style={[
                styles.subTabBtn,
                subTab === 'posts' && {
                  backgroundColor: colors.ink,
                  borderRadius: radii.pill,
                },
              ]}>
              <Text
                pointerEvents="none"
                style={[
                  styles.subTabText,
                  { color: subTab === 'posts' ? colors.canvas : colors.inkMuted },
                ]}>
                My Posts ({myPosts.length})
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: subTab === 'friends' }}
              accessibilityLabel="Friends Circle"
              onPress={() => {
                triggerHaptic();
                setSubTab('friends');
              }}
              style={[
                styles.subTabBtn,
                subTab === 'friends' && {
                  backgroundColor: colors.ink,
                  borderRadius: radii.pill,
                },
              ]}>
              <Text
                pointerEvents="none"
                style={[
                  styles.subTabText,
                  { color: subTab === 'friends' ? colors.canvas : colors.inkMuted },
                ]}>
                Friends Circle ({friendsList.length + (isPartnerPaired ? 1 : 0)})
              </Text>
            </Pressable>
          </View>

          {/* SUB-TAB 1: MY POSTS (CRUD) */}
          {subTab === 'posts' ? (
            <View style={{ marginTop: spacing.lg, gap: spacing.lg }}>
              <View style={styles.postsHeaderBar}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sectionHeading, { color: colors.ink }]}>
                    Your #KeepIt Feed
                  </Text>
                  <Text style={[styles.sectionSub, { color: colors.inkMuted }]}>
                    Create, edit captions/music/tags, delete, or share 9:16 stories
                  </Text>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Create New Moment Post"
                  onPress={handleOpenCameraNewPost}
                  style={[
                    styles.newPostButton,
                    {
                      backgroundColor: bannerColor,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text pointerEvents="none" style={styles.newPostButtonText}>+ New Post</Text>
                </Pressable>
              </View>

              {userPostsQuery.isError ? (
                <View style={{ gap: spacing.sm }}>
                  <InlineNotice
                    message={
                      userPostsQuery.error instanceof Error
                        ? userPostsQuery.error.message
                        : 'Could not load your Moments.'
                    }
                    tone="error"
                  />
                  <KeepItButton
                    label="Retry Posts"
                    variant="secondary"
                    onPress={() => void userPostsQuery.refetch()}
                  />
                </View>
              ) : null}

              {userPostsQuery.isLoading && myPosts.length === 0 ? (
                <SkeletonBlock height={280} label="Loading your posted Moments..." />
              ) : myPosts.length === 0 ? (
                <View
                  style={[
                    styles.emptyFeedCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.group,
                      padding: spacing.xl,
                    },
                  ]}>
                  <Text style={[styles.emptyFeedTitle, { color: colors.ink }]}>
                    No Moments posted yet
                  </Text>
                  <Text style={[styles.emptyFeedBody, { color: colors.inkMuted }]}>
                    Capture your first dual-camera photo or video loop to start your personal grid.
                  </Text>
                  <KeepItButton
                    label="+ Capture New Post"
                    onPress={handleOpenCameraNewPost}
                    style={{ marginTop: spacing.sm }}
                  />
                </View>
              ) : (
                myPosts.map((post) => (
                  <View key={post.id} style={{ gap: spacing.xs }}>
                    <DualMomentCard
                      moment={post}
                      authorName={displayName}
                      backPhotoUrl={post.back_photo_url ?? post.back_photo_path}
                      frontPhotoUrl={post.front_photo_url ?? post.front_photo_path}
                      blurhash={post.back_blurhash || DEFAULT_WARM_BLURHASH}
                      caption={post.caption}
                      postedAtIso={post.posted_at}
                      lateBySeconds={post.late_by_seconds}
                      isLate={post.is_late}
                      retakeCount={post.retake_count}
                      currentUserId={userId}
                      coupleId={post.couple_id || coupleId || 'local_couple'}
                      isOwner={true}
                      editableCaption={true}
                      onSaveCaption={async (nextCaption: string) => {
                        await updateMomentCaption({
                          momentId: post.id,
                          userId,
                          caption: nextCaption,
                        });
                        await handleRefreshPosts();
                      }}
                      onUpdated={() => void handleRefreshPosts()}
                      onDeleted={async () => {
                        showTemporaryFeedback('Moment deleted from your profile.');
                        await handleRefreshPosts();
                      }}
                    />
                  </View>
                ))
              )}
            </View>
          ) : (
            /* SUB-TAB 2: FRIENDS CIRCLE */
            <View style={{ marginTop: spacing.lg, gap: spacing.lg }}>
              {/* Add Friend Card */}
              <View
                style={[
                  styles.addFriendCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.group,
                    padding: spacing.lg,
                    gap: spacing.md,
                  },
                ]}>
                <View style={{ gap: 2 }}>
                  <Text style={[styles.sectionHeading, { color: colors.ink }]}>
                    Add to Friends Circle
                  </Text>
                  <Text style={[styles.sectionSub, { color: colors.inkMuted }]}>
                    Enter a friend’s @username, display name, or Friend Code
                  </Text>
                </View>

                {/* Relationship Selector */}
                <View style={styles.relSelectorRow}>
                  {(['bestie', 'friend'] as const).map((tier) => {
                    const active = friendRel === tier;
                    return (
                      <Pressable
                        key={tier}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={tier === 'bestie' ? 'Bestie tier' : 'Friend tier'}
                        onPress={() => {
                          triggerHaptic();
                          setFriendRel(tier);
                        }}
                        style={[
                          styles.relOptionPill,
                          {
                            backgroundColor: active ? colors.ink : colors.surfaceElevated,
                            borderColor: active ? colors.ink : colors.border,
                            borderRadius: radii.pill,
                          },
                        ]}>
                        <Text
                          style={[
                            styles.relOptionText,
                            { color: active ? colors.canvas : colors.ink },
                          ]}>
                          {tier === 'bestie' ? 'Bestie' : 'Friend'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.addFriendInputRow}>
                  <TextInput
                    accessibilityLabel="Friend @username, name, or Friend Code"
                    value={friendInput}
                    onChangeText={setFriendInput}
                    placeholder="@username, name, or Friend Code"
                    placeholderTextColor={colors.placeholder}
                    autoCapitalize="none"
                    returnKeyType="done"
                    onSubmitEditing={() => void handleAddFriend()}
                    style={[
                      styles.friendTextInput,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                        color: colors.ink,
                        borderRadius: radii.input,
                      },
                    ]}
                  />

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add Friend"
                    disabled={!friendInput.trim() || addingFriend}
                    onPress={() => void handleAddFriend()}
                    style={[
                      styles.addFriendSubmitBtn,
                      {
                        backgroundColor: bannerColor,
                        borderRadius: radii.input,
                        opacity: !friendInput.trim() || addingFriend ? 0.5 : 1,
                      },
                    ]}>
                    <Text style={styles.addFriendSubmitText}>
                      {addingFriend ? 'Adding…' : '+ Add'}
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Partner Pinned Card (only when paired with a real partner) */}
              {isPartnerPaired ? (
              <View
                style={[
                  styles.friendRowCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: bannerColor,
                    borderRadius: radii.card,
                    padding: spacing.lg,
                  },
                ]}>
                <View style={styles.friendTopRow}>
                  <View
                    style={[
                      styles.friendAvatarCircle,
                      { backgroundColor: partner?.banner_color ?? bannerColor },
                    ]}>
                    {partner?.avatar_path ? (
                      <Image
                        source={{ uri: partner.avatar_path }}
                        contentFit="cover"
                        style={styles.friendAvatarImg}
                      />
                    ) : (
                      <Text style={styles.friendAvatarLetter}>
                        {partnerName.slice(0, 1).toUpperCase()}
                      </Text>
                    )}
                  </View>

                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={styles.friendNameBadgeRow}>
                      <Text style={[styles.friendNameText, { color: colors.ink }]}>
                        {partnerName}
                      </Text>
                      <View
                        style={[
                          styles.tierBadge,
                          { backgroundColor: bannerColor, borderRadius: radii.pill },
                        ]}>
                        <Text style={styles.tierBadgeText}>Partner</Text>
                      </View>
                    </View>
                    <Text style={[styles.friendHandleText, { color: colors.inkMuted }]}>
                      @{partner?.username ?? buildDefaultUsername(partnerName, partner?.id ?? 'partner')}
                    </Text>
                    {partner?.bio ? (
                      <Text style={[styles.friendBioText, { color: colors.ink }]}>
                        {partner.bio}
                      </Text>
                    ) : (
                      <Text style={[styles.friendBioText, { color: colors.inkMuted }]}>
                        Paired with {partnerName} · Daily Moments & Live Map
                      </Text>
                    )}
                    {partner?.mood_song ? (
                      <Text style={[styles.friendSongText, { color: colors.inkMuted }]}>
                        Track: {partner.mood_song}
                      </Text>
                    ) : null}
                  </View>
                </View>

                <View style={styles.friendActionRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Message ${partnerName}`}
                    onPress={() => {
                      triggerHaptic();
                      router.navigate({
                        pathname: '/(tabs)/messages' as never,
                        params: {
                          peerId: partner?.id ?? 'partner_default',
                          peerName: partnerName,
                        },
                      } as never);
                    }}
                    style={[
                      styles.friendMsgBtn,
                      {
                        backgroundColor: colors.ink,
                        borderRadius: radii.pill,
                      },
                    ]}>
                    <Text style={[styles.friendMsgBtnText, { color: colors.canvas }]}>
                      Message
                    </Text>
                  </Pressable>
                </View>
              </View>
              ) : null}
              {/* Friends Circle List */}
              {!isPartnerPaired && friendsList.length === 0 ? (
                <View
                  style={[
                    styles.emptyFeedCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.group,
                      padding: spacing.xl,
                    },
                  ]}>
                  <Text style={[styles.emptyFeedTitle, { color: colors.ink }]}>
                    Your Friends Circle is empty
                  </Text>
                  <Text style={[styles.emptyFeedBody, { color: colors.inkMuted }]}>
                    Share your Friend Code ({friendCode}) or enter a friend’s @username or code above to add them.
                  </Text>
                </View>
              ) : null}
              {friendsList.map((fr) => {
                const fp = fr.friend_profile;
                const fName = fp.display_name;
                const fHandle = fp.username ?? buildDefaultUsername(fName, fr.friend_id);
                const fColor = colors.surfaceElevated;
                return (
                  <View
                    key={fr.id}
                    style={[
                      styles.friendRowCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderRadius: radii.card,
                        padding: spacing.lg,
                      },
                    ]}>
                    <View style={styles.friendTopRow}>
                      <View
                        style={[
                          styles.friendAvatarCircle,
                          { backgroundColor: fColor },
                        ]}>
                        {fp.avatar_path ? (
                          <Image
                            source={{ uri: fp.avatar_path }}
                            contentFit="cover"
                            style={styles.friendAvatarImg}
                          />
                        ) : (
                          <Text style={[styles.friendAvatarLetter, { color: colors.ink }]}>
                            {fName.slice(0, 1).toUpperCase()}
                          </Text>
                        )}
                      </View>

                      <View style={{ flex: 1, gap: 2 }}>
                        <View style={styles.friendNameBadgeRow}>
                          <Text style={[styles.friendNameText, { color: colors.ink }]}>
                            {fName}
                          </Text>
                          <View
                            style={[
                              styles.tierBadge,
                              {
                                backgroundColor: colors.surfaceElevated,
                                borderColor: colors.border,
                                borderWidth: 1,
                                borderRadius: radii.pill,
                              },
                            ]}>
                            <Text style={[styles.tierBadgeText, { color: colors.ink }]}>
                              {fr.relationship === 'bestie' ? 'Bestie' : 'Friend'}
                            </Text>
                          </View>
                        </View>

                        <Text style={[styles.friendHandleText, { color: colors.inkMuted }]}>
                          @{fHandle} {fp.friend_code ? `· ${fp.friend_code}` : ''}
                        </Text>

                        {fp.bio ? (
                          <Text style={[styles.friendBioText, { color: colors.ink }]}>
                            {fp.bio}
                          </Text>
                        ) : null}

                        {fp.mood_song ? (
                          <Text style={[styles.friendSongText, { color: colors.inkMuted }]}>
                            Track: {fp.mood_song}
                          </Text>
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.friendActionRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Message ${fName}`}
                        onPress={() => {
                          triggerHaptic();
                          router.navigate({
                            pathname: '/(tabs)/messages' as never,
                            params: {
                              peerId: fr.friend_id,
                              peerName: fName,
                            },
                          } as never);
                        }}
                        style={[
                          styles.friendMsgBtn,
                          {
                            backgroundColor: colors.ink,
                            borderRadius: radii.pill,
                          },
                        ]}>
                        <Text style={[styles.friendMsgBtnText, { color: colors.canvas }]}>
                          Message
                        </Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${fName} from friends`}
                        onPress={() => void handleRemoveFriend(fr.id, fName)}
                        style={[
                          styles.friendRemoveBtn,
                          {
                            backgroundColor: colors.dangerSoft,
                            borderColor: colors.danger,
                            borderRadius: radii.pill,
                          },
                        ]}>
                        <Text style={[styles.friendRemoveBtnText, { color: colors.danger }]}>
                          Remove
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Edit Profile Modal / Drawer */}
      <Modal
        visible={editModalOpen}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setEditModalOpen(false)}>
        <SafeAreaView style={[styles.modalSafe, { backgroundColor: colors.sheetSurface }]}>
          <View
            style={[
              styles.modalHeader,
              {
                borderBottomColor: colors.border,
                paddingHorizontal: spacing.xl,
                paddingVertical: spacing.md,
              },
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel editing profile"
              onPress={() => setEditModalOpen(false)}>
              <Text style={[styles.modalCancelText, { color: colors.inkMuted }]}>Cancel</Text>
            </Pressable>

            <Text style={[styles.modalTitle, { color: colors.ink }]}>Edit Social Profile</Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save profile changes"
              disabled={savingProfile}
              onPress={() => void handleSaveProfile()}>
              <Text style={[styles.modalSaveText, { color: colors.ink }]}>
                {savingProfile ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: spacing.xl,
              paddingTop: spacing.lg,
              paddingBottom: 60,
              gap: spacing.lg,
            }}>
            {editError ? <InlineNotice message={editError} tone="error" /> : null}

            {/* Banner Color Picker */}
            <View style={{ gap: spacing.xs }}>
              <Text style={[styles.fieldLabel, { color: colors.ink }]}>Banner Theme Color</Text>
              <View style={styles.swatchRow}>
                {BANNER_COLOR_SWATCHES.map((hex) => {
                  const selected = draftBannerColor.toUpperCase() === hex.toUpperCase();
                  return (
                    <Pressable
                      key={hex}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Banner color ${hex}`}
                      onPress={() => {
                        triggerHaptic();
                        setDraftBannerColor(hex);
                      }}
                      style={[
                        styles.colorSwatch,
                        {
                          backgroundColor: hex,
                          borderColor: selected ? colors.ink : 'transparent',
                        },
                      ]}>
                      {selected ? <Text style={styles.swatchCheck}>✓</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Avatar Presets + Custom URI */}
            <View style={{ gap: spacing.xs }}>
              <Text style={[styles.fieldLabel, { color: colors.ink }]}>
                Avatar Preset or Image URI
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.sm, paddingVertical: 4 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Use Monogram Avatar"
                  onPress={() => {
                    triggerHaptic();
                    setDraftAvatarUri('');
                  }}
                  style={[
                    styles.avatarPresetChip,
                    {
                      backgroundColor: !draftAvatarUri ? colors.ink : colors.surface,
                      borderColor: !draftAvatarUri ? colors.ink : colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.avatarPresetChipText,
                      { color: !draftAvatarUri ? colors.canvas : colors.ink },
                    ]}>
                    Monogram
                  </Text>
                </Pressable>

                {AVATAR_PRESETS.map((preset) => {
                  const selected = draftAvatarUri === preset.uri;
                  return (
                    <Pressable
                      key={preset.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Select avatar preset ${preset.label}`}
                      onPress={() => {
                        triggerHaptic();
                        setDraftAvatarUri(preset.uri);
                      }}
                      style={[
                        styles.avatarPresetChip,
                        {
                          backgroundColor: selected ? colors.ink : colors.surface,
                          borderColor: selected ? colors.ink : colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Image
                        source={{ uri: preset.uri }}
                        contentFit="cover"
                        style={styles.presetMiniAvatar}
                      />
                      <Text
                        style={[
                          styles.avatarPresetChipText,
                          { color: selected ? colors.canvas : colors.ink },
                        ]}>
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <TextInput
                accessibilityLabel="Custom Avatar Image URI"
                value={draftAvatarUri}
                onChangeText={setDraftAvatarUri}
                placeholder="Or paste custom image / data URI…"
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.ink,
                    borderRadius: radii.input,
                  },
                ]}
              />
            </View>

            {/* Display Name */}
            <View style={{ gap: spacing.xs }}>
              <Text style={[styles.fieldLabel, { color: colors.ink }]}>Display Name</Text>
              <TextInput
                accessibilityLabel="Display Name"
                value={draftName}
                onChangeText={setDraftName}
                maxLength={40}
                placeholder="Your display name"
                placeholderTextColor={colors.placeholder}
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.ink,
                    borderRadius: radii.input,
                  },
                ]}
              />
            </View>

            {/* @username */}
            <View style={{ gap: spacing.xs }}>
              <Text style={[styles.fieldLabel, { color: colors.ink }]}>@username Handle</Text>
              <TextInput
                accessibilityLabel="Username handle"
                value={draftUsername}
                onChangeText={setDraftUsername}
                maxLength={24}
                autoCapitalize="none"
                placeholder="username"
                placeholderTextColor={colors.placeholder}
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.ink,
                    borderRadius: radii.input,
                  },
                ]}
              />
            </View>

            {/* Bio */}
            <View style={{ gap: spacing.xs }}>
              <View style={styles.labelWithCounter}>
                <Text style={[styles.fieldLabel, { color: colors.ink }]}>Bio</Text>
                <Text style={[styles.counterText, { color: colors.inkMuted }]}>
                  {draftBio.length}/140
                </Text>
              </View>
              <TextInput
                accessibilityLabel="Profile bio"
                value={draftBio}
                onChangeText={setDraftBio}
                maxLength={140}
                multiline
                placeholder="Write a short bio (up to 140 chars)…"
                placeholderTextColor={colors.placeholder}
                style={[
                  styles.modalInput,
                  styles.bioTextarea,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.ink,
                    borderRadius: radii.input,
                  },
                ]}
              />
            </View>

            {/* Pronouns */}
            <View style={{ gap: spacing.xs }}>
              <Text style={[styles.fieldLabel, { color: colors.ink }]}>Pronouns</Text>
              <View style={styles.chipWrapRow}>
                {PRONOUN_PRESETS.map((p) => {
                  const selected = draftPronouns === p;
                  return (
                    <Pressable
                      key={p}
                      accessibilityRole="button"
                      accessibilityLabel={`Pronouns ${p}`}
                      onPress={() => {
                        triggerHaptic();
                        setDraftPronouns(selected ? '' : p);
                      }}
                      style={[
                        styles.presetSmallChip,
                        {
                          backgroundColor: selected ? colors.ink : colors.surface,
                          borderColor: selected ? colors.ink : colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.presetSmallChipText,
                          { color: selected ? colors.canvas : colors.ink },
                        ]}>
                        {p}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                accessibilityLabel="Custom Pronouns"
                value={draftPronouns}
                onChangeText={setDraftPronouns}
                maxLength={24}
                placeholder="she/her, he/him, they/them, or custom"
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.ink,
                    borderRadius: radii.input,
                  },
                ]}
              />
            </View>

            {/* Profile Mood Song */}
            <View style={{ gap: spacing.xs }}>
              <Text style={[styles.fieldLabel, { color: colors.ink }]}>
                Profile Mood Song
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.sm, paddingVertical: 4 }}>
                {CURATED_MUSIC_TRACKS.map((trk) => {
                  const label = `${trk.title} · ${trk.artist}`;
                  const selected = draftMoodSong === label || draftMoodSong === trk.title;
                  return (
                    <Pressable
                      key={trk.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Pick mood song ${label}`}
                      onPress={() => {
                        triggerHaptic();
                        setDraftMoodSong(label);
                      }}
                      style={[
                        styles.songPresetChip,
                        {
                          backgroundColor: selected ? colors.accent : colors.surface,
                          borderColor: selected ? colors.accent : colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.songPresetChipText,
                          { color: selected ? colors.onAccent : colors.ink },
                        ]}>
                        {trk.title} · {trk.artist}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <TextInput
                accessibilityLabel="Custom Mood Song"
                value={draftMoodSong}
                onChangeText={setDraftMoodSong}
                maxLength={60}
                placeholder="Pick a track above or type your current anthem…"
                placeholderTextColor={colors.placeholder}
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.ink,
                    borderRadius: radii.input,
                  },
                ]}
              />
            </View>

            {/* Website Link */}
            <View style={{ gap: spacing.xs }}>
              <Text style={[styles.fieldLabel, { color: colors.ink }]}>Website / Social Link</Text>
              <TextInput
                accessibilityLabel="Website link"
                value={draftWebsite}
                onChangeText={setDraftWebsite}
                maxLength={80}
                autoCapitalize="none"
                placeholder="keepit.social/you"
                placeholderTextColor={colors.placeholder}
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.ink,
                    borderRadius: radii.input,
                  },
                ]}
              />
            </View>

            {/* Private / Dump Account Settings in Modal */}
            <View
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: radii.card,
                padding: spacing.lg,
                gap: spacing.md,
              }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.fieldLabel, { color: colors.ink }]}>
                    Private Profile
                  </Text>
                  <Text style={{ color: colors.inkMuted, fontSize: 12 }}>
                    Require approval before anyone can see your posts or dump grid.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Private profile toggle"
                  value={draftIsPrivate}
                  onValueChange={setDraftIsPrivate}
                  trackColor={{ false: colors.border, true: colors.warning }}
                  thumbColor={colors.ink}
                />
              </View>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.fieldLabel, { color: colors.ink }]}>
                    Dump Account Badge
                  </Text>
                  <Text style={{ color: colors.inkMuted, fontSize: 12 }}>
                    Label this profile as your casual photo dump account (up to 5x/day).
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Dump account mode toggle"
                  value={draftDumpMode}
                  onValueChange={setDraftDumpMode}
                  trackColor={{ false: colors.border, true: colors.accent }}
                  thumbColor={colors.ink}
                />
              </View>
            </View>
            <KeepItButton
              label="Save Social Profile"
              loading={savingProfile}
              onPress={() => void handleSaveProfile()}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  bannerBlock: {
    height: 128,
    justifyContent: 'flex-start',
    paddingTop: 14,
  },
  bannerOverlayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandTagPill: {
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  brandTagText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  topQuickButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerQuickBtn: {
    minHeight: 44,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  bannerQuickBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  avatarHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: -42,
  },
  avatarOuterRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarMonogramCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarMonogramText: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
  },
  avatarEmojiBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmojiBadgeText: {
    fontSize: 13,
  },
  headerEditActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 4,
  },
  friendCodePill: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 9,
    gap: 6,
  },
  friendCodeLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  friendCodeValue: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  editProfilePill: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editProfilePillText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  nameAndPronounsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  displayNameText: {
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  pronounsPill: {
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  pronounsText: {
    fontSize: 12,
    fontWeight: '700',
  },
  handleText: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  bioText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    marginTop: 2,
  },
  badgesWrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  metaBadgePill: {
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  metaBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  statsBarCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  statPartnerValue: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.25,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  statDivider: {
    width: 1,
    height: 28,
  },
  subTabsTrack: {
    flexDirection: 'row',
    borderWidth: 1,
    padding: 4,
  },
  subTabBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subTabText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  postsHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  sectionSub: {
    fontSize: 12,
    fontWeight: '500',
  },
  newPostButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newPostButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  emptyFeedCard: {
    borderWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  emptyFeedTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  emptyFeedBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  addFriendCard: {
    borderWidth: 1,
  },
  relSelectorRow: {
    flexDirection: 'row',
    gap: 8,
  },
  relOptionPill: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  relOptionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  addFriendInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  friendTextInput: {
    flex: 1,
    borderWidth: 1,
    height: 44,
    paddingHorizontal: 13,
    fontSize: 14,
    fontWeight: '500',
  },
  addFriendSubmitBtn: {
    height: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFriendSubmitText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  friendRowCard: {
    borderWidth: 1,
    gap: 12,
  },
  friendTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  friendAvatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  friendAvatarImg: {
    width: 48,
    height: 48,
  },
  friendAvatarLetter: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  friendNameBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  friendNameText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  tierBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  tierBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  friendHandleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  friendBioText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    marginTop: 2,
  },
  friendSongText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  friendActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  friendMsgBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendMsgBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },
  friendRemoveBtn: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendRemoveBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  modalSafe: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  modalSaveText: {
    fontSize: 15,
    fontWeight: '800',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  labelWithCounter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counterText: {
    fontSize: 12,
    fontWeight: '600',
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  colorSwatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchCheck: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  avatarPresetChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
    gap: 7,
  },
  presetMiniAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  avatarPresetChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  modalInput: {
    borderWidth: 1,
    height: 44,
    paddingHorizontal: 14,
    fontSize: 14,
    fontWeight: '500',
  },
  bioTextarea: {
    height: 82,
    paddingTop: 11,
    textAlignVertical: 'top',
  },
  chipWrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 2,
  },
  presetSmallChip: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetSmallChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  songPresetChip: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  songPresetChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
