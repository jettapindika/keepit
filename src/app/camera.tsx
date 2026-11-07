import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
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
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  buildSimulatedDualPhotos,
  fetchTodayMomentBundle,
  formatLateDuration,
  submitDailyMoment,
} from '@/api/moments';
import {
  CURATED_MUSIC_TRACKS,
  fetchFriendsCircle,
  getFilterPresetMeta,
  MOMENT_FILTER_PRESETS,
  QUICK_LOCATION_PRESETS,
} from '@/api/social';
import { InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { useMomentCountdown } from '@/hooks/useMomentCountdown';
import { useSessionStore } from '@/store/sessionStore';
import { MOCHY_SPRINGS, mochyTiming } from '@/theme/motion';
import { useKeepItTheme } from '@/theme/tokens';
import {
  MAX_DAILY_MOMENTS_PER_DAY,
  MomentFilterPreset,
  MomentMediaType,
  MusicTrackAttachment,
  PhotoOverlayItem,
  PostVisibility,
  TaggedPerson,
} from '@/types/database';
import { formatMomentWatermarkTimestamp } from '@/utils/momentExport';

type CaptureStage =
  | 'ready'
  | 'recording_video'
  | 'capturing_first'
  | 'switching_lens'
  | 'capturing_second'
  | 'preview';

const OVERLAY_STICKER_EMOJIS = ['❤️‍🔥', '✨', '🥹', '☕️', '🫶', '🔥', '🌙', '🎧', '🍒', '⚡'] as const;

function waitMs(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export default function CameraModalScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    promptId?: string;
    triggerAt?: string;
    retakesUsed?: string;
    replaceMomentId?: string;
    initialLens?: 'back' | 'front';
    initialMode?: 'photo' | 'video';
  }>();

  const { colors, radii, spacing } = useKeepItTheme();
  const user = useSessionStore((s) => s.user);
  const partner = useSessionStore((s) => s.partner);
  const couple = useSessionStore((s) => s.couple);
  const motionEnabled = useSessionStore((s) => s.motionEnabled);
  const motionSpeed = useSessionStore((s) => s.motionSpeed);

  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [pipSwapped, setPipSwapped] = useState(false);
  const pipRevealScale = useSharedValue(1);
  const shutterFlashOpacity = useSharedValue(0);

  const pipAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pipRevealScale.get() }],
  }));
  const shutterFlashStyle = useAnimatedStyle(() => ({
    opacity: shutterFlashOpacity.get(),
  }));
  const cameraRef = useRef<CameraView | null>(null);
  const cameraReadyResolverRef = useRef<(() => void) | null>(null);
  const activeRecordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const isMountedRef = useRef(true);
  const overlayCounterRef = useRef(0);
  // Supports starting from EITHER front camera or back camera!
  const [facing, setFacing] = useState<'back' | 'front'>(
    params.initialLens === 'front' ? 'front' : 'back'
  );
  const [captureOriginLens, setCaptureOriginLens] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [mediaType, setMediaType] = useState<MomentMediaType>(
    params.initialMode === 'video' ? 'video' : 'photo'
  );
  const [filterPreset, setFilterPreset] = useState<MomentFilterPreset>('normal');
  const [stage, setStage] = useState<CaptureStage>('ready');
  const [cameraReady, setCameraReady] = useState(false);
  const recordingTimerRef = useRef<number | undefined>(undefined);
  // Video recording state
  const [recordingSec, setRecordingSec] = useState(0);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoDurationSec, setVideoDurationSec] = useState<number | null>(null);

  // Captured frames
  const [backUri, setBackUri] = useState<string | null>(null);
  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [capturedAtIso, setCapturedAtIso] = useState<string | null>(null);
  const [caption, setCaption] = useState('');

  // Rich post attachments: Location, Music, Tagged people, On-photo Emoji/Text Overlays, Snap Once (15s), Visibility
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [customLocationInput, setCustomLocationInput] = useState('');

  const [selectedMusic, setSelectedMusic] = useState<MusicTrackAttachment | null>(null);
  const [showMusicPicker, setShowMusicPicker] = useState(false);

  const [taggedUsers, setTaggedUsers] = useState<TaggedPerson[]>([]);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [tagSearchQuery, setTagSearchQuery] = useState('');

  const [overlays, setOverlays] = useState<PhotoOverlayItem[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [showOverlayEditor, setShowOverlayEditor] = useState(false);
  const [overlayTextDraft, setOverlayTextDraft] = useState('');
  const [overlayBgStyle, setOverlayBgStyle] = useState<'glass' | 'solid' | 'neon'>('glass');

  const [snapOnce, setSnapOnce] = useState(false);
  const [visibility, setVisibility] = useState<PostVisibility>('everyone');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bundleQuery = useQuery({
    queryKey: ['today-moment', couple?.id, user?.id],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () =>
      fetchTodayMomentBundle({
        coupleId: couple!.id,
        userId: user!.id,
      }),
  });

  const friendsQuery = useQuery({
    queryKey: ['friends-list', user?.id],
    enabled: Boolean(user?.id),
    queryFn: () =>
      fetchFriendsCircle({
        userId: user!.id,
        partner,
      }),
  });

  const activePromptId = params.promptId || bundleQuery.data?.prompt.id || (couple ? `prompt_${couple.id}_${new Date().toISOString().slice(0, 10)}` : '');
  const activeTriggerAt = params.triggerAt || bundleQuery.data?.prompt.trigger_at;
  const countdown = useMomentCountdown(activeTriggerAt);

  const dailyPostedCount = bundleQuery.data?.dailyPostCount ?? 0;
  const shotsRemainingToday = Math.max(0, MAX_DAILY_MOMENTS_PER_DAY - dailyPostedCount);
  const activeFilterMeta = getFilterPresetMeta(filterPreset);

  useEffect(() => {
    isMountedRef.current = true;
    // Do not fire cold OS permission prompt on mount: let user see in-viewfinder primer first
    return () => {
      isMountedRef.current = false;
      clearInterval(recordingTimerRef.current);
      if (cameraReadyResolverRef.current) {
        cameraReadyResolverRef.current();
        cameraReadyResolverRef.current = null;
      }
    };
  }, [permission, requestPermission]);

  const handleCameraReady = () => {
    if (!isMountedRef.current) return;
    setCameraReady(true);
    if (cameraReadyResolverRef.current) {
      cameraReadyResolverRef.current();
      cameraReadyResolverRef.current = null;
    }
  };

  const handleSwitchLens = (nextLens: 'back' | 'front') => {
    setCameraReady(false);
    setFacing(nextLens);
  };

  /**
   * Fixes Bug #1 ("when start from front camera its not working (only opposite is working)"):
   * Captures the CURRENT active lens first (`facing` - whether 'front' or 'back'),
   * then switches to the opposite lens (`oppositeLens = firstLens === 'front' ? 'back' : 'front'`),
   * waits for `onCameraReady` + ISP stabilization, captures the second lens, and assigns
   * `backUri` / `frontUri` accurately regardless of starting lens.
   */
  const captureDualSequence = async () => {
    setError(null);
    const captureTimestamp = new Date().toISOString();
    const firstLens = facing;
    const secondLens: 'back' | 'front' = firstLens === 'front' ? 'back' : 'front';
    setCaptureOriginLens(firstLens);

    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    if (permission?.granted && cameraRef.current && Platform.OS !== 'web') {
      try {
        if (!cameraReady) {
          const { promise, resolve } = Promise.withResolvers<void>();
          cameraReadyResolverRef.current = resolve;
          setTimeout(resolve, 450);
          await promise;
        }
        if (!isMountedRef.current) return;

        setStage('capturing_first');
        const firstShot = await cameraRef.current.takePictureAsync({
          quality: 0.45,
          base64: true,
          skipProcessing: false,
        });
        if (!isMountedRef.current) return;

        setStage('switching_lens');
        setCameraReady(false);
        const { promise: readyPromise, resolve: resolveReady } = Promise.withResolvers<void>();
        cameraReadyResolverRef.current = resolveReady;
        setTimeout(resolveReady, 700);
        setFacing(secondLens);
        await readyPromise;
        if (!isMountedRef.current) return;

        // Extra 300ms settling window so Android CameraX front->back or back->front session binds cleanly
        await waitMs(300);
        if (!isMountedRef.current || !cameraRef.current) return;

        setStage('capturing_second');
        let secondShot = await cameraRef.current
          .takePictureAsync({
            quality: 0.45,
            base64: true,
            skipProcessing: false,
          })
          .catch(() => null);

        // Retry once if the opposite camera HAL was still settling
        if (!secondShot?.uri && isMountedRef.current && cameraRef.current) {
          await waitMs(400);
          secondShot = await cameraRef.current
            .takePictureAsync({
              quality: 0.45,
              base64: true,
              skipProcessing: false,
            })
            .catch(() => null);
        }

        if (!isMountedRef.current) return;

        const firstUri =
          firstShot?.base64 && firstShot.base64.length <= 240_000
            ? `data:image/jpeg;base64,${firstShot.base64}`
            : firstShot?.uri;
        const secondShotUri =
          secondShot?.base64 && secondShot.base64.length <= 240_000
            ? `data:image/jpeg;base64,${secondShot.base64}`
            : secondShot?.uri;

        if (firstUri) {
          const fallbackOpposite = buildSimulatedDualPhotos({
            authorLabel: user?.display_name ?? 'You',
            sceneLabel: 'Dual Companion Lens',
            accentHex: activeFilterMeta.svgTintHex,
            filterPreset,
            primaryLens: firstLens,
            shotNumber: dailyPostedCount + 1,
            mediaType: 'photo',
          });
          const secondUri =
            secondShotUri ??
            (firstLens === 'back' ? fallbackOpposite.frontUri : fallbackOpposite.backUri);
          const resolvedBack = firstLens === 'back' ? firstUri : secondUri;
          const resolvedFront = firstLens === 'front' ? firstUri : secondUri;
          setBackUri(resolvedBack);
          setFrontUri(resolvedFront);
          setCapturedAtIso(captureTimestamp);
          setPipSwapped(false);
          if (motionEnabled) {
            pipRevealScale.set(0.65);
            pipRevealScale.set(withSpring(1, MOCHY_SPRINGS.popIn(motionSpeed)));
          }
          setStage('preview');
          return;
        }
      } catch {
        // Fallback to high-res dual frame generator if device/emulator lacks dual camera HAL
      }
    }

    if (!isMountedRef.current) return;
    setStage('capturing_first');
    if (motionEnabled) {
      shutterFlashOpacity.set(0.35);
      shutterFlashOpacity.set(withTiming(0, mochyTiming(180, undefined, motionEnabled, motionSpeed)));
    }
    await waitMs(150);
    if (!isMountedRef.current) return;
    setStage('switching_lens');
    setFacing(secondLens);
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
    await waitMs(220);
    if (!isMountedRef.current) return;
    setStage('capturing_second');
    await waitMs(140);
    if (!isMountedRef.current) return;

    const simulated = buildSimulatedDualPhotos({
      authorLabel: user?.display_name ?? 'You',
      sceneLabel:
        firstLens === 'front'
          ? 'Front-first Dual Moment'
          : countdown.phase === 'late'
            ? 'Afternoon coffee break'
            : 'Morning desk & sunlight',
      accentHex: activeFilterMeta.svgTintHex,
      filterPreset,
      primaryLens: firstLens,
      shotNumber: dailyPostedCount + 1,
      mediaType: 'photo',
    });

    setBackUri(simulated.backUri);
    setFrontUri(simulated.frontUri);
    setCapturedAtIso(captureTimestamp);
    setPipSwapped(false);
    if (motionEnabled) {
      pipRevealScale.set(0.65);
      pipRevealScale.set(withSpring(1, MOCHY_SPRINGS.popIn(motionSpeed)));
    }
    setStage('preview');
  };

  const finalizeVideoCapture = async (finalDuration: number) => {
    clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = undefined;

    let recordedHardwareUri: string | null = null;
    if (Platform.OS !== 'web' && cameraRef.current) {
      try {
        cameraRef.current.stopRecording();
      } catch {
        // Ignore if already stopped
      }
    }
    if (activeRecordingPromiseRef.current) {
      try {
        const recResult = await Promise.race([
          activeRecordingPromiseRef.current,
          waitMs(1800).then(() => undefined),
        ]);
        if (recResult?.uri) {
          recordedHardwareUri = recResult.uri;
        }
      } catch {
        // Ignore hardware recorder error
      }
      activeRecordingPromiseRef.current = null;
    }

    if (!isMountedRef.current) return;

    const captureTimestamp = new Date().toISOString();
    const simulated = buildSimulatedDualPhotos({
      authorLabel: user?.display_name ?? 'You',
      sceneLabel: `Dual Video (${finalDuration}s) · ${facing === 'front' ? 'Front Lead' : 'Back Lead'}`,
      accentHex: activeFilterMeta.svgTintHex,
      filterPreset,
      primaryLens: facing,
      shotNumber: dailyPostedCount + 1,
      mediaType: 'video',
    });

    setBackUri((prev) => recordedHardwareUri ?? prev ?? simulated.backUri);
    setFrontUri((prev) => prev ?? simulated.frontUri);
    setVideoDurationSec(finalDuration);
    setVideoUri((prev) => recordedHardwareUri ?? prev ?? simulated.backUri);
    setCapturedAtIso(captureTimestamp);
    setStage('preview');
  };

  const startOrStopVideoRecording = async () => {
    setError(null);
    if (stage === 'recording_video') {
      const finalDuration = Math.max(2, recordingSec);
      await finalizeVideoCapture(finalDuration);
      return;
    }

    // Request microphone permission if available on native (or record muted if declined)
    if (Platform.OS !== 'web' && micPermission && !micPermission.granted && micPermission.canAskAgain) {
      try {
        await requestMicPermission();
      } catch {
        // Continue with muted video recording if mic is declined
      }
    }

    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    setCaptureOriginLens(facing);
    setRecordingSec(1);
    setStage('recording_video');

    if (permission?.granted && cameraRef.current && cameraReady && Platform.OS !== 'web') {
      try {
        // Capture a still frame first so the companion thumbnail/PIP has real camera pixels
        const stillThumb = await cameraRef.current
          .takePictureAsync({ quality: 0.65, skipProcessing: true })
          .catch(() => null);
        if (stillThumb?.uri && isMountedRef.current) {
          if (facing === 'front') {
            setFrontUri(stillThumb.uri);
          } else {
            setBackUri(stillThumb.uri);
          }
        }
        const recPromise = cameraRef.current.recordAsync({ maxDuration: 15 });
        activeRecordingPromiseRef.current = recPromise;
        void recPromise
          .then((recorded) => {
            if (recorded?.uri && isMountedRef.current) {
              setVideoUri(recorded.uri);
              setBackUri((prev) => prev ?? recorded.uri);
            }
          })
          .catch(() => {});
      } catch {
        // Simulated video fallback on web / emulator
      }
    }

    recordingTimerRef.current = setInterval(() => {
      setRecordingSec((prev) => {
        if (prev >= 15) {
          void finalizeVideoCapture(15);
          return 15;
        }
        return prev + 1;
      });
    }, 1000) as unknown as number;
  };

  const handleUseCurrentGpsLocation = async () => {
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!isMountedRef.current) return;
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationLabel(
          `GPS (${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)})`
        );
        setShowLocationPicker(false);
        return;
      }
      setError('Location permission was declined. Pick a place below or type a custom spot.');
    } catch {
      setError('GPS signal unavailable on this device. Choose a preset spot or enter a custom place.');
    }
  };

  const handleAddEmojiOverlay = (emoji: string) => {
    overlayCounterRef.current += 1;
    const seq = overlayCounterRef.current;
    const id = `ov_em_${seq}`;
    const item: PhotoOverlayItem = {
      id,
      kind: 'emoji',
      content: emoji,
      size: 'lg',
      xPct: 22 + ((seq * 23) % 56),
      yPct: 24 + ((seq * 19) % 52),
    };
    setOverlays((prev) => [...prev, item]);
    setSelectedOverlayId(id);
  };

  const handleAddTextOverlay = () => {
    const cleaned = overlayTextDraft.trim();
    if (!cleaned) return;
    overlayCounterRef.current += 1;
    const seq = overlayCounterRef.current;
    const id = `ov_txt_${seq}`;
    const item: PhotoOverlayItem = {
      id,
      kind: 'text',
      content: cleaned.slice(0, 48),
      bgStyle: overlayBgStyle,
      size: 'md',
      xPct: 50,
      yPct: 36 + ((seq * 16) % 42),
    };
    setOverlays((prev) => [...prev, item]);
    setSelectedOverlayId(id);
    setOverlayTextDraft('');
  };

  const nudgeSelectedOverlay = (dx: number, dy: number) => {
    const targetId = selectedOverlayId ?? overlays[overlays.length - 1]?.id;
    if (!targetId) return;
    setOverlays((prev) =>
      prev.map((ov) =>
        ov.id === targetId
          ? {
              ...ov,
              xPct: Math.min(88, Math.max(12, ov.xPct + dx)),
              yPct: Math.min(86, Math.max(12, ov.yPct + dy)),
            }
          : ov
      )
    );
  };
  const toggleTagPerson = (person: TaggedPerson) => {
    setTaggedUsers((prev) => {
      const exists = prev.some((p) => p.userId === person.userId);
      if (exists) {
        return prev.filter((p) => p.userId !== person.userId);
      }
      return [...prev, person];
    });
  };

  const taggablePeople: TaggedPerson[] = [
    ...(partner
      ? [
          {
            userId: partner.id,
            displayName: partner.display_name,
            username: partner.username || partner.display_name.toLowerCase().replace(/\s+/g, ''),
          },
        ]
      : []),
    ...(friendsQuery.data ?? []).map((f) => ({
      userId: f.friend_id,
      displayName: f.friend_profile.display_name,
      username:
        f.friend_profile.username ||
        f.friend_profile.display_name.toLowerCase().replace(/\s+/g, ''),
    })),
  ];
  const filteredTaggablePeople = taggablePeople.filter((p) => {
    const q = tagSearchQuery.trim().toLowerCase().replace(/^@/, '');
    if (!q) return true;
    return (
      p.username.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q)
    );
  });

  const handlePostMoment = async () => {
    if (!user || !couple || !backUri || !frontUri) {
      setError('Capture a photo or video first.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await submitDailyMoment({
        coupleId: couple.id,
        promptId: activePromptId,
        userId: user.id,
        authorName: user.display_name,
        authorUsername: user.username,
        authorAvatar: user.avatar_path,
        backUri,
        frontUri,
        caption,
        capturedAtIso: capturedAtIso ?? new Date().toISOString(),
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        locationLabel,
        musicTrack: selectedMusic,
        taggedUsers,
        overlays,
        visibility,
        snapOnce,
        snapDurationSeconds: 15,
        mediaType,
        videoUri,
        videoDurationSeconds: videoDurationSec,
        filterPreset,
        replaceMomentId: params.replaceMomentId ?? null,
      });

      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      await queryClient.invalidateQueries({ queryKey: ['today-moment', couple.id] });
      await queryClient.invalidateQueries({ queryKey: ['month-memories', couple.id] });
      await queryClient.invalidateQueries({ queryKey: ['user-posts'] });
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish Moment. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const computedLateSec =
    activeTriggerAt && capturedAtIso
      ? Math.max(
          0,
          Math.floor(
            (new Date(capturedAtIso).getTime() - new Date(activeTriggerAt).getTime()) / 1000
          )
        )
      : countdown.phase === 'late'
        ? 121 + countdown.secondsOverdue
        : 0;

  const watermarkTimestamp = formatMomentWatermarkTimestamp(capturedAtIso);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
          ]}>
          {/* Top Camera Bar */}
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close camera"
              onPress={() => router.back()}
              style={styles.topButton}>
              <Text style={[styles.topButtonText, { color: colors.inkMuted }]}>Close</Text>
            </Pressable>

            <View
              style={[
                styles.timerPill,
                {
                  borderColor:
                    stage === 'recording_video'
                      ? colors.danger
                      : countdown.phase === 'late'
                        ? colors.warning
                        : colors.accent,
                  backgroundColor: colors.surface,
                  borderRadius: radii.pill,
                },
              ]}>
              <Text
                style={[
                  styles.timerText,
                  {
                    color:
                      stage === 'recording_video'
                        ? colors.danger
                        : countdown.phase === 'late'
                          ? colors.warning
                          : colors.ink,
                  },
                ]}>
                {stage === 'recording_video'
                  ? `REC 00:${String(recordingSec).padStart(2, '0')} / 00:15`
                  : `Post ${Math.min(MAX_DAILY_MOMENTS_PER_DAY, dailyPostedCount + 1)}/${MAX_DAILY_MOMENTS_PER_DAY} · ${countdown.formattedTimer}`}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Toggle flash, currently ${flash}`}
              onPress={() => setFlash((prev) => (prev === 'off' ? 'on' : 'off'))}
              style={styles.topButton}>
              <Text style={[styles.topButtonText, { color: colors.inkMuted }]}>
                Flash: {flash === 'on' ? 'On' : 'Off'}
              </Text>
            </Pressable>
          </View>

          {/* Photo / Video Mode Switcher + Starting Lens Indicator */}
          {stage !== 'preview' ? (
            <View style={styles.modeSwitchRow}>
              <View
                style={[
                  styles.segmentedPill,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}>
                <Pressable
                  accessibilityRole="tab"
                  accessibilityLabel="Photo mode"
                  accessibilityState={{ selected: mediaType === 'photo' }}
                  onPress={() => setMediaType('photo')}
                  style={[
                    styles.modeTab,
                    {
                      backgroundColor:
                        mediaType === 'photo' ? colors.surfaceElevated : 'transparent',
                    },
                  ]}>
                  <Text
                    style={[
                      styles.modeTabText,
                      { color: mediaType === 'photo' ? colors.ink : colors.inkMuted },
                    ]}>
                    Dual Photo
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="tab"
                  accessibilityLabel="Video mode"
                  accessibilityState={{ selected: mediaType === 'video' }}
                  onPress={() => setMediaType('video')}
                  style={[
                    styles.modeTab,
                    {
                      backgroundColor:
                        mediaType === 'video' ? colors.surfaceElevated : 'transparent',
                    },
                  ]}>
                  <Text
                    style={[
                      styles.modeTabText,
                      { color: mediaType === 'video' ? colors.ink : colors.inkMuted },
                    ]}>
                    Dual Video (15s)
                  </Text>
                </Pressable>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Flip starting camera lens, currently ${facing}`}
                onPress={() => handleSwitchLens(facing === 'back' ? 'front' : 'back')}
                style={[
                  styles.lensPill,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                    borderRadius: radii.pill,
                  },
                ]}>
                <Text style={[styles.lensPillText, { color: colors.ink }]}>
                  Start: {facing === 'front' ? 'Front Selfie' : 'Back Camera'} ↻
                </Text>
              </Pressable>
            </View>
          ) : null}

          {stage !== 'preview' ? (
            <>
              {/* Live 3:4 Viewfinder with Live Filter Tint & #KeepIt Watermark */}
              <View
                style={[
                  styles.viewfinderFrame,
                  {
                    backgroundColor: colors.surface,
                    borderColor: activeFilterMeta.borderAccent || colors.border,
                    borderRadius: radii.photo,
                  },
                ]}>
                {permission?.granted && Platform.OS !== 'web' ? (
                  <CameraView
                    ref={cameraRef}
                    style={styles.full}
                    facing={facing}
                    flash={facing === 'front' ? 'off' : flash}
                    mute={!micPermission?.granted}
                    mode={mediaType === 'video' ? 'video' : 'picture'}
                    onCameraReady={handleCameraReady}
                  />
                ) : (
                  <View style={styles.simulatedViewfinder}>
                    <View
                      style={[
                        styles.selfiePipGuide,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.accent,
                        },
                      ]}>
                      <Text style={[styles.pipGuideLabel, { color: colors.inkMuted }]}>
                        {facing === 'front' ? 'Back PIP' : 'Front PIP'}
                      </Text>
                    </View>

                    <Text style={[styles.viewfinderTitle, { color: colors.ink }]}>
                      {stage === 'recording_video'
                        ? `Recording Dual Video (${recordingSec}s)...`
                        : stage === 'capturing_first'
                          ? `Capturing ${facing} lens...`
                          : stage === 'switching_lens'
                            ? `Switching to ${facing === 'front' ? 'back' : 'front'} lens...`
                            : stage === 'capturing_second'
                              ? 'Capturing second lens...'
                              : `${facing === 'front' ? 'Front-First' : 'Back-First'} Dual ${mediaType === 'video' ? 'Video' : 'Moment'}`}
                    </Text>

                    <Text style={[styles.viewfinderSub, { color: colors.inkMuted }]}>
                      Filter: {activeFilterMeta.label} · {shotsRemainingToday} of{' '}
                      {MAX_DAILY_MOMENTS_PER_DAY} daily posts left
                    </Text>

                    {permission && !permission.granted && Platform.OS !== 'web' ? (
                      <View style={styles.permissionPrimerBox}>
                        <Text style={[styles.permissionPrimerText, { color: colors.inkMuted }]}>
                          KeepIt uses your front and back cameras together to capture both sides of your Moment. You can also capture a simulated dual frame below without granting camera access.
                        </Text>
                        <KeepItButton
                          label={
                            permission.canAskAgain
                              ? 'Allow Front & Back Camera'
                              : 'Open System Camera Settings'
                          }
                          variant="secondary"
                          onPress={() => {
                            if (permission.canAskAgain) {
                              void requestPermission();
                            } else {
                              void Linking.openSettings();
                            }
                          }}
                        />
                      </View>
                    ) : null}
                  </View>
                )}

                {/* Shutter Flash Feedback Layer */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: '#FFFFFF' },
                    shutterFlashStyle,
                  ]}
                />

                {/* Signature 2-Step Dual Capture Progress Banner */}
                {stage === 'capturing_first' ||
                stage === 'switching_lens' ||
                stage === 'capturing_second' ? (
                  <View
                    style={[
                      styles.dualCaptureBanner,
                      {
                        backgroundColor: colors.chromeGlass,
                        borderColor: colors.accent,
                        borderRadius: radii.pill,
                      },
                    ]}>
                    <View style={styles.dualStepDots}>
                      <View
                        style={[
                          styles.dualStepDot,
                          { backgroundColor: colors.accent },
                        ]}
                      />
                      <View
                        style={[
                          styles.dualStepDot,
                          {
                            backgroundColor:
                              stage === 'capturing_second'
                                ? colors.accent
                                : colors.border,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.dualCaptureBannerText, { color: colors.ink }]}>
                      {stage === 'capturing_first'
                        ? `1/2 Capturing ${captureOriginLens === 'front' ? 'Front Selfie' : 'Back Scene'}…`
                        : stage === 'switching_lens'
                          ? 'Flipping to companion lens…'
                          : `2/2 Capturing ${captureOriginLens === 'front' ? 'Back PIP' : 'Front PIP'}…`}
                    </Text>
                  </View>
                ) : null}
                {/* Live Filter Color Grade Overlay */}
                {activeFilterMeta.tintOverlay !== 'transparent' ? (
                  <View
                    pointerEvents="none"
                    style={[
                      StyleSheet.absoluteFill,
                      { backgroundColor: activeFilterMeta.tintOverlay },
                    ]}
                  />
                ) : null}

                {/* Permanent #keepit + Timestamp Bottom-Left Watermark on Photo */}
                <View pointerEvents="none" style={styles.keepItPhotoWatermark}>
                  <Text style={styles.keepItWatermarkTitle}>#keepit</Text>
                  <Text style={styles.keepItWatermarkTime}>{watermarkTimestamp}</Text>
                </View>
              </View>

              {/* Filter Carousel Strip */}
              <ScrollView
                horizontal
                style={{ flexGrow: 0 }}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterStrip}>
                {MOMENT_FILTER_PRESETS.map((preset) => {
                  const selected = filterPreset === preset.id;
                  return (
                    <Pressable
                      key={preset.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Filter ${preset.label}`}
                      accessibilityState={{ selected }}
                      onPress={() => setFilterPreset(preset.id)}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: selected ? colors.accent : colors.surface,
                          borderColor: selected ? colors.accent : colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <View
                        style={[
                          styles.filterSwatch,
                          { backgroundColor: preset.svgTintHex },
                        ]}
                      />
                      <Text
                        style={[
                          styles.filterChipText,
                          { color: selected ? colors.onAccent : colors.ink },
                        ]}>
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {error ? <InlineNotice message={error} tone="error" /> : null}

              {/* Shutter Controls */}
              <View style={styles.shutterBar}>
                <Text style={[styles.sideMeta, { color: colors.inkMuted }]}>
                  {shotsRemainingToday}/{MAX_DAILY_MOMENTS_PER_DAY} left today
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    mediaType === 'video'
                      ? stage === 'recording_video'
                        ? 'Stop Video Recording'
                        : 'Record Dual Video'
                      : 'Capture Dual Moment'
                  }
                  disabled={stage !== 'ready' && stage !== 'recording_video'}
                  onPress={() => {
                    if (mediaType === 'video') {
                      void startOrStopVideoRecording();
                    } else {
                      void captureDualSequence();
                    }
                  }}
                  style={[
                    styles.shutterOuter,
                    {
                      borderColor:
                        mediaType === 'video' ? colors.danger : colors.ink,
                      opacity:
                        stage === 'ready' || stage === 'recording_video' ? 1 : 0.5,
                    },
                  ]}>
                  <View
                    style={[
                      stage === 'recording_video'
                        ? styles.shutterRecordingSquare
                        : styles.shutterInner,
                      {
                        backgroundColor:
                          mediaType === 'video' ? colors.danger : colors.accent,
                      },
                    ]}
                  />
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Flip primary lens"
                  onPress={() => handleSwitchLens(facing === 'back' ? 'front' : 'back')}>
                  <Text style={[styles.sideMeta, { color: colors.ink }]}>
                    Lens: {facing === 'back' ? 'Back' : 'Front'}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              {/* Captured Dual Preview with Filter, Overlays, Music, Location, Tags & #KeepIt Watermark */}
              <View
                style={[
                  styles.viewfinderFrame,
                  {
                    backgroundColor: colors.surface,
                    borderColor: activeFilterMeta.borderAccent || colors.border,
                    borderRadius: radii.photo,
                  },
                ]}>
                {backUri && frontUri ? (
                  <Image
                    source={{ uri: pipSwapped ? frontUri : backUri }}
                    contentFit="cover"
                    style={[
                      styles.full,
                      Platform.OS === 'web' && activeFilterMeta.webCssFilter !== 'none'
                        ? ({ filter: activeFilterMeta.webCssFilter } as never)
                        : null,
                    ]}
                  />
                ) : null}

                {activeFilterMeta.tintOverlay !== 'transparent' ? (
                  <View
                    pointerEvents="none"
                    style={[
                      StyleSheet.absoluteFill,
                      { backgroundColor: activeFilterMeta.tintOverlay },
                    ]}
                  />
                ) : null}

                {frontUri && backUri ? (
                  <Animated.View style={[styles.previewPipAnchor, pipAnimatedStyle]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Swap front and back preview lenses"
                      onPress={() => {
                        if (Platform.OS !== 'web') {
                          void Haptics.selectionAsync();
                        }
                        if (motionEnabled) {
                          pipRevealScale.set(0.86);
                          pipRevealScale.set(withSpring(1, MOCHY_SPRINGS.popIn(motionSpeed)));
                        }
                        setPipSwapped((prev) => !prev);
                      }}
                      style={[
                        styles.previewPip,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.canvas,
                        },
                      ]}>
                      <Image
                        source={{ uri: pipSwapped ? backUri : frontUri }}
                        contentFit="cover"
                        style={styles.full}
                      />
                    </Pressable>
                  </Animated.View>
                ) : null}

                {/* On-Photo Emoji Stickers & Text Overlays (Tap to select, long-press to remove) */}
                {overlays.map((ov) => {
                  const isSelected = selectedOverlayId === ov.id;
                  return (
                    <Pressable
                      key={ov.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Select overlay ${ov.content}`}
                      onPress={() => setSelectedOverlayId(ov.id)}
                      onLongPress={() =>
                        setOverlays((prev) => prev.filter((item) => item.id !== ov.id))
                      }
                      style={[
                        styles.photoOverlayAnchor,
                        {
                          left: `${ov.xPct}%`,
                          top: `${ov.yPct}%`,
                        },
                      ]}>
                      {ov.kind === 'emoji' ? (
                        <Text
                          style={[
                            styles.photoOverlayEmoji,
                            ov.size === 'sm'
                              ? { fontSize: 28 }
                              : ov.size === 'md'
                                ? { fontSize: 34 }
                                : { fontSize: 42 },
                          ]}>
                          {ov.content}
                        </Text>
                      ) : (
                        <View
                          style={[
                            styles.photoOverlayTextPill,
                            {
                              backgroundColor:
                                ov.bgStyle === 'neon'
                                  ? '#282830'
                                  : ov.bgStyle === 'solid'
                                    ? '#141416'
                                    : 'rgba(20, 20, 22, 0.78)',
                              borderColor: isSelected ? colors.accent : 'rgba(255,255,255,0.28)',
                            },
                          ]}>
                          <Text style={styles.photoOverlayText}>{ov.content}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}

                {/* Top-Right Timing + Media Type + Filter Badge */}
                <View style={styles.previewBadgeStack}>
                  <View
                    style={[
                      styles.previewTimingBadge,
                      {
                        backgroundColor: colors.canvas,
                        borderColor:
                          computedLateSec > 120 ? colors.warning : colors.border,
                        borderRadius: radii.pill,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.previewTimingText,
                        {
                          color:
                            computedLateSec > 120 ? colors.warning : colors.ink,
                        },
                      ]}>
                      {mediaType === 'video'
                        ? `VIDEO ${videoDurationSec ?? 4}s · `
                        : ''}
                      {formatLateDuration(computedLateSec)}
                    </Text>
                  </View>

                  {filterPreset !== 'normal' ? (
                    <View
                      style={[
                        styles.previewTimingBadge,
                        {
                          backgroundColor: colors.canvas,
                          borderColor: colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Text style={[styles.previewTimingText, { color: colors.ink }]}>
                        {activeFilterMeta.label}
                      </Text>
                    </View>
                  ) : null}

                  {snapOnce ? (
                    <View
                      style={[
                        styles.previewTimingBadge,
                        {
                          backgroundColor: colors.warning,
                          borderColor: colors.warning,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Text style={[styles.previewTimingText, { color: '#000000' }]}>
                        Snap Once · 15s
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Bottom-Right Tagged People & Music/Location Preview Pills */}
                <View style={styles.bottomRightMetaStack}>
                  {selectedMusic ? (
                    <View style={styles.photoMusicBadge}>
                      <Text numberOfLines={1} style={styles.photoMusicBadgeText}>
                        Track: {selectedMusic.title} · {selectedMusic.artist}
                      </Text>
                    </View>
                  ) : null}
                  {locationLabel ? (
                    <View style={styles.photoMusicBadge}>
                      <Text numberOfLines={1} style={styles.photoMusicBadgeText}>
                        {locationLabel}
                      </Text>
                    </View>
                  ) : null}
                  {taggedUsers.length > 0 ? (
                    <View style={styles.photoMusicBadge}>
                      <Text numberOfLines={1} style={styles.photoMusicBadgeText}>
                        {taggedUsers.map((t) => `@${t.username}`).join(' ')}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Mandatory Bottom-Left #keepit + Timestamp Watermark on Photo (Item #8) */}
                <View pointerEvents="none" style={styles.keepItPhotoWatermark}>
                  <Text style={styles.keepItWatermarkTitle}>#keepit</Text>
                  <Text style={styles.keepItWatermarkTime}>{watermarkTimestamp}</Text>
                </View>
              </View>

              {/* Post-Capture Filter Switcher */}
              <ScrollView
                horizontal
                style={{ flexGrow: 0 }}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterStrip}>
                {MOMENT_FILTER_PRESETS.map((preset) => {
                  const selected = filterPreset === preset.id;
                  return (
                    <Pressable
                      key={preset.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Apply ${preset.label} filter`}
                      onPress={() => setFilterPreset(preset.id)}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: selected ? colors.accent : colors.surface,
                          borderColor: selected ? colors.accent : colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <View
                        style={[
                          styles.filterSwatch,
                          { backgroundColor: preset.svgTintHex },
                        ]}
                      />
                      <Text
                        style={[
                          styles.filterChipText,
                          { color: selected ? colors.onAccent : colors.ink },
                        ]}>
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* Rich Creative Toolbar: Emoji/Text On-Photo, Location, Music, Tag People, Snap Once */}
              <View style={styles.creativeToolbar}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add Emoji or Text to photo"
                  onPress={() => setShowOverlayEditor((v) => !v)}
                  style={[
                    styles.toolChip,
                    {
                      backgroundColor:
                        overlays.length > 0 || showOverlayEditor
                          ? colors.accentSoft
                          : colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.toolChipText, { color: colors.ink }]}>
                    Stickers / Text {overlays.length > 0 ? `(${overlays.length})` : ''}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add Location to post"
                  onPress={() => setShowLocationPicker((v) => !v)}
                  style={[
                    styles.toolChip,
                    {
                      backgroundColor:
                        locationLabel || showLocationPicker
                          ? colors.accentSoft
                          : colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.toolChipText, { color: colors.ink }]}>
                    {locationLabel ? locationLabel.split('·')[0].trim() : 'Location'}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add Music to post"
                  onPress={() => setShowMusicPicker((v) => !v)}
                  style={[
                    styles.toolChip,
                    {
                      backgroundColor:
                        selectedMusic || showMusicPicker
                          ? colors.accentSoft
                          : colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.toolChipText, { color: colors.ink }]}>
                    {selectedMusic ? selectedMusic.title : 'Music'}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Tag people in post"
                  onPress={() => setShowTagPicker((v) => !v)}
                  style={[
                    styles.toolChip,
                    {
                      backgroundColor:
                        taggedUsers.length > 0 || showTagPicker
                          ? colors.accentSoft
                          : colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.toolChipText, { color: colors.ink }]}>
                    Tag {taggedUsers.length > 0 ? `(${taggedUsers.length})` : 'People'}
                  </Text>
                </Pressable>
              </View>

              {/* Expandable Panel: On-Photo Emoji & Text Overlay Studio (Item #12) */}
              {showOverlayEditor ? (
                <View
                  style={[
                    styles.drawerCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}>
                  <Text style={[styles.drawerTitle, { color: colors.ink }]}>
                    Add Emoji Sticker or Text on Photo
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8 }}>
                    {OVERLAY_STICKER_EMOJIS.map((em) => (
                      <Pressable
                        key={em}
                        accessibilityRole="button"
                        accessibilityLabel={`Sticker ${em}`}
                        onPress={() => handleAddEmojiOverlay(em)}
                        style={[
                          styles.emojiStickerBtn,
                          {
                            backgroundColor: colors.surfaceElevated,
                            borderColor: colors.border,
                          },
                        ]}>
                        <Text style={{ fontSize: 20 }}>{em}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>

                  <View style={styles.inlineInputRow}>
                    <TextInput
                      accessibilityLabel="Text overlay on photo"
                      value={overlayTextDraft}
                      onChangeText={setOverlayTextDraft}
                      placeholder="Type text on photo (e.g. POV: coffee date)..."
                      placeholderTextColor={colors.placeholder}
                      maxLength={48}
                      style={[
                        styles.captionInput,
                        {
                          flex: 1,
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                          color: colors.ink,
                          borderRadius: radii.input,
                        },
                      ]}
                    />
                    <KeepItButton label="Place Text" onPress={handleAddTextOverlay} />
                  </View>

                  <View style={styles.styleSwitchRow}>
                    {(['glass', 'solid', 'neon'] as const).map((st) => (
                      <Pressable
                        key={st}
                        accessibilityRole="button"
                        onPress={() => setOverlayBgStyle(st)}
                        style={[
                          styles.smallChoicePill,
                          {
                            backgroundColor:
                              overlayBgStyle === st
                                ? colors.accent
                                : colors.surfaceElevated,
                            borderRadius: radii.pill,
                          },
                        ]}>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: '700',
                            color: overlayBgStyle === st ? colors.onAccent : colors.ink,
                          }}>
                          {st.toUpperCase()}
                        </Text>
                      </Pressable>
                    ))}
                    {overlays.length > 0 ? (
                      <>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Move overlay up"
                          onPress={() => nudgeSelectedOverlay(0, -8)}
                          style={styles.smallChoicePill}>
                          <Text style={{ fontSize: 12, color: colors.ink, fontWeight: '700' }}>↑</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Move overlay down"
                          onPress={() => nudgeSelectedOverlay(0, 8)}
                          style={styles.smallChoicePill}>
                          <Text style={{ fontSize: 12, color: colors.ink, fontWeight: '700' }}>↓</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Move overlay left"
                          onPress={() => nudgeSelectedOverlay(-8, 0)}
                          style={styles.smallChoicePill}>
                          <Text style={{ fontSize: 12, color: colors.ink, fontWeight: '700' }}>←</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Move overlay right"
                          onPress={() => nudgeSelectedOverlay(8, 0)}
                          style={styles.smallChoicePill}>
                          <Text style={{ fontSize: 12, color: colors.ink, fontWeight: '700' }}>→</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => {
                            setOverlays([]);
                            setSelectedOverlayId(null);
                          }}
                          style={styles.smallChoicePill}>
                          <Text style={{ fontSize: 12, color: colors.danger, fontWeight: '600' }}>
                            Clear overlays
                          </Text>
                        </Pressable>
                      </>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {/* Expandable Panel: Location Picker (Item #7) */}
              {showLocationPicker ? (
                <View
                  style={[
                    styles.drawerCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}>
                  <Text style={[styles.drawerTitle, { color: colors.ink }]}>
                    Tag Location
                  </Text>
                  <View style={styles.wrapRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Use current GPS location"
                      onPress={() => void handleUseCurrentGpsLocation()}
                      style={[
                        styles.presetChip,
                        {
                          backgroundColor: colors.accentSoft,
                          borderColor: colors.accent,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Text style={[styles.presetChipText, { color: colors.ink }]}>
                        Use Current GPS
                      </Text>
                    </Pressable>
                    {QUICK_LOCATION_PRESETS.map((loc) => (
                      <Pressable
                        key={loc.label}
                        accessibilityRole="button"
                        accessibilityLabel={`Location ${loc.label}`}
                        onPress={() => {
                          setLocationLabel(loc.label);
                          setCoords({ lat: loc.lat, lng: loc.lng });
                          setShowLocationPicker(false);
                        }}
                        style={[
                          styles.presetChip,
                          {
                            backgroundColor:
                              locationLabel === loc.label
                                ? colors.accent
                                : colors.surfaceElevated,
                            borderColor: colors.border,
                            borderRadius: radii.pill,
                          },
                        ]}>
                        <Text
                          style={[
                            styles.presetChipText,
                            {
                              color:
                                locationLabel === loc.label
                                  ? colors.onAccent
                                  : colors.ink,
                            },
                          ]}>
                          {loc.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.inlineInputRow}>
                    <TextInput
                      accessibilityLabel="Custom location name"
                      value={customLocationInput}
                      onChangeText={setCustomLocationInput}
                      placeholder="Or enter custom place..."
                      placeholderTextColor={colors.placeholder}
                      style={[
                        styles.captionInput,
                        {
                          flex: 1,
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.border,
                          color: colors.ink,
                          borderRadius: radii.input,
                        },
                      ]}
                    />
                    <KeepItButton
                      label="Set Place"
                      onPress={() => {
                        if (customLocationInput.trim()) {
                          setLocationLabel(customLocationInput.trim());
                          setCustomLocationInput('');
                          setShowLocationPicker(false);
                        }
                      }}
                    />
                  </View>
                </View>
              ) : null}

              {/* Expandable Panel: Music Picker (Item #7) */}
              {showMusicPicker ? (
                <View
                  style={[
                    styles.drawerCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}>
                  <Text style={[styles.drawerTitle, { color: colors.ink }]}>
                    Attach Soundtrack
                  </Text>
                  <View style={{ gap: 8 }}>
                    {CURATED_MUSIC_TRACKS.map((trk) => {
                      const active = selectedMusic?.id === trk.id;
                      return (
                        <Pressable
                          key={trk.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Select song ${trk.title} by ${trk.artist}`}
                          onPress={() => {
                            setSelectedMusic(active ? null : trk);
                            setShowMusicPicker(false);
                          }}
                          style={[
                            styles.musicRow,
                            {
                              backgroundColor: active
                                ? colors.accentSoft
                                : colors.surfaceElevated,
                              borderColor: active ? colors.accent : colors.border,
                              borderRadius: radii.input,
                            },
                          ]}>
                          <View
                            style={[
                              styles.musicDisc,
                              { backgroundColor: trk.coverColor },
                            ]}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.musicTitle, { color: colors.ink }]}>
                              {trk.title}
                            </Text>
                            <Text style={[styles.musicSub, { color: colors.inkMuted }]}>
                              {trk.artist} · {trk.previewNote}
                            </Text>
                          </View>
                          <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 12 }}>
                            {active ? 'Selected ✓' : 'Add'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* Expandable Panel: Tag People (Item #9) */}
              {showTagPicker ? (
                <View
                  style={[
                    styles.drawerCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}>
                  <Text style={[styles.drawerTitle, { color: colors.ink }]}>
                    Tag Partner & Friends
                  </Text>
                  <TextInput
                    accessibilityLabel="Search username to tag"
                    value={tagSearchQuery}
                    onChangeText={setTagSearchQuery}
                    placeholder="Search @username or name..."
                    placeholderTextColor={colors.placeholder}
                    autoCapitalize="none"
                    style={[
                      styles.captionInput,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                        color: colors.ink,
                        borderRadius: radii.input,
                      },
                    ]}
                  />
                  <View style={styles.wrapRow}>
                    {filteredTaggablePeople.map((person) => {
                      const isTagged = taggedUsers.some((u) => u.userId === person.userId);
                      return (
                        <Pressable
                          key={person.userId}
                          accessibilityRole="button"
                          accessibilityLabel={`Tag ${person.displayName}`}
                          onPress={() => toggleTagPerson(person)}
                          style={[
                            styles.presetChip,
                            {
                              backgroundColor: isTagged
                                ? colors.accent
                                : colors.surfaceElevated,
                              borderColor: colors.border,
                              borderRadius: radii.pill,
                            },
                          ]}>
                          <Text
                            style={[
                              styles.presetChipText,
                              {
                                color: isTagged ? colors.onAccent : colors.ink,
                              },
                            ]}>
                            @{person.username} ({person.displayName}) {isTagged ? '✓' : '+'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* Snap Once (15s Disappearing Mode) & Audience Selector (Item #10 & #14) */}
              <View
                style={[
                  styles.snapOnceCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: snapOnce ? colors.warning : colors.border,
                    borderRadius: radii.card,
                  },
                ]}>
                <View style={styles.snapRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.drawerTitle, { color: colors.ink }]}>
                      Snap Once (Disappears in 15s)
                    </Text>
                    <Text style={[styles.musicSub, { color: colors.inkMuted }]}>
                      Once viewed by your partner or friends, this post vanishes after 15 seconds.
                    </Text>
                  </View>
                  <Switch
                    accessibilityLabel="Enable Snap Once 15 second timer"
                    value={snapOnce}
                    onValueChange={setSnapOnce}
                    trackColor={{ false: colors.border, true: colors.warning }}
                    thumbColor={colors.ink}
                  />
                </View>

                <View style={styles.audienceRow}>
                  {(['everyone', 'partner', 'friends'] as const).map((vis) => (
                    <Pressable
                      key={vis}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: visibility === vis }}
                      onPress={() => setVisibility(vis)}
                      style={[
                        styles.audienceChip,
                        {
                          backgroundColor:
                            visibility === vis ? colors.surfaceElevated : 'transparent',
                          borderColor:
                            visibility === vis ? colors.accent : colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '700',
                          color: visibility === vis ? colors.ink : colors.inkMuted,
                        }}>
                        {vis === 'everyone'
                          ? 'Partner + Friends'
                          : vis === 'partner'
                            ? 'Partner Only'
                            : 'Friends Circle'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Caption Input */}
              <View style={styles.captionWrap}>
                <Text style={[styles.captionLabel, { color: colors.ink }]}>
                  Caption (optional)
                </Text>
                <TextInput
                  accessibilityLabel="Add a short caption"
                  maxLength={160}
                  value={caption}
                  placeholder="Write a caption for your Moment..."
                  placeholderTextColor={colors.placeholder}
                  onChangeText={setCaption}
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

              {error ? <InlineNotice message={error} tone="error" /> : null}

              {/* Post / Retake Buttons */}
              <View style={styles.previewActions}>
                <KeepItButton
                  label={
                    snapOnce
                      ? 'Post Snap Once (15s)'
                      : `Post Moment (#KeepIt · ${captureOriginLens === 'front' ? 'Front Lead' : 'Dual'})`
                  }
                  loading={submitting}
                  onPress={() => void handlePostMoment()}
                />
                <KeepItButton
                  label="Retake"
                  variant="secondary"
                  disabled={submitting}
                  onPress={() => {
                    setBackUri(null);
                    setFrontUri(null);
                    setVideoUri(null);
                    setStage('ready');
                  }}
                />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  full: { width: '100%', height: '100%' },
  content: {
    flexGrow: 1,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    gap: 14,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  topButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  timerPill: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  timerText: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  modeSwitchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  segmentedPill: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 999,
    padding: 3,
    gap: 4,
  },
  modeTab: {
    minHeight: 38,
    paddingHorizontal: 13,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  modeTabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  lensPill: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lensPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  viewfinderFrame: {
    width: '100%',
    aspectRatio: 0.75,
    borderWidth: 1.5,
    overflow: 'hidden',
    position: 'relative',
  },
  simulatedViewfinder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  selfiePipGuide: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 96,
    height: 128,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pipGuideLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  viewfinderTitle: {
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
  },
  viewfinderSub: {
    fontSize: 13,
    textAlign: 'center',
  },
  keepItPhotoWatermark: {
    position: 'absolute',
    bottom: 14,
    left: 16,
    alignItems: 'flex-start',
    gap: 1,
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
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: -0.2,
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  filterStrip: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  filterChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  filterSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  shutterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  sideMeta: {
    fontSize: 13,
    fontWeight: '600',
    minWidth: 92,
  },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  shutterRecordingSquare: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  previewPipAnchor: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 5,
  },
  previewPip: {
    width: 108,
    height: 144,
    borderRadius: 16,
    borderWidth: 2.5,
    overflow: 'hidden',
  },
  previewBadgeStack: {
    position: 'absolute',
    top: 16,
    right: 16,
    alignItems: 'flex-end',
    gap: 6,
  },
  previewTimingBadge: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  previewTimingText: {
    fontSize: 12,
    fontWeight: '700',
  },
  bottomRightMetaStack: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    alignItems: 'flex-end',
    gap: 5,
    maxWidth: '62%',
  },
  photoMusicBadge: {
    backgroundColor: 'rgba(12, 12, 14, 0.78)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  photoMusicBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  photoOverlayAnchor: {
    position: 'absolute',
    transform: [{ translateX: -30 }, { translateY: -20 }],
  },
  photoOverlayEmoji: {
    fontSize: 38,
  },
  photoOverlayTextPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  photoOverlayText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  creativeToolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  toolChip: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  drawerCard: {
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  drawerTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  emojiStickerBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  styleSwitchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  smallChoicePill: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  musicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    padding: 10,
  },
  musicDisc: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  musicTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  musicSub: {
    fontSize: 12,
  },
  snapOnceCard: {
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  snapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  audienceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  audienceChip: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionWrap: {
    gap: 6,
  },
  captionLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  captionInput: {
    minHeight: 46,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  previewActions: {
    gap: 10,
    marginTop: 4,
  },
  permissionPrimerBox: {
    width: '100%',
    gap: 10,
    marginTop: 6,
    alignItems: 'center',
  },
  permissionPrimerText: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  dualCaptureBanner: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 7,
    zIndex: 8,
  },
  dualStepDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dualStepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dualCaptureBannerText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
