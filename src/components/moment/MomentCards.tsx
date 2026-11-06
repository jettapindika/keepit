import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
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
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import {
  addMomentComment,
  buildSimulatedDualPhotos,
  deleteMomentPost,
  formatLateDuration,
  markSnapOnceMomentState,
  toggleMomentReaction,
  updateMomentDetails,
} from '@/api/moments';
import {
  CURATED_MUSIC_TRACKS,
  getFilterPresetMeta,
  MOMENT_FILTER_PRESETS,
  QUICK_LOCATION_PRESETS,
} from '@/api/social';
import { InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
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
  buildMomentCompositeSvgDataUri,
  downloadOrShareMomentUri,
  STORY_THEME_PRESETS,
  StoryThemePreset,
} from '@/utils/momentExport';

const QUICK_REACTION_EMOJIS = ['❤️', '🔥', '🥹', '😂', '👏'] as const;
const OVERLAY_STICKER_EMOJIS = ['❤️‍🔥', '✨', '🥹', '☕️', '🫶', '🔥', '🌙', '🎧'] as const;

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
  isLate: propIsLate,
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
  const motionEnabled = useSessionStore((s) => s.motionEnabled);
  const motionSpeed = useSessionStore((s) => s.motionSpeed);

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

  // Local optimistic state synced with `moment` prop updates
  const [localCaption, setLocalCaption] = useState<string | null>(
    propCaption !== undefined ? propCaption : (moment?.caption ?? null)
  );
  const [localFilterPreset, setLocalFilterPreset] = useState<MomentFilterPreset>(
    moment?.filter_preset ?? 'normal'
  );
  const [localLocationLabel, setLocalLocationLabel] = useState<string | null>(
    moment?.location_label ?? null
  );
  const [localMusicTrack, setLocalMusicTrack] = useState<MusicTrackAttachment | null>(
    moment?.music_track ?? null
  );
  const [localOverlays, setLocalOverlays] = useState<PhotoOverlayItem[]>(
    moment?.overlays ?? []
  );
  const [localSnapOnce, setLocalSnapOnce] = useState<boolean>(Boolean(moment?.snap_once));
  const [localReactions, setLocalReactions] = useState<Record<string, string>>(
    moment?.reactions ?? {}
  );
  const [localComments, setLocalComments] = useState<MomentCommentRecord[]>(
    moment?.comments ?? []
  );

  useEffect(() => {
    setLocalCaption(propCaption !== undefined ? propCaption : (moment?.caption ?? null));
    setLocalFilterPreset(moment?.filter_preset ?? 'normal');
    setLocalLocationLabel(moment?.location_label ?? null);
    setLocalMusicTrack(moment?.music_track ?? null);
    setLocalOverlays(moment?.overlays ?? []);
    setLocalSnapOnce(Boolean(moment?.snap_once));
    setLocalReactions(moment?.reactions ?? {});
    setLocalComments(moment?.comments ?? []);
  }, [
    moment?.id,
    moment?.caption,
    moment?.filter_preset,
    moment?.location_label,
    moment?.music_track,
    moment?.overlays,
    moment?.snap_once,
    moment?.reactions,
    moment?.comments,
    propCaption,
  ]);

  // Partner Image Fix (Item #2): always guarantee non-empty dual photos once unlocked
  const fallbackPhotos = buildSimulatedDualPhotos({
    authorLabel: authorName,
    sceneLabel: 'Shared KeepIt Moment',
    filterPreset: localFilterPreset,
  });

  const resolvedBackUri =
    (backPhotoUrl && backPhotoUrl.trim()) ||
    (moment?.back_photo_url && moment.back_photo_url.trim()) ||
    (moment?.back_photo_path && moment.back_photo_path.trim()) ||
    fallbackPhotos.backUri;

  const resolvedFrontUri =
    (frontPhotoUrl && frontPhotoUrl.trim()) ||
    (moment?.front_photo_url && moment.front_photo_url.trim()) ||
    (moment?.front_photo_path && moment.front_photo_path.trim()) ||
    fallbackPhotos.frontUri;

  const [swapped, setSwapped] = useState(false);
  const mainSource = swapped ? resolvedFrontUri : resolvedBackUri;
  const pipSource = swapped ? resolvedBackUri : resolvedFrontUri;

  const postedAtIso = propPostedAtIso ?? moment?.posted_at ?? new Date().toISOString();
  const lateBySeconds = propLateBySeconds ?? moment?.late_by_seconds ?? 0;
  const isLate = propIsLate ?? moment?.is_late ?? lateBySeconds > 120;
  const retakeCount = propRetakeCount ?? moment?.retake_count ?? 0;
  const mediaType: MomentMediaType = moment?.media_type ?? 'photo';
  const videoDurationSec = moment?.video_duration_seconds ?? 6;
  const taggedUsers: TaggedPerson[] = moment?.tagged_users ?? [];

  // Video loop playback state (Item #18)
  const [videoPlaying, setVideoPlaying] = useState(mediaType === 'video');
  const [videoProgressPct, setVideoProgressPct] = useState(0);
  const videoTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    clearInterval(videoTimerRef.current);
    if (mediaType !== 'video' || !videoPlaying) {
      return;
    }
    const stepMs = 200;
    const totalSteps = Math.max(10, Math.round((videoDurationSec * 1000) / stepMs));
    videoTimerRef.current = setInterval(() => {
      setVideoProgressPct((prev) => {
        const next = prev + 100 / totalSteps;
        return next >= 100 ? 0 : next;
      });
    }, stepMs) as unknown as number;

    return () => {
      clearInterval(videoTimerRef.current);
    };
  }, [mediaType, videoPlaying, videoDurationSec]);

  // Music preview state (Item #9)
  const [musicPlaying, setMusicPlaying] = useState(false);

  // Snap Once 15s disappearing mode state (Item #14)
  const alreadyViewed = Boolean(
    moment?.viewed_by_user_ids?.includes(effectiveUserId)
  );
  const [snapOpened, setSnapOpened] = useState(false);
  const [snapExpired, setSnapExpired] = useState(alreadyViewed);
  const [snapSecondsLeft, setSnapSecondsLeft] = useState(15);
  const snapTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setSnapExpired(Boolean(moment?.viewed_by_user_ids?.includes(effectiveUserId)));
  }, [moment?.id, moment?.viewed_by_user_ids, effectiveUserId]);

  useEffect(() => {
    return () => {
      clearInterval(snapTimerRef.current);
    };
  }, []);

  const handleOpenSnapOnce = () => {
    if (snapOpened || snapExpired) return;
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setSnapOpened(true);
    setSnapSecondsLeft(15);
    if (moment?.id) {
      void markSnapOnceMomentState({
        momentId: moment.id,
        coupleId: effectiveCoupleId,
        viewerId: effectiveUserId,
        expired: false,
      });
    }
    clearInterval(snapTimerRef.current);
    snapTimerRef.current = setInterval(() => {
      setSnapSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(snapTimerRef.current);
          setSnapExpired(true);
          if (moment?.id) {
            void markSnapOnceMomentState({
              momentId: moment.id,
              coupleId: effectiveCoupleId,
              viewerId: effectiveUserId,
              expired: true,
            }).then(() => {
              void onUpdated?.();
            });
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000) as unknown as number;
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
  const [draftSnapOnce, setDraftSnapOnce] = useState(localSnapOnce);

  // Comments & Reactions state (Item #13)
  const [commentInput, setCommentInput] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // Download & 9:16 Story Share modal state (Item #15 & #19)
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const [storyModalOpen, setStoryModalOpen] = useState(false);
  const [storyTheme, setStoryTheme] = useState<StoryThemePreset>('midnight');
  const [storySharing, setStorySharing] = useState(false);

  const pipScale = useSharedValue(1);
  const pipStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pipScale.get() }],
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

  const handleOpenEditor = () => {
    setDraftCaption(localCaption ?? '');
    setDraftFilter(localFilterPreset);
    setDraftLocation(localLocationLabel ?? '');
    setDraftMusic(localMusicTrack);
    setDraftOverlays(localOverlays);
    setDraftOverlayText('');
    setDraftSnapOnce(localSnapOnce);
    setConfirmingDelete(false);
    setCrudError(null);
    setEditing(true);
  };

  const handleAddEmojiOverlay = (emoji: string) => {
    const idx = draftOverlays.length;
    const nextItem: PhotoOverlayItem = {
      id: `ov_${Date.now().toString(36)}_${idx}`,
      kind: 'emoji',
      content: emoji,
      xPct: 24 + ((idx * 19) % 56),
      yPct: 26 + ((idx * 23) % 48),
    };
    setDraftOverlays((prev) => [...prev, nextItem]);
  };

  const handleAddTextOverlay = () => {
    const cleaned = draftOverlayText.trim();
    if (!cleaned) return;
    const idx = draftOverlays.length;
    const nextItem: PhotoOverlayItem = {
      id: `ov_${Date.now().toString(36)}_${idx}`,
      kind: 'text',
      content: cleaned.slice(0, 36),
      bgStyle: 'glass',
      xPct: 50,
      yPct: 42 + ((idx * 14) % 36),
    };
    setDraftOverlays((prev) => [...prev, nextItem]);
    setDraftOverlayText('');
  };

  const handleSaveEditor = async () => {
    setSavingCrud(true);
    setCrudError(null);
    try {
      const nextCaptionTrimmed = draftCaption.trim() ? draftCaption.trim() : null;
      const nextLocTrimmed = draftLocation.trim() ? draftLocation.trim() : null;

      if (moment?.id) {
        const updated = await updateMomentDetails({
          momentId: moment.id,
          userId: moment.user_id || effectiveUserId,
          caption: nextCaptionTrimmed,
          filterPreset: draftFilter,
          locationLabel: nextLocTrimmed,
          musicTrack: draftMusic,
          overlays: draftOverlays,
          snapOnce: draftSnapOnce,
        });
        setLocalCaption(updated.caption);
        setLocalFilterPreset(updated.filter_preset ?? 'normal');
        setLocalLocationLabel(updated.location_label ?? null);
        setLocalMusicTrack(updated.music_track ?? null);
        setLocalOverlays(updated.overlays ?? []);
        setLocalSnapOnce(Boolean(updated.snap_once));
        await onUpdated?.(updated);
      } else if (onSaveCaption) {
        await onSaveCaption(draftCaption.trim());
        setLocalCaption(nextCaptionTrimmed);
        setLocalFilterPreset(draftFilter);
        setLocalLocationLabel(nextLocTrimmed);
        setLocalMusicTrack(draftMusic);
        setLocalOverlays(draftOverlays);
        setLocalSnapOnce(draftSnapOnce);
      } else {
        setLocalCaption(nextCaptionTrimmed);
        setLocalFilterPreset(draftFilter);
        setLocalLocationLabel(nextLocTrimmed);
        setLocalMusicTrack(draftMusic);
        setLocalOverlays(draftOverlays);
        setLocalSnapOnce(draftSnapOnce);
      }
      setEditing(false);
    } catch (err) {
      setCrudError(err instanceof Error ? err.message : 'Could not update Moment.');
    } finally {
      setSavingCrud(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!moment?.id) return;
    setDeletingPost(true);
    setCrudError(null);
    try {
      await deleteMomentPost({
        momentId: moment.id,
        userId: moment.user_id || effectiveUserId,
        coupleId: effectiveCoupleId,
      });
      setEditing(false);
      await onDeleted?.(moment.id);
      await onUpdated?.();
    } catch (err) {
      setCrudError(err instanceof Error ? err.message : 'Could not delete Moment.');
    } finally {
      setDeletingPost(false);
    }
  };

  const handleToggleReaction = async (emoji: string) => {
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
    const nextReactions = { ...localReactions };
    if (nextReactions[effectiveUserId] === emoji) {
      delete nextReactions[effectiveUserId];
    } else {
      nextReactions[effectiveUserId] = emoji;
    }
    setLocalReactions(nextReactions);

    if (moment?.id) {
      try {
        await toggleMomentReaction({
          momentId: moment.id,
          coupleId: effectiveCoupleId,
          userId: effectiveUserId,
          emoji,
        });
        await onUpdated?.();
      } catch {
        // Optimistic update stays responsive
      }
    }
  };

  const handlePostComment = async () => {
    const cleaned = commentInput.trim();
    if (!cleaned) return;
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
        setLocalComments((prev) => [...prev, created]);
        setCommentInput('');
        await onUpdated?.();
      } else {
        const fallbackComment: MomentCommentRecord = {
          id: `cmt_${Date.now().toString(36)}`,
          moment_id: 'local_moment',
          author_id: effectiveUserId,
          author_name: authorDisplay,
          author_username: authorHandle,
          text: cleaned,
          created_at: new Date().toISOString(),
        };
        setLocalComments((prev) => [...prev, fallbackComment]);
        setCommentInput('');
      }
    } finally {
      setPostingComment(false);
    }
  };

  const handleSave3x4Photo = async () => {
    const dataUri = buildMomentCompositeSvgDataUri({
      backUri: mainSource,
      frontUri: pipSource,
      authorName,
      caption: localCaption,
      locationLabel: localLocationLabel,
      musicTitle: localMusicTrack
        ? `${localMusicTrack.title} · ${localMusicTrack.artist}`
        : null,
      filterPreset: localFilterPreset,
      overlays: localOverlays,
      aspect: '3:4',
    });
    const safeAuthor = authorName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'keepit';
    const msg = await downloadOrShareMomentUri({
      dataUri,
      filename: `keepit-${safeAuthor}-3x4.svg`,
      title: `${authorName}’s KeepIt Moment`,
    });
    setActionBanner(msg);
  };

  const storyDataUri = buildMomentCompositeSvgDataUri({
    backUri: mainSource,
    frontUri: pipSource,
    authorName,
    caption: localCaption,
    locationLabel: localLocationLabel,
    musicTitle: localMusicTrack
      ? `${localMusicTrack.title} · ${localMusicTrack.artist}`
      : null,
    filterPreset: localFilterPreset,
    overlays: localOverlays,
    aspect: '9:16',
    storyTheme,
  });

  const handleShare9x16Story = async () => {
    setStorySharing(true);
    try {
      const safeAuthor = authorName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'keepit';
      const msg = await downloadOrShareMomentUri({
        dataUri: storyDataUri,
        filename: `keepit-story-${safeAuthor}-9x16.svg`,
        title: `${authorName}’s 9:16 KeepIt Story`,
      });
      setActionBanner(msg);
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

  return (
    <View style={{ gap: spacing.md }}>
      {/* Main 3:4 Photo Container */}
      <View
        style={[
          styles.photoFrame,
          {
            backgroundColor: colors.surface,
            borderColor:
              localFilterPreset !== 'normal' ? filterMeta.borderAccent : colors.border,
            borderRadius: radii.photo,
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
              <Text style={styles.snapIconEmoji}>🔥</Text>
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
                { backgroundColor: colors.accentSoft, borderColor: colors.warning },
              ]}>
              <Text style={styles.snapIconEmoji}>🔥</Text>
            </View>
            <Text style={[styles.snapOverlayTitle, { color: colors.ink }]}>
              🔥 Snap Once · Tap to view for 15s
            </Text>
            <Text style={[styles.snapOverlaySub, { color: colors.inkMuted }]}>
              {authorName} sent a 15-second disappearing Moment. Tap when ready!
            </Text>
          </Pressable>
        ) : (
          <>
            <Image
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
            <Animated.View style={[styles.pipAnchor, pipStyle]}>
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
                  source={{ uri: pipSource }}
                  contentFit="cover"
                  style={styles.fullImage}
                />
              </Pressable>
            </Animated.View>

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
                            ? '#A855F7'
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
                      backgroundColor: colors.warning,
                      borderColor: colors.warning,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.statusPillText, { color: '#000000' }]}>
                    🔥 {snapSecondsLeft}s left
                  </Text>
                </View>
              ) : null}

              {localSnapOnce && ownerFlag ? (
                <View
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor: colors.canvas,
                      borderColor: colors.warning,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.statusPillText, { color: colors.warning }]}>
                    🔥 Snap Once · 15s
                  </Text>
                </View>
              ) : null}

              {mediaType === 'video' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={videoPlaying ? 'Pause video loop' : 'Play video loop'}
                  onPress={() => setVideoPlaying((prev) => !prev)}
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor: colors.canvas,
                      borderColor: colors.accent,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.statusPillText, { color: colors.ink }]}>
                    {videoPlaying ? '⏸' : '▶'} VIDEO · {videoDurationSec}s
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
                    ✨ {filterMeta.label}
                  </Text>
                </View>
              ) : null}

              <View
                style={[
                  styles.statusPill,
                  {
                    backgroundColor: colors.canvas,
                    borderColor: isLate ? colors.warning : colors.border,
                    borderRadius: radii.pill,
                  },
                ]}>
                <Text
                  style={[
                    styles.statusPillText,
                    { color: isLate ? colors.warning : colors.ink },
                  ]}>
                  {formatLateDuration(lateBySeconds)}
                </Text>
              </View>

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
            {mediaType === 'video' ? (
              <View style={styles.videoProgressTrack}>
                <View
                  style={[
                    styles.videoProgressFill,
                    {
                      width: `${videoPlaying ? videoProgressPct : 100}%`,
                      backgroundColor: colors.accent,
                    },
                  ]}
                />
              </View>
            ) : null}

            {/* #KeepIt Bottom-Left Watermark (Item #8) */}
            <View style={styles.keepItWatermarkPill}>
              <Text style={styles.keepItWatermarkText}>
                {moment?.watermark_tag ?? '#KeepIt'}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Caption + Rich Metadata + Social + CRUD + Share Card */}
      <View
        style={[
          styles.metaCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.card,
            padding: spacing.lg,
          },
        ]}>
        <View style={styles.metaTopRow}>
          <View style={styles.authorRow}>
            <Text style={[styles.authorText, { color: colors.ink }]}>{authorName}</Text>
            {moment?.daily_index && moment.daily_index > 1 ? (
              <View
                style={[
                  styles.dailyShotBadge,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                ]}>
                <Text style={[styles.dailyShotBadgeText, { color: colors.inkMuted }]}>
                  #{moment.daily_index}/5
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.timestampText, { color: colors.inkMuted }]}>
            {timeFormatted}
          </Text>
        </View>

        {/* Location, Music & Tagged People Badges (Item #7 & #9) */}
        {localLocationLabel || localMusicTrack || taggedUsers.length > 0 ? (
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
                  📍 {localLocationLabel}
                </Text>
              </View>
            ) : null}

            {localMusicTrack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Toggle music preview ${localMusicTrack.title}`}
                onPress={() => setMusicPlaying((prev) => !prev)}
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
                  🎵 {localMusicTrack.title} · {localMusicTrack.artist}
                  {musicPlaying ? '  ♫ Playing preview...' : ''}
                </Text>
              </Pressable>
            ) : null}

            {taggedUsers.map((person) => (
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
                  🏷️ @{person.username}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Full Post CRUD Inline Editor for Owner (Item #11) */}
        {editing ? (
          <View
            style={[
              styles.editorPanel,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                borderRadius: radii.input,
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
                value={draftCaption}
                maxLength={160}
                placeholder="Add a caption (up to 160 chars)..."
                placeholderTextColor={colors.inkMuted}
                onChangeText={setDraftCaption}
                style={[
                  styles.captionInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
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
                      onPress={() => setDraftFilter(preset.id)}
                      style={[
                        styles.OptionPill,
                        {
                          backgroundColor: active ? colors.accent : colors.surface,
                          borderColor: active ? colors.accent : colors.border,
                          borderRadius: radii.pill,
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
                value={draftLocation}
                placeholder="Custom location or choose below..."
                placeholderTextColor={colors.inkMuted}
                onChangeText={setDraftLocation}
                style={[
                  styles.captionInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
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
                      onPress={() => setDraftLocation(loc.label)}
                      style={[
                        styles.OptionPill,
                        {
                          backgroundColor: active ? colors.accent : colors.surface,
                          borderColor: active ? colors.accent : colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.optionPillText,
                          { color: active ? colors.onAccent : colors.ink },
                        ]}>
                        📍 {loc.label}
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
                      onPress={() => setDraftMusic(trk)}
                      style={[
                        styles.OptionPill,
                        {
                          backgroundColor: active ? colors.accent : colors.surface,
                          borderColor: active ? colors.accent : colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.optionPillText,
                          { color: active ? colors.onAccent : colors.ink },
                        ]}>
                        🎵 {trk.title} · {trk.artist}
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
                  value={draftOverlayText}
                  placeholder="Add text banner on photo..."
                  placeholderTextColor={colors.inkMuted}
                  onChangeText={setDraftOverlayText}
                  style={[
                    styles.captionInput,
                    {
                      flex: 1,
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      color: colors.ink,
                      borderRadius: radii.input,
                    },
                  ]}
                />
                <Pressable
                  accessibilityRole="button"
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
            </View>

            {/* Snap Once Toggle */}
            <View style={styles.snapSwitchRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.editorSectionTitle, { color: colors.ink, fontSize: 14 }]}>
                  🔥 Snap Once (15s Disappearing)
                </Text>
                <Text style={[styles.editorLabel, { color: colors.inkMuted }]}>
                  Expires 15 seconds after your partner or friend opens it
                </Text>
              </View>
              <Switch
                value={draftSnapOnce}
                onValueChange={setDraftSnapOnce}
                trackColor={{ false: colors.border, true: colors.warning }}
              />
            </View>

            <View style={styles.editActionsRow}>
              <KeepItButton
                label="Save Changes"
                loading={savingCrud}
                onPress={() => void handleSaveEditor()}
                style={{ flex: 1 }}
              />
              <KeepItButton
                label="Cancel"
                variant="secondary"
                disabled={savingCrud || deletingPost}
                onPress={() => setEditing(false)}
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
                  label="🗑 Delete Post"
                  variant="danger"
                  disabled={savingCrud}
                  onPress={() => setConfirmingDelete(true)}
                />
              )
            ) : null}
          </View>
        ) : (
          <View style={styles.captionRow}>
            <Text
              style={[
                styles.captionText,
                { color: localCaption ? colors.ink : colors.inkMuted },
              ]}>
              {localCaption ? `“${localCaption}”` : 'No note added.'}
            </Text>

            <View style={styles.inlineButtonRow}>
              {ownerFlag || editableCaption ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit or manage Moment"
                  onPress={handleOpenEditor}
                  style={[
                    styles.smallActionChip,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.smallActionText, { color: colors.ink }]}>
                    ✏️ Edit / Manage
                  </Text>
                </Pressable>
              ) : null}

              {canRetake && onRetake ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retake today's Moment"
                  onPress={onRetake}
                  style={[
                    styles.smallActionChip,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.smallActionText, { color: colors.accent }]}>
                    Retake ({Math.max(0, 2 - retakeCount)} left)
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}

        {/* Quick Emoji Reactions Bar (Item #13) */}
        <View style={styles.reactionRow}>
          {QUICK_REACTION_EMOJIS.map((emoji) => {
            const count = reactionCounts[emoji] ?? 0;
            const selected = localReactions[effectiveUserId] === emoji;
            return (
              <Pressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={`React with ${emoji}`}
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
                <Text style={styles.reactionEmoji}>{emoji}</Text>
                {count > 0 ? (
                  <Text style={[styles.reactionCount, { color: colors.ink }]}>
                    {count}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {/* Comments List & Inline Input (Item #13) */}
        <View style={styles.commentsSection}>
          {localComments.length > 0 ? (
            <View style={{ gap: 6 }}>
              {localComments.map((cmt) => (
                <View
                  key={cmt.id}
                  style={[
                    styles.commentBubble,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                      borderRadius: radii.input,
                    },
                  ]}>
                  <Text style={[styles.commentAuthor, { color: colors.ink }]}>
                    {cmt.author_name}
                    {cmt.author_username ? ` (@${cmt.author_username})` : ''}:{' '}
                    <Text style={[styles.commentBody, { color: colors.ink }]}>
                      {cmt.text}
                    </Text>
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

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
                  borderColor: colors.border,
                  color: colors.ink,
                  borderRadius: radii.pill,
                },
              ]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Post comment"
              disabled={postingComment || !commentInput.trim()}
              onPress={() => void handlePostComment()}
              style={[
                styles.postCommentBtn,
                {
                  backgroundColor: commentInput.trim()
                    ? colors.accent
                    : colors.surfaceElevated,
                  borderColor: colors.border,
                  borderRadius: radii.pill,
                },
              ]}>
              <Text
                style={[
                  styles.postCommentBtnText,
                  {
                    color: commentInput.trim() ? colors.onAccent : colors.inkMuted,
                  },
                ]}>
                Post
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Download Post (Item #15) & Share to 9:16 Story (Item #19) */}
        <View style={styles.exportActionBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save 3:4 photo with KeepIt watermark"
            onPress={() => void handleSave3x4Photo()}
            style={[
              styles.exportActionBtn,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                borderRadius: radii.pill,
              },
            ]}>
            <Text style={[styles.exportActionText, { color: colors.ink }]}>
              ⬇ Save Photo
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open 9:16 Story Share preview"
            onPress={() => setStoryModalOpen(true)}
            style={[
              styles.exportActionBtn,
              {
                backgroundColor: colors.accentSoft,
                borderColor: colors.accent,
                borderRadius: radii.pill,
              },
            ]}>
            <Text style={[styles.exportActionText, { color: colors.ink }]}>
              📱 Share 9:16 Story
            </Text>
          </Pressable>
        </View>

        {actionBanner ? (
          <InlineNotice message={actionBanner} tone="success" />
        ) : null}
      </View>

      {/* Full-Screen 9:16 Story Share Modal (Item #19) */}
      <Modal
        visible={storyModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setStoryModalOpen(false)}>
        <View style={styles.storyModalBackdrop}>
          <View
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
                onPress={() => setStoryModalOpen(false)}
                style={[
                  styles.smallActionChip,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                    borderRadius: radii.pill,
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
                      onPress={() => setStoryTheme(preset.id)}
                      style={[
                        styles.OptionPill,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surfaceElevated,
                          borderColor: active ? colors.accent : colors.border,
                          borderRadius: radii.pill,
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
  isLate,
  onCaptureMine,
}: {
  partnerName: string;
  postedAtIso: string;
  lateBySeconds: number;
  isLate: boolean;
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
      <View
        style={[
          styles.lockedPipSilhouette,
          {
            backgroundColor: colors.accentSoft,
            borderColor: colors.accent,
          },
        ]}
      />

      <View style={styles.lockedCenter}>
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: isLate ? colors.warning : colors.border,
              borderRadius: radii.pill,
            },
          ]}>
          <Text style={[styles.statusPillText, { color: isLate ? colors.warning : colors.ink }]}>
            {partnerName} posted at {timeFormatted} · {formatLateDuration(lateBySeconds)}
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
  photoFrame: {
    width: '100%',
    aspectRatio: 0.75,
    borderWidth: 1.5,
    overflow: 'hidden',
    position: 'relative',
    borderCurve: 'continuous',
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
    width: 102,
    height: 136,
    borderRadius: 16,
    borderWidth: 2,
    overflow: 'hidden',
    borderCurve: 'continuous',
    boxShadow: '0px 6px 16px rgba(0, 0, 0, 0.25)',
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
  },
  statusPill: {
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderCurve: 'continuous',
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  keepItWatermarkPill: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    backgroundColor: 'rgba(12, 12, 14, 0.78)',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.24)',
    zIndex: 6,
  },
  keepItWatermarkText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: -0.2,
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
    fontSize: 28,
  },
  snapOverlayTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  snapOverlaySub: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  metaCard: {
    borderWidth: 1,
    gap: 12,
    borderCurve: 'continuous',
  },
  metaTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  authorText: {
    fontSize: 16,
    fontWeight: '700',
  },
  dailyShotBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  dailyShotBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  timestampText: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  attachmentChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  attachmentChip: {
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderCurve: 'continuous',
  },
  attachmentChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  captionRow: {
    gap: 10,
  },
  captionText: {
    fontSize: 15,
    lineHeight: 21,
  },
  inlineButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  smallActionChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderCurve: 'continuous',
  },
  smallActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  editorPanel: {
    borderWidth: 1,
    padding: 14,
    gap: 12,
    borderCurve: 'continuous',
  },
  editorSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  editorLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  horizontalPillsRow: {
    gap: 8,
    paddingVertical: 2,
  },
  OptionPill: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderCurve: 'continuous',
  },
  optionPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  clearOverlaysBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  clearOverlaysText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emojiStickerBtn: {
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  emojiStickerBtnText: {
    fontSize: 13,
    fontWeight: '700',
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
    minHeight: 42,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    borderCurve: 'continuous',
  },
  editActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  deleteConfirmBox: {
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  deleteConfirmText: {
    fontSize: 13,
    fontWeight: '700',
  },
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderCurve: 'continuous',
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  commentsSection: {
    gap: 8,
  },
  commentBubble: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderCurve: 'continuous',
  },
  commentAuthor: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
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
    minHeight: 38,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
    fontSize: 13,
    borderCurve: 'continuous',
  },
  postCommentBtn: {
    borderWidth: 1,
    paddingHorizontal: 14,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  postCommentBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  exportActionBar: {
    flexDirection: 'row',
    gap: 8,
  },
  exportActionBtn: {
    flex: 1,
    borderWidth: 1,
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  exportActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  storyModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'center',
    padding: 18,
  },
  storyModalSheet: {
    borderWidth: 1,
    padding: 18,
    gap: 14,
    maxHeight: '94%',
  },
  storyModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  storyModalSub: {
    fontSize: 12,
    fontWeight: '600',
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
    aspectRatio: 0.78,
    borderWidth: 1,
    justifyContent: 'space-between',
    position: 'relative',
    borderCurve: 'continuous',
  },
  lockedPipSilhouette: {
    width: 84,
    height: 112,
    borderRadius: 16,
    borderWidth: 1.5,
    opacity: 0.65,
    borderCurve: 'continuous',
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
