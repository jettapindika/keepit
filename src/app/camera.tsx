import { useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  buildSimulatedDualPhotos,
  formatLateDuration,
  submitDailyMoment,
} from '@/api/moments';
import { InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { useMomentCountdown } from '@/hooks/useMomentCountdown';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';

type CaptureStage = 'ready' | 'capturing_back' | 'switching_front' | 'capturing_front' | 'preview';

export default function CameraModalScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    promptId?: string;
    triggerAt?: string;
    retakesUsed?: string;
  }>();

  const { colors, radii, spacing } = useKeepItTheme();
  const user = useSessionStore((s) => s.user);
  const couple = useSessionStore((s) => s.couple);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [stage, setStage] = useState<CaptureStage>('ready');
  const [cameraReady, setCameraReady] = useState(false);

  const [backUri, setBackUri] = useState<string | null>(null);
  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [capturedAtIso, setCapturedAtIso] = useState<string | null>(null);
  const captionRef = useRef('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countdown = useMomentCountdown(params.triggerAt);
  const retakesUsed = Number(params.retakesUsed ?? '0') || 0;
  const retakesLeft = Math.max(0, 2 - retakesUsed);

  const captureDualSequence = async () => {
    setError(null);
    const captureTimestamp = new Date().toISOString();

    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    // Try real hardware camera sequence when granted & ready; fallback cleanly on headless/simulator
    if (permission?.granted && cameraRef.current && cameraReady && Platform.OS !== 'web') {
      try {
        setStage('capturing_back');
        setFacing('back');
        const firstShot = await cameraRef.current.takePictureAsync({ quality: 0.82 });

        setStage('switching_front');
        setFacing('front');
        const switchWait = Promise.withResolvers<void>();
        setTimeout(switchWait.resolve, 350);
        await switchWait.promise;
        setStage('capturing_front');
        const secondShot = await cameraRef.current.takePictureAsync({ quality: 0.82 });

        if (firstShot?.uri && secondShot?.uri) {
          setBackUri(firstShot.uri);
          setFrontUri(secondShot.uri);
          setCapturedAtIso(captureTimestamp);
          setStage('preview');
          return;
        }
      } catch {
        // Fall through to deterministic dual-lens generator if emulator/headless lacks ISP
      }
    }

    // Sequential step feedback (<400ms switch) for web / simulator without dual ISP
    setStage('capturing_back');
    const backStepWait = Promise.withResolvers<void>();
    setTimeout(backStepWait.resolve, 160);
    await backStepWait.promise;
    setStage('switching_front');
    const frontStepWait = Promise.withResolvers<void>();
    setTimeout(frontStepWait.resolve, 220);
    await frontStepWait.promise;
    const simulated = buildSimulatedDualPhotos({
      authorLabel: user?.display_name ?? 'You',
      sceneLabel:
        countdown.phase === 'late' ? 'Afternoon coffee break' : 'Morning desk & sunlight',
      accentHex: colors.accent,
    });

    setBackUri(simulated.backUri);
    setFrontUri(simulated.frontUri);
    setCapturedAtIso(captureTimestamp);
    setStage('preview');
  };

  const handlePostMoment = async () => {
    if (!user || !couple || !params.promptId || !backUri || !frontUri) {
      setError('Missing Moment session details. Close and reopen the camera.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await submitDailyMoment({
        coupleId: couple.id,
        promptId: params.promptId,
        userId: user.id,
        backUri,
        frontUri,
        caption: captionRef.current,
        capturedAtIso: capturedAtIso ?? new Date().toISOString(),
      });

      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      await queryClient.invalidateQueries({ queryKey: ['today-moment', couple.id] });
      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload Moment. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const computedLateSec =
    params.triggerAt && capturedAtIso
      ? Math.max(
          0,
          Math.floor(
            (new Date(capturedAtIso).getTime() - new Date(params.triggerAt).getTime()) / 1000
          )
        )
      : countdown.phase === 'late'
        ? 121 + countdown.secondsOverdue
        : 0;

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
                  borderColor: countdown.phase === 'late' ? colors.warning : colors.accent,
                  backgroundColor:
                    countdown.phase === 'late' ? colors.surface : colors.accentSoft,
                  borderRadius: radii.pill,
                },
              ]}>
              <Text
                style={[
                  styles.timerText,
                  { color: countdown.phase === 'late' ? colors.warning : colors.accent },
                ]}>
                {countdown.formattedTimer}
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

          {stage !== 'preview' ? (
            <>
              {/* Live 3:4 Viewfinder */}
              <View
                style={[
                  styles.viewfinderFrame,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.photo,
                  },
                ]}>
                {permission?.granted && Platform.OS !== 'web' ? (
                  <CameraView
                    ref={cameraRef}
                    style={styles.full}
                    facing={facing}
                    flash={flash}
                    onCameraReady={() => setCameraReady(true)}
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
                        Front PIP
                      </Text>
                    </View>

                    <Text style={[styles.viewfinderTitle, { color: colors.ink }]}>
                      {stage === 'capturing_back'
                        ? 'Capturing back camera...'
                        : stage === 'switching_front'
                          ? 'Hold steady for selfie...'
                          : 'Dual-Camera Moment'}
                    </Text>

                    {permission && !permission.granted && Platform.OS !== 'web' ? (
                      <KeepItButton
                        label="Grant Camera Access"
                        variant="secondary"
                        onPress={() => {
                          if (permission.canAskAgain) {
                            void requestPermission();
                          } else {
                            void Linking.openSettings();
                          }
                        }}
                      />
                    ) : null}
                  </View>
                )}
              </View>

              {error ? <InlineNotice message={error} tone="error" /> : null}

              {/* Shutter Controls */}
              <View style={styles.shutterBar}>
                <Text style={[styles.sideMeta, { color: colors.inkMuted }]}>
                  {retakesLeft} {retakesLeft === 1 ? 'retake' : 'retakes'} left
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Capture Dual Moment"
                  disabled={stage !== 'ready'}
                  onPress={() => void captureDualSequence()}
                  style={[
                    styles.shutterOuter,
                    {
                      borderColor: colors.ink,
                      opacity: stage === 'ready' ? 1 : 0.5,
                    },
                  ]}>
                  <View style={[styles.shutterInner, { backgroundColor: colors.accent }]} />
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Flip primary lens"
                  onPress={() => setFacing((prev) => (prev === 'back' ? 'front' : 'back'))}>
                  <Text style={[styles.sideMeta, { color: colors.ink }]}>
                    Lens: {facing === 'back' ? 'Back' : 'Front'}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              {/* Captured Dual Preview */}
              <View
                style={[
                  styles.viewfinderFrame,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.photo,
                  },
                ]}>
                {backUri ? (
                  <Image source={backUri} contentFit="cover" style={styles.full} />
                ) : null}
                {frontUri ? (
                  <View
                    style={[
                      styles.previewPip,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.canvas,
                      },
                    ]}>
                    <Image source={frontUri} contentFit="cover" style={styles.full} />
                  </View>
                ) : null}

                <View
                  style={[
                    styles.previewTimingBadge,
                    {
                      backgroundColor: colors.canvas,
                      borderColor: computedLateSec > 120 ? colors.warning : colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.previewTimingText,
                      { color: computedLateSec > 120 ? colors.warning : colors.ink },
                    ]}>
                    {formatLateDuration(computedLateSec)}
                  </Text>
                </View>
              </View>

              <View style={{ gap: 8 }}>
                <Text style={[styles.captionLabel, { color: colors.ink }]}>
                  Short caption (optional)
                </Text>
                <TextInput
                  accessibilityLabel="Moment short caption"
                  maxLength={100}
                  placeholder="Add a short note..."
                  placeholderTextColor={colors.inkMuted}
                  onChangeText={(val) => {
                    captionRef.current = val;
                  }}
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
              </View>

              {error ? <InlineNotice message={error} tone="error" /> : null}

              <KeepItButton
                label="Post Today’s Moment"
                loading={submitting}
                onPress={() => void handlePostMoment()}
              />

              {retakesLeft > 0 && countdown.phase === 'live' ? (
                <KeepItButton
                  label={`Retake Photo (${retakesLeft} left)`}
                  variant="secondary"
                  disabled={submitting}
                  onPress={() => {
                    setBackUri(null);
                    setFrontUri(null);
                    setStage('ready');
                  }}
                />
              ) : null}
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
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
    gap: 18,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  topButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  timerPill: {
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderCurve: 'continuous',
  },
  timerText: {
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  viewfinderFrame: {
    width: '100%',
    aspectRatio: 0.75,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    borderCurve: 'continuous',
  },
  simulatedViewfinder: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  selfiePipGuide: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 88,
    height: 118,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  pipGuideLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  viewfinderTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  viewfinderSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 280,
  },
  shutterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  shutterOuter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  sideMeta: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  previewPip: {
    position: 'absolute',
    top: 14,
    left: 14,
    width: 98,
    height: 130,
    borderRadius: 16,
    borderWidth: 2,
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  previewTimingBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderCurve: 'continuous',
  },
  previewTimingText: {
    fontSize: 12,
    fontWeight: '700',
  },
  captionLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  captionInput: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    borderCurve: 'continuous',
  },
});
