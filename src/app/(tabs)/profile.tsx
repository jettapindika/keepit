import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
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
import { AppPressable, AppSwitch as Switch, AppTextInput, ConfirmModal, PageHeader } from '@/components/ui/ScreenKit';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';
import { MomentRecord } from '@/types/database';
import { pickProfileImage } from '@/utils/imageUpload';

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
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

const AVATAR_PRESETS = [
  {
    id: 'sunset_cam',
    label: 'Sunset',
    uri: makeAvatarSvgDataUri('#D95D39', 'K', 'KEEPIT'),
  },
  {
    id: 'obsidian_dual',
    label: 'Obsidian',
    uri: makeAvatarSvgDataUri('#1C1C1E', 'II', 'DUAL'),
  },
  {
    id: 'slate_vinyl',
    label: 'Slate',
    uri: makeAvatarSvgDataUri('#282830', 'M', 'MOMENT'),
  },
  {
    id: 'graphite_film',
    label: '35mm',
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
  const [uploadingMedia, setUploadingMedia] = useState<'avatar' | 'banner' | null>(null);
  const copyTimerRef = useRef<number | undefined>(undefined);
  const feedbackTimerRef = useRef<number | undefined>(undefined);

  // Edit Profile Modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftUsername, setDraftUsername] = useState('');
  const [draftBio, setDraftBio] = useState('');
  const [draftPronouns, setDraftPronouns] = useState('');
  const [draftMoodSong, setDraftMoodSong] = useState('');
  const [draftBannerColor, setDraftBannerColor] = useState<string>('#1C1C1E');
  const [draftBannerUri, setDraftBannerUri] = useState('');
  const [draftWebsite, setDraftWebsite] = useState('');
  const [draftAvatarUri, setDraftAvatarUri] = useState('');
  const [draftIsPrivate, setDraftIsPrivate] = useState(false);
  const [draftDumpMode, setDraftDumpMode] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [editInitialSnapshot, setEditInitialSnapshot] = useState('');
  const [privateModeSaving, setPrivateModeSaving] = useState(false);
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Add Friend state
  const [friendInput, setFriendInput] = useState('');
  const [friendRel, setFriendRel] = useState<'bestie' | 'friend'>('bestie');
  const [addingFriend, setAddingFriend] = useState(false);
  const [pendingRemoveFriend, setPendingRemoveFriend] = useState<{
    friendRecordId: string;
    name: string;
  } | null>(null);
  const [removingFriend, setRemovingFriend] = useState(false);

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
  const username = user?.username || buildDefaultUsername(displayName, userId);
  const friendCode = user?.friend_code || buildFriendCode(userId, displayName);
  const bannerColor = user?.banner_color ?? '#1C1C1E';
  const bannerPath = user?.banner_path ?? null;
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
    try {
      await Clipboard.setStringAsync(friendCode);
      setCopiedCode(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedCode(false), 2000) as unknown as number;
    } catch {
      setProfileError('Could not copy the Friend Code. Try selecting it manually.');
    }
  };

  const handleTogglePrivacyQuick = () => {
    if (privateModeSaving) return;
    triggerHaptic();
    const nextVal = !isPrivateAccount;
    setPrivateModeSaving(true);
    void updateProfile({
      displayName,
      isPrivate: nextVal,
    })
      .then(() => {
        showTemporaryFeedback(
          nextVal ? 'Private Profile enabled.' : 'Profile is now visible to your circle.'
        );
      })
      .catch((err) => {
        setProfileError(err instanceof Error ? err.message : 'Could not update privacy settings.');
      })
      .finally(() => setPrivateModeSaving(false));
  };

  const handleDirectUpload = async (kind: 'avatar' | 'banner') => {
    if (uploadingMedia) return;
    triggerHaptic();
    setProfileError(null);
    setUploadingMedia(kind);
    try {
      const picked = await pickProfileImage(kind);
      if (!picked) return;
      if (kind === 'avatar') {
        await updateProfile({
          displayName,
          avatarPath: picked.uri,
        });
        showTemporaryFeedback('Profile photo updated.');
      } else {
        await updateProfile({
          displayName,
          bannerPath: picked.uri,
        });
        showTemporaryFeedback('Banner image updated.');
      }
    } catch (err) {
      setProfileError(
        err instanceof Error ? err.message : `Could not upload ${kind} image.`
      );
    } finally {
      setUploadingMedia(null);
    }
  };

  const handleModalUpload = async (kind: 'avatar' | 'banner') => {
    if (uploadingMedia) return;
    triggerHaptic();
    setEditError(null);
    setUploadingMedia(kind);
    try {
      const picked = await pickProfileImage(kind);
      if (!picked) return;
      if (kind === 'avatar') {
        setDraftAvatarUri(picked.uri);
      } else {
        setDraftBannerUri(picked.uri);
      }
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : `Could not select ${kind} image.`
      );
    } finally {
      setUploadingMedia(null);
    }
  };

  const openEditProfileModal = () => {
    triggerHaptic();
    setEditError(null);
    const initial = {
      name: user?.display_name ?? '',
      username,
      bio: user?.bio ?? '',
      pronouns: user?.pronouns ?? '',
      moodSong: user?.mood_song ?? '',
      bannerColor: user?.banner_color ?? '#1C1C1E',
      bannerUri: user?.banner_path ?? '',
      website: user?.website ?? '',
      avatarUri: user?.avatar_path ?? '',
      isPrivate: Boolean(user?.is_private),
      dumpMode: Boolean(user?.dump_mode),
    };
    setEditInitialSnapshot(JSON.stringify(initial));
    setDraftName(initial.name);
    setDraftUsername(initial.username);
    setDraftBio(initial.bio);
    setDraftPronouns(initial.pronouns);
    setDraftMoodSong(initial.moodSong);
    setDraftBannerColor(initial.bannerColor);
    setDraftBannerUri(initial.bannerUri);
    setDraftWebsite(initial.website);
    setDraftAvatarUri(initial.avatarUri);
    setDraftIsPrivate(initial.isPrivate);
    setDraftDumpMode(initial.dumpMode);
    setEditModalOpen(true);
  };

  const draftSnapshot = JSON.stringify({
    name: draftName,
    username: draftUsername,
    bio: draftBio,
    pronouns: draftPronouns,
    moodSong: draftMoodSong,
    bannerColor: draftBannerColor,
    bannerUri: draftBannerUri,
    website: draftWebsite,
    avatarUri: draftAvatarUri,
    isPrivate: draftIsPrivate,
    dumpMode: draftDumpMode,
  });
  const editDirty = Boolean(editInitialSnapshot && draftSnapshot !== editInitialSnapshot);

  const closeEditProfile = () => {
    if (savingProfile) return;
    if (!editDirty) {
      setEditModalOpen(false);
      return;
    }
    setEditConfirmOpen(true);
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !editModalOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || savingProfile) return;
      event.preventDefault();
      if (editDirty) setEditConfirmOpen(true);
      else setEditModalOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [editModalOpen, editDirty, savingProfile]);

  const discardEditProfile = () => {
    setEditConfirmOpen(false);
    setEditModalOpen(false);
  };

  const handleSaveProfile = async () => {
    if (savingProfile) return;
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
        bannerPath: draftBannerUri.trim() ? draftBannerUri.trim() : null,
        website: draftWebsite.trim(),
        avatarPath: draftAvatarUri.trim() ? draftAvatarUri.trim() : null,
        isPrivate: draftIsPrivate,
        dumpMode: draftDumpMode,
      });
      setEditModalOpen(false);
      showTemporaryFeedback('Profile changes saved.');
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

  const [pullRefreshing, setPullRefreshing] = useState(false);

  const handleRefreshPosts = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['user-posts'] }),
      queryClient.invalidateQueries({ queryKey: ['today-moment'] }),
      queryClient.invalidateQueries({ queryKey: ['month-memories'] }),
    ]);
  };

  const handlePullRefresh = async () => {
    if (pullRefreshing) return;
    setPullRefreshing(true);
    setProfileError(null);
    triggerHaptic();
    try {
      await Promise.all([
        useSessionStore.getState().refreshPairing(),
        requestRealtimeCatchUpSync({ userId, coupleId }),
      ]);
      const { promise: delayPromise, resolve: resolveDelay } = Promise.withResolvers<void>();
      setTimeout(resolveDelay, 200);
      await delayPromise;
      await Promise.all([
        bundleQuery.refetch(),
        userPostsQuery.refetch(),
        friendsQuery.refetch(),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  };
  const handleAddFriend = async () => {
    if (!friendInput.trim() || addingFriend) return;
    setProfileError(null);
    setAddingFriend(true);
    Keyboard.dismiss();
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

  const executeRemoveFriend = async () => {
    if (!pendingRemoveFriend || removingFriend) return;
    const { friendRecordId, name } = pendingRemoveFriend;
    setProfileError(null);
    setRemovingFriend(true);
    triggerHaptic();
    try {
      await removeFriend({ userId, friendRecordId });
      setPendingRemoveFriend(null);
      showTemporaryFeedback(`Removed ${name} from your Friends Circle.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['friends-list', userId] }),
        queryClient.invalidateQueries({ queryKey: ['today-moment'] }),
      ]);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Could not remove friend.');
    } finally {
      setRemovingFriend(false);
    }
  };

  const handleOpenWebsite = (rawUrl: string) => {
    const cleaned = rawUrl.trim();
    if (!cleaned) return;
    const target = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    void Linking.openURL(target).catch(() =>
      setProfileError('Could not open that link. Check the URL and try again.')
    );
  };

  const monogram = displayName.trim().slice(0, 1).toUpperCase() || 'K';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <View style={[styles.pageHeaderWrap, { paddingHorizontal: spacing.xl }]}>
        <PageHeader
          title="Profile"
          action={
            <View style={styles.headerActionGroup}>
              <AppPressable
                accessibilityRole="button"
                accessibilityLabel="Open settings"
                onPress={() => router.navigate('/(tabs)/settings')}
                style={[
                  styles.iconHeaderBtn,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.controlBorder,
                    borderRadius: radii.input,
                  },
                ]}>
                <SymbolView
                  name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
                  tintColor={colors.ink}
                  size={18}
                />
              </AppPressable>
            </View>
          }
        />
      </View>

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
        contentContainerStyle={{
          paddingBottom: keyboardVisible ? Math.max(20, insets.bottom) : 148,
          maxWidth: 640,
          width: '100%',
          alignSelf: 'center',
        }}>
        <View style={styles.contentWrap}>
          {/* Banner with Image Upload */}
          <RevealOnAppear revealKey="profile-banner">
            <View style={[styles.bannerBlock, { backgroundColor: bannerColor }]}>
              {bannerPath ? (
                <Image
                  source={{ uri: bannerPath }}
                  contentFit="cover"
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              <View style={[styles.bannerOverlayRow, { paddingHorizontal: spacing.xl }]}>
                <View style={styles.topQuickButtons}>
                  {bannerPath ? (
                    <AppPressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove banner image"
                      onPress={() => {
                        triggerHaptic();
                        void updateProfile({ displayName, bannerPath: null }).then(() =>
                          showTemporaryFeedback('Banner reset to solid color.')
                        );
                      }}
                      style={styles.bannerIconBtn}>
                      <SymbolView
                        name={{ ios: 'xmark', android: 'close', web: 'close' }}
                        tintColor="#FFFFFF"
                        size={16}
                      />
                    </AppPressable>
                  ) : null}
                  <AppPressable
                    accessibilityRole="button"
                    accessibilityLabel="Upload banner image"
                    disabled={uploadingMedia === 'banner'}
                    onPress={() => void handleDirectUpload('banner')}
                    style={styles.bannerIconBtn}>
                    <SymbolView
                      name={{ ios: 'photo.badge.plus', android: 'add_a_photo', web: 'add_a_photo' }}
                      tintColor="#FFFFFF"
                      size={17}
                    />
                  </AppPressable>
                </View>
              </View>
            </View>
          </RevealOnAppear>

          {/* Avatar + Identity Card */}
          <View style={{ paddingHorizontal: spacing.xl }}>
            <View style={styles.avatarHeaderRow}>
              <AppPressable
                accessibilityRole="button"
                accessibilityLabel="Upload profile photo"
                disabled={uploadingMedia === 'avatar'}
                onPress={() => void handleDirectUpload('avatar')}
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
                    styles.avatarCameraBadge,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.canvas,
                    },
                  ]}>
                  <SymbolView
                    name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
                    tintColor={colors.ink}
                    size={13}
                  />
                </View>
              </AppPressable>

              <View style={styles.headerEditActions}>
                <AppPressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: isPrivateAccount }}
                  accessibilityLabel={
                    isPrivateAccount
                      ? 'Private profile active. Tap to make visible to circle'
                      : 'Circle profile active. Tap to enable private profile'
                  }
                  disabled={privateModeSaving}
                  onPress={handleTogglePrivacyQuick}
                  style={[
                    styles.iconActionBtnWide,
                    {
                      backgroundColor: isPrivateAccount ? colors.accentSoft : colors.surface,
                      borderColor: isPrivateAccount ? colors.ink : colors.border,
                      borderRadius: radii.input,
                    },
                  ]}>
                  <SymbolView
                    name={
                      isPrivateAccount
                        ? { ios: 'lock.fill', android: 'lock', web: 'lock' }
                        : { ios: 'lock.open', android: 'lock_open', web: 'lock_open' }
                    }
                    tintColor={colors.ink}
                    size={16}
                  />
                  <Text style={[styles.iconActionText, { color: colors.ink }]}>
                    {isPrivateAccount ? 'Private' : 'Public'}
                  </Text>
                </AppPressable>

                <AppPressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit Profile"
                  onPress={openEditProfileModal}
                  style={[
                    styles.iconActionBtnWide,
                    {
                      backgroundColor: colors.ink,
                      borderColor: colors.ink,
                      borderRadius: radii.input,
                    },
                  ]}>
                  <SymbolView
                    name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                    tintColor={colors.canvas}
                    size={16}
                  />
                  <Text style={[styles.iconActionText, { color: colors.canvas }]}>Edit</Text>
                </AppPressable>
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
                      styles.statusIconBadge,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                        borderRadius: radii.pill,
                      },
                    ]}>
                    <SymbolView
                      name={{ ios: 'lock.fill', android: 'lock', web: 'lock' }}
                      tintColor={colors.inkMuted}
                      size={12}
                    />
                  </View>
                ) : null}
                {isDumpAccount ? (
                  <View
                    style={[
                      styles.statusIconBadge,
                      {
                        backgroundColor: colors.accentSoft,
                        borderColor: colors.border,
                        borderRadius: radii.pill,
                      },
                    ]}>
                    <SymbolView
                      name={{ ios: 'photo.stack', android: 'photo_library', web: 'photo_library' }}
                      tintColor={colors.ink}
                      size={12}
                    />
                  </View>
                ) : null}
              </View>

              <Text style={[styles.handleText, { color: colors.inkMuted }]}>@{username}</Text>

              {bio ? (
                <Text style={[styles.bioText, { color: colors.ink }]}>{bio}</Text>
              ) : null}

              {/* Compact Icon Badges Row: Mood Song + Website */}
              {moodSong || website ? (
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
                      <SymbolView
                        name={{ ios: 'music.note', android: 'music_note', web: 'music_note' }}
                        tintColor={colors.inkMuted}
                        size={13}
                      />
                      <Text numberOfLines={1} style={[styles.metaBadgeText, { color: colors.ink }]}>
                        {moodSong}
                      </Text>
                    </View>
                  ) : null}

                  {website ? (
                    <AppPressable
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
                      <SymbolView
                        name={{ ios: 'link', android: 'link', web: 'link' }}
                        tintColor={colors.inkMuted}
                        size={13}
                      />
                      <Text numberOfLines={1} style={[styles.metaBadgeText, { color: colors.ink }]}>
                        {website.replace(/^https?:\/\//i, '')}
                      </Text>
                    </AppPressable>
                  ) : null}
                </View>
              ) : null}
            </View>

            {/* Icon-First Social Stats Bar */}
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
                    paddingHorizontal: spacing.sm,
                  },
                ]}>
                <View
                  accessible
                  accessibilityLabel={`${myPosts.length} Posts`}
                  style={styles.statCol}>
                  <SymbolView
                    name={{ ios: 'square.grid.2x2', android: 'grid_view', web: 'grid_view' }}
                    tintColor={colors.inkMuted}
                    size={15}
                  />
                  <Text style={[styles.statValue, { color: colors.ink }]}>{myPosts.length}</Text>
                  <Text style={[styles.statLabel, { color: colors.inkMuted }]}>Posts</Text>
                </View>

                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />

                <View
                  accessible
                  accessibilityLabel={`${streakCount} day streak`}
                  style={styles.statCol}>
                  <SymbolView
                    name={{ ios: 'flame.fill', android: 'local_fire_department', web: 'local_fire_department' }}
                    tintColor={colors.inkMuted}
                    size={15}
                  />
                  <Text style={[styles.statValue, { color: colors.ink }]}>{streakCount}d</Text>
                  <Text style={[styles.statLabel, { color: colors.inkMuted }]}>Streak</Text>
                </View>

                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />

                <View
                  accessible
                  accessibilityLabel={`${friendsList.length + (isPartnerPaired ? 1 : 0)} Circle`}
                  style={styles.statCol}>
                  <SymbolView
                    name={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
                    tintColor={colors.inkMuted}
                    size={15}
                  />
                  <Text style={[styles.statValue, { color: colors.ink }]}>{friendsList.length + (isPartnerPaired ? 1 : 0)}</Text>
                  <Text style={[styles.statLabel, { color: colors.inkMuted }]}>Circle</Text>
                </View>

                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />

                <AppPressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    isPartnerPaired ? `Paired with ${partnerName}` : 'Pair with a Partner'
                  }
                  onPress={() => {
                    triggerHaptic();
                    router.navigate('/(auth)/pair');
                  }}
                  style={[styles.statCol, { flex: 1.25 }]}>
                  <SymbolView
                    name={
                      isPartnerPaired
                        ? { ios: 'heart.fill', android: 'favorite', web: 'favorite' }
                        : { ios: 'person.badge.plus', android: 'person_add', web: 'person_add' }
                    }
                    tintColor={isPartnerPaired ? colors.ink : colors.inkMuted}
                    size={15}
                  />
                  <Text
                    numberOfLines={1}
                    style={[styles.statPartnerValue, { color: colors.ink }]}>
                    {isPartnerPaired ? partnerName : 'Pair'}
                  </Text>
                </AppPressable>
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

            {/* Profile Sub-Tabs Switcher + Inline Action */}
            <View style={[styles.subTabsBarRow, { marginTop: spacing.lg }]}>
              <View
                style={[
                  styles.subTabsTrack,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.pill,
                  },
                ]}>
                <AppPressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: subTab === 'posts' }}
                  accessibilityLabel={`My Posts (${myPosts.length})`}
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
                  <SymbolView
                    name={{ ios: 'square.grid.2x2', android: 'grid_view', web: 'grid_view' }}
                    tintColor={subTab === 'posts' ? colors.canvas : colors.inkMuted}
                    size={16}
                  />
                  <Text
                    pointerEvents="none"
                    style={[
                      styles.subTabText,
                      { color: subTab === 'posts' ? colors.canvas : colors.inkMuted },
                    ]}>
                    Posts · {myPosts.length}
                  </Text>
                </AppPressable>

                <AppPressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: subTab === 'friends' }}
                  accessibilityLabel={`Friends Circle (${friendsList.length + (isPartnerPaired ? 1 : 0)})`}
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
                  <SymbolView
                    name={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
                    tintColor={subTab === 'friends' ? colors.canvas : colors.inkMuted}
                    size={16}
                  />
                  <Text
                    pointerEvents="none"
                    style={[
                      styles.subTabText,
                      { color: subTab === 'friends' ? colors.canvas : colors.inkMuted },
                    ]}>
                    Friends · {friendsList.length + (isPartnerPaired ? 1 : 0)}
                  </Text>
                </AppPressable>
              </View>

              {subTab === 'posts' ? (
                <AppPressable
                  accessibilityRole="button"
                  accessibilityLabel="Create New Moment Post"
                  onPress={handleOpenCameraNewPost}
                  style={[
                    styles.newPostIconBtn,
                    {
                      backgroundColor: colors.ink,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <SymbolView
                    name={{ ios: 'plus', android: 'add', web: 'add' }}
                    tintColor={colors.canvas}
                    size={17}
                  />
                </AppPressable>
              ) : null}
            </View>

            {/* SUB-TAB 1: MY POSTS (CRUD) */}
            {subTab === 'posts' ? (
              <View style={{ marginTop: spacing.md, gap: spacing.lg }}>
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
                    <SymbolView
                      name={{ ios: 'camera.aperture', android: 'photo_camera', web: 'photo_camera' }}
                      tintColor={colors.inkMuted}
                      size={28}
                    />
                    <Text style={[styles.emptyFeedTitle, { color: colors.ink }]}>
                      No Moments yet
                    </Text>
                    <KeepItButton
                      label="Capture Moment"
                      onPress={handleOpenCameraNewPost}
                      style={{ marginTop: spacing.xs }}
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
              <View style={{ marginTop: spacing.md, gap: spacing.md }}>
                <View
                  style={[
                    styles.addFriendCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                      padding: spacing.md,
                      gap: spacing.sm,
                    },
                  ]}>
                  <Text style={{ fontSize: 15, lineHeight: 22, color: colors.ink }}>
                    Your Friend Code
                  </Text>
                  <Text style={{ fontSize: 13, lineHeight: 20, color: colors.inkMuted }}>
                    Share this so someone can add you.
                  </Text>
                  <AppPressable
                    accessibilityRole="button"
                    accessibilityLabel={`Copy Friend Code ${friendCode}`}
                    onPress={() => void handleCopyFriendCode()}
                    style={[
                      styles.friendCodePill,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: copiedCode ? colors.success : colors.border,
                        borderRadius: radii.pill,
                      },
                    ]}>
                    <SymbolView
                      name={
                        copiedCode
                          ? { ios: 'checkmark', android: 'check', web: 'check' }
                          : { ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' }
                      }
                      tintColor={copiedCode ? colors.success : colors.inkMuted}
                      size={14}
                    />
                    <Text style={[styles.friendCodeValue, { color: colors.ink }]}>
                      {copiedCode ? 'Copied' : friendCode}
                    </Text>
                  </AppPressable>
                </View>
                {/* Compact Add Friend Bar */}
                <View
                  style={[
                    styles.addFriendCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                      padding: spacing.md,
                      gap: spacing.sm,
                    },
                  ]}>
                  <View style={styles.addFriendInputRow}>
                    <AppPressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        friendRel === 'bestie'
                          ? 'Tier: Bestie. Tap to switch to Friend'
                          : 'Tier: Friend. Tap to switch to Bestie'
                      }
                      onPress={() => {
                        triggerHaptic();
                        setFriendRel((prev) => (prev === 'bestie' ? 'friend' : 'bestie'));
                      }}
                      style={[
                        styles.tierToggleIconBtn,
                        {
                          backgroundColor:
                            friendRel === 'bestie' ? colors.ink : colors.surfaceElevated,
                          borderColor: friendRel === 'bestie' ? colors.ink : colors.border,
                          borderRadius: radii.input,
                        },
                      ]}>
                      <SymbolView
                        name={
                          friendRel === 'bestie'
                            ? { ios: 'heart.fill', android: 'favorite', web: 'favorite' }
                            : { ios: 'person.fill', android: 'person', web: 'person' }
                        }
                        tintColor={friendRel === 'bestie' ? colors.canvas : colors.ink}
                        size={16}
                      />
                      <Text
                        style={[
                          styles.iconActionText,
                          { color: friendRel === 'bestie' ? colors.canvas : colors.ink },
                        ]}>
                        {friendRel === 'bestie' ? 'Bestie' : 'Friend'}
                      </Text>
                    </AppPressable>

                    <AppTextInput
                      accessibilityLabel="Friend @username, name, or Friend Code"
                      value={friendInput}
                      onChangeText={(val) => {
                        if (profileError) setProfileError(null);
                        setFriendInput(val);
                      }}
                      placeholder="@username or code"
                      placeholderTextColor={colors.placeholder}
                      autoCapitalize="none"
                      autoCorrect={false}
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

                    <AppPressable
                      accessibilityRole="button"
                      accessibilityLabel="Add Friend"
                      disabled={!friendInput.trim() || addingFriend}
                      onPress={() => void handleAddFriend()}
                      style={[
                        styles.addFriendSubmitBtn,
                        {
                          backgroundColor: colors.ink,
                          borderRadius: radii.input,
                          opacity: !friendInput.trim() || addingFriend ? 0.45 : 1,
                        },
                      ]}>
                      <SymbolView
                        name={{ ios: 'person.badge.plus', android: 'person_add', web: 'person_add' }}
                        tintColor={colors.canvas}
                        size={18}
                      />
                    </AppPressable>
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
                        padding: spacing.md,
                      },
                    ]}>
                    <View style={styles.friendCompactRow}>
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

                      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                        <View style={styles.friendNameBadgeRow}>
                          <Text numberOfLines={1} style={[styles.friendNameText, { color: colors.ink }]}>
                            {partnerName}
                          </Text>
                          <SymbolView
                            name={{ ios: 'heart.fill', android: 'favorite', web: 'favorite' }}
                            tintColor={colors.ink}
                            size={13}
                          />
                        </View>
                        <Text numberOfLines={1} style={[styles.friendHandleText, { color: colors.inkMuted }]}>
                          @{partner?.username ?? buildDefaultUsername(partnerName, partner?.id ?? 'partner')}
                        </Text>
                      </View>

                      <AppPressable
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
                          styles.friendIconBtn,
                          {
                            backgroundColor: colors.ink,
                            borderRadius: radii.pill,
                          },
                        ]}>
                        <SymbolView
                          name={{ ios: 'bubble.left.fill', android: 'chat_bubble', web: 'chat_bubble' }}
                          tintColor={colors.canvas}
                          size={16}
                        />
                      </AppPressable>
                    </View>
                  </View>
                ) : null}

                {/* Friends Circle List */}
                {friendsQuery.isLoading && friendsList.length === 0 ? (
                  <SkeletonBlock height={120} label="Loading Friends Circle..." />
                ) : !isPartnerPaired && friendsList.length === 0 ? (
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
                    <SymbolView
                      name={{ ios: 'person.2', android: 'group', web: 'group' }}
                      tintColor={colors.inkMuted}
                      size={28}
                    />
                    <Text style={[styles.emptyFeedTitle, { color: colors.ink }]}>
                      Circle is empty
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
                          padding: spacing.md,
                        },
                      ]}>
                      <View style={styles.friendCompactRow}>
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

                        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                          <View style={styles.friendNameBadgeRow}>
                            <Text numberOfLines={1} style={[styles.friendNameText, { color: colors.ink }]}>
                              {fName}
                            </Text>
                            <SymbolView
                              name={
                                fr.relationship === 'bestie'
                                  ? { ios: 'heart.fill', android: 'favorite', web: 'favorite' }
                                  : { ios: 'person.fill', android: 'person', web: 'person' }
                              }
                              tintColor={colors.inkMuted}
                              size={12}
                            />
                          </View>

                          <Text numberOfLines={1} style={[styles.friendHandleText, { color: colors.inkMuted }]}>
                            @{fHandle}
                          </Text>
                        </View>

                        <View style={styles.friendCompactActions}>
                          <AppPressable
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
                              styles.friendIconBtn,
                              {
                                backgroundColor: colors.ink,
                                borderRadius: radii.pill,
                              },
                            ]}>
                            <SymbolView
                              name={{ ios: 'bubble.left.fill', android: 'chat_bubble', web: 'chat_bubble' }}
                              tintColor={colors.canvas}
                              size={16}
                            />
                          </AppPressable>

                          <AppPressable
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${fName} from friends`}
                            onPress={() => setPendingRemoveFriend({ friendRecordId: fr.id, name: fName })}
                            style={[
                              styles.friendIconBtn,
                              {
                                backgroundColor: colors.dangerSoft,
                                borderColor: colors.danger,
                                borderWidth: 1,
                                borderRadius: radii.pill,
                              },
                            ]}>
                            <SymbolView
                              name={{ ios: 'person.badge.minus', android: 'person_remove', web: 'person_remove' }}
                              tintColor={colors.danger}
                              size={16}
                            />
                          </AppPressable>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Edit Profile Modal / Drawer */}
      <Modal
        visible={editModalOpen}
        animationType="slide"
        transparent
        onRequestClose={closeEditProfile}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={insets.top}>
          <SafeAreaView
            style={[
              styles.modalSheet,
              { backgroundColor: colors.sheetSurface, borderColor: colors.controlBorder },
            ]}>
            <View
              style={[
                styles.modalHeader,
                {
                  borderBottomColor: colors.border,
                  paddingHorizontal: spacing.xl,
                  paddingVertical: spacing.md,
                },
              ]}>
              <AppPressable
                accessibilityRole="button"
                accessibilityLabel="Cancel editing profile"
                disabled={savingProfile}
                onPress={closeEditProfile}
                style={styles.modalHeaderIconBtn}>
                <SymbolView
                  name={{ ios: 'xmark', android: 'close', web: 'close' }}
                  tintColor={colors.inkMuted}
                  size={18}
                />
              </AppPressable>

              <Text numberOfLines={1} style={[styles.modalTitle, { color: colors.ink }]}>
                Edit Profile
              </Text>

              <AppPressable
                accessibilityRole="button"
                accessibilityLabel="Save profile changes"
                disabled={savingProfile}
                onPress={() => void handleSaveProfile()}
                style={styles.modalHeaderIconBtn}>
                <SymbolView
                  name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                  tintColor={colors.ink}
                  size={20}
                />
              </AppPressable>
            </View>

            {editConfirmOpen ? (
              <View
                style={[
                  styles.editConfirm,
                  { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
                ]}>
                <Text style={{ color: colors.ink, fontSize: 14, lineHeight: 20 }}>
                  Discard unsaved changes?
                </Text>
                <View style={styles.editConfirmActions}>
                  <AppPressable
                    accessibilityRole="button"
                    accessibilityLabel="Keep editing profile"
                    onPress={() => setEditConfirmOpen(false)}
                    style={[
                      styles.confirmButton,
                      { borderColor: colors.controlBorder, backgroundColor: colors.surface },
                    ]}>
                    <Text style={{ color: colors.ink, fontWeight: '700' }}>Keep</Text>
                  </AppPressable>
                  <AppPressable
                    accessibilityRole="button"
                    accessibilityLabel="Discard profile changes"
                    onPress={discardEditProfile}
                    style={[
                      styles.confirmButton,
                      { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
                    ]}>
                    <Text style={{ color: colors.danger, fontWeight: '700' }}>Discard</Text>
                  </AppPressable>
                </View>
              </View>
            ) : null}

            <ScrollView
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              style={{ flexShrink: 1 }}
              contentContainerStyle={{
                paddingHorizontal: spacing.xl,
                paddingTop: spacing.lg,
                paddingBottom: Math.max(32, insets.bottom),
                gap: spacing.lg,
              }}>
              {editError ? <InlineNotice message={editError} tone="error" /> : null}

              {/* Visual Banner & Avatar Upload Preview Card */}
              <View style={{ gap: spacing.sm }}>
                <View
                  style={[
                    styles.modalBannerPreview,
                    {
                      backgroundColor: draftBannerColor,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}>
                  {draftBannerUri ? (
                    <Image
                      source={{ uri: draftBannerUri }}
                      contentFit="cover"
                      style={StyleSheet.absoluteFill}
                    />
                  ) : null}
                  <View style={styles.modalBannerActions}>
                    {draftBannerUri ? (
                      <AppPressable
                        accessibilityRole="button"
                        accessibilityLabel="Clear custom banner image"
                        onPress={() => {
                          triggerHaptic();
                          setDraftBannerUri('');
                        }}
                        style={styles.bannerIconBtn}>
                        <SymbolView
                          name={{ ios: 'trash', android: 'delete', web: 'delete' }}
                          tintColor="#FFFFFF"
                          size={15}
                        />
                      </AppPressable>
                    ) : null}
                    <AppPressable
                      accessibilityRole="button"
                      accessibilityLabel="Upload banner image from device"
                      disabled={uploadingMedia === 'banner'}
                      onPress={() => void handleModalUpload('banner')}
                      style={styles.bannerUploadPill}>
                      <SymbolView
                        name={{ ios: 'photo.badge.plus', android: 'add_a_photo', web: 'add_a_photo' }}
                        tintColor="#FFFFFF"
                        size={15}
                      />
                      <Text style={styles.bannerUploadPillText}>
                        {uploadingMedia === 'banner' ? 'Uploading…' : 'Banner'}
                      </Text>
                    </AppPressable>
                  </View>
                </View>

                <View style={styles.modalAvatarAndSwatchesRow}>
                  <AppPressable
                    accessibilityRole="button"
                    accessibilityLabel="Upload profile photo from device"
                    disabled={uploadingMedia === 'avatar'}
                    onPress={() => void handleModalUpload('avatar')}
                    style={[
                      styles.modalAvatarPreviewRing,
                      {
                        backgroundColor: colors.sheetSurface,
                        borderColor: colors.sheetSurface,
                      },
                    ]}>
                    {draftAvatarUri ? (
                      <Image
                        source={{ uri: draftAvatarUri }}
                        contentFit="cover"
                        style={styles.modalAvatarImg}
                      />
                    ) : (
                      <View
                        style={[
                          styles.modalAvatarImg,
                          {
                            backgroundColor: draftBannerColor,
                            alignItems: 'center',
                            justifyContent: 'center',
                          },
                        ]}>
                        <Text style={styles.avatarMonogramText}>{monogram}</Text>
                      </View>
                    )}
                    <View
                      style={[
                        styles.avatarCameraBadge,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.sheetSurface,
                        },
                      ]}>
                      <SymbolView
                        name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
                        tintColor={colors.ink}
                        size={12}
                      />
                    </View>
                  </AppPressable>

                  {/* Banner Color Swatches */}
                  <View style={styles.swatchRow}>
                    {BANNER_COLOR_SWATCHES.map((hex) => {
                      const selected = draftBannerColor.toUpperCase() === hex.toUpperCase();
                      return (
                        <AppPressable
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
                          {selected ? (
                            <SymbolView
                              name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                              tintColor="#FFFFFF"
                              size={14}
                            />
                          ) : null}
                        </AppPressable>
                      );
                    })}
                  </View>
                </View>

                {/* Avatar Quick Presets + Upload Chip */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}>
                  <AppPressable
                    accessibilityRole="button"
                    accessibilityLabel="Upload custom avatar image"
                    onPress={() => void handleModalUpload('avatar')}
                    style={[
                      styles.avatarPresetChip,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.controlBorder,
                        borderRadius: radii.pill,
                      },
                    ]}>
                    <SymbolView
                      name={{ ios: 'arrow.up.circle.fill', android: 'file_upload', web: 'file_upload' }}
                      tintColor={colors.ink}
                      size={15}
                    />
                    <Text style={[styles.avatarPresetChipText, { color: colors.ink }]}>
                      Upload
                    </Text>
                  </AppPressable>

                  <AppPressable
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
                  </AppPressable>

                  {AVATAR_PRESETS.map((preset) => {
                    const selected = draftAvatarUri === preset.uri;
                    return (
                      <AppPressable
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
                      </AppPressable>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Identity Inputs with Icons */}
              <View style={{ gap: spacing.sm }}>
                <View style={styles.iconInputRow}>
                  <View style={[styles.inputLeadIcon, { backgroundColor: colors.surface }]}>
                    <SymbolView
                      name={{ ios: 'person.fill', android: 'person', web: 'person' }}
                      tintColor={colors.inkMuted}
                      size={16}
                    />
                  </View>
                  <AppTextInput
                    accessibilityLabel="Display Name"
                    value={draftName}
                    onChangeText={setDraftName}
                    maxLength={40}
                    placeholder="Display name"
                    placeholderTextColor={colors.placeholder}
                    style={[
                      styles.modalInput,
                      {
                        flex: 1,
                        backgroundColor: colors.surface,
                        borderColor: colors.controlBorder,
                        color: colors.ink,
                        borderRadius: radii.input,
                      },
                    ]}
                  />
                </View>

                <View style={styles.iconInputRow}>
                  <View style={[styles.inputLeadIcon, { backgroundColor: colors.surface }]}>
                    <SymbolView
                      name={{ ios: 'at', android: 'alternate_email', web: 'alternate_email' }}
                      tintColor={colors.inkMuted}
                      size={16}
                    />
                  </View>
                  <AppTextInput
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
                        flex: 1,
                        backgroundColor: colors.surface,
                        borderColor: colors.controlBorder,
                        color: colors.ink,
                        borderRadius: radii.input,
                      },
                    ]}
                  />
                </View>

                {/* Bio */}
                <View style={{ gap: 4 }}>
                  <AppTextInput
                    accessibilityLabel="Profile bio"
                    value={draftBio}
                    onChangeText={setDraftBio}
                    maxLength={140}
                    multiline
                    placeholder="Bio"
                    placeholderTextColor={colors.placeholder}
                    style={[
                      styles.modalInput,
                      styles.bioTextarea,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.controlBorder,
                        color: colors.ink,
                        borderRadius: radii.input,
                      },
                    ]}
                  />
                  <Text style={[styles.counterText, { color: colors.inkMuted, alignSelf: 'flex-end' }]}>
                    {draftBio.length}/140
                  </Text>
                </View>

                {/* Pronouns */}
                <View style={styles.chipWrapRow}>
                  {PRONOUN_PRESETS.map((p) => {
                    const selected = draftPronouns === p;
                    return (
                      <AppPressable
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
                      </AppPressable>
                    );
                  })}
                </View>

                {/* Mood Song */}
                <View style={{ gap: 6 }}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}>
                    {CURATED_MUSIC_TRACKS.map((trk) => {
                      const label = `${trk.title} · ${trk.artist}`;
                      const selected = draftMoodSong === label || draftMoodSong === trk.title;
                      return (
                        <AppPressable
                          key={trk.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Pick mood song ${label}`}
                          onPress={() => {
                            triggerHaptic();
                            setDraftMoodSong(selected ? '' : label);
                          }}
                          style={[
                            styles.songPresetChip,
                            {
                              backgroundColor: selected ? colors.accent : colors.surface,
                              borderColor: selected ? colors.accent : colors.border,
                              borderRadius: radii.pill,
                            },
                          ]}>
                          <SymbolView
                            name={{ ios: 'music.note', android: 'music_note', web: 'music_note' }}
                            tintColor={selected ? colors.onAccent : colors.inkMuted}
                            size={13}
                          />
                          <Text
                            style={[
                              styles.songPresetChipText,
                              { color: selected ? colors.onAccent : colors.ink },
                            ]}>
                            {trk.title}
                          </Text>
                        </AppPressable>
                      );
                    })}
                  </ScrollView>

                  <View style={styles.iconInputRow}>
                    <View style={[styles.inputLeadIcon, { backgroundColor: colors.surface }]}>
                      <SymbolView
                        name={{ ios: 'music.note', android: 'music_note', web: 'music_note' }}
                        tintColor={colors.inkMuted}
                        size={16}
                      />
                    </View>
                    <AppTextInput
                      accessibilityLabel="Custom Mood Song"
                      value={draftMoodSong}
                      onChangeText={setDraftMoodSong}
                      maxLength={60}
                      placeholder="Mood track"
                      placeholderTextColor={colors.placeholder}
                      style={[
                        styles.modalInput,
                        {
                          flex: 1,
                          backgroundColor: colors.surface,
                          borderColor: colors.controlBorder,
                          color: colors.ink,
                          borderRadius: radii.input,
                        },
                      ]}
                    />
                  </View>
                </View>

                {/* Website Link */}
                <View style={styles.iconInputRow}>
                  <View style={[styles.inputLeadIcon, { backgroundColor: colors.surface }]}>
                    <SymbolView
                      name={{ ios: 'link', android: 'link', web: 'link' }}
                      tintColor={colors.inkMuted}
                      size={16}
                    />
                  </View>
                  <AppTextInput
                    accessibilityLabel="Website link"
                    value={draftWebsite}
                    onChangeText={setDraftWebsite}
                    maxLength={80}
                    autoCapitalize="none"
                    placeholder="Website link"
                    placeholderTextColor={colors.placeholder}
                    style={[
                      styles.modalInput,
                      {
                        flex: 1,
                        backgroundColor: colors.surface,
                        borderColor: colors.controlBorder,
                        color: colors.ink,
                        borderRadius: radii.input,
                      },
                    ]}
                  />
                </View>
              </View>

              {/* Clean Icon-Only Toggles in Modal */}
              <View
                style={{
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderWidth: 1,
                  borderRadius: radii.card,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md,
                  gap: spacing.md,
                }}>
                <View style={styles.toggleRow}>
                  <View style={styles.toggleLabelWrap}>
                    <SymbolView
                      name={{ ios: 'lock.fill', android: 'lock', web: 'lock' }}
                      tintColor={colors.ink}
                      size={16}
                    />
                    <Text style={[styles.fieldLabel, { color: colors.ink }]}>Private Profile</Text>
                  </View>
                  <Switch
                    accessibilityLabel="Private profile toggle"
                    value={draftIsPrivate}
                    onValueChange={setDraftIsPrivate}
                  />
                </View>

                <View style={styles.toggleRow}>
                  <View style={styles.toggleLabelWrap}>
                    <SymbolView
                      name={{ ios: 'photo.stack', android: 'photo_library', web: 'photo_library' }}
                      tintColor={colors.ink}
                      size={16}
                    />
                    <Text style={[styles.fieldLabel, { color: colors.ink }]}>Dump Mode</Text>
                  </View>
                  <Switch
                    accessibilityLabel="Dump account mode toggle"
                    value={draftDumpMode}
                    onValueChange={setDraftDumpMode}
                  />
                </View>
              </View>

              <KeepItButton
                label="Save Profile"
                loading={savingProfile}
                onPress={() => void handleSaveProfile()}
              />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
      <ConfirmModal
        visible={pendingRemoveFriend !== null}
        title={pendingRemoveFriend ? `Remove ${pendingRemoveFriend.name}?` : 'Remove friend?'}
        message="This removes the friend from your circle."
        confirmLabel="Remove"
        loadingLabel="Removing…"
        loading={removingFriend}
        onCancel={() => setPendingRemoveFriend(null)}
        onConfirm={() => void executeRemoveFriend()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pageHeaderWrap: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingTop: 8,
    paddingBottom: 8,
  },
  contentWrap: {
    width: '100%',
  },
  headerActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconHeaderBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  editConfirm: {
    marginHorizontal: 20,
    marginTop: 12,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
  },
  editConfirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  confirmButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
  },
  modalSheet: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '94%',
    height: '94%',
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 22,
    overflow: 'hidden',
  },
  safe: {
    flex: 1,
  },
  bannerBlock: {
    height: 136,
    justifyContent: 'flex-end',
    paddingBottom: 12,
    overflow: 'hidden',
  },
  bannerOverlayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  topQuickButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerIconBtn: {
    width: 44,
    height: 44,
    backgroundColor: 'rgba(0, 0, 0, 0.48)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  bannerUploadPill: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.56)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  bannerUploadPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
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
    fontSize: 32,
    fontWeight: '800',
  },
  avatarCameraBadge: {
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
  headerEditActions: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingBottom: 4,
    minWidth: 0,
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
  friendCodeValue: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  iconActionBtn: {
    width: 44,
    height: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconActionBtnWide: {
    minWidth: 44,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  iconActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  nameAndPronounsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  displayNameText: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '600',
    letterSpacing: -0.3,
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
  statusIconBadge: {
    width: 26,
    height: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 6,
    maxWidth: '100%',
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
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minHeight: 44,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  statPartnerValue: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.25,
  },
  statDivider: {
    width: 1,
    height: 22,
  },
  subTabsBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  subTabsTrack: {
    flex: 1,
    flexDirection: 'row',
    borderWidth: 1,
    padding: 4,
  },
  subTabBtn: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subTabText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  newPostIconBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyFeedCard: {
    borderWidth: 1,
    alignItems: 'center',
    gap: 10,
  },
  emptyFeedTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  addFriendCard: {
    borderWidth: 1,
  },
  tierToggleIconBtn: {
    minWidth: 44,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderCurve: 'continuous',
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
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendRowCard: {
    borderWidth: 1,
  },
  friendCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  friendAvatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  friendAvatarImg: {
    width: 44,
    height: 44,
  },
  friendAvatarLetter: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  friendNameBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  friendNameText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  friendHandleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  friendCompactActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  friendIconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  modalHeaderIconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  modalBannerPreview: {
    height: 112,
    borderWidth: 1,
    justifyContent: 'flex-end',
    padding: 10,
    overflow: 'hidden',
  },
  modalBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  modalAvatarAndSwatchesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -36,
    paddingHorizontal: 10,
  },
  modalAvatarPreviewRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalAvatarImg: {
    width: 68,
    height: 68,
    borderRadius: 34,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  counterText: {
    fontSize: 11,
    fontWeight: '600',
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 28,
  },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPresetChip: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  presetMiniAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  avatarPresetChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  iconInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputLeadIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalInput: {
    borderWidth: 1,
    height: 44,
    paddingHorizontal: 14,
    fontSize: 14,
    fontWeight: '500',
  },
  bioTextarea: {
    height: 76,
    paddingTop: 11,
    textAlignVertical: 'top',
  },
  chipWrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetSmallChip: {
    minHeight: 40,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetSmallChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  songPresetChip: {
    minHeight: 40,
    flexDirection: 'row',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  songPresetChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toggleLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
