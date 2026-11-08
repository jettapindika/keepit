import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
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
import {
  embedKeepItWatermarkOnImageUri,
  exportAndShareCompositeMoment,
  formatMomentWatermarkTimestamp,
} from '@/utils/momentExport';
import { extractVideoDualFramesJpeg } from '../../modules/keepit-widget-bridge';

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
  const [showFilterTray, setShowFilterTray] = useState(false);
  const [stage, setStage] = useState<CaptureStage>('ready');
  const [cameraReady, setCameraReady] = useState(false);
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
  const [vlogPipUri, setVlogPipUri] = useState<string | null>(null);
  const [savePreviewOpen, setSavePreviewOpen] = useState(false);
  const [savingDraftPhoto, setSavingDraftPhoto] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
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

  const handleSelectMediaType = (nextMode: MomentMediaType) => {
    if (stage !== 'ready' || nextMode === mediaType) return;
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
    setError(null);
    setCameraReady(false);
    setMediaType(nextMode);
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
        const pictureOptions =
          Platform.OS === 'web'
            ? { quality: 0.55, base64: true }
            : { quality: 0.55 };
        let firstShot = await cameraRef.current
          .takePictureAsync(pictureOptions)
          .catch(() => null);
        if (!firstShot?.uri && isMountedRef.current && cameraRef.current) {
          await waitMs(450);
          firstShot = await cameraRef.current
            .takePictureAsync(pictureOptions)
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
          .takePictureAsync(pictureOptions)
          .catch(() => null);

        // Retry once if the opposite camera HAL was still settling
        if (!secondShot?.uri && isMountedRef.current && cameraRef.current) {
          await waitMs(550);
          secondShot = await cameraRef.current
            .takePictureAsync(pictureOptions)
            .catch(() => null);
        }
        if (!isMountedRef.current) return;

        const firstUri = firstShot?.uri?.startsWith('data:')
          ? firstShot.uri
          : Platform.OS === 'web' && firstShot?.base64 && firstShot.base64.length <= 240_000
            ? firstShot.base64.startsWith('data:') ? firstShot.base64 : `data:image/jpeg;base64,${firstShot.base64}`
            : firstShot?.uri;
        const secondShotUri = secondShot?.uri?.startsWith('data:')
          ? secondShot.uri
          : Platform.OS === 'web' && secondShot?.base64 && secondShot.base64.length <= 240_000
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
          waitMs(4000).then(() => undefined),
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
      setVlogPipUri(null);
      setStage('ready');
      setError('The video could not be saved. Check camera and microphone access, then record again.');
      return;
    }

    try {
      const primaryLens = recordingOriginRef.current;
      const captureLabel = formatMomentWatermarkTimestamp(capturedAtIso);
      const extractedFrames = await extractVideoDualFramesJpeg(recordedHardwareUri);

      const rawStartFrame = extractedFrames?.startUri ?? vlogPipUri ?? recordedHardwareUri;
      const rawEndFrame = extractedFrames?.endUri ?? vlogPipUri ?? rawStartFrame;

      const [watermarkedStart, watermarkedEnd] = await Promise.all([
        embedKeepItWatermarkOnImageUri(rawStartFrame, captureLabel),
        embedKeepItWatermarkOnImageUri(rawEndFrame, captureLabel),
      ]);

      if (primaryLens === 'front') {
        setFrontUri(watermarkedEnd);
        setBackUri(vlogPipUri ?? watermarkedStart);
      } else {
        setBackUri(watermarkedEnd);
        setFrontUri(vlogPipUri ?? watermarkedStart);
      }

      setVideoDurationSec(finalDuration);
      setVideoUri(recordedHardwareUri);
      setPipSwapped(false);
      setStage('preview');
    } catch {
      setStage('ready');
      setError('The video could not be saved. Record again to capture your Moment.');
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
      setError('Video capture is not available in the browser yet. Switch to Photo mode to use the browser camera.');
      return;
    }
    if (!permission?.granted || !cameraRef.current) {
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
    const startLens = facing;
    setCaptureOriginLens(startLens);
    recordingOriginRef.current = startLens;
    setCapturedAtIso(new Date().toISOString());
    elapsedRecordingRef.current = 0;
    setRecordingSec(0);
    setShowFilterTray(false);

    try {
      if (!cameraReady) {
        const { promise, resolve } = Promise.withResolvers<void>();
        cameraReadyResolverRef.current = resolve;
        setTimeout(resolve, 900);
        await promise;
      }
      if (!isMountedRef.current || !cameraRef.current) return;

      // Record immediately without sequential lens switching!
      setStage('recording_video');
      const recPromise = cameraRef.current.recordAsync({ maxDuration: 15 });
      activeRecordingPromiseRef.current = recPromise;
      void recPromise.catch(() => {
        if (!isMountedRef.current || finalizeRecordingRef.current) return;
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = undefined;
        activeRecordingPromiseRef.current = null;
        setVlogPipUri(null);
        setStage('ready');
        setError('Video recording failed. Record again to capture your Moment.');
      });
      recordingTimerRef.current = setInterval(() => {
        elapsedRecordingRef.current += 1;
        setRecordingSec(elapsedRecordingRef.current);
        if (elapsedRecordingRef.current >= 15) {
          void finalizeVideoCapture(15);
        }
      }, 1000) as unknown as number;
    } catch {
      setVlogPipUri(null);
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
      setTimeout(() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/(tabs)');
        }
      }, 0);
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Could not publish Moment. Try again.');
      }
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false);
      }
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
  const headerQuotaLabel = replaceTarget?.daily_index
    ? `Editing ${replaceTarget.daily_index}/${MAX_DAILY_MOMENTS_PER_DAY}`
    : `${Math.min(dailyPostedCount, MAX_DAILY_MOMENTS_PER_DAY)}/${MAX_DAILY_MOMENTS_PER_DAY} today`;
  const headerTimingLabel =
    isThisCapturePromptCheckIn && countdown.phase === 'live'
      ? `Live · ${countdown.formattedTimer} left`
      : isThisCapturePromptCheckIn && countdown.phase === 'late'
        ? `Late · ${countdown.formattedTimer}`
        : captureTimeShort;
  const shutterDisabled =
    !permission?.granted ||
    !cameraReady ||
    (stage !== 'ready' && stage !== 'recording_video') ||
    (stage === 'ready' &&
      bundleQuery.isSuccess &&
      shotsRemainingToday === 0 &&
      !params.replaceMomentId) ||
    (Platform.OS === 'web' && mediaType === 'video');
  const shutterHint = shotsRemainingToday === 0 && !params.replaceMomentId
    ? 'All of today’s Moments are posted. Replace one from its menu on Home.'
    : !permission?.granted
      ? 'Camera permission is required to capture.'
      : !cameraReady
        ? 'Camera is still starting.'
        : undefined;
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

  const filterActive = filterPreset !== 'normal' || showFilterTray;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        {stage !== 'preview' ? (
          <View style={styles.captureViewport}>
            {/* Top Icon Bar: Close Icon | Status Pill | Flash Icon */}
            <View style={styles.captureTopBar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={submitting ? 'Publishing…' : 'Close camera'}
                disabled={submitting || (stage !== 'ready' && stage !== 'recording_video')}
                onPress={handleClose}
                style={[
                  styles.iconCircleBtn,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}>
                <SymbolView
                  name={{ ios: 'xmark', android: 'close', web: 'close' }}
                  tintColor={colors.ink}
                  size={20}
                  fallback={<Text style={[styles.iconFallbackText, { color: colors.ink }]}>✕</Text>}
                />
              </Pressable>

              <View style={styles.capturePillRow}>
                <View
                  style={[
                    styles.timerPill,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.timerText, { color: colors.ink }]}>
                    {headerQuotaLabel}
                  </Text>
                </View>
                <View
                  style={[
                    styles.timerPill,
                    {
                      borderColor:
                        stage === 'recording_video' ? colors.danger : colors.border,
                      backgroundColor: colors.surface,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.timerText,
                      {
                        color:
                          stage === 'recording_video' ? colors.danger : colors.ink,
                      },
                    ]}>
                    {stage === 'recording_video'
                      ? `REC 00:${String(recordingSec).padStart(2, '0')} / 00:15`
                      : headerTimingLabel}
                  </Text>
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Toggle flash, currently ${flash}`}
                accessibilityState={{ checked: flash === 'on' }}
                disabled={!permission?.granted || !cameraReady || stage !== 'ready'}
                onPress={() => {
                  if (Platform.OS !== 'web') {
                    void Haptics.selectionAsync();
                  }
                  setFlash((prev) => (prev === 'off' ? 'on' : 'off'));
                }}
                style={[
                  styles.iconCircleBtn,
                  {
                    backgroundColor:
                      flash === 'on' ? colors.accent : colors.surface,
                    borderColor:
                      flash === 'on' ? colors.accent : colors.border,
                  },
                ]}>
                <SymbolView
                  name={
                    flash === 'on'
                      ? { ios: 'bolt.fill', android: 'flash_on', web: 'flash_on' }
                      : { ios: 'bolt.slash.fill', android: 'flash_off', web: 'flash_off' }
                  }
                  tintColor={flash === 'on' ? colors.onAccent : colors.ink}
                  size={20}
                  fallback={
                    <Text
                      style={[
                        styles.iconFallbackText,
                        { color: flash === 'on' ? colors.onAccent : colors.ink },
                      ]}>
                      ⚡
                    </Text>
                  }
                />
              </Pressable>
            </View>

            {bundleQuery.isError ? (
              <View style={styles.compactNoticeWrap}>
                <InlineNotice
                  message="Today's capture allowance could not load. Retry before publishing."
                  tone="error"
                />
                <KeepItButton
                  label="Retry daily allowance"
                  variant="secondary"
                  onPress={() => void bundleQuery.refetch()}
                />
              </View>
            ) : null}

            {/* Flexible 3:4 Viewfinder Stage */}
            <View style={styles.viewfinderStage}>
              <View
                style={[
                  styles.captureViewfinderFrame,
                  {
                    backgroundColor: colors.surface,
                    borderColor: activeFilterMeta.borderAccent || colors.border,
                    borderRadius: radii.photo,
                  },
                ]}>
                {permission?.granted ? (
                  <CameraView
                    ref={cameraRef}
                    style={styles.full}
                    facing={facing}
                    flash={facing === 'front' ? 'off' : flash}
                    mute={!micPermission?.granted}
                    mode={mediaType === 'video' ? 'video' : 'picture'}
                    onCameraReady={handleCameraReady}
                    onMountError={(event) => {
                      setCameraReady(false);
                      setError(
                        `Camera could not open: ${event.message}. Check camera permission and try switching lenses.`
                      );
                    }}
                  />
                ) : (
                  <View style={styles.simulatedViewfinder}>
                    <Text style={[styles.viewfinderTitle, { color: colors.ink }]}>
                      {permission ? 'Camera access needed' : 'Checking camera access…'}
                    </Text>
                    <Text style={[styles.viewfinderSub, { color: colors.inkMuted }]}>
                      {Platform.OS === 'web'
                        ? 'Allow this site to use your cameras. Dual capture needs access to both front and back lenses.'
                        : 'Allow camera access to capture a real Moment. You can close this screen without granting access.'}
                    </Text>

                    {permission && !permission.granted ? (
                      <View style={styles.permissionPrimerBox}>
                        <Text style={[styles.permissionPrimerText, { color: colors.inkMuted }]}>
                          KeepIt captures the front and back lenses one after the other. No photo is shared until you review and publish it.
                        </Text>
                        <KeepItButton
                          label={
                            permission.canAskAgain
                              ? 'Allow camera access'
                              : Platform.OS === 'web'
                                ? 'How to allow camera access'
                                : 'Open camera settings'
                          }
                          loading={permissionRetrying}
                          variant="secondary"
                          onPress={() => {
                            setPermissionRetrying(true);
                            if (Platform.OS === 'web' && !permission.canAskAgain) {
                              setError(
                                'Camera access is blocked. Open this site’s camera permissions in your browser settings, allow access, then reload this page.'
                              );
                              setPermissionRetrying(false);
                              return;
                            }
                            const request = permission.canAskAgain
                              ? requestPermission()
                              : Linking.openSettings();
                            void request
                              .catch(() =>
                                setError(
                                  'Camera permission could not be opened. Try again in your device settings.'
                                )
                              )
                              .finally(() => setPermissionRetrying(false));
                          }}
                        />
                      </View>
                    ) : null}
                  </View>
                )}

                {/* Simultaneous Vlogging PIP Overlay During Video Mode */}
                {mediaType === 'video' ? (
                  <View pointerEvents="box-none" style={styles.previewPipAnchor}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Switch active vlogging lens, currently ${facing}`}
                      disabled={stage !== 'ready' && stage !== 'recording_video'}
                      onPress={() => {
                        if (Platform.OS !== 'web') void Haptics.selectionAsync();
                        handleSwitchLens(facing === 'back' ? 'front' : 'back');
                      }}
                      style={[
                        styles.previewPip,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: stage === 'recording_video' ? colors.danger : colors.canvas,
                          alignItems: 'center',
                          justifyContent: 'center',
                        },
                      ]}>
                      {vlogPipUri ? (
                        <Image
                          source={{ uri: vlogPipUri }}
                          contentFit="cover"
                          style={styles.full}
                        />
                      ) : (
                        <View style={{ alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6 }}>
                          <SymbolView
                            name={{
                              ios: 'arrow.triangle.2.circlepath.camera',
                              android: 'flip_camera_ios',
                              web: 'flip_camera_ios',
                            }}
                            tintColor={colors.ink}
                            size={20}
                            fallback={<Text style={[styles.iconFallbackText, { color: colors.ink }]}>↻</Text>}
                          />
                          <Text style={{ color: colors.ink, fontSize: 11, fontWeight: '700', textAlign: 'center' }}>
                            {facing === 'back' ? 'Front PIP' : 'Back PIP'}
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  </View>
                ) : null}
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

                {/* Collapsible Filter Carousel Strip Overlaid Inside Viewfinder */}
                {showFilterTray ? (
                  <View
                    style={[
                      styles.floatingFilterTray,
                      {
                        backgroundColor: colors.chromeGlass,
                        borderColor: colors.border,
                        borderRadius: radii.card,
                      },
                    ]}>
                    <ScrollView
                      horizontal
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
                            disabled={!permission?.granted || !cameraReady || stage !== 'ready'}
                            onPress={() => {
                              if (Platform.OS !== 'web') {
                                void Haptics.selectionAsync();
                              }
                              setFilterPreset(preset.id);
                              setShowFilterTray(false);
                            }}
                            style={[
                              styles.filterChip,
                              {
                                backgroundColor: selected
                                  ? colors.accent
                                  : colors.surfaceElevated,
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
                  </View>
                ) : null}
              </View>
            </View>

            {error ? (
              <View style={styles.compactNoticeWrap}>
                <InlineNotice message={error} tone="error" />
              </View>
            ) : null}
            {bundleQuery.isSuccess &&
            shotsRemainingToday === 0 &&
            !params.replaceMomentId ? (
              <View style={styles.compactNoticeWrap}>
                <InlineNotice
                  message={`You have posted all ${MAX_DAILY_MOMENTS_PER_DAY} Moments for today. You can replace an existing Moment from its menu.`}
                />
              </View>
            ) : null}
            {Platform.OS === 'web' && mediaType === 'video' ? (
              <View style={styles.compactNoticeWrap}>
                <InlineNotice message="Browser video recording is unavailable. Switch to Photo to use your browser cameras." />
              </View>
            ) : null}

            {/* Bottom Camera Controls: Photo/Video Selector Above Shutter + Icon Controls */}
            <View style={styles.bottomCameraControls}>
              <View
                accessibilityRole="tablist"
                accessibilityLabel="Camera capture mode"
                style={styles.cameraModeSelector}>
                <Pressable
                  accessibilityRole="tab"
                  accessibilityLabel="Photo"
                  accessibilityState={{ selected: mediaType === 'photo' }}
                  disabled={!permission?.granted || !cameraReady || stage !== 'ready'}
                  onPress={() => handleSelectMediaType('photo')}
                  style={styles.cameraModeOption}>
                  <Text
                    style={[
                      styles.cameraModeText,
                      {
                        color:
                          mediaType === 'photo' ? colors.ink : colors.inkMuted,
                        fontWeight: mediaType === 'photo' ? '700' : '500',
                      },
                    ]}>
                    Photo
                  </Text>
                  <View
                    style={[
                      styles.cameraModeDot,
                      {
                        backgroundColor:
                          mediaType === 'photo' ? colors.ink : 'transparent',
                      },
                    ]}
                  />
                </Pressable>

                <Pressable
                  accessibilityRole="tab"
                  accessibilityLabel="Video"
                  accessibilityState={{ selected: mediaType === 'video' }}
                  disabled={!permission?.granted || !cameraReady || stage !== 'ready'}
                  onPress={() => handleSelectMediaType('video')}
                  style={styles.cameraModeOption}>
                  <Text
                    style={[
                      styles.cameraModeText,
                      {
                        color:
                          mediaType === 'video' ? colors.ink : colors.inkMuted,
                        fontWeight: mediaType === 'video' ? '700' : '500',
                      },
                    ]}>
                    Video
                  </Text>
                  <View
                    style={[
                      styles.cameraModeDot,
                      {
                        backgroundColor:
                          mediaType === 'video' ? colors.danger : 'transparent',
                      },
                    ]}
                  />
                </Pressable>
              </View>

              <View style={styles.shutterBar}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Toggle filters, current filter ${activeFilterMeta.label}`}
                  accessibilityState={{ expanded: showFilterTray, selected: filterActive }}
                  disabled={!permission?.granted || !cameraReady || stage !== 'ready'}
                  onPress={() => {
                    if (Platform.OS !== 'web') {
                      void Haptics.selectionAsync();
                    }
                    setShowFilterTray((prev) => !prev);
                  }}
                  style={[
                    styles.dockIconBtn,
                    {
                      backgroundColor: filterActive
                        ? colors.accent
                        : colors.surface,
                      borderColor: filterActive ? colors.accent : colors.border,
                    },
                  ]}>
                  <SymbolView
                    name={{
                      ios: 'camera.filters',
                      android: 'filter_vintage',
                      web: 'filter_vintage',
                    }}
                    tintColor={filterActive ? colors.onAccent : colors.ink}
                    size={22}
                    fallback={
                      <Text
                        style={[
                          styles.iconFallbackText,
                          { color: filterActive ? colors.onAccent : colors.ink },
                        ]}>
                        ◐
                      </Text>
                    }
                  />
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    mediaType === 'video'
                      ? stage === 'recording_video'
                        ? 'Stop Video Recording'
                        : 'Record Dual Video'
                      : 'Capture Dual Moment'
                  }
                  accessibilityHint={shutterHint}
                  disabled={shutterDisabled}
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
                      opacity: shutterDisabled ? 0.4 : 1,
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
                  accessibilityLabel={`Switch camera lens, currently ${facing}`}
                  disabled={!permission?.granted || !cameraReady || stage !== 'ready'}
                  onPress={() => {
                    if (Platform.OS !== 'web') {
                      void Haptics.selectionAsync();
                    }
                    handleSwitchLens(facing === 'back' ? 'front' : 'back');
                  }}
                  style={[
                    styles.dockIconBtn,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}>
                  <SymbolView
                    name={{
                      ios: 'arrow.triangle.2.circlepath.camera',
                      android: 'flip_camera_ios',
                      web: 'flip_camera_ios',
                    }}
                    tintColor={colors.ink}
                    size={22}
                    fallback={
                      <Text style={[styles.iconFallbackText, { color: colors.ink }]}>
                        ↻
                      </Text>
                    }
                  />
                </Pressable>
              </View>
            </View>
          </View>
        ) : (
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.content,
              { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 132 },
            ]}>
            <PageHeader
              title="Review Moment"
              subtitle="Check both sides before publishing."
              onBack={handleClose}
              backLabel={submitting ? 'Publishing…' : 'Back'}
              backDisabled={submitting}
            />
            {bundleQuery.isError ? (
              <View style={{ gap: 8 }}>
                <InlineNotice
                  message="Today's capture allowance could not load. Retry before publishing."
                  tone="error"
                />
                <KeepItButton
                  label="Retry daily allowance"
                  variant="secondary"
                  onPress={() => void bundleQuery.refetch()}
                />
              </View>
            ) : null}
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
              {selectedMusic || taggedUsers.length > 0 ? (
                <View style={styles.wrapRow}>
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
                    {selectedOverlayId ? (
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
                    borderColor: colors.border,
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
                <Text style={[styles.musicSub, { color: colors.inkMuted }]}>Snap Once gives each viewer 15 seconds after opening. It does not prevent screenshots or recordings.</Text>
              </View>

              <View
                style={[
                  styles.snapOnceCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.card,
                  },
                ]}>
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
              {saveFeedback ? <InlineNotice message={saveFeedback} tone="success" /> : null}

              {bundleQuery.isPending ? <InlineNotice tone="info" message="Checking today’s capture allowance…" /> : null}

              {/* Post / Save Preview / Retake Buttons */}
              <View style={styles.previewActions}>
                <KeepItButton
                  label={snapOnce ? 'Post Snap Once (15s)' : 'Post Moment'}
                  loading={submitting}
                  loadingLabel="Publishing Moment…"
                  disabled={!user || !couple || submitting || bundleQuery.isPending || bundleQuery.isError}
                  onPress={() => void handlePostMoment()}
                />
                <KeepItButton
                  label="Save Photo (Preview)"
                  variant="secondary"
                  disabled={submitting || !backUri || !frontUri}
                  onPress={() => {
                    setSaveFeedback(null);
                    setSavePreviewOpen(true);
                  }}
                />
                <KeepItButton
                  label="Retake"
                  variant="secondary"
                  disabled={submitting}
                  onPress={() => {
                    const retake = () => {
                      setBackUri(null);
                      setFrontUri(null);
                      setVlogPipUri(null);
                      setVideoUri(null);
                      setVideoDurationSec(null);
                      setCapturedAtIso(null);
                      setSaveFeedback(null);
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

              <Modal
                visible={savePreviewOpen}
                animationType={motionEnabled ? 'slide' : 'none'}
                transparent
                onRequestClose={() => { if (!savingDraftPhoto) setSavePreviewOpen(false); }}>
                <View style={styles.saveModalBackdrop}>
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.saveModalContent}
                    style={[
                      styles.saveModalSheet,
                      {
                        backgroundColor: colors.sheetSurface,
                        borderColor: colors.border,
                        borderRadius: radii.group,
                      },
                    ]}>
                    <View style={styles.captureTopBar}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.drawerTitle, { color: colors.ink }]}>
                          Save Moment Preview
                        </Text>
                        <Text style={[styles.musicSub, { color: colors.inkMuted }]}>
                          Tap the corner photo to swap lenses before saving
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close Save preview"
                        disabled={savingDraftPhoto}
                        onPress={() => setSavePreviewOpen(false)}
                        style={[
                          styles.smallChoicePill,
                          {
                            backgroundColor: colors.surfaceElevated,
                            borderColor: colors.controlBorder,
                            borderWidth: 1,
                            borderRadius: radii.input,
                          },
                        ]}>
                        <Text style={{ color: colors.ink, fontWeight: '600', fontSize: 15 }}>
                          Close
                        </Text>
                      </Pressable>
                    </View>

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
                          style={styles.full}
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
                        <View style={styles.previewPipAnchor}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Swap front and back lens for saved photo"
                            onPress={() => setPipSwapped((prev) => !prev)}
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
                        </View>
                      ) : null}
                      <View pointerEvents="none" style={styles.keepItPhotoWatermark}>
                        <KeepItWatermarkLogo width={76} color="#FFFFFF" />
                        <Text style={styles.keepItWatermarkTime}>{watermarkTimestamp}</Text>
                      </View>
                    </View>

                    <KeepItButton
                      label="Confirm & Save Photo"
                      loading={savingDraftPhoto}
                      loadingLabel="Saving Photo…"
                      onPress={() => {
                        if (!backUri || !frontUri || savingDraftPhoto) return;
                        setSavingDraftPhoto(true);
                        const author = user?.display_name ?? 'KeepIt';
                        const safeAuthor = author.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'keepit';
                        void exportAndShareCompositeMoment({
                          backUri: pipSwapped ? frontUri : backUri,
                          frontUri: pipSwapped ? backUri : frontUri,
                          authorName: author,
                          postedAtIso: capturedAtIso ?? new Date().toISOString(),
                          timestampLabel: watermarkTimestamp,
                          caption,
                          locationLabel,
                          musicTitle: selectedMusic
                            ? `${selectedMusic.title} · ${selectedMusic.artist}`
                            : null,
                          taggedUsers,
                          filterPreset,
                          overlays,
                          aspect: '3:4',
                          baseFilename: `keepit-${safeAuthor}-moment`,
                          title: `${author}’s KeepIt Moment`,
                        })
                          .then((msg) => {
                            setSaveFeedback(msg);
                            setSavePreviewOpen(false);
                          })
                          .catch((err) => {
                            setError(err instanceof Error ? err.message : 'Could not save photo.');
                          })
                          .finally(() => {
                            setSavingDraftPhoto(false);
                          });
                      }}
                    />
                  </ScrollView>
                </View>
              </Modal>
          </ScrollView>
        )}
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
  captureViewport: {
    flex: 1,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    justifyContent: 'space-between',
    gap: 10,
  },
  captureTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  iconCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockIconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconFallbackText: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '600',
  },
  capturePillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  timerPill: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
    flexShrink: 1,
  },
  timerText: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  compactNoticeWrap: {
    gap: 6,
  },
  viewfinderStage: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureViewfinderFrame: {
    height: '100%',
    maxHeight: '100%',
    maxWidth: '100%',
    aspectRatio: 4 / 5,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  viewfinderFrame: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    aspectRatio: 4 / 5,
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
    alignItems: 'flex-start',
    gap: 3,
  },
  keepItWatermarkTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  keepItWatermarkTime: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  floatingFilterTray: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    zIndex: 10,
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
    paddingVertical: 8,
  },
  filterSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  filterChipText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  bottomCameraControls: {
    gap: 8,
  },
  cameraModeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  cameraModeOption: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  cameraModeText: {
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.2,
  },
  cameraModeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  shutterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 2,
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
    width: 84,
    height: 105,
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
    backgroundColor: '#000000',
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
  },
  saveModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'center',
    padding: 18,
  },
  saveModalSheet: {
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
    maxHeight: '92%',
    borderWidth: 1,
  },
  saveModalContent: {
    padding: 20,
    gap: 16,
  }
});
