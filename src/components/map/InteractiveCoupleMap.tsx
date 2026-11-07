import { Image } from 'expo-image';
import React, { useRef, useState } from 'react';
import { GestureResponderEvent, StyleSheet, Text, View } from 'react-native';

import {
  computeDistanceMeters,
  formatDistanceApart,
  formatRelativeTimeAgo,
} from '@/api/locations';
import {
  CloseCrossIcon,
  CoupleLinkIcon,
  CrosshairIcon,
  DirectionChevronIcon,
  FriendsClusterIcon,
  GhostCloakIcon,
  LiveBeaconIcon,
  MomentPinIcon,
  PanMoveIcon,
  RadarRingsIcon,
  StreetGridIcon,
  ZoomMinusIcon,
  ZoomPlusIcon,
} from '@/components/map/MapIcons';
import { KeepItButton } from '@/components/ui/Primitives';
import { AppPressable, EmptyState } from '@/components/ui/ScreenKit';
import { useKeepItTheme } from '@/theme/tokens';
import { LocationMode, LocationShareRecord } from '@/types/database';

export interface InteractiveCoupleMapProps {
  mine: LocationShareRecord | null;
  partner: LocationShareRecord | null;
  friends?: LocationShareRecord[];
  myName: string;
  partnerName: string;
}

type Pin = { id: string; name: string; role: string; record: LocationShareRecord };
const HEIGHT = 356;
const TILE_SIZE = 256;
const MIN_ZOOM = 12;
const MAX_ZOOM = 16;
const DEFAULT_ZOOM = 14;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hasCoordinates(
  record: LocationShareRecord | null,
): record is LocationShareRecord & { lat: number; lng: number } {
  return Boolean(record && record.mode !== 'ghost' && record.lat != null && record.lng != null);
}

