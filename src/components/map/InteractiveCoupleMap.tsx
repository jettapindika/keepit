import { Image } from 'expo-image';
import React, { useRef, useState } from 'react';
import { GestureResponderEvent, StyleSheet, Text, View } from 'react-native';

import { computeDistanceMeters, formatDistanceApart, formatLocationModeLabel, formatRelativeTimeAgo } from '@/api/locations';
import { AppPressable, EmptyState } from '@/components/ui/ScreenKit';
import { KeepItButton } from '@/components/ui/Primitives';
import { useKeepItTheme } from '@/theme/tokens';
import { LocationShareRecord } from '@/types/database';

export interface InteractiveCoupleMapProps {
  mine: LocationShareRecord | null;
  partner: LocationShareRecord | null;
  friends?: LocationShareRecord[];
  myName: string;
  partnerName: string;
}

type Pin = { id: string; name: string; role: string; record: LocationShareRecord };
const HEIGHT = 340;
const TILE_SIZE = 256;
const MIN_ZOOM = 12;
const MAX_ZOOM = 16;
const DEFAULT_ZOOM = 14;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hasCoordinates(record: LocationShareRecord | null): record is LocationShareRecord & { lat: number; lng: number } {
  return Boolean(record && record.mode !== 'ghost' && record.lat != null && record.lng != null);
}

