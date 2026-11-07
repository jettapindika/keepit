import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
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
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  fetchTodayMomentBundle,
  formatLateDuration,
  submitDailyMoment,
  isMomentPromptCheckIn,
} from '@/api/moments';
import {
  CURATED_MUSIC_TRACKS,
  fetchFriendsCircle,
  getFilterPresetMeta,
  MOMENT_FILTER_PRESETS,
  QUICK_LOCATION_PRESETS,
} from '@/api/social';
import { InlineNotice, KeepItButton, KeepItWatermarkLogo } from '@/components/ui/Primitives';
import { AppPressable, AppSwitch as Switch, AppTextInput, PageHeader, SectionHeader } from '@/components/ui/ScreenKit';
import { useMomentCountdown } from '@/hooks/useMomentCountdown';
import { useSessionStore } from '@/store/sessionStore';
import { MOCHY_SPRINGS, mochyTiming } from '@/theme/motion';
import { useKeepItTheme } from '@/theme/tokens';
import { useAppMotion } from '@/hooks/useAppMotion';
import {
  MAX_DAILY_MOMENTS_PER_DAY,
  MomentFilterPreset,
  MomentMediaType,
  MusicTrackAttachment,
  PhotoOverlayItem,
  PostVisibility,
  TaggedPerson,
} from '@/types/database';
import { embedKeepItWatermarkOnImageUri, formatMomentWatermarkTimestamp } from '@/utils/momentExport';

type CaptureStage =
  | 'ready'
  | 'recording_video'
  | 'capturing_first'
  | 'switching_lens'
  | 'capturing_second'
  | 'preview';

const OVERLAY_STICKER_EMOJIS = ['❤️‍🔥', '✨', '🥹', '☕️', '🫶', '🔥', '🌙', '🎧', '🍒', '⚡'] as const;

