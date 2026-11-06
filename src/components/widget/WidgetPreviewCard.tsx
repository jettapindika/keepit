import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { RevealOnAppear } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { MOCHY_SPRINGS } from '@/theme/motion';
import { useKeepItTheme } from '@/theme/tokens';
import { WidgetSnapshotPayload } from '@/types/database';

export type WidgetSizePreset = 'small' | 'medium';

export interface WidgetPreviewCardProps {
  snapshot: WidgetSnapshotPayload | null;
  lastSyncedAt?: string | null;
  onPressOpenApp?: () => void;
  onPressCaptureLocked?: () => void;
  onPressSyncNow?: () => void | Promise<void>;
  initialSize?: WidgetSizePreset;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function formatRelativeWidgetTime(isoString: string | null | undefined, nowMs = Date.now()): string {
  if (!isoString) {
    return 'Waiting';
  }
  const parsed = new Date(isoString).getTime();
  if (!Number.isFinite(parsed)) {
    return 'Just now';
  }
  const diffSec = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (diffSec < 60) {
    return 'Just now';
  }
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getActiveWidgetStatus(
  snapshot: WidgetSnapshotPayload | null,
  nowMs: number
): { emoji: string | null; text: string } | null {
  if (!snapshot || !snapshot.statusText) {
    return null;
  }
  if (snapshot.statusExpiresAt) {
    const expiresMs = new Date(snapshot.statusExpiresAt).getTime();
    if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
      return null;
    }
  }
  return {
    emoji: snapshot.statusEmoji,
    text: snapshot.statusText,
  };
}

export function WidgetPreviewCard({
  snapshot,
  lastSyncedAt,
  onPressOpenApp,
  onPressCaptureLocked,
  onPressSyncNow,
  initialSize = 'medium',
}: WidgetPreviewCardProps) {
  const { colors, radii, spacing, type } = useKeepItTheme();
  const motionEnabled = useSessionStore((s) => s.motionEnabled);
  const motionSpeed = useSessionStore((s) => s.motionSpeed);

  const [sizePreset, setSizePreset] = useState<WidgetSizePreset>(initialSize);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [syncing, setSyncing] = useState(false);

  const widgetPopScale = useSharedValue(1);
  const tapPressScale = useSharedValue(1);

  // Refresh live relative time ("Just now" -> "12m ago") every 30s
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const handleSelectSize = (nextSize: WidgetSizePreset) => {
    if (nextSize === sizePreset) {
      return;
    }
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
    setSizePreset(nextSize);
    if (motionEnabled) {
      widgetPopScale.set(0.93);
      widgetPopScale.set(withSpring(1, MOCHY_SPRINGS.popIn(motionSpeed)));
    } else {
      widgetPopScale.set(1);
    }
  };

  const handleWidgetTap = () => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (snapshot?.momentLocked && onPressCaptureLocked) {
      onPressCaptureLocked();
      return;
    }
    onPressOpenApp?.();
  };

  const handleManualSync = async () => {
    if (!onPressSyncNow || syncing) return;
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
    setSyncing(true);
    try {
      await onPressSyncNow();
      setNowMs(Date.now());
      if (motionEnabled) {
        widgetPopScale.set(0.96);
        widgetPopScale.set(withSpring(1, MOCHY_SPRINGS.popIn(motionSpeed)));
      }
    } finally {
      setSyncing(false);
    }
  };