function worldPoint(lat: number, lng: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const sinLat = Math.sin(clamp(lat, -85.0511, 85.0511) * Math.PI / 180);
  return {
    x: (lng + 180) / 360 * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

export function InteractiveCoupleMap({ mine, partner, friends = [], myName, partnerName }: InteractiveCoupleMapProps) {
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
  if (hasCoordinates(partner)) pins.push({ id: 'partner', name: partnerName, role: 'Partner', record: partner });
  const activeFriends = friends.filter(hasCoordinates);
  if (showFriends) activeFriends.forEach((record) => pins.push({ id: record.user_id, name: record.display_name ?? 'Friend', role: 'Friend', record }));
  const focus = pins.find((pin) => pin.id === focusId);
  const anchorPins = focus ? [focus] : pins.filter((pin) => pin.id === 'mine' || pin.id === 'partner');
  const anchors = anchorPins.length ? anchorPins : pins.slice(0, 1);
  const anchor = anchors.length ? {
    lat: anchors.reduce((sum, pin) => sum + pin.record.lat!, 0) / anchors.length,
    lng: anchors.reduce((sum, pin) => sum + pin.record.lng!, 0) / anchors.length,
  } : null;
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
    for (let tx = Math.floor(worldLeft / TILE_SIZE); tx <= Math.floor((worldLeft + width) / TILE_SIZE); tx += 1) {
      const wrappedTx = ((tx % numTilesAxis) + numTilesAxis) % numTilesAxis;
      for (let ty = clamp(Math.floor(worldTop / TILE_SIZE), 0, numTilesAxis - 1); ty <= clamp(Math.floor((worldTop + HEIGHT) / TILE_SIZE), 0, numTilesAxis - 1); ty += 1) {
        const sub = subdomains[Math.abs(wrappedTx + ty) % subdomains.length];
        const tileUrl = `https://${sub}.basemaps.cartocdn.com/${cartoTheme}/${zoom}/${wrappedTx}/${ty}@2x.png`;
        tiles.push({ key: `${cartoTheme}_${zoom}_${tx}_${ty}_${tileAttempt}`, url: tileUrl, left: Math.round(tx * TILE_SIZE - worldLeft), top: Math.round(ty * TILE_SIZE - worldTop) });
      }
    }
  }
  const tileError = tiles.some((tile) => failedTiles.includes(tile.key));
  const tilesLoading = tiles.length > 0 && tiles.some((tile) => !loadedTiles.includes(tile.key) && !failedTiles.includes(tile.key));
  const distance = hasCoordinates(mine) && hasCoordinates(partner)
    ? formatDistanceApart(computeDistanceMeters(mine.lat, mine.lng, partner.lat, partner.lng)) : null;
  const metersPerPixel = anchor ? 156543.03392 * Math.cos(anchor.lat * Math.PI / 180) / 2 ** zoom : null;
  const scaleMeters = metersPerPixel ? Math.max(25, Math.round(metersPerPixel * 60 / 10) * 10) : null;
  const connector = hasCoordinates(mine) && hasCoordinates(partner)
    ? { mine: project(mine), partner: project(partner) }
    : null;
  const connectorLength = connector ? Math.hypot(connector.partner.x - connector.mine.x, connector.partner.y - connector.mine.y) : 0;
  const connectorAngle = connector ? Math.atan2(connector.partner.y - connector.mine.y, connector.partner.x - connector.mine.x) * 180 / Math.PI : 0;
  const selected = selectedId === 'partner'
    ? { name: partnerName, role: 'Partner', record: partner }
    : selectedId === 'mine'
      ? { name: myName, role: 'You', record: mine }
      : pins.find((pin) => pin.id === selectedId);

  const control = (label: string, onPress: () => void, options: { selected?: boolean; disabled?: boolean; label?: string; toggle?: boolean } = {}) => (
    <AppPressable
      accessibilityRole={options.toggle ? 'checkbox' : 'button'}
      accessibilityLabel={options.label ?? label}
      accessibilityState={options.toggle ? { checked: options.selected, disabled: options.disabled } : { selected: options.selected, disabled: options.disabled }}
      disabled={options.disabled}
      onPress={onPress}
      style={[styles.control, { borderColor: colors.controlBorder, borderRadius: radii.input, backgroundColor: options.selected ? colors.accent : colors.surfaceElevated }]}
    >
      <Text style={[styles.controlText, { color: options.selected ? colors.onAccent : colors.ink }]}>{options.toggle ? `${options.selected ? '✓ ' : ''}${label}` : options.selected ? `✓ ${label}` : label}</Text>
    </AppPressable>
  );
  const center = () => { setFocusId(null); setPan({ x: 0, y: 0 }); setZoom(DEFAULT_ZOOM); };
  const zoomBy = (delta: number) => {
    const next = clamp(zoom + delta, MIN_ZOOM, MAX_ZOOM);
    if (next === zoom) return;
    const factor = 2 ** (next - zoom);
    setZoom(next);
    setPan((value) => ({ x: value.x * factor, y: value.y * factor }));
  };
  const handleStart = (event: GestureResponderEvent) => {
    touchStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, baseX: pan.x, baseY: pan.y };
  };
  const handleMove = (event: GestureResponderEvent) => {
    setPan({ x: clamp(touchStart.current.baseX + event.nativeEvent.pageX - touchStart.current.x, -900, 900), y: clamp(touchStart.current.baseY + event.nativeEvent.pageY - touchStart.current.y, -900, 900) });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderRadius: radii.card }]}>
      <View style={styles.toolbar}>
        {control('Street', () => setMapStyle('street'), { selected: mapStyle === 'street', label: 'Street map view' })}
        {control('Radar', () => setMapStyle('radar'), { selected: mapStyle === 'radar', label: 'Radar map view' })}
        {control(`Friends (${activeFriends.length})`, () => setShowFriends((value) => !value), { selected: showFriends, toggle: true, label: 'Show friend pins' })}
      </View>
      {anchor ? (
        <>
          <View onLayout={(event) => setWidth(Math.max(1, Math.round(event.nativeEvent.layout.width)))} style={[styles.canvas, { backgroundColor: colors.surfaceElevated, borderRadius: radii.photo }]}>
            <View
              style={StyleSheet.absoluteFill}
              onTouchStart={handleStart}
              onStartShouldSetResponder={() => panEnabled}
              onMoveShouldSetResponder={() => panEnabled}
              onResponderMove={handleMove}
              onResponderTerminationRequest={() => true}
              accessibilityLabel={panEnabled ? 'Map panning enabled. Drag to move the map.' : 'Map preview. Enable move map or use direction controls to pan.'}
            >
              {mapStyle === 'street' ? tiles.map((tile) => (
                <Image
                  key={tile.key}
                  source={{ uri: tile.url }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  onLoad={() => setLoadedTiles((current) => current.includes(tile.key) ? current : [...current.slice(-80), tile.key])}
                  onError={() => setFailedTiles((current) => current.includes(tile.key) ? current : [...current.slice(-80), tile.key])}
                  style={{ position: 'absolute', left: tile.left, top: tile.top, width: TILE_SIZE + 0.5, height: TILE_SIZE + 0.5 }}
                />
              )) : [52, 106, 160].map((radius) => (
                <View key={radius} pointerEvents="none" style={{ position: 'absolute', width: radius * 2, height: radius * 2, borderRadius: radius, borderWidth: 1, borderColor: colors.controlBorder, left: width / 2 - radius, top: HEIGHT / 2 - radius }} />
              ))}
            </View>
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              {connector && connectorLength > 0 ? (
                <View pointerEvents="none" style={{
                  position: 'absolute',
                  left: (connector.mine.x + connector.partner.x) / 2 - connectorLength / 2,
                  top: (connector.mine.y + connector.partner.y) / 2,
                  width: connectorLength,
                  borderTopWidth: 2,
                  borderStyle: 'dashed',
                  borderColor: colors.controlBorder,
                  transform: [{ rotate: `${connectorAngle}deg` }],
                }} />
              ) : null}
              {pins.map((pin) => {
                const point = project(pin.record);
                if (point.x < 26 || point.x > width - 26 || point.y < 26 || point.y > HEIGHT - 26) return null;
                const isSelected = selectedId === pin.id;
                const haloDiameter = metersPerPixel && pin.record.accuracy_m != null
                  ? clamp(pin.record.accuracy_m / metersPerPixel * 2, 48, 96)
                  : null;
                return (
                  <React.Fragment key={pin.id}>
                    {haloDiameter ? <View pointerEvents="none" style={{ position: 'absolute', left: point.x - haloDiameter / 2, top: point.y - haloDiameter / 2, width: haloDiameter, height: haloDiameter, borderRadius: haloDiameter / 2, borderWidth: 1, borderColor: colors.controlBorder, backgroundColor: colors.accentSoft }} /> : null}
                    <AppPressable
                      accessibilityRole="button"
                      accessibilityLabel={`Inspect ${pin.name}, ${pin.role}, ${pin.record.place_name ?? 'shared location'}`}
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => setSelectedId((value) => value === pin.id ? null : pin.id)}
                      style={[styles.pin, { left: point.x - 24, top: point.y - 24, borderRadius: 24, borderColor: isSelected ? colors.focusRing : colors.controlBorder, backgroundColor: pin.id === 'mine' ? colors.surface : colors.accent }]}
                    >
                      <Text style={[styles.initial, { color: pin.id === 'mine' ? colors.ink : colors.onAccent }]}>{(pin.name.trim()[0] ?? '?').toUpperCase()}</Text>
                    </AppPressable>
                  </React.Fragment>
                );
              })}
            </View>
          </View>
          <View style={styles.mapFooter}>
            <Text style={[styles.secondary, { color: colors.inkMuted }]}>{distance ? `${distance} apart · ` : ''}{scaleMeters} m scale · z{zoom} · © OSM · CARTO</Text>
            {tilesLoading ? <Text accessibilityLiveRegion="polite" style={[styles.secondary, { color: colors.inkMuted }]}>Loading street tiles…</Text> : null}
            {tileError ? (
              <View style={styles.error}>
                <Text style={[styles.body, { color: colors.ink }]}>Some street tiles could not load. Shared pins are still shown; Radar does not need street tiles.</Text>
                <KeepItButton label="Retry street tiles" variant="secondary" onPress={() => { setFailedTiles([]); setLoadedTiles([]); setTileAttempt((value) => value + 1); }} />
              </View>
            ) : null}
          </View>
        </>
      ) : (
        <EmptyState title="No shared locations yet" message="Check in below to share a place. Ghost mode stays hidden; On Moment waits for a Moment with a location." />
      )}
      <View style={styles.toolbar}>
        {control('−', () => zoomBy(-1), { disabled: !anchor || zoom === MIN_ZOOM, label: 'Zoom out map' })}
        {control('+', () => zoomBy(1), { disabled: !anchor || zoom === MAX_ZOOM, label: 'Zoom in map' })}
        {control('Center', center, { disabled: !anchor, label: 'Center map on shared pins' })}
        {control('Partner', () => { setSelectedId('partner'); if (hasCoordinates(partner)) { setFocusId('partner'); setPan({ x: 0, y: 0 }); setZoom(15); } }, { disabled: !partner, label: `Show ${partnerName} location details` })}
        {control('Move map', () => setPanEnabled((value) => !value), { selected: panEnabled, disabled: !anchor, toggle: true })}
      </View>
      {panEnabled && anchor ? (
        <View style={styles.toolbar}>
          {control('↑', () => setPan((value) => ({ ...value, y: clamp(value.y + 80, -900, 900) })), { label: 'Pan map north' })}
          {control('←', () => setPan((value) => ({ ...value, x: clamp(value.x + 80, -900, 900) })), { label: 'Pan map west' })}
          {control('→', () => setPan((value) => ({ ...value, x: clamp(value.x - 80, -900, 900) })), { label: 'Pan map east' })}
          {control('↓', () => setPan((value) => ({ ...value, y: clamp(value.y - 80, -900, 900) })), { label: 'Pan map south' })}
        </View>
      ) : null}
      {pins.length ? (
        <View style={styles.toolbar}>
          {pins.map((pin) => <React.Fragment key={pin.id}>{control(pin.role === 'You' ? 'Your pin' : pin.name, () => { setSelectedId(pin.id); setFocusId(pin.id); setPan({ x: 0, y: 0 }); }, { selected: selectedId === pin.id, label: `Focus ${pin.name} pin` })}</React.Fragment>)}
        </View>
      ) : null}
      {partner?.mode === 'ghost' ? <Text style={[styles.body, { color: colors.inkMuted }]}>{partnerName} is in Ghost mode. Their location is hidden.</Text> : null}
      {selected ? (
        <View style={[styles.details, { backgroundColor: colors.surfaceElevated, borderRadius: radii.input }]}>
          <Text style={[styles.body, { color: colors.ink, fontWeight: '600' }]}>{selected.name} · {selected.role}</Text>
          <Text style={[styles.body, { color: colors.ink }]}>{!selected.record ? 'Location not available' : selected.record.mode === 'ghost' ? 'Ghost mode · Location hidden' : !hasCoordinates(selected.record) ? selected.record.mode === 'on_moment' ? 'Waiting for a Moment with a location' : 'No coordinates shared yet' : selected.record.place_name ?? 'Shared coordinates'}</Text>
          {selected.record ? <Text style={[styles.secondary, { color: colors.inkMuted }]}>{formatLocationModeLabel(selected.record.mode)} · {selected.record.location_updated_at ? `Updated ${formatRelativeTimeAgo(selected.record.location_updated_at)}` : 'No location update yet'}{selected.record.accuracy_m != null && hasCoordinates(selected.record) ? ` · Accuracy about ${Math.round(selected.record.accuracy_m)} m` : ''}</Text> : null}
          <KeepItButton label="Close pin details" variant="secondary" onPress={() => setSelectedId(null)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 12, gap: 12 },
  canvas: { height: HEIGHT, width: '100%', overflow: 'hidden', position: 'relative' },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  control: { minHeight: 44, minWidth: 44, maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  controlText: { fontSize: 15, lineHeight: 22, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  pin: { position: 'absolute', height: 48, width: 48, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
  secondary: { fontSize: 13, lineHeight: 20 },
  mapFooter: { gap: 8 },
  error: { gap: 10 },
  details: { padding: 16, gap: 10 },
});