const Pressable = AppPressable;
const TextInput = AppTextInput;
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

  const { colors, radii } = useKeepItTheme();
  const user = useSessionStore((s) => s.user);
  const partner = useSessionStore((s) => s.partner);
  const couple = useSessionStore((s) => s.couple);
  const { enabled: motionEnabled, speed: motionSpeed } = useAppMotion();

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
  const [activeCameraMode, setActiveCameraMode] = useState<'picture' | 'video'>('picture');
  const recordingOriginRef = useRef<'back' | 'front'>('back');
  const finalizeRecordingRef = useRef(false);
  const elapsedRecordingRef = useRef(0);
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
  const [locating, setLocating] = useState(false);

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
  const [allowLeave, setAllowLeave] = useState(false);
  const pendingRemovalRef = useRef<(() => void) | null>(null);
  const [visibility, setVisibility] = useState<PostVisibility>('everyone');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionRetrying, setPermissionRetrying] = useState(false);

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
  const isPartnerPaired = Boolean(partner && couple && !couple.id.startsWith('solo_'));
  const myMomentsToday = bundleQuery.data?.myMomentsToday ?? (bundleQuery.data?.mine ? [bundleQuery.data.mine] : []);
  const replaceTarget = params.replaceMomentId
    ? myMomentsToday.find((m) => m.id === params.replaceMomentId)
    : undefined;
  const alreadyCheckedInOtherPost = myMomentsToday.some(
    (m) => m.id !== replaceTarget?.id && isMomentPromptCheckIn(m)
  );
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
  }, []);

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
    if (stage !== 'ready') return;
    setStage('capturing_first');
    if (motionEnabled) {
      shutterFlashOpacity.set(0.35);
      shutterFlashOpacity.set(withTiming(0, mochyTiming(180, undefined, motionEnabled, motionSpeed)));
    }
    if (Platform.OS === 'web') {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (devices.filter((device) => device.kind === 'videoinput').length < 2) {
          setStage('ready');
          setError('Dual capture needs front and back cameras. This browser exposes only one camera. Open KeepIt on a device with both lenses.');
          return;
        }
      } catch {
        setStage('ready');
        setError('The browser could not check available cameras. Allow camera access and retry.');
        return;
      }
    }
    const captureTimestamp = new Date().toISOString();
    const firstLens = facing;
    const secondLens: 'back' | 'front' = firstLens === 'front' ? 'back' : 'front';
    setCaptureOriginLens(firstLens);

    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    if (permission?.granted && cameraRef.current) {
      try {
        if (!cameraReady) {
          const { promise, resolve } = Promise.withResolvers<void>();
          cameraReadyResolverRef.current = resolve;
          setTimeout(resolve, 900);
          await promise;
        }
        await waitMs(180);
        if (!isMountedRef.current || !cameraRef.current) return;

        setStage('capturing_first');
        let firstShot = await cameraRef.current
          .takePictureAsync({
            quality: 0.55,
            base64: true,
          })
          .catch(() => null);
        if (!firstShot?.uri && isMountedRef.current && cameraRef.current) {
          await waitMs(450);
          firstShot = await cameraRef.current
            .takePictureAsync({
              quality: 0.55,
              base64: true,
            })
            .catch(() => null);
        }
        if (!isMountedRef.current) return;

        setStage('switching_lens');
        setCameraReady(false);
        const { promise: readyPromise, resolve: resolveReady } = Promise.withResolvers<void>();
        cameraReadyResolverRef.current = resolveReady;
        setTimeout(resolveReady, 1200);
        setFacing(secondLens);
        await readyPromise;
        if (!isMountedRef.current) return;

        // Extra settling window so Android CameraX front->back or back->front session binds and exposes cleanly
        await waitMs(480);
        if (!isMountedRef.current || !cameraRef.current) return;

        setStage('capturing_second');
        let secondShot = await cameraRef.current
          .takePictureAsync({
            quality: 0.55,
            base64: true,
          })
          .catch(() => null);

        // Retry once if the opposite camera HAL was still settling
        if (!secondShot?.uri && isMountedRef.current && cameraRef.current) {
          await waitMs(550);
          secondShot = await cameraRef.current
            .takePictureAsync({
              quality: 0.55,
              base64: true,
            })
            .catch(() => null);
        }
        if (!isMountedRef.current) return;

        const firstUri = firstShot?.uri?.startsWith('data:')
          ? firstShot.uri
          : firstShot?.base64 && firstShot.base64.length <= 240_000
            ? firstShot.base64.startsWith('data:') ? firstShot.base64 : `data:image/jpeg;base64,${firstShot.base64}`
            : firstShot?.uri;
        const secondShotUri = secondShot?.uri?.startsWith('data:')
          ? secondShot.uri
          : secondShot?.base64 && secondShot.base64.length <= 240_000
            ? secondShot.base64.startsWith('data:') ? secondShot.base64 : `data:image/jpeg;base64,${secondShot.base64}`
            : secondShot?.uri;

        if (!firstUri || !secondShotUri) {
          if (isMountedRef.current) {
            setStage('ready');
            setError('The second camera frame was not captured. Check camera access and try again.');
          }
          return;
        }

        const rawBack = firstLens === 'back' ? firstUri : secondShotUri;
        const rawFront = firstLens === 'front' ? firstUri : secondShotUri;
        const captureLabel = formatMomentWatermarkTimestamp(captureTimestamp);
        const [resolvedBack, resolvedFront] = await Promise.all([
          embedKeepItWatermarkOnImageUri(rawBack, captureLabel),
          embedKeepItWatermarkOnImageUri(rawFront, captureLabel),
        ]);
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
      } catch {
        if (isMountedRef.current) {
          setStage('ready');
          setError('Camera capture failed before both lenses were saved. Check camera access and try again.');
        }
        return;
      }
    }
    setStage('ready');
    setError('Allow camera access before capturing a Moment.');
  };

  const finalizeVideoCapture = async (finalDuration: number) => {
    if (finalizeRecordingRef.current) return;
    finalizeRecordingRef.current = true;
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

    if (!recordedHardwareUri) {
      finalizeRecordingRef.current = false;
      setActiveCameraMode('picture');
      setStage('ready');
      setError('The video could not be saved. Check camera and microphone access, then record again.');
      return;
    }

    try {
      setStage('switching_lens');
      setCameraReady(false);
      const { promise, resolve } = Promise.withResolvers<void>();
      cameraReadyResolverRef.current = resolve;
      setTimeout(resolve, 1200);
      const companionLens = recordingOriginRef.current === 'front' ? 'back' : 'front';
      setActiveCameraMode('picture');
      setFacing(companionLens);
      await promise;
      await waitMs(480);
      if (!isMountedRef.current || !cameraRef.current) return;
      setStage('capturing_second');
      const companion = await cameraRef.current.takePictureAsync({ quality: 0.65 });
      if (!companion?.uri) throw new Error('Companion photo was not saved.');
      if (companionLens === 'front') setFrontUri(companion.uri);
      else setBackUri(companion.uri);
      setVideoDurationSec(finalDuration);
      setVideoUri(recordedHardwareUri);
      setStage('preview');
    } catch {
      setStage('ready');
      setError('The companion camera photo could not be saved. Record again to capture both sides.');
    } finally {
      finalizeRecordingRef.current = false;
    }
  };

  const startOrStopVideoRecording = async () => {
    setError(null);
    if (stage === 'recording_video') {
      const finalDuration = Math.max(1, elapsedRecordingRef.current);
      await finalizeVideoCapture(finalDuration);
      return;
    }
    if (Platform.OS === 'web') {
      setError('Video capture is not available in the browser yet. Choose Dual Photo to use the browser camera.');
      return;
    }
    if (!permission?.granted || !cameraRef.current || !cameraReady) {
      setError('Video capture requires camera access. Allow access, then try again.');
      return;
    }

    // Request microphone permission if available on native (or record muted if declined)
    if (micPermission && !micPermission.granted && micPermission.canAskAgain) {
      try {
        await requestMicPermission();
      } catch {
        // Continue with muted video recording if mic is declined
      }
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setCaptureOriginLens(facing);
    recordingOriginRef.current = facing;
    setCapturedAtIso(new Date().toISOString());
    elapsedRecordingRef.current = 0;
    setRecordingSec(0);
    setStage('capturing_first');
    try {
      const stillThumb = await cameraRef.current.takePictureAsync({ quality: 0.65 });
      if (!stillThumb?.uri) throw new Error('First camera frame was not saved.');
      if (!isMountedRef.current) return;
      if (facing === 'front') setFrontUri(stillThumb.uri);
      else setBackUri(stillThumb.uri);
      const { promise, resolve } = Promise.withResolvers<void>();
      cameraReadyResolverRef.current = resolve;
      setTimeout(resolve, 1200);
      setCameraReady(false);
      setActiveCameraMode('video');
      await promise;
      await waitMs(480);
      if (!isMountedRef.current || !cameraRef.current) return;
      setStage('recording_video');
      activeRecordingPromiseRef.current = cameraRef.current.recordAsync({ maxDuration: 15 });
      void activeRecordingPromiseRef.current.catch(() => {
        if (!isMountedRef.current) return;
        clearInterval(recordingTimerRef.current);
        setActiveCameraMode('picture');
        setStage('ready');
        setError('Video recording failed. Record again to capture both sides.');
      });
      recordingTimerRef.current = setInterval(() => {
        elapsedRecordingRef.current += 1;
        setRecordingSec(elapsedRecordingRef.current);
        if (elapsedRecordingRef.current >= 15) void finalizeVideoCapture(15);
      }, 1000) as unknown as number;
    } catch {
      setActiveCameraMode('picture');
      setStage('ready');
      setError('Video recording could not start. Check camera access and try again.');
    }
  };

  const handleUseCurrentGpsLocation = async () => {
    setError(null);
    if (locating) return;
    setLocating(true);
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
    } finally {
      setLocating(false);
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

  const disableRemovalPrevention = usePreventRemove(!allowLeave && (stage !== 'ready' || submitting), ({ repeat }) => {
    if (submitting || (stage !== 'preview' && stage !== 'recording_video')) return;
    const discard = () => {
      if (stage === 'recording_video') {
        clearInterval(recordingTimerRef.current);
        try { cameraRef.current?.stopRecording(); } catch { /* The recorder may have already stopped. */ }
      }
      pendingRemovalRef.current = null;
      setAllowLeave(true);
      repeat();
    };
    const message = stage === 'preview' ? 'Your captured media and edits will be lost.' : 'Your current recording will not be saved.';
    if (Platform.OS === 'web') {
      if (globalThis.confirm(`Discard this Moment? ${message}`)) discard();
    } else {
      Alert.alert('Discard this Moment?', message, [
        { text: stage === 'preview' ? 'Keep editing' : 'Keep recording', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: discard },
      ]);
    }
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
      setAllowLeave(true);
      disableRemovalPrevention();
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

  const activeTriggerMs = activeTriggerAt ? new Date(activeTriggerAt).getTime() : NaN;
  const capturedTimeMs = capturedAtIso ? new Date(capturedAtIso).getTime() : NaN;
  const isThisCapturePromptCheckIn =
    isPartnerPaired &&
    !alreadyCheckedInOtherPost &&
    Number.isFinite(activeTriggerMs) &&
    (Number.isFinite(capturedTimeMs)
      ? capturedTimeMs >= activeTriggerMs
      : countdown.phase !== 'upcoming');

  const computedLateSec = isThisCapturePromptCheckIn
    ? Number.isFinite(capturedTimeMs)
      ? Math.max(0, Math.floor((capturedTimeMs - activeTriggerMs) / 1000))
      : countdown.phase === 'late'
        ? 301 + countdown.secondsOverdue
        : 0
    : 0;

  const captureTimeShort = Number.isFinite(capturedTimeMs)
    ? new Date(capturedTimeMs).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : countdown.currentTimeShort;
  const activeSlotNumber = replaceTarget?.daily_index
    ? replaceTarget.daily_index
    : Math.min(MAX_DAILY_MOMENTS_PER_DAY, dailyPostedCount + 1);
  const headerTimingSuffix =
    isThisCapturePromptCheckIn && countdown.phase === 'live'
      ? `${countdown.formattedTimer} left`
      : isThisCapturePromptCheckIn && countdown.phase === 'late'
        ? countdown.formattedTimer
        : captureTimeShort;
  const watermarkTimestamp = formatMomentWatermarkTimestamp(capturedAtIso);

  const handleClose = () => {
    if (submitting || (stage !== 'ready' && stage !== 'preview' && stage !== 'recording_video')) return;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  });

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
            { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 132 },
          ]}>
          <PageHeader
            title={stage === 'preview' ? 'Review Moment' : 'Capture Moment'}
            subtitle={stage === 'preview' ? 'Check both sides before publishing.' : 'A two-sided Moment, captured together.'}
            onBack={handleClose}
            backLabel={submitting ? 'Publishing…' : 'Close'}
            backDisabled={submitting || (stage !== 'ready' && stage !== 'preview' && stage !== 'recording_video')}
            action={stage !== 'preview' ? (
              <AppPressable
                accessibilityRole="button"
                accessibilityLabel={`Toggle flash, currently ${flash}`}
                accessibilityState={{ checked: flash === 'on' }}
                disabled={stage !== 'ready'}
                onPress={() => setFlash((prev) => (prev === 'off' ? 'on' : 'off'))}
                style={styles.headerControl}>
                <Text style={[styles.topButtonText, { color: colors.ink }]}>Flash {flash === 'on' ? 'on' : 'off'}</Text>
              </AppPressable>
            ) : null}
          />
          <View style={styles.statusRow}>
            <View style={[styles.timerPill, { borderColor: stage === 'recording_video' ? colors.danger : colors.controlBorder, backgroundColor: colors.surface, borderRadius: radii.input }]}>
              <Text style={[styles.timerText, { color: stage === 'recording_video' ? colors.danger : colors.ink }]}>
                {stage === 'recording_video'
                  ? `REC 00:${String(recordingSec).padStart(2, '0')} / 00:15`
                  : `Post ${activeSlotNumber}/${MAX_DAILY_MOMENTS_PER_DAY} · ${headerTimingSuffix}`}
              </Text>
            </View>
            <Text style={[styles.statusCopy, { color: colors.inkMuted }]}> 
              {shotsRemainingToday} capture{shotsRemainingToday === 1 ? '' : 's'} left today
            </Text>
          </View>
          {bundleQuery.isError ? <View style={{ gap: 8 }}><InlineNotice message="Today's capture allowance could not load. Retry before publishing." tone="error" /><KeepItButton label="Retry daily allowance" variant="secondary" onPress={() => void bundleQuery.refetch()} /></View> : null}

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
                  disabled={stage !== 'ready'}
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
                  disabled={stage !== 'ready'}
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
                disabled={stage !== 'ready'}
                onPress={() => handleSwitchLens(facing === 'back' ? 'front' : 'back')}
                style={[
                  styles.lensPill,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                    borderRadius: radii.input,
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
                {permission?.granted ? (
                  <CameraView
                    key={`cam-${facing}-${activeCameraMode}`}
                    ref={cameraRef}
                    style={styles.full}
                    facing={facing}
                    flash={facing === 'front' ? 'off' : flash}
                    mute={!micPermission?.granted}
                    mode={activeCameraMode}
                    onCameraReady={handleCameraReady}
                    onMountError={(event) => {
                      setCameraReady(false);
                      setError(`Camera could not open: ${event.message}. Check camera permission and try switching lenses.`);
                    }}
                  />
                ) : (
                  <View style={styles.simulatedViewfinder}>

                    <Text style={[styles.viewfinderTitle, { color: colors.ink }]}>
                      {permission ? 'Camera access needed' : 'Checking camera access…'}
                    </Text>
                    <Text style={[styles.viewfinderSub, { color: colors.inkMuted }]}>
                      {Platform.OS === 'web'
                        ? 'Allow this site to use your cameras. Dual Photo needs access to both front and back lenses.'
                        : 'Allow camera access to capture a real Moment. You can close this screen without granting access.'}
                    </Text>

                    {permission && !permission.granted ? (
                      <View style={styles.permissionPrimerBox}>
                        <Text style={[styles.permissionPrimerText, { color: colors.inkMuted }]}> 
                          KeepIt captures the front and back lenses one after the other. No photo is shared until you review and publish it.
                        </Text>
                        <KeepItButton
                          label={permission.canAskAgain ? 'Allow camera access' : Platform.OS === 'web' ? 'How to allow camera access' : 'Open camera settings'}
                          loading={permissionRetrying}
                          variant="secondary"
                          onPress={() => {
                            setPermissionRetrying(true);
                            if (Platform.OS === 'web' && !permission.canAskAgain) {
                              setError('Camera access is blocked. Open this site’s camera permissions in your browser settings, allow access, then reload this page.');
                              setPermissionRetrying(false);
                              return;
                            }
                            const request = permission.canAskAgain ? requestPermission() : Linking.openSettings();
                            void request.catch(() => setError('Camera permission could not be opened. Try again in your device settings.')).finally(() => setPermissionRetrying(false));
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

                {/* Permanent #keepit SVG + Timestamp Bottom-Left Watermark on Photo */}
                <View pointerEvents="none" style={styles.keepItPhotoWatermark}>
                  <KeepItWatermarkLogo width={76} color="#FFFFFF" />
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
                      disabled={stage !== 'ready'}
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
              {bundleQuery.isSuccess && shotsRemainingToday === 0 && !params.replaceMomentId ? <InlineNotice message={`You have posted all ${MAX_DAILY_MOMENTS_PER_DAY} Moments for today. You can replace an existing Moment from its menu.`} /> : null}
              {Platform.OS === 'web' && mediaType === 'video' ? <InlineNotice message="Browser video recording is unavailable. Dual Photo uses your real browser cameras." /> : null}

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
                  disabled={!permission?.granted || !cameraReady || (stage !== 'ready' && stage !== 'recording_video') || (stage === 'ready' && bundleQuery.isSuccess && shotsRemainingToday === 0 && !params.replaceMomentId) || (Platform.OS === 'web' && mediaType === 'video')}
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
                  disabled={stage !== 'ready'}
                  onPress={() => handleSwitchLens(facing === 'back' ? 'front' : 'back')}>
                  <Text style={[styles.sideMeta, { color: colors.ink }]}>
                    Lens: {facing === 'back' ? 'Back' : 'Front'}
                  </Text>
                </Pressable>
              </View>
              <Text accessibilityLiveRegion="polite" style={[styles.musicSub, { color: colors.inkMuted, textAlign: 'center' }]}>
                {stage === 'recording_video' ? 'Recording up to 15 seconds. Tap stop to review.' : stage === 'ready' ? 'Capture both sides. Keep still while KeepIt switches lenses.' : 'Capturing both sides. Keep the camera steady.'}
              </Text>
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
                  {isThisCapturePromptCheckIn || mediaType === 'video' ? (
                    <View
                      style={[
                        styles.previewTimingBadge,
                        {
                          backgroundColor: colors.canvas,
                          borderColor: colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.previewTimingText,
                          { color: colors.ink },
                        ]}>
                        {mediaType === 'video'
                          ? `VIDEO ${videoDurationSec ?? 4}s${isThisCapturePromptCheckIn ? ' · ' : ''}`
                          : ''}
                        {isThisCapturePromptCheckIn
                          ? formatLateDuration(computedLateSec)
                          : ''}
                      </Text>
                    </View>
                  ) : null}

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
                          backgroundColor: colors.accentSoft,
                          borderColor: colors.controlBorder,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Text style={[styles.previewTimingText, { color: colors.ink }]}>
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

                {/* Mandatory Bottom-Left #keepit SVG + Timestamp Watermark on Photo (Item #8) */}
                <View pointerEvents="none" style={styles.keepItPhotoWatermark}>
                  <KeepItWatermarkLogo width={76} color="#FFFFFF" />
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
                      accessibilityState={{ selected, disabled: submitting }}
                      disabled={submitting}
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
              <SectionHeader title="Make it yours" subtitle="Attachments are optional. Review the audience before publishing." />
              {locationLabel || selectedMusic || taggedUsers.length > 0 ? (
                <View style={styles.wrapRow}>
                  {locationLabel ? <KeepItButton label={`Remove location: ${locationLabel}`} variant="secondary" disabled={submitting} onPress={() => { setLocationLabel(null); setCoords(null); }} /> : null}
                  {selectedMusic ? <KeepItButton label={`Remove music: ${selectedMusic.title}`} variant="secondary" disabled={submitting} onPress={() => setSelectedMusic(null)} /> : null}
                  {taggedUsers.map((person) => <KeepItButton key={person.userId} label={`Untag @${person.username}`} variant="secondary" disabled={submitting} onPress={() => toggleTagPerson(person)} />)}
                </View>
              ) : null}

              {/* Rich Creative Toolbar: Emoji/Text On-Photo, Location, Music, Tag People, Snap Once */}
              <View style={styles.creativeToolbar}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add Emoji or Text to photo"
                  accessibilityState={{ expanded: showOverlayEditor }}
                  disabled={submitting}
                  onPress={() => setShowOverlayEditor((v) => !v)}
                  style={[
                    styles.toolChip,
                    {
                      backgroundColor:
                        overlays.length > 0 || showOverlayEditor
                          ? colors.accentSoft
                          : colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.input,
                    },
                  ]}>
                  <Text style={[styles.toolChipText, { color: colors.ink }]}>
                    Stickers / Text {overlays.length > 0 ? `(${overlays.length})` : ''}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add Location to post"
                  accessibilityState={{ expanded: showLocationPicker }}
                  disabled={submitting}
                  onPress={() => setShowLocationPicker((v) => !v)}
                  style={[
                    styles.toolChip,
                    {
                      backgroundColor:
                        locationLabel || showLocationPicker
                          ? colors.accentSoft
                          : colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.input,
                    },
                  ]}>
                  <Text style={[styles.toolChipText, { color: colors.ink }]}>
                    {locationLabel ? locationLabel.split('·')[0].trim() : 'Location'}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add Music to post"
                  accessibilityState={{ expanded: showMusicPicker }}
                  disabled={submitting}
                  onPress={() => setShowMusicPicker((v) => !v)}
                  style={[
                    styles.toolChip,
                    {
                      backgroundColor:
                        selectedMusic || showMusicPicker
                          ? colors.accentSoft
                          : colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.input,
                    },
                  ]}>
                  <Text style={[styles.toolChipText, { color: colors.ink }]}>
                    {selectedMusic ? selectedMusic.title : 'Music'}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Tag people in post"
                  accessibilityState={{ expanded: showTagPicker }}
                  disabled={submitting}
                  onPress={() => setShowTagPicker((v) => !v)}
                  style={[
                    styles.toolChip,
                    {
                      backgroundColor:
                        taggedUsers.length > 0 || showTagPicker
                          ? colors.accentSoft
                          : colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.input,
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
                  <KeepItButton label="Done editing stickers and text" variant="ghost" onPress={() => setShowOverlayEditor(false)} />
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
                  {overlays.length > 0 ? <View style={styles.wrapRow}>{overlays.map((item) => <KeepItButton key={item.id} label={`Remove ${item.content}`} variant="secondary" onPress={() => { setOverlays((items) => items.filter((overlay) => overlay.id !== item.id)); setSelectedOverlayId(null); }} />)}</View> : null}

                  <View style={styles.inlineInputRow}>
                    <TextInput
                      accessibilityLabel="Text overlay on photo"
                      value={overlayTextDraft}
                      onChangeText={setOverlayTextDraft}
                      placeholder="Add text to your Moment"
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
                    <KeepItButton label="Place text" disabled={!overlayTextDraft.trim() || submitting} onPress={handleAddTextOverlay} />
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
                            fontSize: 15,
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
                          <Text style={{ fontSize: 15, color: colors.danger, fontWeight: '600' }}>
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
                  <KeepItButton label="Close location picker" variant="ghost" disabled={locating} onPress={() => setShowLocationPicker(false)} />
                  <View style={styles.wrapRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Use current GPS location"
                      disabled={locating || submitting}
                      accessibilityState={{ busy: locating, disabled: locating || submitting }}
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
                        {locating ? 'Finding your location…' : 'Use current GPS'}
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
                      disabled={!customLocationInput.trim() || submitting}
                      onPress={() => {
                        if (customLocationInput.trim()) {
                          setLocationLabel(customLocationInput.trim());
                          setCoords(null);
                          setCustomLocationInput('');
                          setShowLocationPicker(false);
                        }
                      }}
                    />
                  </View>
                  {locationLabel ? <KeepItButton label="Remove location" variant="secondary" onPress={() => { setLocationLabel(null); setCoords(null); }} /> : null}
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
                  <KeepItButton label="Close music picker" variant="ghost" onPress={() => setShowMusicPicker(false)} />
                  <View style={{ gap: 8 }}>
                    {CURATED_MUSIC_TRACKS.map((trk) => {
                      const active = selectedMusic?.id === trk.id;
                      return (
                        <Pressable
                          key={trk.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active, disabled: submitting }}
                          disabled={submitting}
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
                          <Text style={{ color: colors.ink, fontWeight: '600', fontSize: 15 }}>
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
                  <KeepItButton label="Done tagging people" variant="ghost" onPress={() => setShowTagPicker(false)} />
                  {friendsQuery.isPending ? <Text style={[styles.musicSub, { color: colors.inkMuted }]}>Loading friends…</Text> : null}
                  {friendsQuery.isError ? <KeepItButton label="Retry loading friends" variant="secondary" onPress={() => void friendsQuery.refetch()} /> : null}
                  {!friendsQuery.isPending && filteredTaggablePeople.length === 0 ? <Text style={[styles.musicSub, { color: colors.inkMuted }]}>{tagSearchQuery.trim() ? 'No matching people. Try another name.' : 'No people to tag yet. Connect with your partner or add friends first.'}</Text> : null}
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
                          accessibilityState={{ selected: isTagged, disabled: submitting }}
                          disabled={submitting}
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
                    disabled={submitting}
                    value={snapOnce}
                    onValueChange={setSnapOnce}
                  />
                </View>

                <SectionHeader title="Who can see this?" subtitle={visibility === 'partner' ? 'Shared with your paired partner only.' : visibility === 'friends' ? 'Shared with your friends circle.' : 'Shared with your partner and friends circle.'} />
                <View style={styles.audienceRow}>
                  {(['everyone', 'partner', 'friends'] as const).map((vis) => (
                    <Pressable
                      key={vis}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: visibility === vis, disabled: submitting }}
                      disabled={submitting}
                      onPress={() => setVisibility(vis)}
                      style={[
                        styles.audienceChip,
                        {
                          backgroundColor:
                            visibility === vis ? colors.surfaceElevated : 'transparent',
                          borderColor:
                            visibility === vis ? colors.accent : colors.border,
                          borderRadius: radii.input,
                        },
                      ]}>
                      <Text
                        style={{
                          fontSize: 15,
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
              <Text style={[styles.musicSub, { color: colors.inkMuted }]}>Snap Once gives each viewer 15 seconds after opening. It does not prevent screenshots or recordings.</Text>

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
                  editable={!submitting}
                  multiline
                  textAlignVertical="top"
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
                  loadingLabel="Publishing Moment…"
                  disabled={!user || !couple || submitting || bundleQuery.isPending || bundleQuery.isError}
                  onPress={() => void handlePostMoment()}
                />
                <KeepItButton
                  label="Retake"
                  variant="secondary"
                  disabled={submitting}
                  onPress={() => {
                    const retake = () => {
                      setBackUri(null);
                      setFrontUri(null);
                      setVideoUri(null);
                      setVideoDurationSec(null);
                      setCapturedAtIso(null);
                      setActiveCameraMode('picture');
                      setStage('ready');
                      setError(null);
                    };
                    if (Platform.OS === 'web') {
                      if (globalThis.confirm('Retake this Moment? Your captured media will be replaced.')) retake();
                    } else {
                      Alert.alert('Retake this Moment?', 'Your captured media will be replaced. Captions and attachments will stay.', [
                        { text: 'Keep editing', style: 'cancel' },
                        { text: 'Retake', style: 'destructive', onPress: retake },
                      ]);
                    }
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
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
    gap: 16,
  },
  headerControl: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusCopy: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 20,
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
    flexWrap: 'wrap',
    borderWidth: 1,
    borderRadius: 10,
    padding: 3,
    gap: 4,
  },
  modeTab: {
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  modeTabText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
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
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  viewfinderFrame: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    aspectRatio: 0.75,
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
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    textAlign: 'center',
  },
  viewfinderSub: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  keepItPhotoWatermark: {
    position: 'absolute',
    bottom: 14,
    left: 16,
    maxWidth: '48%',
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(10, 7, 8, 0.72)',
    alignItems: 'flex-start',
    gap: 4,
  },
  keepItWatermarkTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  keepItWatermarkTime: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
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
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  shutterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  sideMeta: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
    flexShrink: 1,
    maxWidth: 90,
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
    width: 80,
    height: 108,
    borderRadius: 10,
    borderWidth: 2,
    overflow: 'hidden',
  },
  previewBadgeStack: {
    position: 'absolute',
    top: 16,
    right: 16,
    maxWidth: '54%',
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
    backgroundColor: '#0A0708',
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
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    flexShrink: 1,
  },
  drawerCard: {
    padding: 20,
    gap: 14,
  },
  drawerTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
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
    alignItems: 'stretch',
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
    fontSize: 15,
    lineHeight: 22,
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
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  musicSub: {
    fontSize: 13,
    lineHeight: 20,
  },
  snapOnceCard: {
    padding: 20,
    gap: 16,
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
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  captionInput: {
    minHeight: 50,
    minWidth: 0,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: 22,
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
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  dualCaptureBanner: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 13,
    paddingVertical: 12,
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
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    flexShrink: 1,
    fontVariant: ['tabular-nums'],
  }
});
