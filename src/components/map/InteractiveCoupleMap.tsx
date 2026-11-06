import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
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

import {
  computeDistanceMeters,
  FALLBACK_LIVE_COORDS,
  formatDistanceApart,
  formatLocationModeLabel,
  formatRelativeTimeAgo,
} from '@/api/locations';
import { useSessionStore } from '@/store/sessionStore';
import { MOCHY_SPRINGS, mochyTiming } from '@/theme/motion';
import { useKeepItTheme } from '@/theme/tokens';
import { LocationShareRecord } from '@/types/database';

export interface InteractiveCoupleMapProps {
  mine: LocationShareRecord | null;
  partner: LocationShareRecord | null;
  friends?: LocationShareRecord[];
  myName: string;
  partnerName: string;
}

type MapVisualMode = 'street' | 'radar';
type SelectedPinId = 'mine' | 'partner' | string;

const CANVAS_HEIGHT = 388;
const TILE_SIZE = 256;
const MIN_ZOOM = 12;
const MAX_ZOOM = 16;
const DEFAULT_ZOOM = 14;
const GRID_SPACING = 44;
const RING_RADII = [52, 106, 160] as const;

const VECTOR_STREETS = [
  { lat1: 37.798, lng1: -122.401, lat2: 37.756, lng2: -122.444, weight: 3.5 },
  { lat1: 37.789, lng1: -122.445, lat2: 37.789, lng2: -122.398, weight: 2.2 },
  { lat1: 37.7793, lng1: -122.445, lat2: 37.7793, lng2: -122.398, weight: 2.4 },
  { lat1: 37.7695, lng1: -122.445, lat2: 37.7695, lng2: -122.398, weight: 2.0 },
  { lat1: 37.795, lng1: -122.426, lat2: 37.755, lng2: -122.426, weight: 2.2 },
  { lat1: 37.795, lng1: -122.4194, lat2: 37.755, lng2: -122.4194, weight: 2.6 },
  { lat1: 37.795, lng1: -122.4148, lat2: 37.755, lng2: -122.4148, weight: 2.0 },
  { lat1: 37.795, lng1: -122.409, lat2: 37.755, lng2: -122.409, weight: 2.0 },
] as const;