  const widgetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: widgetPopScale.get() * tapPressScale.get() }],
  }));

  const partnerName = snapshot?.partnerName ?? 'Your partner';
  const isLocked = Boolean(snapshot?.momentLocked);
  const photoUri = !isLocked ? (snapshot?.momentPhotoUri ?? null) : null;
  const frontPipUri = !isLocked ? (snapshot?.momentFrontPhotoUri ?? null) : null;
  const activeStatus = getActiveWidgetStatus(snapshot, nowMs);

  const referenceTimeIso = snapshot?.momentPostedAt ?? snapshot?.updatedAt ?? lastSyncedAt ?? null;
  const timeAgo = formatRelativeWidgetTime(referenceTimeIso, nowMs);
  const syncedLabel = lastSyncedAt
    ? `Synced ${formatRelativeWidgetTime(lastSyncedAt, nowMs)}`
    : 'Live preview';

  const interactiveTargetAvailable = Boolean(
    (isLocked && onPressCaptureLocked) || onPressOpenApp
  );

  return (
    <RevealOnAppear revealKey="home-widget-preview-card">
      <View
        style={[
          styles.outerGroup,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.group,
            padding: spacing.lg,
            gap: spacing.md,
          },
        ]}>
        {/* Header + Size Switcher */}
        <View style={styles.headerRow}>
          <View style={styles.headerTitles}>
            <Text
              style={[
                styles.sectionTitle,
                {
                  color: colors.ink,
                  letterSpacing: type.titleTracking,
                },
              ]}>
              Home Screen Widget
            </Text>
            <Text
              style={[
                styles.sectionSub,
                {
                  color: colors.inkMuted,
                  letterSpacing: type.bodyTracking,
                },
              ]}>
              {syncedLabel} · {partnerName}
            </Text>
          </View>

          <View
            accessibilityRole="tablist"
            accessibilityLabel="Widget size selector"
            style={[
              styles.sizeToggleTrack,
              {
                backgroundColor: colors.canvas,
                borderColor: colors.border,
                borderRadius: radii.pill,
              },
            ]}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: sizePreset === 'small' }}
              accessibilityLabel="Small 2x2 widget preview"
              onPress={() => handleSelectSize('small')}
              style={[
                styles.sizeTogglePill,
                {
                  backgroundColor:
                    sizePreset === 'small' ? colors.surfaceElevated : 'transparent',
                  borderRadius: radii.pill,
                },
              ]}>
              <Text
                style={[
                  styles.sizeToggleText,
                  {
                    color: sizePreset === 'small' ? colors.ink : colors.inkMuted,
                    fontWeight: sizePreset === 'small' ? '700' : '600',
                  },
                ]}>
                Small 2x2
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: sizePreset === 'medium' }}
              accessibilityLabel="Medium 4x2 widget preview"
              onPress={() => handleSelectSize('medium')}
              style={[
                styles.sizeTogglePill,
                {
                  backgroundColor:
                    sizePreset === 'medium' ? colors.surfaceElevated : 'transparent',
                  borderRadius: radii.pill,
                },
              ]}>
              <Text
                style={[
                  styles.sizeToggleText,
                  {
                    color: sizePreset === 'medium' ? colors.ink : colors.inkMuted,
                    fontWeight: sizePreset === 'medium' ? '700' : '600',
                  },
                ]}>
                Medium 4x2
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Home Screen Stage */}
        <View
          style={[
            styles.stageWell,
            {
              backgroundColor: colors.sheetSurface,
              borderColor: colors.border,
              borderRadius: radii.photo,
              padding: spacing.lg,
            },
          ]}>
          <AnimatedPressable
            disabled={!interactiveTargetAvailable}
            accessibilityRole="button"
            accessibilityLabel={
              isLocked
                ? `${partnerName}'s widget Moment is locked. Tap to open camera and post yours`
                : `${partnerName}'s Home Screen widget preview. Tap to open KeepIt`
            }
            onPressIn={() => {
              if (!motionEnabled || !interactiveTargetAvailable) return;
              tapPressScale.set(withSpring(0.975, MOCHY_SPRINGS.pressIn(motionSpeed)));
            }}
            onPressOut={() => {
              if (!motionEnabled || !interactiveTargetAvailable) return;
              tapPressScale.set(withSpring(1, MOCHY_SPRINGS.pressRelease(motionSpeed)));
            }}
            onPress={handleWidgetTap}
            style={[
              sizePreset === 'small' ? styles.smallWidgetShell : styles.mediumWidgetShell,
              {
                backgroundColor: colors.canvas,
                borderColor: colors.border,
                borderRadius: radii.photo,
              },
              widgetAnimatedStyle,
            ]}>
            {!snapshot ? (
              <View style={styles.emptyShell}>
                <Text
                  style={[
                    styles.emptyTitle,
                    { color: colors.ink, letterSpacing: type.titleTracking },
                  ]}>
                  Pair to activate widget
                </Text>
                <Text
                  style={[
                    styles.emptyBody,
                    { color: colors.inkMuted, letterSpacing: type.bodyTracking },
                  ]}
                  numberOfLines={sizePreset === 'small' ? 3 : 2}>
                  Once paired, your partner’s daily Moment and live status appear right here.
                </Text>
              </View>
            ) : sizePreset === 'small' ? (
              /* Small 2x2 Widget Surface */
              <View style={styles.smallInner}>
                {photoUri ? (
                  <>
                    <Image
                      source={{ uri: photoUri }}
                      contentFit="cover"
                      style={StyleSheet.absoluteFill}
                    />
                    <View style={styles.photoScrim} />
                  </>
                ) : (
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      { backgroundColor: colors.surfaceElevated },
                    ]}
                  />
                )}

                {/* Top row: partner name + relative time */}
                <View style={styles.smallTopBar}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.smallPartnerName,
                      {
                        color: photoUri ? '#FFFFFF' : colors.ink,
                        letterSpacing: type.bodyTracking,
                      },
                    ]}>
                    {partnerName}
                  </Text>
                  <Text
                    style={[
                      styles.timeAgoBadgeText,
                      { color: photoUri ? 'rgba(255,255,255,0.78)' : colors.inkMuted },
                    ]}>
                    {timeAgo}
                  </Text>
                </View>

                {/* Center locked motif when Moment is locked */}
                {isLocked ? (
                  <View style={styles.smallLockedCenter}>
                    <View
                      style={[
                        styles.lockedSilhouetteMini,
                        {
                          backgroundColor: colors.accentSoft,
                          borderColor: colors.accent,
                        },
                      ]}
                    />
                  </View>
                ) : null}

                {/* Bottom row: locked callout, status pill, or caption */}
                <View style={styles.smallBottomBar}>
                  {isLocked ? (
                    <View>
                      <Text
                        style={[
                          styles.lockedHeadlineSmall,
                          { color: colors.ink, letterSpacing: type.bodyTracking },
                        ]}>
                        Moment locked
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[styles.lockedSubSmall, { color: colors.inkMuted }]}>
                        Tap to capture yours
                      </Text>
                    </View>
                  ) : activeStatus ? (
                    <View
                      style={[
                        styles.widgetStatusChip,
                        {
                          backgroundColor: photoUri ? 'rgba(20, 20, 22, 0.88)' : colors.surface,
                          borderColor: photoUri ? 'rgba(255, 255, 255, 0.12)' : colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.widgetStatusText,
                          { color: photoUri ? '#FFFFFF' : colors.ink },
                        ]}>
                        {activeStatus.emoji ? `${activeStatus.emoji} ` : ''}
                        {activeStatus.text}
                      </Text>
                    </View>
                  ) : snapshot.momentCaption ? (
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.smallCaption,
                        { color: photoUri ? '#FFFFFF' : colors.ink },
                      ]}>
                      {snapshot.momentCaption}
                    </Text>
                  ) : (
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.lockedSubSmall,
                        { color: photoUri ? 'rgba(255,255,255,0.78)' : colors.inkMuted },
                      ]}>
                      {photoUri ? 'Tap to view Moment' : 'No Moment posted yet'}
                    </Text>
                  )}
                </View>
              </View>
            ) : (
              /* Medium 4x2 Widget Surface */
              <View style={styles.mediumInner}>
                {/* Left Moment Photo Squircle */}
                <View
                  style={[
                    styles.mediumPhotoTile,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}>
                  {isLocked ? (
                    <View style={styles.lockedTileContent}>
                      <View
                        style={[
                          styles.lockedSilhouetteMini,
                          {
                            backgroundColor: colors.accentSoft,
                            borderColor: colors.accent,
                          },
                        ]}
                      />
                      <Text style={[styles.lockedTileLabel, { color: colors.ink }]}>Locked</Text>
                    </View>
                  ) : photoUri ? (
                    <>
                      <Image
                        source={{ uri: photoUri }}
                        contentFit="cover"
                        style={StyleSheet.absoluteFill}
                      />
                      {frontPipUri ? (
                        <View
                          style={[
                            styles.miniPipFrame,
                            {
                              backgroundColor: colors.surfaceElevated,
                              borderColor: colors.canvas,
                            },
                          ]}>
                          <Image
                            source={{ uri: frontPipUri }}
                            contentFit="cover"
                            style={StyleSheet.absoluteFill}
                          />
                        </View>
                      ) : null}
                    </>
                  ) : (
                    <View style={styles.lockedTileContent}>
                      <View
                        style={[
                          styles.emptyFrameOutline,
                          { borderColor: colors.border },
                        ]}
                      />
                      <Text style={[styles.emptyTileLabel, { color: colors.inkMuted }]}>
                        Waiting
                      </Text>
                    </View>
                  )}
                </View>

                {/* Right Status & Moment Details */}
                <View style={styles.mediumRightCol}>
                  <View style={styles.mediumTopRow}>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.mediumPartnerName,
                        {
                          color: colors.ink,
                          letterSpacing: type.titleTracking,
                        },
                      ]}>
                      {partnerName}
                    </Text>

                    {snapshot.streakCount > 0 ? (
                      <View
                        style={[
                          styles.streakMiniPill,
                          {
                            backgroundColor: colors.accentSoft,
                            borderRadius: radii.pill,
                          },
                        ]}>
                        <Text style={[styles.streakMiniText, { color: colors.accent }]}>
                          {snapshot.streakCount}d
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {activeStatus ? (
                    <View
                      style={[
                        styles.widgetStatusChip,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                          borderRadius: radii.pill,
                          alignSelf: 'flex-start',
                        },
                      ]}>
                      <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
                      <Text
                        numberOfLines={1}
                        style={[styles.widgetStatusText, { color: colors.ink }]}>
                        {activeStatus.emoji ? `${activeStatus.emoji} ` : ''}
                        {activeStatus.text}
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.noStatusText, { color: colors.inkMuted }]}>
                      No active status
                    </Text>
                  )}

                  <View style={styles.mediumSpacer} />

                  <Text
                    numberOfLines={2}
                    style={[
                      styles.mediumCaptionLine,
                      {
                        color: isLocked
                          ? colors.inkMuted
                          : snapshot.momentCaption
                            ? colors.ink
                            : colors.inkMuted,
                        letterSpacing: type.bodyTracking,
                      },
                    ]}>
                    {isLocked
                      ? `Post your Moment to unlock ${partnerName}’s photo.`
                      : snapshot.momentCaption
                        ? snapshot.momentCaption
                        : photoUri
                          ? 'Captured today’s Moment.'
                          : 'Waiting for today’s daily window.'}
                  </Text>

                  <View style={styles.mediumFooterRow}>
                    <Text style={[styles.timeAgoBadgeText, { color: colors.inkMuted }]}>
                      {timeAgo}
                    </Text>
                    <Text style={[styles.dotSeparator, { color: colors.inkMuted }]}>·</Text>
                    <Text style={[styles.tapActionHint, { color: colors.accent }]}>
                      {isLocked ? 'Tap to capture' : 'Tap to open'}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </AnimatedPressable>
        </View>

        {/* Bottom Instruction & Optional Sync Trigger */}
        <View style={styles.footerRow}>
          <Text
            style={[
              styles.footerHint,
              { color: colors.inkMuted, letterSpacing: type.bodyTracking },
            ]}>
            Long-press your iOS or Android Home Screen to pin KeepIt in 2x2 or 4x2.
          </Text>

          {onPressSyncNow ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh widget snapshot now"
              disabled={syncing}
              onPress={() => {
                void handleManualSync();
              }}
              style={[
                styles.syncChip,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                  borderRadius: radii.pill,
                  opacity: syncing ? 0.6 : 1,
                },
              ]}>
              <Text style={[styles.syncChipText, { color: colors.ink }]}>
                {syncing ? 'Syncing' : 'Sync'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </RevealOnAppear>
  );
}

