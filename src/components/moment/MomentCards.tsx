import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import {
  addMomentComment,
  deleteMomentComment,
  deleteMomentPost,
  formatLateDuration,
  getSnapOnceRemainingSeconds,
  isSnapOnceExpiredForViewer,
  isMomentPromptCheckIn,
  markSnapOnceMomentState,
  toggleMomentReaction,
  updateMomentDetails,
} from '@/api/moments';
import {
  CURATED_MUSIC_TRACKS,
  fetchFriendsCircle,
  getFilterPresetMeta,
  MOMENT_FILTER_PRESETS,
  QUICK_LOCATION_PRESETS,
} from '@/api/social';
import { DualFrameMark, InlineNotice, KeepItButton, KeepItWatermarkLogo } from '@/components/ui/Primitives';
import { AppPressable as Pressable, AppSwitch as Switch, AppTextInput as TextInput, SectionHeader } from '@/components/ui/ScreenKit';
import { useSessionStore } from '@/store/sessionStore';
import { useAppMotion } from '@/hooks/useAppMotion';
import { MOCHY_SPRINGS } from '@/theme/motion';
import { useKeepItTheme } from '@/theme/tokens';
import {
  MomentCommentRecord,
  MomentFilterPreset,
  MomentMediaType,
  MomentRecord,
  MusicTrackAttachment,
  PartnerMomentView,
  PhotoOverlayItem,
  TaggedPerson,
} from '@/types/database';
import {
  getActiveMusicPreviewTrackId,
  stopMusicPreview,
  subscribeMusicPreviewState,
  toggleMusicTrackPreview,
} from '@/utils/audioPreview';
import {
  buildMomentCompositeSvgDataUri,
  exportAndShareCompositeMoment,
  formatMomentWatermarkTimestamp,
  STORY_THEME_PRESETS,
  StoryThemePreset,
} from '@/utils/momentExport';

const QUICK_REACTION_EMOJIS = ['❤️', '🔥', '🥹', '😂', '👏'] as const;
const OVERLAY_STICKER_EMOJIS = ['❤️‍🔥', '✨', '🥹', '☕️', '🫶', '🔥', '🌙', '🎧'] as const;

const REACTION_SYMBOL_MAP: Record<
  string,
  { ios: string; android: string; web: string; label: string }