const VECTOR_PARKS = [
  { nwLat: 37.7625, nwLng: -122.4292, seLat: 37.7575, seLng: -122.4245 },
  { nwLat: 37.7782, nwLng: -122.4212, seLat: 37.7764, seLng: -122.4176 },
  { nwLat: 37.7736, nwLng: -122.456, seLat: 37.766, seLng: -122.442 },
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function latLngToWorldPx(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const clampedLat = clamp(lat, -85.0511, 85.0511);
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function ControlChip({
  label,
  active = false,
  onPress,
  accessibilityLabel,
  compact = false,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  compact?: boolean;
}) {
  const { colors, radii, type, isDark } = useKeepItTheme();
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
          compact && styles.controlChipCompact,
          {
            backgroundColor: active
              ? colors.accent
              : isDark
                ? 'rgba(22, 22, 26, 0.88)'
                : 'rgba(255, 255, 255, 0.92)',
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
  friends = [],
  myName,
  partnerName,
}: InteractiveCoupleMapProps) {
  const { colors, radii, spacing, isDark, type } = useKeepItTheme();
  const motionEnabled = useSessionStore((s) => s.motionEnabled);
  const motionSpeed = useSessionStore((s) => s.motionSpeed);

  const [canvasWidth, setCanvasWidth] = useState(360);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [mapStyle, setMapStyle] = useState<MapVisualMode>('street');
  const [showFriends, setShowFriends] = useState<boolean>(true);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [customCenter, setCustomCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<SelectedPinId | null>(null);

  const touchStartRef = useRef<{ pageX: number; pageY: number; baseX: number; baseY: number }>({
    pageX: 0,
    pageY: 0,
    baseX: 0,
    baseY: 0,
  });
  const myScale = useSharedValue(0);
  const partnerScale = useSharedValue(0);
  const veilOpacity = useSharedValue(0);

  const myHasCoords =
    mine !== null && mine.mode !== 'ghost' && mine.lat !== null && mine.lng !== null;
  const partnerHasCoords =
    partner !== null &&
    partner.mode !== 'ghost' &&
    partner.lat !== null &&
    partner.lng !== null;
  const partnerInGhost = partner !== null && partner.mode === 'ghost';

  const activeFriends = friends.filter(
    (f) => f.mode !== 'ghost' && f.lat !== null && f.lng !== null
  );

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

  const handleMoveShouldSetResponder = (e: GestureResponderEvent): boolean => {
    const dx = e.nativeEvent.pageX - touchStartRef.current.pageX;
    const dy = e.nativeEvent.pageY - touchStartRef.current.pageY;
    return Math.abs(dx) > 5 || Math.abs(dy) > 5;
  };

  const handleTouchStart = (e: GestureResponderEvent) => {
    touchStartRef.current = {
      pageX: e.nativeEvent.pageX,
      pageY: e.nativeEvent.pageY,
      baseX: pan.x,
      baseY: pan.y,
    };
  };

  const handleResponderMove = (e: GestureResponderEvent) => {
    const dx = e.nativeEvent.pageX - touchStartRef.current.pageX;
    const dy = e.nativeEvent.pageY - touchStartRef.current.pageY;
    setPan({
      x: clamp(touchStartRef.current.baseX + dx, -900, 900),
      y: clamp(touchStartRef.current.baseY + dy, -900, 900),
    });
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.max(260, Math.round(event.nativeEvent.layout.width));
    if (nextWidth !== canvasWidth) {
      setCanvasWidth(nextWidth);
    }
  };

  const defaultCenterLat =
    myHasCoords && partnerHasCoords && mine?.lat != null && partner?.lat != null
      ? (mine.lat + partner.lat) / 2
      : myHasCoords && mine?.lat != null
        ? mine.lat
        : partnerHasCoords && partner?.lat != null
          ? partner.lat
          : FALLBACK_LIVE_COORDS.lat;

  const defaultCenterLng =
    myHasCoords && partnerHasCoords && mine?.lng != null && partner?.lng != null
      ? (mine.lng + partner.lng) / 2
      : myHasCoords && mine?.lng != null
        ? mine.lng
        : partnerHasCoords && partner?.lng != null
          ? partner.lng
          : FALLBACK_LIVE_COORDS.lng;

  const anchorLat = customCenter ? customCenter.lat : defaultCenterLat;
  const anchorLng = customCenter ? customCenter.lng : defaultCenterLng;

  const anchorWorld = latLngToWorldPx(anchorLat, anchorLng, zoom);
  // World pixel at screen center after user pan
  const viewportCenterWorldX = anchorWorld.x - pan.x;
  const viewportCenterWorldY = anchorWorld.y - pan.y;

  const metersPerPixel =
    (156_543.03392 * Math.max(0.2, Math.cos((anchorLat * Math.PI) / 180))) / Math.pow(2, zoom);
  const pxPerMeter = 1 / Math.max(0.05, metersPerPixel);

  const projectLatLng = (lat: number, lng: number): { x: number; y: number } => {
    const world = latLngToWorldPx(lat, lng, zoom);
    return {
      x: canvasWidth / 2 + (world.x - viewportCenterWorldX),
      y: CANVAS_HEIGHT / 2 + (world.y - viewportCenterWorldY),
    };
  };

  // Compute slippy XYZ tiles covering the viewport
  const numTilesAxis = Math.pow(2, zoom);
  const worldLeft = viewportCenterWorldX - canvasWidth / 2;
  const worldRight = viewportCenterWorldX + canvasWidth / 2;
  const worldTop = viewportCenterWorldY - CANVAS_HEIGHT / 2;
  const worldBottom = viewportCenterWorldY + CANVAS_HEIGHT / 2;

  const minTileX = Math.floor(worldLeft / TILE_SIZE);
  const maxTileX = Math.floor(worldRight / TILE_SIZE);
  const minTileY = clamp(Math.floor(worldTop / TILE_SIZE), 0, numTilesAxis - 1);
  const maxTileY = clamp(Math.floor(worldBottom / TILE_SIZE), 0, numTilesAxis - 1);

  const tiles: { key: string; url: string; left: number; top: number }[] = [];
  if (mapStyle === 'street') {
    for (let tx = minTileX; tx <= maxTileX; tx += 1) {
      const wrappedTx = ((tx % numTilesAxis) + numTilesAxis) % numTilesAxis;
      for (let ty = minTileY; ty <= maxTileY; ty += 1) {
        const tileUrl = `https://tile.openstreetmap.org/${zoom}/${wrappedTx}/${ty}.png`;
        tiles.push({
          key: `${isDark ? 'd' : 'l'}_${zoom}_${tx}_${ty}`,
          url: tileUrl,
          left: Math.round(tx * TILE_SIZE - worldLeft),
          top: Math.round(ty * TILE_SIZE - worldTop),
        });
      }
    }
  }

  const distanceMeters =
    myHasCoords &&
    partnerHasCoords &&
    mine?.lat != null &&
    mine?.lng != null &&
    partner?.lat != null &&
    partner?.lng != null
      ? computeDistanceMeters(mine.lat, mine.lng, partner.lat, partner.lng)
      : null;

  let myScreenPos =
    myHasCoords && mine?.lat != null && mine?.lng != null
      ? projectLatLng(mine.lat, mine.lng)
      : null;

  let partnerScreenPos =
    partnerHasCoords && partner?.lat != null && partner?.lng != null
      ? projectLatLng(partner.lat, partner.lng)
      : null;

  if (myScreenPos && partnerScreenPos) {
    const dx = partnerScreenPos.x - myScreenPos.x;
    const dy = partnerScreenPos.y - myScreenPos.y;
    const pixelGap = Math.hypot(dx, dy);
    if (pixelGap < 34) {
      const ux = pixelGap > 0.5 ? dx / pixelGap : 0.86;
      const uy = pixelGap > 0.5 ? dy / pixelGap : -0.5;
      const push = (34 - pixelGap) / 2;
      myScreenPos = {
        x: myScreenPos.x - ux * push,
        y: myScreenPos.y - uy * push,
      };
      partnerScreenPos = {
        x: partnerScreenPos.x + ux * push,
        y: partnerScreenPos.y + uy * push,
      };
    }
  }

  const friendScreenPins = showFriends
    ? activeFriends.map((friend, index) => {
        const pos = projectLatLng(friend.lat!, friend.lng!);
        const palette = index % 2 === 0 ? '#A855F7' : '#0EA5E9';
        return {
          record: friend,
          pos,
          color: palette,
          name: friend.display_name ?? 'Friend',
        };
      })
    : [];

  // Geodesic dashed connector line + midpoint pill between You and Partner
  const vectorDashes: { key: string; x: number; y: number; angleDeg: number }[] = [];
  if (myScreenPos && partnerScreenPos) {
    const dx = partnerScreenPos.x - myScreenPos.x;
    const dy = partnerScreenPos.y - myScreenPos.y;
    const totalLen = Math.hypot(dx, dy);
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const stepPx = 12;
    const count = Math.min(80, Math.max(2, Math.floor(totalLen / stepPx)));
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

  const myHaloDiameter =
    myHasCoords && mine?.accuracy_m ? clamp(mine.accuracy_m * pxPerMeter * 2, 44, 96) : 50;
  const partnerHaloDiameter =
    partnerHasCoords && partner?.accuracy_m
      ? clamp(partner.accuracy_m * pxPerMeter * 2, 44, 96)
      : 50;

  const scaleBarMeters = Math.max(25, Math.round((68 * metersPerPixel) / 10) * 10);
  const scaleBarLabel =
    scaleBarMeters >= 1000
      ? `${(scaleBarMeters / 1000).toFixed(scaleBarMeters >= 10_000 ? 0 : 1)} km`
      : `${scaleBarMeters} m`;

  const gridLineColor = isDark ? 'rgba(255, 255, 255, 0.065)' : 'rgba(0, 0, 0, 0.06)';
  const radarRingColor = isDark ? 'rgba(52, 199, 89, 0.22)' : 'rgba(36, 138, 61, 0.2)';
  const fallbackRoadColor = isDark ? 'rgba(255, 255, 255, 0.11)' : 'rgba(20, 20, 30, 0.11)';
  const fallbackParkColor = isDark ? 'rgba(52, 199, 89, 0.10)' : 'rgba(52, 199, 89, 0.15)';
  const fallbackWaterColor = isDark ? 'rgba(14, 165, 233, 0.12)' : 'rgba(14, 165, 233, 0.18)';
  const vectorDashColor = isDark ? '#34C759' : '#1E8E3E';

  const verticalCount = Math.ceil(canvasWidth / GRID_SPACING) + 4;
  const horizontalCount = Math.ceil(CANVAS_HEIGHT / GRID_SPACING) + 4;
  const modPanX = ((pan.x % GRID_SPACING) + GRID_SPACING) % GRID_SPACING;
  const modPanY = ((pan.y % GRID_SPACING) + GRID_SPACING) % GRID_SPACING;

  const bayShorePoint = projectLatLng(37.788, -122.388);

  const handleZoomChange = (delta: number) => {
    setZoom((prev) => clamp(prev + delta, MIN_ZOOM, MAX_ZOOM));
    setPan((prev) => {
      const factor = delta > 0 ? 2 : 0.5;
      return { x: prev.x * factor, y: prev.y * factor };
    });
  };

  const handleCenterUs = () => {
    setCustomCenter(null);
    setPan({ x: 0, y: 0 });
    setZoom(DEFAULT_ZOOM);
    setSelectedPinId(null);
  };

  const handleFocusPartner = () => {
    if (partnerHasCoords && partner?.lat != null && partner?.lng != null) {
      setCustomCenter({ lat: partner.lat, lng: partner.lng });
      setPan({ x: 0, y: 0 });
      setZoom(15);
      setSelectedPinId('partner');
    } else {
      setSelectedPinId('partner');
    }
  };

  const resolveInspectedPin = (): {
    title: string;
    subtitle: string;
    distanceText: string;
    updatedText: string;
    accentColor: string;
  } | null => {
    if (!selectedPinId) return null;

    if (selectedPinId === 'mine' && mine) {
      return {
        title: `${myName} (You) · ${formatLocationModeLabel(mine.mode)}`,
        subtitle:
          mine.mode === 'ghost'
            ? 'Hidden in Ghost mode'
            : (mine.place_name ?? 'Live GPS Coordinates'),
        distanceText: 'Your current pin',
        updatedText: `Updated ${formatRelativeTimeAgo(mine.location_updated_at)}`,
        accentColor: colors.success,
      };
    }

    if (selectedPinId === 'partner') {
      if (!partner || partner.mode === 'ghost') {
        return {
          title: `${partnerName} · Ghost`,
          subtitle: 'Location hidden while in Ghost mode',
          distanceText: 'Distance hidden',
          updatedText: partner ? `Changed ${formatRelativeTimeAgo(partner.mode_changed_at)}` : 'Offline',
          accentColor: colors.inkMuted,
        };
      }
      const dist =
        myHasCoords &&
        mine?.lat != null &&
        mine?.lng != null &&
        partner.lat != null &&
        partner.lng != null
          ? formatDistanceApart(computeDistanceMeters(mine.lat, mine.lng, partner.lat, partner.lng))
          : 'Live pin active';
      return {
        title: `${partnerName} · ${formatLocationModeLabel(partner.mode)}`,
        subtitle: partner.place_name ?? 'Sharing live location',
        distanceText: dist,
        updatedText: `Updated ${formatRelativeTimeAgo(partner.location_updated_at)}`,
        accentColor: colors.success,
      };
    }

    const friend = friends.find((f) => f.user_id === selectedPinId);
    if (friend) {
      const friendDist =
        myHasCoords &&
        mine?.lat != null &&
        mine?.lng != null &&
        friend.lat != null &&
        friend.lng != null
          ? formatDistanceApart(computeDistanceMeters(mine.lat, mine.lng, friend.lat, friend.lng))
          : 'In your circle';
      return {
        title: `${friend.display_name ?? 'Friend'} · ${formatLocationModeLabel(friend.mode)}`,
        subtitle: friend.place_name ?? 'Sharing with Friends Circle',
        distanceText: friendDist,
        updatedText: `Updated ${formatRelativeTimeAgo(friend.location_updated_at)}`,
        accentColor: '#A855F7',
      };
    }

    return null;
  };

  const inspectedPin = resolveInspectedPin();

  return (
    <View
      onLayout={handleLayout}
      onTouchStart={handleTouchStart}
      onMoveShouldSetResponder={handleMoveShouldSetResponder}
      onResponderMove={handleResponderMove}
      accessibilityLabel={`Interactive live map for ${myName}, ${partnerName}, and friends`}
      style={[
        styles.canvas,
        {
          height: CANVAS_HEIGHT,
          backgroundColor: isDark ? '#0D1117' : '#EAECEF',
          borderColor: colors.border,
          borderRadius: radii.photo,
        },
      ]}>
      {/* Offline-resilient built-in vector street/park/water fallback layer underneath */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {/* SF Bay shoreline tint on east edge */}
        <View
          style={[
            styles.waterPolygon,
            {
              left: bayShorePoint.x,
              top: -120,
              width: 900,
              height: CANVAS_HEIGHT + 240,
              backgroundColor: fallbackWaterColor,
            },
          ]}
        />

        {/* Vector Parks */}
        {VECTOR_PARKS.map((park, idx) => {
          const nw = projectLatLng(park.nwLat, park.nwLng);
          const se = projectLatLng(park.seLat, park.seLng);
          const w = Math.max(12, se.x - nw.x);
          const h = Math.max(12, se.y - nw.y);
          return (
            <View
              key={`park_${idx}`}
              style={[
                styles.parkBlock,
                {
                  left: nw.x,
                  top: nw.y,
                  width: w,
                  height: h,
                  backgroundColor: fallbackParkColor,
                },
              ]}
            />
          );
        })}

        {/* Cartographic background grid */}
        {Array.from({ length: verticalCount }).map((_, idx) => (
          <View
            key={`v_${idx}`}
            style={[
              styles.gridVertical,
              { left: (idx - 2) * GRID_SPACING + modPanX, backgroundColor: gridLineColor },
            ]}
          />
        ))}
        {Array.from({ length: horizontalCount }).map((_, idx) => (
          <View
            key={`h_${idx}`}
            style={[
              styles.gridHorizontal,
              { top: (idx - 2) * GRID_SPACING + modPanY, backgroundColor: gridLineColor },
            ]}
          />
        ))}

        {/* Major SF Vector Arteries (Market St, Van Ness, Divisadero, etc.) */}
        {VECTOR_STREETS.map((road, idx) => {
          const p1 = projectLatLng(road.lat1, road.lng1);
          const p2 = projectLatLng(road.lat2, road.lng2);
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.hypot(dx, dy);
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;
          return (
            <View
              key={`road_${idx}`}
              style={{
                position: 'absolute',
                width: len,
                height: road.weight,
                left: midX - len / 2,
                top: midY - road.weight / 2,
                backgroundColor: fallbackRoadColor,
                transform: [{ rotate: `${angle}deg` }],
              }}
            />
          );
        })}
      </View>

      {/* Real Slippy OpenStreetMap / Carto XYZ Tile Layer */}
      {mapStyle === 'street' ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {tiles.map((tile) => (
            <Image
              key={tile.key}
              source={{ uri: tile.url }}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={140}
              style={[
                {
                  position: 'absolute',
                  left: tile.left,
                  top: tile.top,
                  width: TILE_SIZE + 0.5,
                  height: TILE_SIZE + 0.5,
                },
                Platform.OS === 'web' && isDark
                  ? ({ filter: 'invert(0.92) hue-rotate(180deg) brightness(0.95) contrast(1.05)' } as never)
                  : null,
              ]}
            />
          ))}
        </View>
      ) : (
        /* Radar Grid Overlay Mode */
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {RING_RADII.map((r) => {
            const diameter = r * 2;
            return (
              <View
                key={`ring_${r}`}
                style={[
                  styles.radarRing,
                  {
                    width: diameter,
                    height: diameter,
                    borderRadius: r,
                    borderColor: radarRingColor,
                    left: canvasWidth / 2 - r,
                    top: CANVAS_HEIGHT / 2 - r,
                  },
                ]}
              />
            );
          })}
          <View
            style={[
              styles.crosshairH,
              {
                backgroundColor: radarRingColor,
                left: canvasWidth / 2 - 12,
                top: CANVAS_HEIGHT / 2 - 0.5,
              },
            ]}
          />
          <View
            style={[
              styles.crosshairV,
              {
                backgroundColor: radarRingColor,
                left: canvasWidth / 2 - 0.5,
                top: CANVAS_HEIGHT / 2 - 12,
              },
            ]}
          />
        </View>
      )}

      {/* Geodesic Connector Line + Midpoint Distance Pill between You and Partner */}
      {myScreenPos && partnerScreenPos && distanceMeters !== null ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {vectorDashes.map((dash) => (
            <View
              key={dash.key}
              style={[
                styles.vectorDash,
                {
                  backgroundColor: vectorDashColor,
                  left: dash.x - 4,
                  top: dash.y - 1.25,
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
                  left: clamp(midpoint.x - 66, 12, canvasWidth - 144),
                  top: clamp(midpoint.y - 14, 54, CANVAS_HEIGHT - 76),
                },
              ]}>
              <View
                style={[
                  styles.distancePill,
                  {
                    backgroundColor: isDark
                      ? 'rgba(18, 18, 22, 0.92)'
                      : 'rgba(255, 255, 255, 0.95)',
                    borderColor: vectorDashColor,
                    borderRadius: radii.pill,
                  },
                ]}>
                <View style={[styles.distancePulseDot, { backgroundColor: vectorDashColor }]} />
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

      {/* Friend Live Pins */}
      {friendScreenPins.map(({ record, pos, color, name }) => {
        const isSelected = selectedPinId === record.user_id;
        return (
          <View
            key={record.user_id}
            style={[
              styles.pinAnchor,
              {
                left: pos.x,
                top: pos.y,
                zIndex: isSelected ? 25 : 12,
              },
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Inspect ${name} pin at ${record.place_name ?? 'live location'}`}
              onPress={() => {
                if (Platform.OS !== 'web') {
                  void Haptics.selectionAsync();
                }
                setSelectedPinId((curr) => (curr === record.user_id ? null : record.user_id));
              }}
              style={styles.pinPressable}>
              <View
                style={[
                  styles.friendPinBadge,
                  {
                    backgroundColor: color,
                    borderColor: isSelected ? colors.ink : colors.canvas,
                    transform: [{ scale: isSelected ? 1.12 : 1 }],
                  },
                ]}>
                <Text style={styles.friendPinInitial}>
                  {(name.trim().slice(0, 1) || 'F').toUpperCase()}
                </Text>
              </View>
              <View
                style={[
                  styles.pinCaptionPill,
                  {
                    backgroundColor: isDark
                      ? 'rgba(20, 20, 24, 0.90)'
                      : 'rgba(255, 255, 255, 0.94)',
                    borderColor: isSelected ? color : colors.border,
                    borderRadius: radii.pill,
                  },
                ]}>
                <Text numberOfLines={1} style={[styles.pinCaptionText, { color: colors.ink }]}>
                  {name.split(' ')[0]}
                </Text>
              </View>
            </Pressable>
          </View>
        );
      })}

      {/* Partner Pin + Accuracy Halo */}
      {partnerScreenPos && partnerHasCoords ? (
        <Animated.View
          style={[
            styles.pinAnchor,
            {
              left: partnerScreenPos.x,
              top: partnerScreenPos.y,
              zIndex: selectedPinId === 'partner' ? 30 : 18,
            },
            partnerPinAnimStyle,
          ]}>
          <View
            pointerEvents="none"
            style={[
              styles.accuracyHalo,
              {
                width: partnerHaloDiameter,
                height: partnerHaloDiameter,
                borderRadius: partnerHaloDiameter / 2,
                backgroundColor: isDark
                  ? 'rgba(52, 199, 89, 0.16)'
                  : 'rgba(36, 138, 61, 0.14)',
                borderColor: isDark ? 'rgba(52, 199, 89, 0.45)' : 'rgba(36, 138, 61, 0.4)',
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Inspect ${partnerName} location`}
            onPress={() => {
              if (Platform.OS !== 'web') {
                void Haptics.selectionAsync();
              }
              setSelectedPinId((curr) => (curr === 'partner' ? null : 'partner'));
            }}
            style={styles.pinPressable}>
            <View
              style={[
                styles.pinBadge,
                {
                  backgroundColor: colors.accent,
                  borderColor: selectedPinId === 'partner' ? colors.success : colors.canvas,
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
                  backgroundColor: isDark
                    ? 'rgba(20, 20, 24, 0.92)'
                    : 'rgba(255, 255, 255, 0.95)',
                  borderColor: selectedPinId === 'partner' ? colors.success : colors.border,
                  borderRadius: radii.pill,
                },
              ]}>
              <Text numberOfLines={1} style={[styles.pinCaptionText, { color: colors.ink }]}>
                {partnerName} · {partner?.mode === 'live' ? 'Live' : 'Moment'}
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}

      {/* Caller (You) Pin + Accuracy Halo */}
      {myScreenPos && myHasCoords ? (
        <Animated.View
          style={[
            styles.pinAnchor,
            {
              left: myScreenPos.x,
              top: myScreenPos.y,
              zIndex: selectedPinId === 'mine' ? 32 : 20,
            },
            myPinAnimStyle,
          ]}>
          <View
            pointerEvents="none"
            style={[
              styles.accuracyHalo,
              {
                width: myHaloDiameter,
                height: myHaloDiameter,
                borderRadius: myHaloDiameter / 2,
                backgroundColor: isDark
                  ? 'rgba(52, 199, 89, 0.14)'
                  : 'rgba(36, 138, 61, 0.12)',
                borderColor: isDark ? 'rgba(52, 199, 89, 0.38)' : 'rgba(36, 138, 61, 0.34)',
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Inspect your location at ${mine?.place_name ?? 'current coordinates'}`}
            onPress={() => {
              if (Platform.OS !== 'web') {
                void Haptics.selectionAsync();
              }
              setSelectedPinId((curr) => (curr === 'mine' ? null : 'mine'));
            }}
            style={styles.pinPressable}>
            <View
              style={[
                styles.pinBadge,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: selectedPinId === 'mine' ? colors.success : colors.ink,
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
                  backgroundColor: isDark
                    ? 'rgba(20, 20, 24, 0.92)'
                    : 'rgba(255, 255, 255, 0.95)',
                  borderColor: selectedPinId === 'mine' ? colors.success : colors.border,
                  borderRadius: radii.pill,
                },
              ]}>
              <Text numberOfLines={1} style={[styles.pinCaptionText, { color: colors.ink }]}>
                You · {mine?.mode === 'live' ? 'Live' : 'Moment'}
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}

      {/* Ghost-mode veil when partner explicitly enters Ghost mode */}
      {partnerInGhost ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ghostVeilWrap,
            {
              paddingHorizontal: spacing.md,
              top: 52,
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
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs + 2,
              },
            ]}>
            <View style={[styles.ghostDot, { backgroundColor: colors.inkMuted }]} />
            <Text
              style={[
                styles.ghostVeilTitle,
                { color: colors.ink, letterSpacing: type.bodyTracking },
              ]}>
              {partnerName} is in Ghost mode
            </Text>
          </View>
        </Animated.View>
      ) : null}

      {/* Top Style Switcher Chips: Street Map | Radar Grid | Friends View */}
      <View
        style={[
          styles.topBarRow,
          {
            top: spacing.sm + 2,
            left: spacing.sm + 2,
            right: spacing.sm + 2,
          },
        ]}>
        <View style={styles.topChipsGroup}>
          <ControlChip
            label="Street Map"
            active={mapStyle === 'street'}
            accessibilityLabel="Switch to OpenStreetMap street tile view"
            onPress={() => setMapStyle('street')}
          />
          <ControlChip
            label="Radar Grid"
            active={mapStyle === 'radar'}
            accessibilityLabel="Switch to tactical radar grid view"
            onPress={() => setMapStyle('radar')}
          />
          <ControlChip
            label={`Friends (${activeFriends.length})`}
            active={showFriends}
            accessibilityLabel="Toggle friend pins on map"
            onPress={() => setShowFriends((v) => !v)}
          />
        </View>
      </View>

      {/* Inspected Pin Popover Card */}
      {inspectedPin ? (
        <View
          style={[
            styles.inspectCard,
            {
              left: spacing.sm + 2,
              right: spacing.sm + 2,
              bottom: 52,
              backgroundColor: isDark
                ? 'rgba(18, 18, 22, 0.95)'
                : 'rgba(255, 255, 255, 0.96)',
              borderColor: colors.border,
              borderRadius: radii.card,
            },
          ]}>
          <View style={[styles.inspectAccentDot, { backgroundColor: inspectedPin.accentColor }]} />
          <View style={styles.inspectBody}>
            <Text numberOfLines={1} style={[styles.inspectTitle, { color: colors.ink }]}>
              {inspectedPin.title}
            </Text>
            <Text numberOfLines={1} style={[styles.inspectSubtitle, { color: colors.inkMuted }]}>
              {inspectedPin.subtitle}
            </Text>
            <Text numberOfLines={1} style={[styles.inspectMeta, { color: colors.inkMuted }]}>
              {inspectedPin.distanceText} · {inspectedPin.updatedText}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close pin details"
            onPress={() => setSelectedPinId(null)}
            style={[
              styles.inspectCloseBtn,
              { backgroundColor: colors.surfaceElevated, borderRadius: radii.pill },
            ]}>
            <Text style={[styles.inspectCloseText, { color: colors.inkMuted }]}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Bottom Scale + Attribution + Zoom/Center/Focus Partner Controls */}
      <View
        style={[
          styles.bottomBarRow,
          {
            bottom: spacing.sm + 2,
            left: spacing.sm + 2,
            right: spacing.sm + 2,
          },
        ]}>
        <View
          pointerEvents="none"
          style={[
            styles.scalePill,
            {
              backgroundColor: isDark
                ? 'rgba(20, 20, 24, 0.86)'
                : 'rgba(255, 255, 255, 0.90)',
              borderColor: colors.border,
              borderRadius: radii.pill,
            },
          ]}>
          <View style={[styles.scaleRule, { borderColor: colors.inkMuted }]} />
          <Text style={[styles.scaleLabel, { color: colors.inkMuted }]}>
            {scaleBarLabel} · z{zoom} · OSM
          </Text>
        </View>

        <View style={styles.controlsRow}>
          <ControlChip
            label="−"
            compact
            active={false}
            accessibilityLabel="Zoom out map"
            onPress={() => handleZoomChange(-1)}
          />
          <ControlChip
            label="+"
            compact
            active={false}
            accessibilityLabel="Zoom in map"
            onPress={() => handleZoomChange(1)}
          />
          <ControlChip
            label="Center Us"
            compact
            active={customCenter === null && pan.x === 0 && pan.y === 0}
            accessibilityLabel="Center map on both of you"
            onPress={handleCenterUs}
          />
          <ControlChip
            label="Partner"
            compact
            active={selectedPinId === 'partner' && customCenter !== null}
            accessibilityLabel={`Focus map on ${partnerName}`}
            onPress={handleFocusPartner}
          />
        </View>
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
  waterPolygon: {
    position: 'absolute',
    transform: [{ rotate: '-14deg' }],
  },
  parkBlock: {
    position: 'absolute',
    borderRadius: 8,
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
    width: 24,
    height: 1,
  },
  crosshairV: {
    position: 'absolute',
    width: 1,
    height: 24,
  },
  vectorDash: {
    position: 'absolute',
    width: 8,
    height: 2.5,
    borderRadius: 2,
  },
  distancePillWrap: {
    position: 'absolute',
    zIndex: 16,
  },
  distancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderCurve: 'continuous',
  },
  distancePulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  distancePillText: {
    fontSize: 11,
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
  pinPressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  accuracyHalo: {
    position: 'absolute',
    borderWidth: 1,
  },
  pinBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendPinBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinInitial: {
    fontSize: 15,
    fontWeight: '800',
  },
  friendPinInitial: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
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
    marginTop: 4,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    maxWidth: 136,
    borderCurve: 'continuous',
  },
  pinCaptionText: {
    fontSize: 10,
    fontWeight: '700',
  },
  ghostVeilWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 22,
  },
  ghostVeilCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  ghostDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  ghostVeilTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  topBarRow: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 40,
  },
  topChipsGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  inspectCard: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    zIndex: 42,
    borderCurve: 'continuous',
  },
  inspectAccentDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  inspectBody: {
    flex: 1,
    gap: 1,
  },
  inspectTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  inspectSubtitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  inspectMeta: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  inspectCloseBtn: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inspectCloseText: {
    fontSize: 11,
    fontWeight: '700',
  },
  bottomBarRow: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    zIndex: 40,
  },
  scalePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderCurve: 'continuous',
  },
  scaleRule: {
    width: 16,
    height: 5,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
  },
  scaleLabel: {
    fontSize: 10,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  controlChip: {
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderCurve: 'continuous',
  },
  controlChipCompact: {
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  controlChipText: {
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
