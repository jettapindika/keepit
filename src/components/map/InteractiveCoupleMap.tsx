import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  Platform,
  Pressable,
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

import { computeDistanceMeters, formatDistanceApart } from '@/api/locations';
import { useSessionStore } from '@/store/sessionStore';
import { MOCHY_SPRINGS, mochyTiming } from '@/theme/motion';
import { useKeepItTheme } from '@/theme/tokens';
import { LocationShareRecord } from '@/types/database';

export interface InteractiveCoupleMapProps {
  mine: LocationShareRecord | null;
  partner: LocationShareRecord | null;
  myName: string;
  partnerName: string;
}

const CANVAS_HEIGHT = 336;
const GRID_SPACING = 44;
const RING_RADII = [46, 94, 144] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ControlChip({
  label,
  active = false,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const { colors, radii, type } = useKeepItTheme();
  const motionEnabled = useSessionStore((s) => s.motionEnabled);
  const motionSpeed = useSessionStore((s) => s.motionSpeed);
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected: active }}
        onPressIn={() => {
          if (!motionEnabled) return;
          scale.set(withSpring(0.92, MOCHY_SPRINGS.pressIn(motionSpeed)));
        }}
        onPressOut={() => {
          if (!motionEnabled) {
            scale.set(1);
            return;
          }
          scale.set(withSpring(1, MOCHY_SPRINGS.pressRelease(motionSpeed)));
        }}
        onPress={() => {
          if (Platform.OS !== 'web') {
            void Haptics.selectionAsync();
          }
          onPress();
        }}
        style={[
          styles.controlChip,
          {
            backgroundColor: active ? colors.accent : colors.surfaceElevated,
            borderColor: active ? colors.accent : colors.border,
            borderRadius: radii.pill,
          },
        ]}>
        <Text
          style={[
            styles.controlChipText,
            {
              color: active ? colors.onAccent : colors.ink,
              letterSpacing: type.bodyTracking,
            },
          ]}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function InteractiveCoupleMap({
  mine,
  partner,
  myName,
  partnerName,
}: InteractiveCoupleMapProps) {
  const { colors, radii, spacing, isDark, type } = useKeepItTheme();
  const motionEnabled = useSessionStore((s) => s.motionEnabled);
  const motionSpeed = useSessionStore((s) => s.motionSpeed);

  const [canvasWidth, setCanvasWidth] = useState(340);
  const [zoom, setZoom] = useState<1 | 2>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const panOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const myScale = useSharedValue(0);
  const partnerScale = useSharedValue(0);
  const veilOpacity = useSharedValue(1);

  const myHasCoords =
    mine !== null && mine.mode !== 'ghost' && mine.lat !== null && mine.lng !== null;
  const partnerHasCoords =
    partner !== null &&
    partner.mode !== 'ghost' &&
    partner.lat !== null &&
    partner.lng !== null;
  const partnerInGhost = !partner || partner.mode === 'ghost';

  useEffect(() => {
    const targetMine = myHasCoords ? 1 : 0;
    if (!motionEnabled) {
      myScale.set(targetMine);
    } else {
      myScale.set(withSpring(targetMine, MOCHY_SPRINGS.popIn(motionSpeed)));
    }
  }, [myHasCoords, mine?.mode, mine?.lat, mine?.lng, motionEnabled, motionSpeed, myScale]);

  useEffect(() => {
    const targetPartner = partnerHasCoords ? 1 : 0;
    if (!motionEnabled) {
      partnerScale.set(targetPartner);
    } else {
      partnerScale.set(withSpring(targetPartner, MOCHY_SPRINGS.popIn(motionSpeed)));
    }
  }, [
    partnerHasCoords,
    partner?.mode,
    partner?.lat,
    partner?.lng,
    motionEnabled,
    motionSpeed,
    partnerScale,
  ]);

  useEffect(() => {
    const showVeil = partnerInGhost ? 1 : 0;
    veilOpacity.set(withTiming(showVeil, mochyTiming(260, undefined, motionEnabled, motionSpeed)));
  }, [partnerInGhost, motionEnabled, motionSpeed, veilOpacity]);

  const myPinAnimStyle = useAnimatedStyle(() => ({
    opacity: clamp(myScale.get(), 0, 1),
    transform: [{ scale: myScale.get() }],
  }));

  const partnerPinAnimStyle = useAnimatedStyle(() => ({
    opacity: clamp(partnerScale.get(), 0, 1),
    transform: [{ scale: partnerScale.get() }],
  }));

  const ghostVeilAnimStyle = useAnimatedStyle(() => ({
    opacity: veilOpacity.get(),
  }));

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
      onPanResponderGrant: () => {
        setPan((current) => {
          panOriginRef.current = current;
          return current;
        });
      },
      onPanResponderMove: (_, gesture) => {
        const nextX = clamp(panOriginRef.current.x + gesture.dx, -110, 110);
        const nextY = clamp(panOriginRef.current.y + gesture.dy, -88, 88);
        setPan({ x: nextX, y: nextY });
      },
    })
  ).current;

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.max(260, Math.round(event.nativeEvent.layout.width));
    if (nextWidth !== canvasWidth) {
      setCanvasWidth(nextWidth);
    }
  };

  // Compute metric projection anchored around the couple's shared midpoint
  const distanceMeters =
    myHasCoords && partnerHasCoords && mine?.lat != null && mine?.lng != null && partner?.lat != null && partner?.lng != null
      ? computeDistanceMeters(mine.lat, mine.lng, partner.lat, partner.lng)
      : null;

  let baseHalfSpanM = 1400;
  if (distanceMeters !== null) {
    baseHalfSpanM = clamp(distanceMeters * 0.85, 220, 60_000);
  } else if (myHasCoords && mine?.accuracy_m) {
    baseHalfSpanM = clamp(mine.accuracy_m * 14, 300, 2400);
  } else if (partnerHasCoords && partner?.accuracy_m) {
    baseHalfSpanM = clamp(partner.accuracy_m * 14, 300, 2400);
  }

  const effectiveHalfSpanM = baseHalfSpanM / zoom;
  const maxVisualRadiusPx = Math.min(canvasWidth, CANVAS_HEIGHT) * 0.34;
  const pxPerMeter = maxVisualRadiusPx / Math.max(1, effectiveHalfSpanM);

  const centerLat =
    myHasCoords && partnerHasCoords && mine?.lat != null && partner?.lat != null
      ? (mine.lat + partner.lat) / 2
      : myHasCoords && mine?.lat != null
        ? mine.lat
        : partnerHasCoords && partner?.lat != null
          ? partner.lat
          : 0;

  const centerLng =
    myHasCoords && partnerHasCoords && mine?.lng != null && partner?.lng != null
      ? (mine.lng + partner.lng) / 2
      : myHasCoords && mine?.lng != null
        ? mine.lng
        : partnerHasCoords && partner?.lng != null
          ? partner.lng
          : 0;

  const cosCenterLat = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180));

  const projectPoint = (lat: number, lng: number): { x: number; y: number } => {
    const eastMeters = (lng - centerLng) * 111_320 * cosCenterLat;
    const northMeters = (lat - centerLat) * 111_132;
    const rawX = canvasWidth / 2 + pan.x + eastMeters * pxPerMeter;
    const rawY = CANVAS_HEIGHT / 2 + pan.y - northMeters * pxPerMeter;
    return {
      x: clamp(rawX, 38, canvasWidth - 38),
      y: clamp(rawY, 54, CANVAS_HEIGHT - 56),
    };
  };

  let myScreenPos =
    myHasCoords && mine?.lat != null && mine?.lng != null
      ? projectPoint(mine.lat, mine.lng)
      : null;

  let partnerScreenPos =
    partnerHasCoords && partner?.lat != null && partner?.lng != null
      ? projectPoint(partner.lat, partner.lng)
      : null;

  // Keep overlapping pins visually distinct when partners are right next to each other (<50m)
  if (myScreenPos && partnerScreenPos) {
    const dx = partnerScreenPos.x - myScreenPos.x;
    const dy = partnerScreenPos.y - myScreenPos.y;
    const pixelGap = Math.hypot(dx, dy);
    if (pixelGap < 34) {
      const ux = pixelGap > 0.5 ? dx / pixelGap : 0.86;
      const uy = pixelGap > 0.5 ? dy / pixelGap : -0.5;
      const push = (34 - pixelGap) / 2;
      myScreenPos = {
        x: clamp(myScreenPos.x - ux * push, 38, canvasWidth - 38),
        y: clamp(myScreenPos.y - uy * push, 54, CANVAS_HEIGHT - 56),
      };
      partnerScreenPos = {
        x: clamp(partnerScreenPos.x + ux * push, 38, canvasWidth - 38),
        y: clamp(partnerScreenPos.y + uy * push, 54, CANVAS_HEIGHT - 56),
      };
    }
  }

  const gridLineColor = isDark ? 'rgba(255, 255, 255, 0.055)' : 'rgba(0, 0, 0, 0.055)';
  const radarRingColor = isDark ? 'rgba(255, 255, 255, 0.085)' : 'rgba(0, 0, 0, 0.08)';
  const vectorDashColor = isDark ? 'rgba(224, 224, 224, 0.72)' : 'rgba(20, 20, 22, 0.62)';

  const verticalCount = Math.ceil(canvasWidth / GRID_SPACING) + 4;
  const horizontalCount = Math.ceil(CANVAS_HEIGHT / GRID_SPACING) + 4;
  const modPanX = ((pan.x % GRID_SPACING) + GRID_SPACING) % GRID_SPACING;
  const modPanY = ((pan.y % GRID_SPACING) + GRID_SPACING) % GRID_SPACING;

  const myHaloDiameter =
    myHasCoords && mine?.accuracy_m
      ? clamp(mine.accuracy_m * pxPerMeter * 2, 46, 118)
      : 54;
  const partnerHaloDiameter =
    partnerHasCoords && partner?.accuracy_m
      ? clamp(partner.accuracy_m * pxPerMeter * 2, 46, 118)
      : 54;

  // Build dashed vector segments between pins when both coordinates exist
  const vectorDashes: { key: string; x: number; y: number; angleDeg: number }[] = [];
  if (myScreenPos && partnerScreenPos) {
    const dx = partnerScreenPos.x - myScreenPos.x;
    const dy = partnerScreenPos.y - myScreenPos.y;
    const totalLen = Math.hypot(dx, dy);
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const stepPx = 13;
    const count = Math.max(2, Math.floor(totalLen / stepPx));
    for (let i = 1; i < count; i += 1) {
      const t = i / count;
      vectorDashes.push({
        key: `dash_${i}`,
        x: myScreenPos.x + dx * t,
        y: myScreenPos.y + dy * t,
        angleDeg,
      });
    }
  }

  const midpoint =
    myScreenPos && partnerScreenPos
      ? {
          x: (myScreenPos.x + partnerScreenPos.x) / 2,
          y: (myScreenPos.y + partnerScreenPos.y) / 2,
        }
      : null;

  const scaleBarMeters = Math.round((72 / pxPerMeter) / 10) * 10;
  const scaleBarLabel =
    scaleBarMeters >= 1000
      ? `${(scaleBarMeters / 1000).toFixed(scaleBarMeters >= 10_000 ? 0 : 1)} km`
      : `${Math.max(25, scaleBarMeters)} m`;

  const partnerBadgeLabel =
    partner?.mode === 'live'
      ? `${partnerName} · Live`
      : partner?.mode === 'on_moment'
        ? `${partnerName} · Moment`
        : `${partnerName} · Ghost`;

  return (
    <View
      onLayout={handleLayout}
      {...panResponder.panHandlers}
      accessibilityLabel={`Interactive couple radar map for ${myName} and ${partnerName}`}
      style={[
        styles.canvas,
        {
          height: CANVAS_HEIGHT,
          backgroundColor: isDark ? colors.sheetSurface : colors.surface,
          borderColor: colors.border,
          borderRadius: radii.photo,
        },
      ]}>
      {/* Cartographic grid lines */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {Array.from({ length: verticalCount }).map((_, idx) => {
          const x = (idx - 2) * GRID_SPACING + modPanX;
          return (
            <View
              key={`v_${idx}`}
              style={[
                styles.gridVertical,
                { left: x, backgroundColor: gridLineColor },
              ]}
            />
          );
        })}
        {Array.from({ length: horizontalCount }).map((_, idx) => {
          const y = (idx - 2) * GRID_SPACING + modPanY;
          return (
            <View
              key={`h_${idx}`}
              style={[
                styles.gridHorizontal,
                { top: y, backgroundColor: gridLineColor },
              ]}
            />
          );
        })}
      </View>

      {/* Concentric radar rings */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {RING_RADII.map((r) => {
          const scaledRadius = r * (zoom === 2 ? 1.18 : 1);
          const diameter = scaledRadius * 2;
          return (
            <View
              key={`ring_${r}`}
              style={[
                styles.radarRing,
                {
                  width: diameter,
                  height: diameter,
                  borderRadius: scaledRadius,
                  borderColor: radarRingColor,
                  left: canvasWidth / 2 + pan.x - scaledRadius,
                  top: CANVAS_HEIGHT / 2 + pan.y - scaledRadius,
                },
              ]}
            />
          );
        })}

        {/* Subtle center crosshair */}
        <View
          style={[
            styles.crosshairH,
            {
              backgroundColor: radarRingColor,
              left: canvasWidth / 2 + pan.x - 9,
              top: CANVAS_HEIGHT / 2 + pan.y - 0.5,
            },
          ]}
        />
        <View
          style={[
            styles.crosshairV,
            {
              backgroundColor: radarRingColor,
              left: canvasWidth / 2 + pan.x - 0.5,
              top: CANVAS_HEIGHT / 2 + pan.y - 9,
            },
          ]}
        />
      </View>

      {/* Connecting dashed vector line + live distance pill */}
      {myScreenPos && partnerScreenPos && distanceMeters !== null ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {vectorDashes.map((dash) => (
            <View
              key={dash.key}
              style={[
                styles.vectorDash,
                {
                  backgroundColor: vectorDashColor,
                  left: dash.x - 3.5,
                  top: dash.y - 1,
                  transform: [{ rotate: `${dash.angleDeg}deg` }],
                },
              ]}
            />
          ))}
          {midpoint ? (
            <View
              style={[
                styles.distancePillWrap,
                {
                  left: clamp(midpoint.x - 68, 12, canvasWidth - 148),
                  top: clamp(midpoint.y - 15, 48, CANVAS_HEIGHT - 64),
                },
              ]}>
              <View
                style={[
                  styles.distancePill,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                    borderRadius: radii.pill,
                  },
                ]}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.distancePillText,
                    { color: colors.ink, letterSpacing: type.bodyTracking },
                  ]}>
                  {formatDistanceApart(distanceMeters)}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Partner Pin + Accuracy Halo */}
      {partnerScreenPos && partnerHasCoords ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pinAnchor,
            {
              left: partnerScreenPos.x,
              top: partnerScreenPos.y,
            },
            partnerPinAnimStyle,
          ]}>
          <View
            style={[
              styles.accuracyHalo,
              {
                width: partnerHaloDiameter,
                height: partnerHaloDiameter,
                borderRadius: partnerHaloDiameter / 2,
                backgroundColor:
                  partner?.mode === 'live'
                    ? isDark
                      ? 'rgba(52, 199, 89, 0.14)'
                      : 'rgba(36, 138, 61, 0.12)'
                    : isDark
                      ? 'rgba(224, 224, 224, 0.11)'
                      : 'rgba(20, 20, 22, 0.08)',
                borderColor:
                  partner?.mode === 'live'
                    ? isDark
                      ? 'rgba(52, 199, 89, 0.42)'
                      : 'rgba(36, 138, 61, 0.36)'
                    : colors.border,
              },
            ]}
          />
          <View
            style={[
              styles.pinBadge,
              {
                backgroundColor: colors.accent,
                borderColor: colors.canvas,
              },
            ]}>
            <Text style={[styles.pinInitial, { color: colors.onAccent }]}>
              {(partnerName.trim().slice(0, 1) || 'P').toUpperCase()}
            </Text>
            {partner?.mode === 'live' ? (
              <View
                style={[
                  styles.livePinDot,
                  {
                    backgroundColor: colors.success,
                    borderColor: colors.accent,
                  },
                ]}
              />
            ) : null}
          </View>
          <View
            style={[
              styles.pinCaptionPill,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                borderRadius: radii.pill,
              },
            ]}>
            <Text
              numberOfLines={1}
              style={[styles.pinCaptionText, { color: colors.ink }]}>
              {partnerBadgeLabel}
            </Text>
          </View>
        </Animated.View>
      ) : null}

      {/* Caller Pin + Accuracy Halo */}
      {myScreenPos && myHasCoords ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pinAnchor,
            {
              left: myScreenPos.x,
              top: myScreenPos.y,
            },
            myPinAnimStyle,
          ]}>
          <View
            style={[
              styles.accuracyHalo,
              {
                width: myHaloDiameter,
                height: myHaloDiameter,
                borderRadius: myHaloDiameter / 2,
                backgroundColor:
                  mine?.mode === 'live'
                    ? isDark
                      ? 'rgba(52, 199, 89, 0.12)'
                      : 'rgba(36, 138, 61, 0.10)'
                    : isDark
                      ? 'rgba(255, 255, 255, 0.08)'
                      : 'rgba(0, 0, 0, 0.06)',
                borderColor:
                  mine?.mode === 'live'
                    ? isDark
                      ? 'rgba(52, 199, 89, 0.36)'
                      : 'rgba(36, 138, 61, 0.32)'
                    : colors.border,
              },
            ]}
          />
          <View
            style={[
              styles.pinBadge,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.ink,
              },
            ]}>
            <Text style={[styles.pinInitial, { color: colors.ink }]}>
              {(myName.trim().slice(0, 1) || 'Y').toUpperCase()}
            </Text>
            {mine?.mode === 'live' ? (
              <View
                style={[
                  styles.livePinDot,
                  {
                    backgroundColor: colors.success,
                    borderColor: colors.surfaceElevated,
                  },
                ]}
              />
            ) : null}
          </View>
          <View
            style={[
              styles.pinCaptionPill,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                borderRadius: radii.pill,
              },
            ]}>
            <Text numberOfLines={1} style={[styles.pinCaptionText, { color: colors.ink }]}>
              {mine?.mode === 'live' ? 'You · Live' : 'You · Moment'}
            </Text>
          </View>
        </Animated.View>
      ) : null}

      {/* Ghost-mode veil when partner is in Ghost mode */}
      {partnerInGhost ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ghostVeilWrap,
            {
              paddingHorizontal: spacing.lg,
              top: myHasCoords ? 48 : CANVAS_HEIGHT / 2 - 48,
            },
            ghostVeilAnimStyle,
          ]}>
          <View
            style={[
              styles.ghostVeilCard,
              {
                backgroundColor: isDark
                  ? 'rgba(20, 20, 22, 0.90)'
                  : 'rgba(255, 255, 255, 0.92)',
                borderColor: colors.border,
                borderRadius: radii.card,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
              },
            ]}>
            <View style={styles.ghostVeilHeader}>
              <View
                style={[
                  styles.ghostDot,
                  { backgroundColor: colors.inkMuted },
                ]}
              />
              <Text
                style={[
                  styles.ghostVeilTitle,
                  { color: colors.ink, letterSpacing: type.bodyTracking },
                ]}>
                {partnerName} is in Ghost mode
              </Text>
            </View>
          </View>
        </Animated.View>
      ) : null}

      {/* Top-left scale indicator */}
      <View
        pointerEvents="none"
        style={[
          styles.topLeftScale,
          {
            top: spacing.md,
            left: spacing.md,
            backgroundColor: colors.surfaceElevated,
            borderColor: colors.border,
            borderRadius: radii.pill,
          },
        ]}>
        <View style={[styles.scaleRule, { borderColor: colors.inkMuted }]} />
        <Text style={[styles.scaleLabel, { color: colors.inkMuted }]}>{scaleBarLabel}</Text>
      </View>

      {/* Bottom-right tactile pan/zoom controls (1x, 2x, Center) */}
      <View
        style={[
          styles.controlsRow,
          {
            bottom: spacing.md,
            right: spacing.md,
          },
        ]}>
        <ControlChip
          label="1x"
          active={zoom === 1}
          accessibilityLabel="Set map zoom to 1x"
          onPress={() => setZoom(1)}
        />
        <ControlChip
          label="2x"
          active={zoom === 2}
          accessibilityLabel="Set map zoom to 2x"
          onPress={() => setZoom(2)}
        />
        <ControlChip
          label="Center"
          active={pan.x === 0 && pan.y === 0}
          accessibilityLabel="Center map view"
          onPress={() => setPan({ x: 0, y: 0 })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    width: '100%',
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    borderCurve: 'continuous',
  },
  gridVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
  },
  gridHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  radarRing: {
    position: 'absolute',
    borderWidth: 1,
  },
  crosshairH: {
    position: 'absolute',
    width: 18,
    height: 1,
  },
  crosshairV: {
    position: 'absolute',
    width: 1,
    height: 18,
  },
  vectorDash: {
    position: 'absolute',
    width: 7,
    height: 2,
    borderRadius: 1,
  },
  distancePillWrap: {
    position: 'absolute',
    width: 136,
    alignItems: 'center',
  },
  distancePill: {
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderCurve: 'continuous',
  },
  distancePillText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  pinAnchor: {
    position: 'absolute',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accuracyHalo: {
    position: 'absolute',
    borderWidth: 1,
  },
  pinBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinInitial: {
    fontSize: 14,
    fontWeight: '700',
  },
  livePinDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 2,
  },
  pinCaptionPill: {
    position: 'absolute',
    top: 22,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 78,
    alignItems: 'center',
  },
  pinCaptionText: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  ghostVeilWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  ghostVeilCard: {
    maxWidth: 320,
    width: '100%',
    borderWidth: 1,
    gap: 4,
    borderCurve: 'continuous',
  },
  ghostVeilHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ghostDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  ghostVeilTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  ghostVeilBody: {
    fontSize: 12,
    lineHeight: 17,
  },
  topLeftScale: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  scaleRule: {
    width: 18,
    height: 5,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
  },
  scaleLabel: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  controlsRow: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  controlChip: {
    borderWidth: 1,
    minHeight: 34,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlChipText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