const styles = StyleSheet.create({
  outerGroup: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  headerTitles: {
    flexShrink: 1,
    gap: 2,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  sectionSub: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  sizeToggleTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderWidth: 1,
  },
  sizeTogglePill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  sizeToggleText: {
    fontSize: 12,
    letterSpacing: -0.25,
  },
  stageWell: {
    borderWidth: 1,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallWidgetShell: {
    width: 164,
    height: 164,
    borderWidth: 1,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  mediumWidgetShell: {
    width: '100%',
    minHeight: 154,
    borderWidth: 1,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  emptyShell: {
    flex: 1,
    padding: 14,
    justifyContent: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  emptyBody: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  smallInner: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  photoScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
  },
  smallTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  smallPartnerName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  smallLockedCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedSilhouetteMini: {
    width: 30,
    height: 38,
    borderRadius: 9,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  smallBottomBar: {
    gap: 4,
  },
  lockedHeadlineSmall: {
    fontSize: 13,
    fontWeight: '700',
  },
  lockedSubSmall: {
    fontSize: 11,
    fontWeight: '600',
  },
  smallCaption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  widgetStatusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    maxWidth: '100%',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  widgetStatusText: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
  },
  mediumInner: {
    flex: 1,
    flexDirection: 'row',
    padding: 12,
    gap: 12,
  },
  mediumPhotoTile: {
    width: 108,
    minHeight: 128,
    borderWidth: 1,
    borderCurve: 'continuous',
    overflow: 'hidden',
    position: 'relative',
  },
  miniPipFrame: {
    position: 'absolute',
    top: 7,
    left: 7,
    width: 30,
    height: 40,
    borderRadius: 8,
    borderWidth: 1.5,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  lockedTileContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 8,
  },
  lockedTileLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyFrameOutline: {
    width: 26,
    height: 34,
    borderRadius: 8,
    borderWidth: 1.5,
    borderCurve: 'continuous',
  },
  emptyTileLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  mediumRightCol: {
    flex: 1,
    gap: 6,
  },
  mediumTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  mediumPartnerName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
  },
  streakMiniPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  streakMiniText: {
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  noStatusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  mediumSpacer: {
    flex: 1,
    minHeight: 2,
  },
  mediumCaptionLine: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  mediumFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  timeAgoBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  dotSeparator: {
    fontSize: 11,
    fontWeight: '700',
  },
  tapActionHint: {
    fontSize: 11,
    fontWeight: '700',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  footerHint: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  syncChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
  syncChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