> = {
  '❤️': { ios: 'heart.fill', android: 'favorite', web: 'favorite', label: 'Love' },
  '🔥': {
    ios: 'flame.fill',
    android: 'local_fire_department',
    web: 'local_fire_department',
    label: 'Fire',
  },
  '🥹': { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome', label: 'Touched' },
  '😂': {
    ios: 'face.smiling',
    android: 'sentiment_satisfied',
    web: 'sentiment_satisfied',
    label: 'Laugh',
  },
  '👏': { ios: 'Hands.clap.fill', android: 'celebration', web: 'celebration', label: 'Applause' },
};

function ReactionGlyph({
  emoji,
  size = 18,
  tintColor,
}: {
  emoji: string;
  size?: number;
  tintColor: string;
}) {
  const spec = REACTION_SYMBOL_MAP[emoji];
  if (!spec) {
    return <Text style={{ fontSize: size, color: tintColor }}>{emoji}</Text>;
  }
  return (
    <SymbolView
      name={{ ios: spec.ios as never, android: spec.android as never, web: spec.web as never }}
      tintColor={tintColor}
      size={size}
    />
  );
}

export interface DualMomentCardProps {
  authorName?: string;
  backPhotoUrl?: string | null;
  frontPhotoUrl?: string | null;
  blurhash?: string;
  caption?: string | null;
  postedAtIso?: string;
  lateBySeconds?: number;
  isLate?: boolean;
  retakeCount?: number;
  editableCaption?: boolean;
  onSaveCaption?: (nextCaption: string) => Promise<void>;
  canRetake?: boolean;
  onRetake?: () => void;
  moment?: MomentRecord | PartnerMomentView;
  currentUserId?: string;
  coupleId?: string;
  isOwner?: boolean;
  onUpdated?: (updated?: MomentRecord) => void | Promise<void>;
  onDeleted?: (momentId?: string) => void | Promise<void>;
}

export function DualMomentCard({
  authorName: propAuthorName,
  backPhotoUrl,
  frontPhotoUrl,
  caption: propCaption,
  postedAtIso: propPostedAtIso,
  lateBySeconds: propLateBySeconds,
  isLate: _propIsLate,
  retakeCount: propRetakeCount,
  editableCaption = false,
  onSaveCaption,
  canRetake = false,
  onRetake,
  moment,
  currentUserId: propCurrentUserId,
  coupleId: propCoupleId,
  isOwner: propIsOwner,
  onUpdated,
  onDeleted,
}: DualMomentCardProps) {
  const { colors, radii, spacing } = useKeepItTheme();
  const sessionUser = useSessionStore((s) => s.user);
  const sessionCouple = useSessionStore((s) => s.couple);
  const { enabled: motionEnabled, speed: motionSpeed } = useAppMotion();

  const effectiveUserId = propCurrentUserId ?? sessionUser?.id ?? 'local_user';
  const effectiveCoupleId =
    propCoupleId ??
    (moment && 'couple_id' in moment ? moment.couple_id : undefined) ??
    sessionCouple?.id ??
    'local_couple';
  const authorName = propAuthorName ?? moment?.author_name ?? 'Partner';
  const ownerFlag =
    propIsOwner ??
    editableCaption ??
    Boolean(moment?.user_id && moment.user_id === effectiveUserId);

  const sessionPartner = useSessionStore((s) => s.partner);
  const overlaySeqRef = useRef(0);

  // Local optimistic overrides keyed to moment revision so prop updates sync without setState-in-effect
  const momentRevisionKey = [
    moment?.id ?? 'standalone',
    propCaption ?? moment?.caption ?? '',
    moment?.filter_preset ?? 'normal',
    moment?.location_label ?? '',
    moment?.music_track?.id ?? '',
    String(moment?.overlays?.length ?? 0),
    String(Boolean(moment?.snap_once)),
    JSON.stringify(moment?.reactions ?? {}),
    String(moment?.comments?.length ?? 0),
    String(moment?.tagged_users?.length ?? 0),
  ].join('|');

  const [optimisticRev, setOptimisticRev] = useState(momentRevisionKey);
  const [optCaption, setOptCaption] = useState<string | null | undefined>(undefined);
  const [optFilter, setOptFilter] = useState<MomentFilterPreset | undefined>(undefined);
  const [optLocation, setOptLocation] = useState<string | null | undefined>(undefined);
  const [optMusic, setOptMusic] = useState<MusicTrackAttachment | null | undefined>(undefined);
  const [optOverlays, setOptOverlays] = useState<PhotoOverlayItem[] | undefined>(undefined);
  const [optTaggedUsers, setOptTaggedUsers] = useState<TaggedPerson[] | undefined>(undefined);
  const [optSnapOnce, setOptSnapOnce] = useState<boolean | undefined>(undefined);
  const [optReactions, setOptReactions] = useState<Record<string, string> | undefined>(undefined);
  const [optComments, setOptComments] = useState<MomentCommentRecord[] | undefined>(undefined);

  const useOpt = optimisticRev === momentRevisionKey;

  const localCaption: string | null = useOpt && optCaption !== undefined
    ? optCaption
    : (propCaption !== undefined ? propCaption : (moment?.caption ?? null));
  const localFilterPreset: MomentFilterPreset = useOpt && optFilter !== undefined
    ? optFilter
    : (moment?.filter_preset ?? 'normal');
  const localLocationLabel: string | null = useOpt && optLocation !== undefined
    ? optLocation
    : (moment?.location_label ?? null);
  const localMusicTrack: MusicTrackAttachment | null = useOpt && optMusic !== undefined
    ? optMusic
    : (moment?.music_track ?? null);
  const localOverlays: PhotoOverlayItem[] = useOpt && optOverlays !== undefined
    ? optOverlays
    : (moment?.overlays ?? []);
  const localTaggedUsers: TaggedPerson[] = useOpt && optTaggedUsers !== undefined
    ? optTaggedUsers
    : (moment?.tagged_users ?? []);
  const localSnapOnce: boolean = useOpt && optSnapOnce !== undefined
    ? optSnapOnce
    : Boolean(moment?.snap_once);
  const localReactions: Record<string, string> = useOpt && optReactions !== undefined
    ? optReactions
    : (moment?.reactions ?? {});
  const localComments: MomentCommentRecord[] = useOpt && optComments !== undefined
    ? optComments
    : (moment?.comments ?? []);
  const resolvedBackUri =
    (backPhotoUrl && backPhotoUrl.trim()) ||
    (moment?.back_photo_url && moment.back_photo_url.trim()) ||
    (moment?.back_photo_path && moment.back_photo_path.trim()) ||
    '';

  const resolvedFrontUri =
    (frontPhotoUrl && frontPhotoUrl.trim()) ||
    (moment?.front_photo_url && moment.front_photo_url.trim()) ||
    (moment?.front_photo_path && moment.front_photo_path.trim()) ||
    '';

  const [swapped, setSwapped] = useState(false);
  const mainSource = swapped ? resolvedFrontUri : resolvedBackUri;
  const pipSource = swapped ? resolvedBackUri : resolvedFrontUri;
  const [failedImageUris, setFailedImageUris] = useState<string[]>([]);
  const mediaUnavailable = !mainSource || mainSource.startsWith('data:image/svg+xml') || failedImageUris.includes(mainSource);
  const [mediaRetry, setMediaRetry] = useState(0);

  const postedAtIso = propPostedAtIso ?? moment?.posted_at ?? new Date().toISOString();
  const lateBySeconds = propLateBySeconds ?? moment?.late_by_seconds ?? 0;
  const isPromptCheckIn = moment
    ? isMomentPromptCheckIn(moment)
    : !effectiveCoupleId.startsWith('solo_') && !effectiveUserId.startsWith('friend_');
  const retakeCount = propRetakeCount ?? moment?.retake_count ?? 0;
  const mediaType: MomentMediaType = moment?.media_type ?? 'photo';
  const videoDurationSec = moment?.video_duration_seconds ?? 6;
  const videoUri: string | null = moment?.video_uri ?? null;
  const isRealPlayableVideo = Boolean(
    mediaType === 'video' &&
      videoUri &&
      !videoUri.startsWith('data:image/svg+xml')
  );
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoProgressPct, setVideoProgressPct] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Real audible Music Preview state synced with global single-track player
  const [activeAudioTrackId, setActiveAudioTrackId] = useState<string | null>(() =>
    getActiveMusicPreviewTrackId()
  );
  const musicPlaying = Boolean(localMusicTrack && activeAudioTrackId === localMusicTrack.id);

  useEffect(() => {
    const unsub = subscribeMusicPreviewState((nextId) => {
      setActiveAudioTrackId(nextId);
    });
    return () => {
      unsub();
      if (localMusicTrack && getActiveMusicPreviewTrackId() === localMusicTrack.id) {
        stopMusicPreview();
      }
    };
  }, [localMusicTrack]);

  // Authoritative Snap Once 15s disappearing mode state (resumes across tab switches)
  const propSnapExpired = Boolean(
    moment &&
      localSnapOnce &&
      !ownerFlag &&
      isSnapOnceExpiredForViewer(
        {
          snap_once: localSnapOnce,
          user_id: moment.user_id,
          viewed_by_user_ids: moment.viewed_by_user_ids,
          snap_opened_at_by_user: moment.snap_opened_at_by_user,
          snap_duration_seconds: moment.snap_duration_seconds,
        },
        effectiveUserId
      )
  );

  const [localExpiredFlag, setLocalExpiredFlag] = useState(false);
  const snapExpired = propSnapExpired || localExpiredFlag;

  const initialRemaining =
    moment && localSnapOnce && !ownerFlag && !snapExpired
      ? getSnapOnceRemainingSeconds(
          {
            snap_once: localSnapOnce,
            user_id: moment.user_id,
            viewed_by_user_ids: moment.viewed_by_user_ids,
            snap_opened_at_by_user: moment.snap_opened_at_by_user,
            snap_duration_seconds: moment.snap_duration_seconds,
          },
          effectiveUserId
        )
      : null;

  const [snapOpened, setSnapOpened] = useState<boolean>(() =>
    Boolean(initialRemaining !== null && initialRemaining > 0)
  );
  const [snapSecondsLeft, setSnapSecondsLeft] = useState<number>(() =>
    initialRemaining !== null && initialRemaining > 0 ? initialRemaining : 15
  );
  const snapTimerRef = useRef<number | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!localSnapOnce || ownerFlag || snapExpired) {
      clearInterval(snapTimerRef.current);
      if (propSnapExpired && moment?.id && !moment.viewed_by_user_ids?.includes(effectiveUserId)) {
        void markSnapOnceMomentState({
          momentId: moment.id,
          coupleId: effectiveCoupleId,
          viewerId: effectiveUserId,
          expired: true,
        }).then(() => {
          void onUpdated?.();
        }).catch((err) => setActionError(err instanceof Error ? err.message : 'Could not sync the expired Snap Once state. Refresh the feed to retry.'));
      }
      return;
    }
    if (!snapOpened) return;

    clearInterval(snapTimerRef.current);
    snapTimerRef.current = setInterval(() => {
      setSnapSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(snapTimerRef.current);
          setLocalExpiredFlag(true);
          if (moment?.id) {
            void markSnapOnceMomentState({
              momentId: moment.id,
              coupleId: effectiveCoupleId,
              viewerId: effectiveUserId,
              expired: true,
            }).then(() => {
              void onUpdated?.();
            }).catch((err) => setActionError(err instanceof Error ? err.message : 'Could not sync the expired Snap Once state. Refresh the feed to retry.'));
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000) as unknown as number;

    return () => {
      clearInterval(snapTimerRef.current);
    };
  }, [
    localSnapOnce,
    ownerFlag,
    snapExpired,
    propSnapExpired,
    snapOpened,
    moment?.id,
    moment?.viewed_by_user_ids,
    effectiveCoupleId,
    effectiveUserId,
    onUpdated,
  ]);

  const handleOpenSnapOnce = () => {
    if (snapOpened || snapExpired || ownerFlag) return;
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    const rem =
      moment
        ? (getSnapOnceRemainingSeconds(
            {
              snap_once: localSnapOnce,
              user_id: moment.user_id,
              viewed_by_user_ids: moment.viewed_by_user_ids,
              snap_opened_at_by_user: moment.snap_opened_at_by_user,
              snap_duration_seconds: moment.snap_duration_seconds,
            },
            effectiveUserId
          ) ?? 15)
        : 15;
    if (rem <= 0) {
      setLocalExpiredFlag(true);
      return;
    }
    setSnapSecondsLeft(rem);
    setSnapOpened(true);
    if (moment?.id) {
      void markSnapOnceMomentState({
        momentId: moment.id,
        coupleId: effectiveCoupleId,
        viewerId: effectiveUserId,
        expired: false,
      }).catch((err) => setActionError(err instanceof Error ? err.message : 'Could not sync the Snap Once view state. Refresh the feed to retry.'));
    }
  };

  // Owner CRUD editor state (Item #11)
  const [editing, setEditing] = useState(false);
  const [savingCrud, setSavingCrud] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingPost, setDeletingPost] = useState(false);
  const [crudError, setCrudError] = useState<string | null>(null);

  const [draftCaption, setDraftCaption] = useState(localCaption ?? '');
  const [draftFilter, setDraftFilter] = useState<MomentFilterPreset>(localFilterPreset);
  const [draftLocation, setDraftLocation] = useState(localLocationLabel ?? '');
  const [draftMusic, setDraftMusic] = useState<MusicTrackAttachment | null>(localMusicTrack);
  const [draftOverlays, setDraftOverlays] = useState<PhotoOverlayItem[]>(localOverlays);
  const [draftOverlayText, setDraftOverlayText] = useState('');
  const [draftOverlayBgStyle, setDraftOverlayBgStyle] = useState<'glass' | 'solid' | 'neon'>('glass');
  const [draftTaggedUsers, setDraftTaggedUsers] = useState<TaggedPerson[]>(localTaggedUsers);
  const [draftSnapOnce, setDraftSnapOnce] = useState(localSnapOnce);
  const [circleTagCandidates, setCircleTagCandidates] = useState<TaggedPerson[]>([]);
  // Comments & Reactions state (Item #13)
  const [commentInput, setCommentInput] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [savingReaction, setSavingReaction] = useState(false);

  // Download & 9:16 Story Share modal state (Item #15 & #19)
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [storyModalOpen, setStoryModalOpen] = useState(false);
  const [storyTheme, setStoryTheme] = useState<StoryThemePreset>('midnight');
  const [storySharing, setStorySharing] = useState(false);
  const [pendingDeleteComment, setPendingDeleteComment] = useState<string | null>(null);
  const [discardEdits, setDiscardEdits] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const [radialOpen, setRadialOpen] = useState(false);
  const pipScale = useSharedValue(1);
  const pipStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pipScale.get() }],
  }));
  const radialScale = useSharedValue(0.95);
  const radialOpacity = useSharedValue(0);
  const radialAnimStyle = useAnimatedStyle(() => ({
    opacity: radialOpacity.get(),
    transform: [{ scale: radialScale.get() }],
  }));

  const filterMeta = getFilterPresetMeta(localFilterPreset);

  const handleSwapPip = () => {
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
    if (motionEnabled) {
      pipScale.set(0.86);
      pipScale.set(withSpring(1, MOCHY_SPRINGS.popIn(motionSpeed)));
    }
    setSwapped((prev) => !prev);
  };

  const openRadialFan = () => {
    if (isSnapLockedForViewer || isSnapExpiredForViewer) return;
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setRadialOpen(true);
    if (motionEnabled) {
      radialScale.set(0.92);
      radialOpacity.set(0);
      radialScale.set(withSpring(1, MOCHY_SPRINGS.popIn(motionSpeed)));
      radialOpacity.set(withSpring(1, MOCHY_SPRINGS.popIn(motionSpeed)));
    } else {
      radialScale.set(1);
      radialOpacity.set(1);
    }
  };

  const closeRadialFan = () => {
    setRadialOpen(false);
  };

  const openHubSheet = () => {
    setRadialOpen(false);
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
    setHubOpen(true);
  };

  const closeHubSheet = () => {
    if (savingCrud || deletingPost) return;
    if (editing) {
      const isDirty =
        draftCaption !== (localCaption ?? '') ||
        draftFilter !== localFilterPreset ||
        draftLocation !== (localLocationLabel ?? '') ||
        (draftMusic?.id ?? null) !== (localMusicTrack?.id ?? null) ||
        draftOverlays.length !== localOverlays.length ||
        draftTaggedUsers.length !== localTaggedUsers.length ||
        draftSnapOnce !== localSnapOnce;
      if (isDirty) {
        setDiscardEdits(true);
        return;
      }
      setEditing(false);
    }
    setConfirmingDelete(false);
    setHubOpen(false);
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (!radialOpen && !hubOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (radialOpen) {
          setRadialOpen(false);
        } else if (hubOpen && !storyModalOpen && !pendingDeleteComment && !discardEdits) {
          closeHubSheet();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const handleOpenEditor = () => {
    setDiscardEdits(false);
    setDraftCaption(localCaption ?? '');
    setDraftFilter(localFilterPreset);
    setDraftLocation(localLocationLabel ?? '');
    setDraftMusic(localMusicTrack);
    setDraftOverlays(localOverlays);
    setDraftOverlayText('');
    setDraftOverlayBgStyle('glass');
    setDraftTaggedUsers(localTaggedUsers);
    setDraftSnapOnce(localSnapOnce);
    setConfirmingDelete(false);
    setCrudError(null);
    setEditing(true);
    void fetchFriendsCircle({ userId: effectiveUserId, partner: sessionPartner }).then(
      (friends) => {
        setCircleTagCandidates(
          friends.map((f) => ({
            userId: f.friend_id,
            displayName: f.friend_profile.display_name,
            username: f.friend_profile.username ?? f.friend_id,
          }))
        );
      }
    ).catch((err) => setCrudError(err instanceof Error ? err.message : 'Could not load people to tag. Reopen the editor to retry.'));
  };

  const availableTagCandidates: TaggedPerson[] = [
    ...(sessionPartner
      ? [
          {
            userId: sessionPartner.id,
            displayName: sessionPartner.display_name,
            username:
              sessionPartner.username ||
              sessionPartner.display_name.toLowerCase().replace(/\s+/g, ''),
          },
        ]
      : []),
    ...circleTagCandidates,
  ];

  const handleToggleDraftTag = (person: TaggedPerson) => {
    setDraftTaggedUsers((prev) => {
      const exists = prev.some((t) => t.userId === person.userId);
      return exists ? prev.filter((t) => t.userId !== person.userId) : [...prev, person];
    });
  };

  const handleAddEmojiOverlay = (emoji: string) => {
    overlaySeqRef.current += 1;
    const seq = draftOverlays.length + overlaySeqRef.current;
    const nextItem: PhotoOverlayItem = {
      id: `ov_ed_${seq}`,
      kind: 'emoji',
      content: emoji,
      xPct: 24 + ((seq * 19) % 56),
      yPct: 26 + ((seq * 23) % 48),
    };
    setDraftOverlays((prev) => [...prev, nextItem]);
  };

  const handleAddTextOverlay = () => {
    const cleaned = draftOverlayText.trim();
    if (!cleaned) return;
    overlaySeqRef.current += 1;
    const seq = draftOverlays.length + overlaySeqRef.current;
    const nextItem: PhotoOverlayItem = {
      id: `ov_ed_txt_${seq}`,
      kind: 'text',
      content: cleaned.slice(0, 36),
      bgStyle: draftOverlayBgStyle,
      xPct: 50,
      yPct: 42 + ((seq * 14) % 36),
    };
    setDraftOverlays((prev) => [...prev, nextItem]);
    setDraftOverlayText('');
  };

  const handleSaveEditor = async () => {
    if (savingCrud || deletingPost) return;
    setSavingCrud(true);
    setCrudError(null);
    try {
      const nextCaptionTrimmed = draftCaption.trim() ? draftCaption.trim() : null;
      const nextLocTrimmed = draftLocation.trim() ? draftLocation.trim() : null;
      const matchedLocPreset = QUICK_LOCATION_PRESETS.find((l) => l.label === nextLocTrimmed);

      if (moment?.id) {
        const updated = await updateMomentDetails({
          momentId: moment.id,
          userId: moment.user_id || effectiveUserId,
          caption: nextCaptionTrimmed,
          filterPreset: draftFilter,
          locationLabel: nextLocTrimmed,
          lat: matchedLocPreset ? matchedLocPreset.lat : nextLocTrimmed === null ? null : undefined,
          lng: matchedLocPreset ? matchedLocPreset.lng : nextLocTrimmed === null ? null : undefined,
          musicTrack: draftMusic,
          taggedUsers: draftTaggedUsers,
          overlays: draftOverlays,
          snapOnce: draftSnapOnce,
        });
        setOptimisticRev(momentRevisionKey);
        setOptCaption(updated.caption);
        setOptFilter(updated.filter_preset ?? 'normal');
        setOptLocation(updated.location_label ?? null);
        setOptMusic(updated.music_track ?? null);
        setOptTaggedUsers(updated.tagged_users ?? []);
        setOptOverlays(updated.overlays ?? []);
        setOptSnapOnce(Boolean(updated.snap_once));
        await onUpdated?.(updated);
      } else if (onSaveCaption) {
        await onSaveCaption(draftCaption.trim());
        setOptimisticRev(momentRevisionKey);
        setOptCaption(nextCaptionTrimmed);
        setOptFilter(draftFilter);
        setOptLocation(nextLocTrimmed);
        setOptMusic(draftMusic);
        setOptTaggedUsers(draftTaggedUsers);
        setOptOverlays(draftOverlays);
        setOptSnapOnce(draftSnapOnce);
      } else {
        setOptimisticRev(momentRevisionKey);
        setOptCaption(nextCaptionTrimmed);
        setOptFilter(draftFilter);
        setOptLocation(nextLocTrimmed);
        setOptMusic(draftMusic);
        setOptTaggedUsers(draftTaggedUsers);
        setOptOverlays(draftOverlays);
        setOptSnapOnce(draftSnapOnce);
      }
      setEditing(false);
    } catch (err) {
      setCrudError(err instanceof Error ? err.message : 'Could not update Moment.');
    } finally {
      setSavingCrud(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!moment?.id || savingCrud || deletingPost) return;
    setDeletingPost(true);
    setCrudError(null);
    try {
      await deleteMomentPost({
        momentId: moment.id,
        userId: moment.user_id || effectiveUserId,
        coupleId: effectiveCoupleId,
      });
      setEditing(false);
      setHubOpen(false);
      await onDeleted?.(moment.id);
      await onUpdated?.();
    } catch (err) {
      setCrudError(err instanceof Error ? err.message : 'Could not delete Moment.');
    } finally {
      setDeletingPost(false);
    }
  };

  const handleToggleReaction = async (emoji: string) => {
    if (savingReaction || !moment?.id) return;
    setSavingReaction(true);
    setActionError(null);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    const nextReactions = { ...localReactions };
    if (nextReactions[effectiveUserId] === emoji) delete nextReactions[effectiveUserId];
    else nextReactions[effectiveUserId] = emoji;
    setOptimisticRev(momentRevisionKey);
    setOptReactions(nextReactions);
    try {
      await toggleMomentReaction({ momentId: moment.id, coupleId: effectiveCoupleId, userId: effectiveUserId, emoji });
      await onUpdated?.();
    } catch (err) {
      setOptReactions(localReactions);
      setActionError(err instanceof Error ? err.message : 'Could not save your reaction. Try again.');
    } finally {
      setSavingReaction(false);
    }
  };

  const handlePostComment = async () => {
    const cleaned = commentInput.trim();
    if (!cleaned || postingComment) return;
    if (!moment?.id) { setActionError('This Moment is not available for comments. Refresh the feed and try again.'); return; }
    setActionError(null);
    setPostingComment(true);
    const authorDisplay = sessionUser?.display_name ?? 'You';
    const authorHandle = sessionUser?.username;
    try {
      if (moment?.id) {
        const created = await addMomentComment({
          momentId: moment.id,
          coupleId: effectiveCoupleId,
          authorId: effectiveUserId,
          authorName: authorDisplay,
          authorUsername: authorHandle,
          text: cleaned,
        });
        setOptimisticRev(momentRevisionKey);
        setOptComments([...localComments, created]);
        setCommentInput('');
        await onUpdated?.();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not post your comment. Your draft is still here. Try again.');
    } finally {
      setPostingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    setOptimisticRev(momentRevisionKey);
    setOptComments(localComments.filter((c) => c.id !== commentId));
    if (moment?.id) {
      try {
        await deleteMomentComment({
          momentId: moment.id,
          commentId,
          coupleId: effectiveCoupleId,
          requesterId: effectiveUserId,
        });
        await onUpdated?.();
      } catch (err) {
        setOptComments(localComments);
        setActionError(err instanceof Error ? err.message : 'Could not delete the comment. Try again.');
      }
    }
  };

  const handleNativeVideoPreview = async () => {
    if (!videoUri || !isRealPlayableVideo) return;
    try {
      if (Platform.OS === 'web') {
        if (!videoRef.current) return;
        if (videoRef.current.paused) await videoRef.current.play();
        else videoRef.current.pause();
        return;
      }
      if (videoUri.startsWith('file://')) {
        const file = new FileSystem.File(videoUri);
        if (await file.canPreview()) {
          await file.preview({ title: `${authorName}’s KeepIt Video`, mimeType: 'video/mp4' });
          return;
        }
      }
      await Linking.openURL(videoUri);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not play this video. Try again.');
    }
  };

  const watermarkTimestamp = formatMomentWatermarkTimestamp(postedAtIso);

  const handleSave3x4Photo = async () => {
    if ((localSnapOnce && !ownerFlag) || savingPhoto || mediaUnavailable) return;
    setSavingPhoto(true);
    setActionBanner(null);
    try {
      const safeAuthor = authorName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'keepit';
      const msg = await exportAndShareCompositeMoment({
        backUri: mainSource,
        frontUri: pipSource,
        authorName,
        postedAtIso,
        timestampLabel: watermarkTimestamp,
        caption: localCaption,
        locationLabel: localLocationLabel,
        musicTitle: localMusicTrack
          ? `${localMusicTrack.title} · ${localMusicTrack.artist}`
          : null,
        taggedUsers: localTaggedUsers,
        filterPreset: localFilterPreset,
        overlays: localOverlays,
        aspect: '3:4',
        baseFilename: `keepit-${safeAuthor}-3x4`,
        title: `${authorName}’s KeepIt Moment`,
      });
      setActionBanner(msg);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save photo. Try again.');
    } finally {
      setSavingPhoto(false);
    }
  };

  const storyDataUri =
    (localSnapOnce && !ownerFlag) || mediaUnavailable
      ? ''
      : buildMomentCompositeSvgDataUri({
          backUri: mainSource,
          frontUri: pipSource,
          authorName,
          postedAtIso,
          timestampLabel: watermarkTimestamp,
          caption: localCaption,
          locationLabel: localLocationLabel,
          musicTitle: localMusicTrack
            ? `${localMusicTrack.title} · ${localMusicTrack.artist}`
            : null,
          taggedUsers: localTaggedUsers,
          filterPreset: localFilterPreset,
          overlays: localOverlays,
          aspect: '9:16',
          storyTheme,
        });

  const handleShare9x16Story = async () => {
    if ((localSnapOnce && !ownerFlag) || storySharing || mediaUnavailable) return;
    setStorySharing(true);
    try {
      const safeAuthor = authorName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'keepit';
      const msg = await exportAndShareCompositeMoment({
        backUri: mainSource,
        frontUri: pipSource,
        authorName,
        postedAtIso,
        timestampLabel: watermarkTimestamp,
        caption: localCaption,
        locationLabel: localLocationLabel,
        musicTitle: localMusicTrack
          ? `${localMusicTrack.title} · ${localMusicTrack.artist}`
          : null,
        taggedUsers: localTaggedUsers,
        filterPreset: localFilterPreset,
        overlays: localOverlays,
        aspect: '9:16',
        storyTheme,
        baseFilename: `keepit-story-${safeAuthor}-9x16`,
        title: `${authorName}’s 9:16 KeepIt Story`,
      });
      setActionBanner(msg);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not share your story. Try again.');
    } finally {
      setStorySharing(false);
    }
  };

  const timeFormatted = new Date(postedAtIso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const isSnapLockedForViewer = localSnapOnce && !ownerFlag && !snapOpened && !snapExpired;
  const isSnapExpiredForViewer = localSnapOnce && !ownerFlag && snapExpired;

  // Reaction count summary per emoji
  const reactionCounts: Record<string, number> = {};
  for (const emoji of Object.values(localReactions)) {
    reactionCounts[emoji] = (reactionCounts[emoji] ?? 0) + 1;
  }
  const totalReactionsCount = Object.values(reactionCounts).reduce((acc, n) => acc + n, 0);
  const myReactionEmoji = localReactions[effectiveUserId] ?? null;
  const topReactionEmoji =
    myReactionEmoji ??
    Object.entries(reactionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    null;
  const totalActivityCount = totalReactionsCount + localComments.length;
  const remainingRetakes = Math.max(0, 2 - retakeCount);

  return (
    <View
      style={[
        styles.postCard,
        {
          backgroundColor: colors.surface,
          borderColor:
            localFilterPreset !== 'normal' ? filterMeta.borderAccent : colors.border,
          borderRadius: radii.card,
        },
      ]}>
      <View style={styles.postHeader}>
        <SectionHeader
          title={authorName}
          subtitle={`${timeFormatted}${isPromptCheckIn ? ` · ${formatLateDuration(lateBySeconds)}` : ''}${moment?.daily_index ? ` · Moment ${moment.daily_index} of 5` : ''}`}
        />
      </View>
      {/* Main 3:4 Photo Container */}
      <View
        style={[
          styles.photoFrame,
          {
            backgroundColor: colors.surfaceElevated,
            borderColor: colors.border,
          },
        ]}>
        {isSnapExpiredForViewer ? (
          <View
            style={[
              styles.snapOverlayContainer,
              { backgroundColor: colors.surfaceElevated },
            ]}>
            <View
              style={[
                styles.snapIconCircle,
                { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
              ]}>
              <Text style={[styles.snapIconEmoji, { color: colors.danger }]}>15s</Text>
            </View>
            <Text style={[styles.snapOverlayTitle, { color: colors.ink }]}>
              Snap Once Expired · Viewed for 15s
            </Text>
            <Text style={[styles.snapOverlaySub, { color: colors.inkMuted }]}>
              This disappearing Dual Moment from {authorName} has vanished.
            </Text>
          </View>
        ) : isSnapLockedForViewer ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tap to view Snap Once Moment for 15 seconds"
            onPress={handleOpenSnapOnce}
            style={[
              styles.snapOverlayContainer,
              { backgroundColor: colors.surfaceElevated },
            ]}>
            <View
              style={[
                styles.snapIconCircle,
                { backgroundColor: colors.accentSoft, borderColor: colors.inkMuted },
              ]}>
              <Text style={[styles.snapIconEmoji, { color: colors.ink }]}>15s</Text>
            </View>
            <Text style={[styles.snapOverlayTitle, { color: colors.ink }]}>
              Snap Once · Tap to view for 15s
            </Text>
            <Text style={[styles.snapOverlaySub, { color: colors.inkMuted }]}>
              {authorName} sent a 15-second disappearing Moment. Tap when ready!
            </Text>
          </Pressable>
        ) : (
          <>
            {Platform.OS === 'web' && isRealPlayableVideo && videoUri ? (
              React.createElement('video', {
                ref: videoRef,
                'aria-label': `${authorName}’s Moment video`,
                onPlay: () => setVideoPlaying(true),
                onPause: () => setVideoPlaying(false),
                onError: () => setActionError('Could not load this video. Use the player controls to retry.'),
                onTimeUpdate: (event: React.SyntheticEvent<HTMLVideoElement>) => {
                  const video = event.currentTarget;
                  setVideoProgressPct(video.duration ? (video.currentTime / video.duration) * 100 : 0);
                },
                src: videoUri,
                autoPlay: videoPlaying,
                loop: true,
                muted: false,
                playsInline: true,
                controls: true,
                style: {
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  filter: filterMeta.webCssFilter !== 'none' ? filterMeta.webCssFilter : undefined,
                },
              })
            ) : mediaUnavailable ? (
              <View style={[styles.snapOverlayContainer, { backgroundColor: colors.surfaceElevated }]}>
                <Text style={[styles.snapOverlayTitle, { color: colors.ink }]}>Moment photo unavailable</Text>
                <Text style={[styles.snapOverlaySub, { color: colors.inkMuted }]}>The original camera photo is unavailable. Generated illustrations are not shown as real Moments.</Text>
                <KeepItButton label="Retry photo" variant="secondary" onPress={() => { setFailedImageUris([]); setMediaRetry((value) => value + 1); void onUpdated?.(); }} />
              </View>
            ) : (
              <Image
                key={`${mainSource}-${mediaRetry}`}
                accessibilityLabel={`${authorName}’s ${swapped ? 'front' : 'back'} camera photo`}
                onError={() => setFailedImageUris((uris) => [...uris, mainSource])}
                source={{ uri: mainSource }}
                contentFit="cover"
                style={[
                  styles.fullImage,
                  Platform.OS === 'web' && filterMeta.webCssFilter !== 'none'
                    ? ({ filter: filterMeta.webCssFilter } as never)
                    : null,
                  mediaType === 'video' && videoPlaying
                    ? { transform: [{ scale: 1.015 }] }
                    : null,
                ]}
              />
            )}

            {/* Filter Preset Tint Overlay (Item #17) */}
            {filterMeta.tintOverlay !== 'transparent' ? (
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: filterMeta.tintOverlay },
                ]}
              />
            ) : null}

            {/* Overlapping 3:4 Front/Back PIP */}
            {pipSource && !pipSource.startsWith('data:image/svg+xml') && !failedImageUris.includes(pipSource) ? <Animated.View style={[styles.pipAnchor, pipStyle]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Swap ${authorName} front and back camera view`}
                onPress={handleSwapPip}
                style={[
                  styles.pipFrame,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.canvas,
                  },
                ]}>
                <Image
                  accessibilityLabel={`${authorName}’s other camera photo. Swap views.`}
                  onError={() => setFailedImageUris((uris) => [...uris, pipSource])}
                  source={{ uri: pipSource }}
                  contentFit="cover"
                  style={styles.fullImage}
                />
              </Pressable>
            </Animated.View> : null}

            {/* On-Photo Emoji & Text Overlays (Item #12) */}
            {localOverlays.map((ov) => (
              <View
                key={ov.id}
                pointerEvents="none"
                style={[
                  styles.overlayItemAnchor,
                  {
                    left: `${ov.xPct}%`,
                    top: `${ov.yPct}%`,
                  },
                ]}>
                {ov.kind === 'emoji' ? (
                  <Text style={styles.overlayEmojiText}>{ov.content}</Text>
                ) : (
                  <View
                    style={[
                      styles.overlayTextPill,
                      {
                        backgroundColor:
                          ov.bgStyle === 'neon'
                            ? '#282830'
                            : ov.bgStyle === 'solid'
                              ? '#141416'
                              : 'rgba(20, 20, 22, 0.80)',
                      },
                    ]}>
                    <Text style={styles.overlayTextLabel}>{ov.content}</Text>
                  </View>
                )}
              </View>
            ))}

            {/* Top-Right Status Badges (On-time / Late + Retake + Filter + Video + Snap Countdown) */}
            <View style={styles.badgeStack}>
              {localSnapOnce && !ownerFlag && snapOpened ? (
                <View
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor: colors.accent,
                      borderColor: colors.accent,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.statusPillText, { color: colors.onAccent }]}>
                    15s · {snapSecondsLeft}s left
                  </Text>
                </View>
              ) : null}

              {localSnapOnce && ownerFlag ? (
                <View
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor: colors.canvas,
                      borderColor: colors.inkMuted,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.statusPillText, { color: colors.ink }]}>
                    Snap Once · 15s
                  </Text>
                </View>
              ) : null}

              {mediaType === 'video' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={Platform.OS === 'web' ? videoPlaying ? 'Pause video' : 'Play video' : 'Open video player'}
                  onPress={() => void handleNativeVideoPreview()}
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor: colors.canvas,
                      borderColor: colors.accent,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.statusPillText, { color: colors.ink }]}>
                    {Platform.OS === 'web' ? videoPlaying ? 'Pause video' : 'Play video' : 'Open video'} · {videoDurationSec}s
                  </Text>
                </Pressable>
              ) : null}

              {localFilterPreset !== 'normal' ? (
                <View
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor: colors.canvas,
                      borderColor: filterMeta.borderAccent,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.statusPillText, { color: colors.ink }]}>
                    {filterMeta.label}
                  </Text>
                </View>
              ) : null}

              {isPromptCheckIn ? (
                <View
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor: colors.canvas,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.statusPillText,
                      { color: colors.ink },
                    ]}>
                    {formatLateDuration(lateBySeconds)}
                  </Text>
                </View>
              ) : null}

              {retakeCount > 0 ? (
                <View
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor: colors.canvas,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.statusPillText, { color: colors.inkMuted }]}>
                    {retakeCount} {retakeCount === 1 ? 'retake' : 'retakes'}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Video Playback Progress Bar (Item #18) */}
            {Platform.OS === 'web' && isRealPlayableVideo ? (
              <View style={styles.videoProgressTrack}>
                <View
                  style={[
                    styles.videoProgressFill,
                    {
                      width: `${videoProgressPct}%`,
                      backgroundColor: colors.accent,
                    },
                  ]}
                />
              </View>
            ) : null}

            {/* BeReal-Style Bottom-Left On-Photo Watermark (#keepit SVG + timestamp below) */}
            <View pointerEvents="none" style={styles.keepItPhotoWatermark}>
              <KeepItWatermarkLogo width={76} color="#FFFFFF" />
              <Text style={styles.keepItWatermarkTime}>{watermarkTimestamp}</Text>
            </View>

            {/* Option A: Long-Press Radial Quick-Reaction Bar */}
            {radialOpen ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss quick reactions"
                  onPress={closeRadialFan}
                  style={styles.radialDismissBackdrop}
                />
                <Animated.View
                  accessibilityRole="toolbar"
                  accessibilityLabel="Quick reactions"
                  style={[
                    styles.radialFanBar,
                    {
                      backgroundColor: 'rgba(20, 17, 19, 0.94)',
                      borderColor: 'rgba(255, 255, 255, 0.28)',
                      borderRadius: radii.pill,
                    },
                    radialAnimStyle,
                  ]}>
                  {QUICK_REACTION_EMOJIS.map((emoji) => {
                    const selected = localReactions[effectiveUserId] === emoji;
                    return (
                      <Pressable
                        key={emoji}
                        accessibilityRole="button"
                        accessibilityLabel={`Quick react ${emoji}`}
                        accessibilityState={{ selected, disabled: savingReaction }}
                        disabled={savingReaction}
                        onPress={() => {
                          closeRadialFan();
                          void handleToggleReaction(emoji);
                        }}
                        style={[
                          styles.radialEmojiBtn,
                          {
                            backgroundColor: selected
                              ? 'rgba(255, 255, 255, 0.22)'
                              : 'transparent',
                            borderColor: selected
                              ? '#FFFFFF'
                              : 'transparent',
                            borderRadius: radii.pill,
                          },
                        ]}>
                        <ReactionGlyph emoji={emoji} size={20} tintColor="#FFFFFF" />
                      </Pressable>
                    );
                  })}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open full Moment interaction sheet"
                    onPress={openHubSheet}
                    style={[
                      styles.radialMoreBtn,
                      {
                        backgroundColor: 'rgba(255, 255, 255, 0.14)',
                        borderColor: 'rgba(255, 255, 255, 0.28)',
                        borderRadius: radii.pill,
                      },
                    ]}>
                    <SymbolView
                      name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
                      tintColor="#FFFFFF"
                      size={18}
                    />
                  </Pressable>
                </Animated.View>
              </>
            ) : null}

            {/* Option A: Single 1-Icon Corner Interaction Hub */}
            <View style={styles.cornerHubAnchor}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  totalActivityCount > 0
                    ? `Moment actions, ${totalReactionsCount} reactions, ${localComments.length} comments. Tap for menu, hold for quick reactions`
                    : 'Moment actions: react, comment, edit, retake, or share. Tap for menu, hold for quick reactions'
                }
                accessibilityHint="Tap to open Moment actions sheet, or long press to quick react"
                onPress={openHubSheet}
                onLongPress={openRadialFan}
                delayLongPress={220}
                style={[
                  styles.cornerHubBtn,
                  {
                    backgroundColor: 'rgba(16, 13, 15, 0.90)',
                    borderColor: myReactionEmoji
                      ? '#FFFFFF'
                      : 'rgba(255, 255, 255, 0.34)',
                    borderRadius: radii.pill,
                  },
                ]}>
                {topReactionEmoji ? (
                  <ReactionGlyph emoji={topReactionEmoji} size={18} tintColor="#FFFFFF" />
                ) : (
                  <SymbolView
                    name={{
                      ios: 'ellipsis',
                      android: 'more_horiz',
                      web: 'more_horiz',
                    }}
                    tintColor="#FFFFFF"
                    size={19}
                  />
                )}
                {totalActivityCount > 0 ? (
                  <Text style={styles.cornerHubCountText}>{totalActivityCount}</Text>
                ) : null}
              </Pressable>
            </View>
          </>
        )}
      </View>

      {/* Connected 1-Line Caption + Right-Corner Holdable Reaction Button Below Photo */}
      {!isSnapLockedForViewer && !isSnapExpiredForViewer ? (
        <View
          style={[
            styles.compactCaptionStrip,
            {
              backgroundColor: colors.surface,
            },
          ]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              localCaption
                ? `Caption: ${localCaption}. Tap to open comments and Moment actions`
                : 'Open comments and Moment actions'
            }
            onPress={openHubSheet}
            style={styles.compactCaptionLeft}>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                styles.compactCaptionText,
                { color: localCaption ? colors.ink : colors.inkMuted },
              ]}>
              {localCaption
                ? `“${localCaption}”`
                : ownerFlag
                  ? 'Add a note or manage Moment…'
                  : 'Add a reaction or comment…'}
            </Text>
            {localLocationLabel || localMusicTrack || localTaggedUsers.length > 0 ? (
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[styles.compactContextMeta, { color: colors.inkMuted }]}>
                {[
                  localLocationLabel,
                  localMusicTrack ? `${localMusicTrack.title} · ${localMusicTrack.artist}` : null,
                  localTaggedUsers.length > 0
                    ? localTaggedUsers.map((p) => `@${p.username}`).join(' ')
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : null}
          </Pressable>
          <View style={styles.compactCaptionRight}>
            {localComments.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${localComments.length} ${localComments.length === 1 ? 'reply' : 'replies'}. Tap to view comments`}
                onPress={openHubSheet}
                style={[
                  styles.compactSummaryBadge,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                    borderRadius: radii.pill,
                  },
                ]}>
                <Text style={[styles.compactSummaryCount, { color: colors.ink }]}>
                  {localComments.length} {localComments.length === 1 ? 'reply' : 'replies'}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                myReactionEmoji
                  ? `Your reaction ${myReactionEmoji}. Tap to toggle or hold for more reactions`
                  : 'Tap to like or hold to choose a reaction'
              }
              accessibilityHint="Long press to open reaction picker"
              accessibilityState={{
                selected: Boolean(myReactionEmoji),
                expanded: radialOpen,
                busy: savingReaction,
                disabled: savingReaction,
              }}
              disabled={savingReaction}
              delayLongPress={220}
              onLongPress={openRadialFan}
              onPress={() => {
                if (radialOpen) {
                  closeRadialFan();
                  return;
                }
                void handleToggleReaction(myReactionEmoji ?? '❤️');
              }}
              style={[
                styles.belowCornerReactionBtn,
                {
                  backgroundColor: myReactionEmoji ? colors.accentSoft : colors.surfaceElevated,
                  borderColor:
                    myReactionEmoji || radialOpen ? colors.accent : colors.controlBorder,
                  borderRadius: radii.pill,
                },
              ]}>
              <ReactionGlyph
                emoji={myReactionEmoji ?? topReactionEmoji ?? '❤️'}
                size={16}
                tintColor={colors.ink}
              />
              {totalReactionsCount > 0 ? (
                <Text style={[styles.compactSummaryCount, { color: colors.ink }]}>
                  {totalReactionsCount}
                </Text>
              ) : null}
            </Pressable>
          </View>
        </View>
      ) : null}

      {actionError && !hubOpen ? <InlineNotice message={actionError} tone="error" /> : null}
      {actionBanner && !hubOpen ? <InlineNotice message={actionBanner} tone="success" /> : null}

      {/* Unified Single-Icon Moment Interaction Sheet Modal */}
      <Modal
        visible={hubOpen}
        animationType={motionEnabled ? 'slide' : 'none'}
        transparent
        onRequestClose={closeHubSheet}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.hubModalBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Moment actions sheet"
            onPress={closeHubSheet}
            style={StyleSheet.absoluteFill}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.hubSheetContainer,
              {
                backgroundColor: colors.sheetSurface,
                borderColor: colors.border,
                borderRadius: radii.group,
              },
            ]}>
            <View style={[styles.hubGrabber, { backgroundColor: colors.controlBorder }]} />

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[styles.hubSheetScrollContent, { padding: spacing.lg }]}>
              <View style={styles.metaTopRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.storyModalTitle, { color: colors.ink }]}>
                    {authorName}’s Moment
                  </Text>
                  <Text style={[styles.storyModalSub, { color: colors.inkMuted }]}>
                    {timeFormatted}{isPromptCheckIn ? ` · ${formatLateDuration(lateBySeconds)}` : ''}
                    {retakeCount > 0 ? ` · ${retakeCount} ${retakeCount === 1 ? 'retake' : 'retakes'}` : ''}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close Moment interaction sheet"
                  disabled={savingCrud || deletingPost}
                  onPress={closeHubSheet}
                  style={[
                    styles.smallActionChip,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.controlBorder,
                      borderRadius: radii.input,
                    },
                  ]}>
                  <Text style={[styles.smallActionText, { color: colors.ink }]}>Done</Text>
                </Pressable>
              </View>

              {actionError ? <InlineNotice message={actionError} tone="error" /> : null}
              {actionBanner ? <InlineNotice message={actionBanner} tone="success" /> : null}

              {/* Quick Emoji Reactions Row */}
              <View style={styles.reactionRow}>
                {QUICK_REACTION_EMOJIS.map((emoji) => {
                  const count = reactionCounts[emoji] ?? 0;
                  const selected = localReactions[effectiveUserId] === emoji;
                  return (
                    <Pressable
                      key={emoji}
                      accessibilityRole="button"
                      accessibilityLabel={`React with ${emoji}`}
                      accessibilityState={{ selected, busy: savingReaction, disabled: savingReaction }}
                      disabled={savingReaction}
                      onPress={() => void handleToggleReaction(emoji)}
                      style={[
                        styles.reactionChip,
                        {
                          backgroundColor: selected
                            ? colors.accentSoft
                            : colors.surfaceElevated,
                          borderColor: selected ? colors.accent : colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <ReactionGlyph emoji={emoji} size={18} tintColor={colors.ink} />
                      {count > 0 ? (
                        <Text style={[styles.reactionCount, { color: colors.ink }]}>
                          {count}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>

              {/* Location, Music & Tagged People Badges */}
              {!isSnapLockedForViewer &&
              !isSnapExpiredForViewer &&
              (localLocationLabel || localMusicTrack || localTaggedUsers.length > 0) ? (
                <View style={styles.attachmentChipsWrap}>
                  {localLocationLabel ? (
                    <View
                      style={[
                        styles.attachmentChip,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Text style={[styles.attachmentChipText, { color: colors.ink }]}>
                        {localLocationLabel}
                      </Text>
                    </View>
                  ) : null}

                  {localMusicTrack ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Toggle music preview ${localMusicTrack.title}`}
                      onPress={() => {
                        toggleMusicTrackPreview(localMusicTrack);
                      }}
                      style={[
                        styles.attachmentChip,
                        {
                          backgroundColor: musicPlaying
                            ? colors.accentSoft
                            : colors.surfaceElevated,
                          borderColor: musicPlaying ? colors.accent : colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Text style={[styles.attachmentChipText, { color: colors.ink }]}>
                        {musicPlaying ? 'Stop · ' : 'Play · '}
                        {localMusicTrack.title} · {localMusicTrack.artist}
                        {musicPlaying ? ' · Playing loop' : ''}
                      </Text>
                    </Pressable>
                  ) : null}

                  {localTaggedUsers.map((person) => (
                    <View
                      key={person.userId}
                      style={[
                        styles.attachmentChip,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Text style={[styles.attachmentChipText, { color: colors.ink }]}>
                        @{person.username}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Consolidated Quick Actions Toolbar (Edit, Retake, Save 3:4, Share 9:16 Story) */}
              {!editing ? (
                <View style={styles.sheetQuickActionsGrid}>
                  {ownerFlag || editableCaption ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Edit or manage Moment"
                      onPress={handleOpenEditor}
                      style={[
                        styles.sheetActionBtn,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.controlBorder,
                          borderRadius: radii.input,
                        },
                      ]}>
                      <Text style={[styles.smallActionText, { color: colors.ink }]}>
                        Edit / Manage
                      </Text>
                    </Pressable>
                  ) : null}

                  {canRetake && onRetake ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Retake today's Moment"
                      onPress={() => {
                        setHubOpen(false);
                        onRetake();
                      }}
                      style={[
                        styles.sheetActionBtn,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.controlBorder,
                          borderRadius: radii.input,
                        },
                      ]}>
                      <Text style={[styles.smallActionText, { color: colors.accent }]}>
                        Retake ({remainingRetakes} left)
                      </Text>
                    </Pressable>
                  ) : null}

                  {!(localSnapOnce && !ownerFlag) ? (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Save 3:4 photo with KeepIt watermark"
                        disabled={savingPhoto || mediaUnavailable}
                        onPress={() => void handleSave3x4Photo()}
                        style={[
                          styles.sheetActionBtn,
                          {
                            backgroundColor: colors.surfaceElevated,
                            borderColor: colors.controlBorder,
                            borderRadius: radii.input,
                            opacity: savingPhoto ? 0.6 : 1,
                          },
                        ]}>
                        <Text style={[styles.smallActionText, { color: colors.ink }]}>
                          {savingPhoto ? 'Saving…' : 'Save Photo'}
                        </Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Open 9:16 Story Share preview"
                        disabled={mediaUnavailable}
                        onPress={() => {
                          setHubOpen(false);
                          setStoryModalOpen(true);
                        }}
                        style={[
                          styles.sheetActionBtn,
                          {
                            backgroundColor: colors.accentSoft,
                            borderColor: colors.accent,
                            borderRadius: radii.input,
                          },
                        ]}>
                        <Text style={[styles.smallActionText, { color: colors.ink }]}>
                          Share 9:16 Story
                        </Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              ) : null}

              {/* Full Post CRUD Editor inside Sheet for Owner */}
              {editing ? (
                <View
                  style={[
                    styles.editorPanel,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                      borderRadius: radii.input,
                      padding: spacing.md,
                    },
                  ]}>
                  <Text style={[styles.editorSectionTitle, { color: colors.ink }]}>
                    Edit / Manage Moment
                  </Text>

                  {crudError ? <InlineNotice message={crudError} tone="error" /> : null}

                  <View style={{ gap: 6 }}>
                    <Text style={[styles.editorLabel, { color: colors.inkMuted }]}>Caption</Text>
                    <TextInput
                      accessibilityLabel="Edit Moment caption"
                      editable={!savingCrud && !deletingPost}
                      value={draftCaption}
                      maxLength={160}
                      placeholder="Add a caption (up to 160 chars)..."
                      placeholderTextColor={colors.inkMuted}
                      onChangeText={setDraftCaption}
                      style={[
                        styles.captionInput,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.controlBorder,
                          color: colors.ink,
                          borderRadius: radii.input,
                        },
                      ]}
                    />
                  </View>

                  {/* Filter Preset Selector */}
                  <View style={{ gap: 6 }}>
                    <Text style={[styles.editorLabel, { color: colors.inkMuted }]}>
                      Filter Preset
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalPillsRow}>
                      {MOMENT_FILTER_PRESETS.map((preset) => {
                        const active = draftFilter === preset.id;
                        return (
                          <Pressable
                            key={preset.id}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active, disabled: savingCrud || deletingPost }}
                            disabled={savingCrud || deletingPost}
                            onPress={() => setDraftFilter(preset.id)}
                            style={[
                              styles.OptionPill,
                              {
                                backgroundColor: active ? colors.accent : colors.surface,
                                borderColor: active ? colors.accent : colors.controlBorder,
                                borderRadius: radii.input,
                              },
                            ]}>
                            <Text
                              style={[
                                styles.optionPillText,
                                { color: active ? colors.onAccent : colors.ink },
                              ]}>
                              {preset.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>

                  {/* Location Selector & Input */}
                  <View style={{ gap: 6 }}>
                    <Text style={[styles.editorLabel, { color: colors.inkMuted }]}>
                      Location Spot
                    </Text>
                    <TextInput
                      accessibilityLabel="Edit Moment location"
                      editable={!savingCrud && !deletingPost}
                      value={draftLocation}
                      placeholder="Custom location or choose below..."
                      placeholderTextColor={colors.inkMuted}
                      onChangeText={setDraftLocation}
                      style={[
                        styles.captionInput,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.controlBorder,
                          color: colors.ink,
                          borderRadius: radii.input,
                        },
                      ]}
                    />
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalPillsRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: !draftLocation }}
                        disabled={savingCrud || deletingPost}
                        onPress={() => setDraftLocation('')}
                        style={[
                          styles.OptionPill,
                          {
                            backgroundColor: !draftLocation ? colors.accent : colors.surface,
                            borderColor: colors.border,
                            borderRadius: radii.pill,
                          },
                        ]}>
                        <Text
                          style={[
                            styles.optionPillText,
                            { color: !draftLocation ? colors.onAccent : colors.inkMuted },
                          ]}>
                          None
                        </Text>
                      </Pressable>
                      {QUICK_LOCATION_PRESETS.map((loc) => {
                        const active = draftLocation === loc.label;
                        return (
                          <Pressable
                            key={loc.label}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active, disabled: savingCrud || deletingPost }}
                            disabled={savingCrud || deletingPost}
                            onPress={() => setDraftLocation(loc.label)}
                            style={[
                              styles.OptionPill,
                              {
                                backgroundColor: active ? colors.accent : colors.surface,
                                borderColor: active ? colors.accent : colors.controlBorder,
                                borderRadius: radii.input,
                              },
                            ]}>
                            <Text
                              style={[
                                styles.optionPillText,
                                { color: active ? colors.onAccent : colors.ink },
                              ]}>
                              {loc.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>

                  {/* Music Track Selector */}
                  <View style={{ gap: 6 }}>
                    <Text style={[styles.editorLabel, { color: colors.inkMuted }]}>
                      Music Attachment
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalPillsRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: !draftMusic }}
                        disabled={savingCrud || deletingPost}
                        onPress={() => setDraftMusic(null)}
                        style={[
                          styles.OptionPill,
                          {
                            backgroundColor: !draftMusic ? colors.accent : colors.surface,
                            borderColor: colors.border,
                            borderRadius: radii.pill,
                          },
                        ]}>
                        <Text
                          style={[
                            styles.optionPillText,
                            { color: !draftMusic ? colors.onAccent : colors.inkMuted },
                          ]}>
                          No Music
                        </Text>
                      </Pressable>
                      {CURATED_MUSIC_TRACKS.map((trk) => {
                        const active = draftMusic?.id === trk.id;
                        return (
                          <Pressable
                            key={trk.id}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active, disabled: savingCrud || deletingPost }}
                            disabled={savingCrud || deletingPost}
                            onPress={() => setDraftMusic(trk)}
                            style={[
                              styles.OptionPill,
                              {
                                backgroundColor: active ? colors.accent : colors.surface,
                                borderColor: active ? colors.accent : colors.controlBorder,
                                borderRadius: radii.input,
                              },
                            ]}>
                            <Text
                              style={[
                                styles.optionPillText,
                                { color: active ? colors.onAccent : colors.ink },
                              ]}>
                              {trk.title} · {trk.artist}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>

                  {/* Tag People Editor */}
                  <View style={{ gap: 6 }}>
                    <Text style={[styles.editorLabel, { color: colors.inkMuted }]}>
                      Tagged People ({draftTaggedUsers.length})
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalPillsRow}>
                      {availableTagCandidates.map((person) => {
                        const active = draftTaggedUsers.some((t) => t.userId === person.userId);
                        return (
                          <Pressable
                            key={person.userId}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active, disabled: savingCrud || deletingPost }}
                            disabled={savingCrud || deletingPost}
                            onPress={() => handleToggleDraftTag(person)}
                            style={[
                              styles.OptionPill,
                              {
                                backgroundColor: active ? colors.accent : colors.surface,
                                borderColor: active ? colors.accent : colors.controlBorder,
                                borderRadius: radii.input,
                              },
                            ]}>
                            <Text
                              style={[
                                styles.optionPillText,
                                { color: active ? colors.onAccent : colors.ink },
                              ]}>
                              @{person.username} {active ? '✓' : '+'}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>

                  {/* On-Photo Emoji & Text Overlays Editor */}
                  <View style={{ gap: 6 }}>
                    <View style={styles.metaTopRow}>
                      <Text style={[styles.editorLabel, { color: colors.inkMuted }]}>
                        On-Photo Stickers & Text ({draftOverlays.length})
                      </Text>
                      {draftOverlays.length > 0 ? (
                        <Pressable
                          accessibilityRole="button"
                          disabled={savingCrud || deletingPost}
                          onPress={() => setDraftOverlays([])}
                          style={styles.clearOverlaysBtn}>
                          <Text style={[styles.clearOverlaysText, { color: colors.danger }]}>
                            Clear overlays
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>

                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalPillsRow}>
                      {OVERLAY_STICKER_EMOJIS.map((emoji) => (
                        <Pressable
                          key={emoji}
                          accessibilityRole="button"
                          accessibilityLabel={`Add ${emoji} sticker overlay`}
                          disabled={savingCrud || deletingPost}
                          onPress={() => handleAddEmojiOverlay(emoji)}
                          style={[
                            styles.emojiStickerBtn,
                            {
                              backgroundColor: colors.surface,
                              borderColor: colors.border,
                              borderRadius: radii.pill,
                            },
                          ]}>
                          <Text style={styles.emojiStickerBtnText}>+ {emoji}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>

                    <View style={styles.overlayInputRow}>
                      <TextInput
                        accessibilityLabel="New text overlay"
                        editable={!savingCrud && !deletingPost}
                        value={draftOverlayText}
                        placeholder="Add text banner on photo..."
                        placeholderTextColor={colors.inkMuted}
                        onChangeText={setDraftOverlayText}
                        style={[
                          styles.captionInput,
                          {
                            flex: 1,
                            backgroundColor: colors.surface,
                            borderColor: colors.controlBorder,
                            color: colors.ink,
                            borderRadius: radii.input,
                          },
                        ]}
                      />
                      <Pressable
                        accessibilityRole="button"
                        disabled={savingCrud || deletingPost || !draftOverlayText.trim()}
                        onPress={handleAddTextOverlay}
                        style={[
                          styles.smallActionChip,
                          {
                            backgroundColor: colors.accent,
                            borderColor: colors.accent,
                            borderRadius: radii.input,
                          },
                        ]}>
                        <Text style={[styles.smallActionText, { color: colors.onAccent }]}>
                          + Text
                        </Text>
                      </Pressable>
                    </View>

                    <View style={[styles.horizontalPillsRow, { flexDirection: 'row', flexWrap: 'wrap' }]}>
                      {(['glass', 'solid', 'neon'] as const).map((st) => {
                        const active = draftOverlayBgStyle === st;
                        return (
                          <Pressable
                            key={st}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active, disabled: savingCrud || deletingPost }}
                            disabled={savingCrud || deletingPost}
                            onPress={() => setDraftOverlayBgStyle(st)}
                            style={[
                              styles.OptionPill,
                              {
                                backgroundColor: active ? colors.accent : colors.surface,
                                borderColor: active ? colors.accent : colors.controlBorder,
                                borderRadius: radii.input,
                              },
                            ]}>
                            <Text
                              style={[
                                styles.optionPillText,
                                { color: active ? colors.onAccent : colors.ink },
                              ]}>
                              {st.toUpperCase()}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  {/* Snap Once Toggle */}
                  <View style={styles.snapSwitchRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.editorSectionTitle, { color: colors.ink, fontSize: 14 }]}>
                        Snap Once (15s Disappearing)
                      </Text>
                      <Text style={[styles.editorLabel, { color: colors.inkMuted }]}>
                        Expires 15 seconds after your partner or friend opens it
                      </Text>
                    </View>
                    <Switch
                      accessibilityLabel="Snap Once, disappears 15 seconds after opening"
                      disabled={savingCrud || deletingPost}
                      value={draftSnapOnce}
                      onValueChange={setDraftSnapOnce}
                    />
                  </View>

                  <View style={styles.editActionsRow}>
                    <KeepItButton
                      label="Save Changes"
                      loading={savingCrud}
                      disabled={deletingPost}
                      onPress={() => void handleSaveEditor()}
                      style={{ flex: 1 }}
                    />
                    <KeepItButton
                      label="Cancel"
                      variant="secondary"
                      disabled={savingCrud || deletingPost}
                      onPress={() => setDiscardEdits(true)}
                      style={{ flex: 1 }}
                    />
                  </View>

                  {/* Delete Post with Confirmation */}
                  {moment?.id ? (
                    confirmingDelete ? (
                      <View
                        style={[
                          styles.deleteConfirmBox,
                          {
                            backgroundColor: colors.dangerSoft,
                            borderColor: colors.danger,
                            borderRadius: radii.input,
                          },
                        ]}>
                        <Text style={[styles.deleteConfirmText, { color: colors.danger }]}>
                          Delete this Moment permanently? This cannot be undone.
                        </Text>
                        <View style={styles.editActionsRow}>
                          <KeepItButton
                            label="Confirm Delete"
                            variant="danger"
                            loading={deletingPost}
                            onPress={() => void handleConfirmDelete()}
                            style={{ flex: 1 }}
                          />
                          <KeepItButton
                            label="Keep Post"
                            variant="secondary"
                            disabled={deletingPost}
                            onPress={() => setConfirmingDelete(false)}
                            style={{ flex: 1 }}
                          />
                        </View>
                      </View>
                    ) : (
                      <KeepItButton
                        label="Delete Post"
                        variant="danger"
                        disabled={savingCrud}
                        onPress={() => setConfirmingDelete(true)}
                      />
                    )
                  ) : null}
                </View>
              ) : null}

              {/* Comments List & Input inside Sheet */}
              <View style={styles.commentsSection}>
                <Text style={[styles.editorLabel, { color: colors.inkMuted }]}>
                  Comments ({localComments.length})
                </Text>
                {localComments.length > 0 ? (
                  <View style={{ gap: 6 }}>
                    {localComments.map((cmt) => {
                      const canDeleteCmt =
                        cmt.author_id === effectiveUserId || ownerFlag;
                      return (
                        <View
                          key={cmt.id}
                          style={[
                            styles.commentBubble,
                            {
                              backgroundColor: colors.surfaceElevated,
                              borderColor: colors.border,
                              borderRadius: radii.input,
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 8,
                            },
                          ]}>
                          <Text style={[styles.commentAuthor, { color: colors.ink, flex: 1 }]}>
                            {cmt.author_name}
                            {cmt.author_username ? ` (@${cmt.author_username})` : ''}:{' '}
                            <Text style={[styles.commentBody, { color: colors.ink }]}>
                              {cmt.text}
                            </Text>
                          </Text>
                          {canDeleteCmt ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Delete comment"
                              onPress={() => setPendingDeleteComment(cmt.id)}
                              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ color: colors.danger, fontSize: 13, fontWeight: '600' }}>
                                Delete
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={[styles.storyModalSub, { color: colors.inkMuted }]}>
                    No comments yet. Leave a note below.
                  </Text>
                )}

                <View style={styles.commentInputRow}>
                  <TextInput
                    accessibilityLabel="Add a comment"
                    value={commentInput}
                    placeholder="Add a comment..."
                    placeholderTextColor={colors.inkMuted}
                    onChangeText={setCommentInput}
                    onSubmitEditing={() => void handlePostComment()}
                    style={[
                      styles.commentInput,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.controlBorder,
                        color: colors.ink,
                        borderRadius: radii.input,
                      },
                    ]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Post comment"
                    accessibilityState={{ busy: postingComment, disabled: postingComment || !commentInput.trim() }}
                    disabled={postingComment || !commentInput.trim()}
                    onPress={() => void handlePostComment()}
                    style={[
                      styles.postCommentBtn,
                      {
                        backgroundColor: commentInput.trim()
                          ? colors.accent
                          : colors.surfaceElevated,
                        borderColor: colors.border,
                        borderRadius: radii.input,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.postCommentBtnText,
                        {
                          color: commentInput.trim() ? colors.onAccent : colors.inkMuted,
                        },
                      ]}>
                      {postingComment ? 'Posting…' : 'Post'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Full-Screen 9:16 Story Share Modal (Item #19) */}
      <Modal
        visible={storyModalOpen}
        animationType={motionEnabled ? 'slide' : 'none'}
        transparent
        onRequestClose={() => { if (!storySharing) setStoryModalOpen(false); }}>
        <View style={styles.storyModalBackdrop}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.storyModalContent}
            style={[
              styles.storyModalSheet,
              {
                backgroundColor: colors.sheetSurface,
                borderColor: colors.border,
                borderRadius: radii.group,
              },
            ]}>
            <View style={styles.metaTopRow}>
              <View>
                <Text style={[styles.storyModalTitle, { color: colors.ink }]}>
                  9:16 Story Studio
                </Text>
                <Text style={[styles.storyModalSub, { color: colors.inkMuted }]}>
                  Vertical story card with #KeepIt watermark
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close Story modal"
                disabled={storySharing}
                onPress={() => { if (!storySharing) setStoryModalOpen(false); }}
                style={[
                  styles.smallActionChip,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.controlBorder,
                    borderRadius: radii.input,
                  },
                ]}>
                <Text style={[styles.smallActionText, { color: colors.ink }]}>
                  Close
                </Text>
              </Pressable>
            </View>

            {/* 9:16 Vertical Framed Preview */}
            <View style={styles.storyCanvasPreviewWrap}>
              <View
                style={[
                  styles.storyCanvasFrame,
                  {
                    borderColor: colors.border,
                    borderRadius: radii.card,
                  },
                ]}>
                <Image
                  source={{ uri: storyDataUri }}
                  contentFit="contain"
                  style={styles.fullImage}
                />
              </View>
            </View>

            {/* Background Theme Selector */}
            <View style={{ gap: 6 }}>
              <Text style={[styles.editorLabel, { color: colors.inkMuted }]}>
                Story Background Theme
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalPillsRow}>
                {STORY_THEME_PRESETS.map((preset) => {
                  const active = storyTheme === preset.id;
                  return (
                    <Pressable
                      key={preset.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active, disabled: storySharing }}
                      disabled={storySharing}
                      onPress={() => setStoryTheme(preset.id)}
                      style={[
                        styles.OptionPill,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surfaceElevated,
                          borderColor: active ? colors.accent : colors.controlBorder,
                          borderRadius: radii.input,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.optionPillText,
                          { color: active ? colors.onAccent : colors.ink },
                        ]}>
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <KeepItButton
              label="Share / Download 9:16 Story"
              loading={storySharing}
              onPress={() => void handleShare9x16Story()}
            />
          </ScrollView>
        </View>
      </Modal>
      <Modal visible={Boolean(pendingDeleteComment || discardEdits)} transparent animationType={motionEnabled ? 'fade' : 'none'} onRequestClose={() => { setPendingDeleteComment(null); setDiscardEdits(false); }}>
        <View style={styles.storyModalBackdrop}>
          <View accessibilityViewIsModal style={[styles.confirmDialog, { backgroundColor: colors.surface, borderRadius: radii.card }]}>
            <SectionHeader title={discardEdits ? 'Discard Moment edits?' : 'Delete this comment?'} subtitle={discardEdits ? 'Your unsaved changes will be lost.' : 'This cannot be undone.'} />
            <KeepItButton label={discardEdits ? 'Discard edits' : 'Delete comment'} variant="danger" onPress={() => { if (discardEdits) { setDiscardEdits(false); setEditing(false); } else if (pendingDeleteComment) { const id = pendingDeleteComment; setPendingDeleteComment(null); void handleDeleteComment(id); } }} />
            <KeepItButton label={discardEdits ? 'Keep editing' : 'Keep comment'} variant="secondary" onPress={() => { setPendingDeleteComment(null); setDiscardEdits(false); }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function LockedMomentCard({
  partnerName,
  postedAtIso,
  lateBySeconds,
  isLate: _isLate,
  isPromptCheckIn = true,
  onCaptureMine,
}: {
  partnerName: string;
  postedAtIso: string;
  lateBySeconds: number;
  isLate: boolean;
  isPromptCheckIn?: boolean;
  onCaptureMine: () => void;
}) {
  const { colors, radii, spacing } = useKeepItTheme();
  const timeFormatted = new Date(postedAtIso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View
      style={[
        styles.lockedFrame,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radii.photo,
          padding: spacing.xl,
        },
      ]}>
      <View style={styles.lockedTopMotif}>
        <DualFrameMark size={52} />
      </View>

      <View style={styles.lockedCenter}>
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.border,
              borderRadius: radii.pill,
            },
          ]}>
          <Text style={[styles.statusPillText, { color: colors.ink }]}>
            {partnerName} posted at {timeFormatted}
            {isPromptCheckIn ? ` · ${formatLateDuration(lateBySeconds)}` : ''}
          </Text>
        </View>

        <Text style={[styles.lockedTitle, { color: colors.ink }]}>
          {partnerName}’s Moment is waiting
        </Text>
        <Text style={[styles.lockedBody, { color: colors.inkMuted }]}>
          Post yours to unlock both Moments.
        </Text>

        <KeepItButton label="Post Yours to Reveal" onPress={onCaptureMine} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  confirmDialog: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: 20, gap: 16 },
  postCard: {
    borderWidth: 1.5,
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  postHeader: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  photoFrame: {
    width: '100%',
    aspectRatio: 0.75,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  pipAnchor: {
    position: 'absolute',
    top: 14,
    left: 14,
    zIndex: 4,
  },
  pipFrame: {
    width: 80,
    height: 107,
    borderRadius: 10,
    borderWidth: 2.5,
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  overlayItemAnchor: {
    position: 'absolute',
    transform: [{ translateX: -24 }, { translateY: -18 }],
    zIndex: 5,
  },
  overlayEmojiText: {
    fontSize: 34,
  },
  overlayTextPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.26)',
  },
  overlayTextLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  badgeStack: {
    position: 'absolute',
    top: 14,
    right: 14,
    alignItems: 'flex-end',
    gap: 6,
    zIndex: 6,
    maxWidth: '60%',
  },
  statusPill: {
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderCurve: 'continuous',
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  keepItPhotoWatermark: {
    position: 'absolute',
    bottom: 14,
    left: 16,
    alignItems: 'flex-start',
    gap: 4,
    zIndex: 6,
    backgroundColor: 'rgba(10, 7, 8, 0.72)',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  keepItWatermarkTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.6,
    lineHeight: 20,
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  keepItWatermarkTime: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  videoProgressTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
    zIndex: 6,
  },
  videoProgressFill: {
    height: '100%',
  },
  snapOverlayContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 12,
  },
  snapIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snapIconEmoji: {
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  snapOverlayTitle: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
    textAlign: 'center',
  },
  snapOverlaySub: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  cornerHubAnchor: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    zIndex: 8,
  },
  cornerHubBtn: {
    minWidth: 46,
    minHeight: 46,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderCurve: 'continuous',
  },
  cornerHubEmoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  cornerHubCountText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  radialDismissBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(10, 7, 8, 0.35)',
    zIndex: 9,
  },
  radialFanBar: {
    position: 'absolute',
    bottom: 68,
    right: 14,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  radialEmojiBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  radialEmojiText: {
    fontSize: 22,
  },
  radialMoreBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginLeft: 2,
  },
  compactCaptionStrip: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  belowCornerReactionBtn: {
    minHeight: 40,
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  compactCaptionLeft: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  compactCaptionText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  compactContextMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  compactCaptionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  compactSummaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  compactSummaryEmoji: {
    fontSize: 13,
  },
  compactSummaryCount: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  compactOpenLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  hubModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'flex-end',
  },
  hubSheetContainer: {
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
    maxHeight: '88%',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 10,
    borderCurve: 'continuous',
  },
  hubGrabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 4,
  },
  hubSheetScrollContent: {
    gap: 16,
    paddingBottom: 32,
  },
  sheetQuickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sheetActionBtn: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  metaTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  attachmentChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  attachmentChip: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  attachmentChipText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  smallActionChip: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderCurve: 'continuous',
  },
  smallActionText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  editorPanel: {
    padding: 0,
    gap: 20,
    borderCurve: 'continuous',
  },
  editorSectionTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
  },
  editorLabel: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
  },
  horizontalPillsRow: {
    gap: 8,
    paddingVertical: 2,
  },
  OptionPill: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  optionPillText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  clearOverlaysBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  clearOverlaysText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  emojiStickerBtn: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiStickerBtnText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  overlayInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  snapSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  captionInput: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    borderCurve: 'continuous',
  },
  editActionsRow: {
    flexDirection: 'column',
    gap: 10,
  },
  deleteConfirmBox: {
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  deleteConfirmText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reactionChip: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderCurve: 'continuous',
  },
  reactionEmoji: {
    fontSize: 18,
  },
  reactionCount: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  commentsSection: {
    gap: 8,
  },
  commentBubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderCurve: 'continuous',
  },
  commentAuthor: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
  },
  commentBody: {
    fontWeight: '500',
  },
  commentInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  commentInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    borderCurve: 'continuous',
  },
  postCommentBtn: {
    borderWidth: 1,
    paddingHorizontal: 16,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  postCommentBtnText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  storyModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'center',
    padding: 18,
  },
  storyModalSheet: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    maxHeight: '94%',
  },
  storyModalContent: {
    padding: 20,
    gap: 20,
  },
  storyModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  storyModalSub: {
    fontSize: 13,
    lineHeight: 20,
  },
  storyCanvasPreviewWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyCanvasFrame: {
    width: '72%',
    maxWidth: 290,
    aspectRatio: 9 / 16,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: '#09090B',
  },
  lockedFrame: {
    width: '100%',
    minHeight: 300,
    justifyContent: 'space-between',
    position: 'relative',
    borderCurve: 'continuous',
  },
  lockedTopMotif: {
    alignSelf: 'flex-start',
  },
  lockedCenter: {
    gap: 14,
    alignItems: 'center',
    marginVertical: 'auto',
  },
  lockedTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  lockedBody: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});