function worldPoint(lat: number, lng: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const sinLat = Math.sin((clamp(lat, -85.0511, 85.0511) * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function ModeBadgeIcon({
  mode,
  color,
  accentColor,
  size = 11,
}: {
  mode: LocationMode;
  color: string;
  accentColor?: string;
  size?: number;
}) {
  if (mode === 'live') {
    return <LiveBeaconIcon color={color} accentColor={accentColor} size={size} />;
  }
  if (mode === 'on_moment') {
    return <MomentPinIcon color={color} size={size} />;
  }
  return <GhostCloakIcon color={color} size={size} />;
}

export function InteractiveCoupleMap({
  mine,
  partner,
  friends = [],
  myName,
  partnerName,
}: InteractiveCoupleMapProps) {
  const { colors, radii, isDark } = useKeepItTheme();
  const [width, setWidth] = useState(320);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [mapStyle, setMapStyle] = useState<'street' | 'radar'>('street');
  const [showFriends, setShowFriends] = useState(true);
  const [panEnabled, setPanEnabled] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failedTiles, setFailedTiles] = useState<string[]>([]);
  const [loadedTiles, setLoadedTiles] = useState<string[]>([]);
  const [tileAttempt, setTileAttempt] = useState(0);
  const touchStart = useRef({ x: 0, y: 0, baseX: 0, baseY: 0 });

  const pins: Pin[] = [];
  if (hasCoordinates(mine)) pins.push({ id: 'mine', name: myName, role: 'You', record: mine });
  if (hasCoordinates(partner))
    pins.push({ id: 'partner', name: partnerName, role: 'Partner', record: partner });
  const activeFriends = friends.filter(hasCoordinates);
  if (showFriends) {
    activeFriends.forEach((record) =>
      pins.push({
        id: record.user_id,
        name: record.display_name ?? 'Friend',
        role: 'Friend',
        record,
      }),
    );
  }
  const focus = pins.find((pin) => pin.id === focusId);
  const anchorPins = focus ? [focus] : pins.filter((pin) => pin.id === 'mine' || pin.id === 'partner');
  const anchors = anchorPins.length ? anchorPins : pins.slice(0, 1);
  const anchor = anchors.length
    ? {
        lat: anchors.reduce((sum, pin) => sum + pin.record.lat!, 0) / anchors.length,
        lng: anchors.reduce((sum, pin) => sum + pin.record.lng!, 0) / anchors.length,
      }
    : null;
  const anchorWorld = anchor ? worldPoint(anchor.lat, anchor.lng, zoom) : null;
  const worldLeft = (anchorWorld?.x ?? 0) - pan.x - width / 2;
  const worldTop = (anchorWorld?.y ?? 0) - pan.y - HEIGHT / 2;
  const project = (record: LocationShareRecord) => {
    const point = worldPoint(record.lat!, record.lng!, zoom);
    return { x: point.x - worldLeft, y: point.y - worldTop };
  };

  const tiles: { key: string; url: string; left: number; top: number }[] = [];
  if (anchor && mapStyle === 'street') {
    const numTilesAxis = 2 ** zoom;
    const cartoTheme = isDark ? 'dark_all' : 'rastertiles/voyager';
    const subdomains = ['a', 'b', 'c', 'd'] as const;
    for (
      let tx = Math.floor(worldLeft / TILE_SIZE);
      tx <= Math.floor((worldLeft + width) / TILE_SIZE);
      tx += 1
    ) {
      const wrappedTx = ((tx % numTilesAxis) + numTilesAxis) % numTilesAxis;
      for (
        let ty = clamp(Math.floor(worldTop / TILE_SIZE), 0, numTilesAxis - 1);
        ty <= clamp(Math.floor((worldTop + HEIGHT) / TILE_SIZE), 0, numTilesAxis - 1);
        ty += 1
      ) {
        const sub = subdomains[Math.abs(wrappedTx + ty) % subdomains.length];
        const tileUrl = `https://${sub}.basemaps.cartocdn.com/${cartoTheme}/${zoom}/${wrappedTx}/${ty}@2x.png`;
        tiles.push({
          key: `${cartoTheme}_${zoom}_${tx}_${ty}_${tileAttempt}`,
          url: tileUrl,
          left: Math.round(tx * TILE_SIZE - worldLeft),
          top: Math.round(ty * TILE_SIZE - worldTop),
        });
      }
    }
  }

  const tileError = tiles.some((tile) => failedTiles.includes(tile.key));
  const tilesLoading =
    tiles.length > 0 &&
    tiles.some((tile) => !loadedTiles.includes(tile.key) && !failedTiles.includes(tile.key));
  const distance =
    hasCoordinates(mine) && hasCoordinates(partner)
      ? formatDistanceApart(computeDistanceMeters(mine.lat, mine.lng, partner.lat, partner.lng))
      : null;
  const metersPerPixel = anchor
    ? (156543.03392 * Math.cos((anchor.lat * Math.PI) / 180)) / 2 ** zoom
    : null;
  const scaleMeters = metersPerPixel ? Math.max(25, Math.round((metersPerPixel * 60) / 10) * 10) : null;
  const connector =
    hasCoordinates(mine) && hasCoordinates(partner)
      ? { mine: project(mine), partner: project(partner) }
      : null;
  const connectorLength = connector
    ? Math.hypot(connector.partner.x - connector.mine.x, connector.partner.y - connector.mine.y)
    : 0;
  const connectorAngle = connector
    ? (Math.atan2(connector.partner.y - connector.mine.y, connector.partner.x - connector.mine.x) *
        180) /
      Math.PI
    : 0;
  const selected =
    selectedId === 'partner'
      ? { name: partnerName, role: 'Partner', record: partner }
      : selectedId === 'mine'
        ? { name: myName, role: 'You', record: mine }
        : pins.find((pin) => pin.id === selectedId);

  const iconButton = (
    icon: React.ReactNode,
    label: string,
    onPress: () => void,
    options: { selected?: boolean; disabled?: boolean; toggle?: boolean; badge?: string } = {},
  ) => (
    <AppPressable
      accessibilityRole={options.toggle ? 'checkbox' : 'button'}
      accessibilityLabel={label}
      accessibilityState={
        options.toggle
          ? { checked: options.selected, disabled: options.disabled }
          : { selected: options.selected, disabled: options.disabled }
      }
      disabled={options.disabled}
      onPress={onPress}
      style={[
        styles.iconBtn,
        {
          borderColor: options.selected ? colors.focusRing : colors.controlBorder,
          borderRadius: radii.input,
          backgroundColor: options.selected ? colors.accent : colors.surfaceElevated,
        },
      ]}
    >
      {icon}
      {options.badge ? (
        <Text
          style={[
            styles.badgeText,
            { color: options.selected ? colors.onAccent : colors.ink },
          ]}
        >
          {options.badge}
        </Text>
      ) : null}
    </AppPressable>
  );

  const center = () => {
    setFocusId(null);
    setPan({ x: 0, y: 0 });
    setZoom(DEFAULT_ZOOM);
  };

  const zoomBy = (delta: number) => {
    const next = clamp(zoom + delta, MIN_ZOOM, MAX_ZOOM);
    if (next === zoom) return;
    const factor = 2 ** (next - zoom);
    setZoom(next);
    setPan((value) => ({ x: value.x * factor, y: value.y * factor }));
  };

  const handleStart = (event: GestureResponderEvent) => {
    touchStart.current = {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
      baseX: pan.x,
      baseY: pan.y,
    };
  };

  const handleMove = (event: GestureResponderEvent) => {
    setPan({
      x: clamp(touchStart.current.baseX + event.nativeEvent.pageX - touchStart.current.x, -900, 900),
      y: clamp(touchStart.current.baseY + event.nativeEvent.pageY - touchStart.current.y, -900, 900),
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderRadius: radii.card }]}>
      {/* Top compact icon HUD bar: Layer switcher + Friends filter + Controls */}
      <View style={styles.hudBar}>
        <View style={styles.hudGroup}>
          {iconButton(
            <StreetGridIcon
              color={mapStyle === 'street' ? colors.onAccent : colors.ink}
              size={18}
            />,
            'Street map view',
            () => setMapStyle('street'),
            { selected: mapStyle === 'street' },
          )}
          {iconButton(
            <RadarRingsIcon
              color={mapStyle === 'radar' ? colors.onAccent : colors.ink}
              size={18}
            />,
            'Radar map view',
            () => setMapStyle('radar'),
            { selected: mapStyle === 'radar' },
          )}
          {iconButton(
            <FriendsClusterIcon
              color={showFriends ? colors.onAccent : colors.ink}
              size={18}
            />,
            `Show friend pins (${activeFriends.length})`,
            () => setShowFriends((value) => !value),
            {
              selected: showFriends,
              toggle: true,
              badge: String(activeFriends.length),
            },
          )}
        </View>
        {distance ? (
          <View style={styles.hudDistance}>
            <CoupleLinkIcon color={colors.inkMuted} size={14} />
            <Text style={[styles.badgeText, { color: colors.ink }]}>{distance}</Text>
          </View>
        ) : null}
      </View>

      {panEnabled && anchor ? (
        <View style={styles.dpadRow}>
          {iconButton(
            <DirectionChevronIcon color={colors.ink} direction="up" size={16} />,
            'Pan map north',
            () => setPan((value) => ({ ...value, y: clamp(value.y + 80, -900, 900) })),
          )}
          {iconButton(
            <DirectionChevronIcon color={colors.ink} direction="left" size={16} />,
            'Pan map west',
            () => setPan((value) => ({ ...value, x: clamp(value.x + 80, -900, 900) })),
          )}
          {iconButton(
            <DirectionChevronIcon color={colors.ink} direction="right" size={16} />,
            'Pan map east',
            () => setPan((value) => ({ ...value, x: clamp(value.x - 80, -900, 900) })),
          )}
          {iconButton(
            <DirectionChevronIcon color={colors.ink} direction="down" size={16} />,
            'Pan map south',
            () => setPan((value) => ({ ...value, y: clamp(value.y - 80, -900, 900) })),
          )}
        </View>
      ) : null}

      {anchor ? (
        <>
          <View
            onLayout={(event) =>
              setWidth(Math.max(1, Math.round(event.nativeEvent.layout.width)))
            }
            style={[
              styles.canvas,
              {
                backgroundColor: colors.surfaceElevated,
                borderRadius: radii.photo,
                borderColor: colors.border,
              },
            ]}
          >
            <View
              style={StyleSheet.absoluteFill}
              onTouchStart={handleStart}
              onStartShouldSetResponder={() => panEnabled}
              onMoveShouldSetResponder={() => panEnabled}
              onResponderMove={handleMove}
              onResponderTerminationRequest={() => true}
              accessibilityLabel={
                panEnabled
                  ? 'Map panning enabled. Drag to move the map.'
                  : 'Map preview. Enable move map or use direction controls to pan.'
              }
            >
              {mapStyle === 'street'
                ? tiles.map((tile) => (
                    <Image
                      key={tile.key}
                      source={{ uri: tile.url }}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      onLoad={() =>
                        setLoadedTiles((current) =>
                          current.includes(tile.key) ? current : [...current.slice(-80), tile.key],
                        )
                      }
                      onError={() =>
                        setFailedTiles((current) =>
                          current.includes(tile.key) ? current : [...current.slice(-80), tile.key],
                        )
                      }
                      style={{
                        position: 'absolute',
                        left: tile.left,
                        top: tile.top,
                        width: TILE_SIZE + 0.5,
                        height: TILE_SIZE + 0.5,
                      }}
                    />
                  ))
                : [52, 106, 160].map((radius) => (
                    <View
                      key={radius}
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        width: radius * 2,
                        height: radius * 2,
                        borderRadius: radius,
                        borderWidth: 1,
                        borderColor: colors.controlBorder,
                        left: width / 2 - radius,
                        top: HEIGHT / 2 - radius,
                      }}
                    />
                  ))}
            </View>

            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              {connector && connectorLength > 0 ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: (connector.mine.x + connector.partner.x) / 2 - connectorLength / 2,
                    top: (connector.mine.y + connector.partner.y) / 2,
                    width: connectorLength,
                    borderTopWidth: 2,
                    borderStyle: 'dashed',
                    borderColor: colors.controlBorder,
                    transform: [{ rotate: `${connectorAngle}deg` }],
                  }}
                />
              ) : null}

              {pins.map((pin) => {
                const point = project(pin.record);
                if (
                  point.x < 26 ||
                  point.x > width - 26 ||
                  point.y < 26 ||
                  point.y > HEIGHT - 26
                )
                  return null;
                const isSelected = selectedId === pin.id;
                const isMine = pin.id === 'mine';
                const haloDiameter =
                  metersPerPixel && pin.record.accuracy_m != null
                    ? clamp((pin.record.accuracy_m / metersPerPixel) * 2, 48, 96)
                    : null;
                return (
                  <React.Fragment key={pin.id}>
                    {haloDiameter ? (
                      <View
                        pointerEvents="none"
                        style={{
                          position: 'absolute',
                          left: point.x - haloDiameter / 2,
                          top: point.y - haloDiameter / 2,
                          width: haloDiameter,
                          height: haloDiameter,
                          borderRadius: haloDiameter / 2,
                          borderWidth: 1,
                          borderColor: colors.controlBorder,
                          backgroundColor: colors.accentSoft,
                        }}
                      />
                    ) : null}
                    <AppPressable
                      accessibilityRole="button"
                      accessibilityLabel={`Inspect ${pin.name}, ${pin.role}, ${pin.record.place_name ?? 'shared location'}`}
                      accessibilityState={{ selected: isSelected }}
                      onPress={() =>
                        setSelectedId((value) => (value === pin.id ? null : pin.id))
                      }
                      style={[
                        styles.pin,
                        {
                          left: point.x - 24,
                          top: point.y - 24,
                          borderRadius: 24,
                          borderColor: isSelected ? colors.focusRing : colors.controlBorder,
                          backgroundColor: isMine ? colors.surface : colors.accent,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.initial,
                          { color: isMine ? colors.ink : colors.onAccent },
                        ]}
                      >
                        {(pin.name.trim()[0] ?? '?').toUpperCase()}
                      </Text>
                      <View
                        pointerEvents="none"
                        style={[
                          styles.pinBadge,
                          {
                            backgroundColor: colors.surfaceElevated,
                            borderColor: colors.controlBorder,
                          },
                        ]}
                      >
                        <ModeBadgeIcon
                          mode={pin.record.mode}
                          color={colors.ink}
                          accentColor={colors.success}
                          size={10}
                        />
                      </View>
                    </AppPressable>
                  </React.Fragment>
                );
              })}

              {/* Right-edge floating icon control dock */}
              <View pointerEvents="box-none" style={styles.canvasRightDock}>
                {iconButton(
                  <ZoomPlusIcon color={colors.ink} size={16} />,
                  'Zoom in map',
                  () => zoomBy(1),
                  { disabled: zoom === MAX_ZOOM },
                )}
                {iconButton(
                  <ZoomMinusIcon color={colors.ink} size={16} />,
                  'Zoom out map',
                  () => zoomBy(-1),
                  { disabled: zoom === MIN_ZOOM },
                )}
                {iconButton(
                  <CrosshairIcon color={colors.ink} size={18} />,
                  'Center map on shared pins',
                  center,
                )}
                {iconButton(
                  <PanMoveIcon
                    color={panEnabled ? colors.onAccent : colors.ink}
                    size={18}
                  />,
                  'Move map',
                  () => setPanEnabled((value) => !value),
                  { selected: panEnabled, toggle: true },
                )}
              </View>
            </View>
          </View>

          {/* Compact icon-tagged telemetry footer + avatar focus chips */}
          <View style={styles.footerRow}>
            <View style={styles.pinSwitchGroup}>
              {pins.map((pin) => {
                const isSelected = selectedId === pin.id;
                const isMine = pin.id === 'mine';
                return (
                  <AppPressable
                    key={pin.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Focus ${pin.name} pin`}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      setSelectedId(pin.id);
                      setFocusId(pin.id);
                      setPan({ x: 0, y: 0 });
                    }}
                    style={[
                      styles.avatarChip,
                      {
                        borderColor: isSelected ? colors.focusRing : colors.controlBorder,
                        borderRadius: radii.pill,
                        backgroundColor: isSelected ? colors.accent : colors.surfaceElevated,
                      },
                    ]}
                  >
                    <ModeBadgeIcon
                      mode={pin.record.mode}
                      color={isSelected ? colors.onAccent : colors.ink}
                      accentColor={isSelected ? colors.onAccent : colors.success}
                      size={13}
                    />
                    <Text
                      style={[
                        styles.chipLabel,
                        { color: isSelected ? colors.onAccent : colors.ink },
                      ]}
                    >
                      {isMine ? 'You' : pin.name}
                    </Text>
                  </AppPressable>
                );
              })}

              {partner && !hasCoordinates(partner) ? (
                <AppPressable
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${partnerName} location details`}
                  accessibilityState={{ selected: selectedId === 'partner' }}
                  onPress={() =>
                    setSelectedId((value) => (value === 'partner' ? null : 'partner'))
                  }
                  style={[
                    styles.avatarChip,
                    {
                      borderColor:
                        selectedId === 'partner' ? colors.focusRing : colors.controlBorder,
                      borderRadius: radii.pill,
                      backgroundColor:
                        selectedId === 'partner' ? colors.accent : colors.surfaceElevated,
                    },
                  ]}
                >
                  <ModeBadgeIcon
                    mode={partner.mode}
                    color={selectedId === 'partner' ? colors.onAccent : colors.inkMuted}
                    size={13}
                  />
                  <Text
                    style={[
                      styles.chipLabel,
                      {
                        color: selectedId === 'partner' ? colors.onAccent : colors.inkMuted,
                      },
                    ]}
                  >
                    {partnerName}
                  </Text>
                </AppPressable>
              ) : null}
            </View>

            <View style={styles.metaStrip}>
              {distance ? (
                <View style={styles.metaBadge}>
                  <CoupleLinkIcon color={colors.inkMuted} size={14} />
                  <Text style={[styles.metaText, { color: colors.ink }]}>{distance}</Text>
                </View>
              ) : null}
              <Text style={[styles.metaText, { color: colors.inkMuted }]}>
                {scaleMeters}m · z{zoom} · © OSM · CARTO
              </Text>
            </View>
          </View>

          {tilesLoading ? (
            <Text accessibilityLiveRegion="polite" style={[styles.metaText, { color: colors.inkMuted }]}>
              Loading street tiles…
            </Text>
          ) : null}
          {tileError ? (
            <View style={styles.error}>
              <Text style={[styles.body, { color: colors.ink }]}>
                Street tiles unavailable. Switch to Radar icon or retry.
              </Text>
              <KeepItButton
                label="Retry street tiles"
                variant="secondary"
                onPress={() => {
                  setFailedTiles([]);
                  setLoadedTiles([]);
                  setTileAttempt((value) => value + 1);
                }}
              />
            </View>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="No active pins on map"
          message="Tap a mode or check-in icon below to place a pin."
        />
      )}

      {selected ? (
        <View
          style={[
            styles.details,
            {
              backgroundColor: colors.surfaceElevated,
              borderRadius: radii.input,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.detailsHeader}>
            <View style={styles.detailsIdentity}>
              <ModeBadgeIcon
                mode={selected.record?.mode ?? 'ghost'}
                color={colors.ink}
                accentColor={colors.success}
                size={18}
              />
              <View style={styles.detailsCopy}>
                <Text style={[styles.body, { color: colors.ink, fontWeight: '700' }]}>
                  {selected.name} · {selected.role}
                </Text>
                <Text style={[styles.secondary, { color: colors.inkMuted }]}>
                  {!selected.record
                    ? 'Unavailable'
                    : selected.record.mode === 'ghost'
                      ? 'Ghost · Hidden'
                      : !hasCoordinates(selected.record)
                        ? selected.record.mode === 'on_moment'
                          ? 'On Moment · Waiting for photo pin'
                          : 'No coordinates'
                        : selected.record.place_name ?? 'Shared pin'}
                  {selected.record?.location_updated_at
                    ? ` · ${formatRelativeTimeAgo(selected.record.location_updated_at)}`
                    : ''}
                  {selected.record?.accuracy_m != null && hasCoordinates(selected.record)
                    ? ` · ±${Math.round(selected.record.accuracy_m)}m`
                    : ''}
                </Text>
              </View>
            </View>
            <AppPressable
              accessibilityRole="button"
              accessibilityLabel="Close pin details"
              onPress={() => setSelectedId(null)}
              style={[
                styles.closeBtn,
                {
                  borderColor: colors.controlBorder,
                  borderRadius: radii.input,
                  backgroundColor: colors.surface,
                },
              ]}
            >
              <CloseCrossIcon color={colors.ink} size={14} />
            </AppPressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 12, gap: 10 },
  hudBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 4,
  },
  hudGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  hudDistance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
  },
  canvasRightDock: {
    position: 'absolute',
    right: 10,
    top: 10,
    gap: 6,
  },
  dpadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  badgeText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  canvas: {
    height: HEIGHT,
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
  },
  pin: {
    position: 'absolute',
    height: 48,
    width: 48,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontSize: 18, fontWeight: '700' },
  footerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pinSwitchGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  avatarChip: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  metaStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  body: { fontSize: 14, lineHeight: 20 },
  secondary: { fontSize: 12, lineHeight: 18 },
  error: { gap: 8 },
  details: {
    padding: 12,
    borderWidth: 1,
  },
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  detailsIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailsCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  closeBtn: {
    minWidth: 44,
    minHeight: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
