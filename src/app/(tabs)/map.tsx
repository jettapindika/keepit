import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { computeDistanceMeters, fetchCoupleLocations, formatDistanceApart, formatLocationModeLabel, formatRelativeTimeAgo, updateMyLocationShare } from '@/api/locations';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { InteractiveCoupleMap } from '@/components/map/InteractiveCoupleMap';
import { InlineNotice, KeepItButton, SkeletonBlock } from '@/components/ui/Primitives';
import { AppPressable, EmptyState, PageHeader, SectionHeader } from '@/components/ui/ScreenKit';
import { useSessionStore } from '@/store/sessionStore';
import { APP_LAYOUT, useKeepItTheme } from '@/theme/tokens';
import { LocationMode, LocationShareRecord } from '@/types/database';

const MODE_OPTIONS: { mode: LocationMode; label: string; description: string }[] = [
  { mode: 'live', label: 'Live', description: 'Share a location pin. Use GPS check-in to refresh your device location.' },
  { mode: 'on_moment', label: 'On Moment', description: 'Share a location with your Moments. Waits for a located Moment if no pin is available.' },
  { mode: 'ghost', label: 'Ghost', description: 'Pause sharing and hide your coordinates.' },
];
interface QuickCheckInOption { id: string; label: string; placeName: string; lat: number | null; lng: number | null; useGps?: boolean }
const QUICK_CHECKIN_PLACES: QuickCheckInOption[] = [
  { id: 'blue_bottle', label: 'Blue Bottle Coffee', placeName: 'Blue Bottle Coffee · Hayes Valley', lat: 37.7763, lng: -122.4232 },
  { id: 'dolores_park', label: 'Dolores Park', placeName: 'Dolores Park Overlook', lat: 37.7596, lng: -122.4269 },
  { id: 'use_gps', label: 'Use GPS', placeName: 'GPS check-in', lat: null, lng: null, useGps: true },
];

function hasCoordinates(record: LocationShareRecord | null): record is LocationShareRecord & { lat: number; lng: number } {
  return Boolean(record && record.mode !== 'ghost' && record.lat != null && record.lng != null);
}

export default function MapScreen() {
  const queryClient = useQueryClient();
  const { colors, radii } = useKeepItTheme();
  const user = useSessionStore((state) => state.user);
  const partner = useSessionStore((state) => state.partner);
  const couple = useSessionStore((state) => state.couple);
  const paired = Boolean(partner && couple && !couple.id.startsWith('solo_'));
  const partnerName = partner?.display_name ?? 'Partner';
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const mounted = useRef(true);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [gpsPrimed, setGpsPrimed] = useState(false);
  const [gpsAvailability, setGpsAvailability] = useState<'unknown' | 'granted' | 'denied' | 'unavailable'>('unknown');
  const [pendingGpsAction, setPendingGpsAction] = useState<'live_mode' | 'checkin_gps' | null>(null);
  const [pendingPlace, setPendingPlace] = useState<QuickCheckInOption | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' | 'success' } | null>(null);
  const locationQuery = useQuery({
    queryKey: ['couple-locations', couple?.id, user?.id],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () => fetchCoupleLocations({ coupleId: couple!.id, userId: user!.id }),
    refetchInterval: 30_000,
  });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const client = supabase;
    if (!couple?.id || !isSupabaseConfigured || !client) return;
    const channel = client.channel(`locations:${couple.id}:${Date.now().toString(36)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'location_shares', filter: `couple_id=eq.${couple.id}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['couple-locations', couple.id] });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'couple_events', filter: `couple_id=eq.${couple.id}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['couple-locations', couple.id] });
      }).subscribe();
    return () => { void client.removeChannel(channel).catch(() => {}); };
  }, [couple?.id, queryClient]);

  const bundle = locationQuery.data;
  const mine = bundle?.mine ?? null;
  const partnerShare = paired ? bundle?.partner ?? null : null;
  const friends = bundle?.friends ?? [];
  const events = bundle?.events ?? [];
  const currentMode = mine?.mode ?? 'ghost';
  const canChange = Boolean(couple && user && bundle) && !busy;
  const distance = hasCoordinates(mine) && hasCoordinates(partnerShare)
    ? formatDistanceApart(computeDistanceMeters(mine.lat, mine.lng, partnerShare.lat, partnerShare.lng)) : null;
  const activePins = (hasCoordinates(partnerShare) ? 1 : 0) + friends.filter(hasCoordinates).length;

  const requestGps = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (mounted.current) setGpsPrimed(true);
    if (permission.status !== 'granted') {
      if (mounted.current) setGpsAvailability('denied');
      throw new Error('Location permission is off. Allow location in your device or browser settings, then try Use GPS again. Sharing mode has not changed.');
    }
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (mounted.current) setGpsAvailability('granted');
      return { lat: position.coords.latitude, lng: position.coords.longitude, accuracyM: position.coords.accuracy };
    } catch {
      if (mounted.current) setGpsAvailability('unavailable');
      throw new Error('Your device could not get a location. Check location services and try Use GPS again, or select a named place. Sharing mode has not changed.');
    }
  };
  const changeSharing = async (mode: LocationMode, place?: QuickCheckInOption, skipPrimer = false) => {
    if (!couple || !user || saving.current || !bundle) return;
    const needsGps = Boolean(place?.useGps || (mode === 'live' && !hasCoordinates(mine) && !place));
    if (needsGps && !gpsPrimed && !skipPrimer) {
      setPendingPlace(null);
      setPendingGpsAction(place ? 'checkin_gps' : 'live_mode');
      scroll.current?.scrollTo({ y: 0, animated: false });
      return;
    }
    saving.current = true;
    setBusy(true);
    setNotice(null);
    setPendingPlace(null);
    setPendingGpsAction(null);
    try {
      let lat = mode === 'ghost' ? null : place ? place.lat : mine?.lat ?? null;
      let lng = mode === 'ghost' ? null : place ? place.lng : mine?.lng ?? null;
      let accuracyM = mode === 'ghost' ? null : place ? null : mine?.accuracy_m ?? null;
      let placeName = mode === 'ghost' ? null : place?.placeName ?? mine?.place_name ?? null;
      if (needsGps) {
        const gps = await requestGps();
        lat = gps.lat;
        lng = gps.lng;
        accuracyM = gps.accuracyM;
        placeName = `GPS check-in (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      }
      const updated = await updateMyLocationShare({ coupleId: couple.id, userId: user.id, mode, lat, lng, accuracyM, placeName });
      queryClient.setQueryData(['couple-locations', couple.id, user.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['couple-locations', couple.id] });
      if (mounted.current) setNotice({ text: place ? `Check-in shared at ${placeName}.` : `Location sharing set to ${formatLocationModeLabel(mode)}.`, tone: 'success' });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (error) {
      if (mounted.current) setNotice({ text: error instanceof Error ? error.message : 'Could not update sharing. Try your selection again.', tone: 'error' });
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const people = [
    ...(paired ? [{ id: partner?.id ?? 'partner', name: partnerName, role: 'Partner', record: partnerShare }] : []),
    ...friends.map((record) => ({ id: record.user_id, name: record.display_name ?? 'Friend', role: 'Friend', record })),
  ];
  const surface = { backgroundColor: colors.surface, borderRadius: radii.card };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <PageHeader title="Map" subtitle="Shared places. Your choice of privacy." />
        {notice ? <InlineNotice message={notice.text} tone={notice.tone} /> : null}
        {pendingGpsAction ? (
          <View style={[styles.group, surface]}>
            <SectionHeader title="Use your device location?" />
            <Text style={[styles.body, { color: colors.inkMuted }]}>KeepIt requests foreground location for this GPS check-in. This screen does not track you in the background. The pin remains shared until you change it or pause with Ghost mode.</Text>
            <KeepItButton label="Continue to location permission" disabled={busy} onPress={() => { const action = pendingGpsAction; void changeSharing('live', action === 'checkin_gps' ? QUICK_CHECKIN_PLACES.find((place) => place.useGps) : undefined, true); }} />
            <KeepItButton label="Not now" variant="secondary" onPress={() => setPendingGpsAction(null)} />
          </View>
        ) : null}
        {locationQuery.isError ? (
          <View style={styles.stack}>
            <InlineNotice message={locationQuery.error instanceof Error ? locationQuery.error.message : 'Shared locations could not load.'} />
            <KeepItButton label="Retry shared locations" variant="secondary" loading={locationQuery.isFetching} onPress={() => void locationQuery.refetch()} />
          </View>
        ) : null}
        {locationQuery.isLoading && !bundle ? <SkeletonBlock height={340} label="Loading shared locations…" /> : null}
        {!couple || !user ? <EmptyState title="Map is not ready" message="Your account session is not available. Return to Home to continue." actionLabel="Open Home" onAction={() => router.navigate('/(tabs)' as never)} /> : null}
        {bundle ? (
          <>
            <View style={[styles.group, surface]}>
              <Text style={[styles.sectionTitle, { color: colors.ink }]}>{currentMode === 'ghost' ? 'Sharing paused · Ghost' : hasCoordinates(mine) ? `Sharing ${mine.place_name ?? 'a location pin'}` : currentMode === 'on_moment' ? 'Waiting for a located Moment' : 'No coordinates shared yet'}</Text>
              <Text style={[styles.body, { color: colors.inkMuted }]}>{currentMode === 'ghost' ? 'Your coordinates are hidden.' : !hasCoordinates(mine) ? 'Your selected mode is on, but there is no location pin to show yet.' : paired ? `Shared with ${partnerName} and eligible circle friends.` : 'Shared with eligible circle friends.'}</Text>
              <Text style={[styles.secondary, { color: colors.inkMuted }]}>Mode: {formatLocationModeLabel(currentMode)}{mine?.location_updated_at ? ` · Updated ${formatRelativeTimeAgo(mine.location_updated_at)}` : ''}</Text>
              {busy ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.ink }]}>Updating location sharing…</Text> : null}
              <KeepItButton label={currentMode === 'ghost' ? 'Enable On Moment sharing' : 'Pause sharing · Ghost'} variant={currentMode === 'ghost' ? 'primary' : 'secondary'} disabled={!canChange} onPress={() => void changeSharing(currentMode === 'ghost' ? 'on_moment' : 'ghost', undefined, true)} />
            </View>
            <InteractiveCoupleMap mine={mine} partner={partnerShare} friends={friends} myName={user?.display_name ?? 'You'} partnerName={partnerName} />
            <View style={[styles.group, surface]}>
              <SectionHeader title="Your location privacy" subtitle="Choose how you share. GPS permission and sharing mode are separate." />
              <View accessibilityRole="radiogroup" accessibilityLabel="Location sharing mode" style={styles.stack}>
                {MODE_OPTIONS.map((option) => {
                  const selected = currentMode === option.mode;
                  return (
                    <AppPressable key={option.mode} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: !canChange, busy }} accessibilityLabel={`${option.label}. ${option.description}`} disabled={!canChange} onPress={() => void changeSharing(option.mode)} style={[styles.mode, { borderColor: selected ? colors.focusRing : colors.controlBorder, borderRadius: radii.input, backgroundColor: selected ? colors.surfaceElevated : colors.surface }]}>
                      <Text style={[styles.body, { color: colors.ink, fontWeight: '600' }]}>{selected ? '● ' : '○ '}{option.label}{selected ? ' · Selected' : ''}</Text>
                      <Text style={[styles.secondary, { color: colors.inkMuted }]}>{option.description}</Text>
                    </AppPressable>
                  );
                })}
              </View>
              <Text style={[styles.secondary, { color: colors.inkMuted }]}>{gpsAvailability === 'denied' ? 'GPS permission is off. You can still choose Ghost, On Moment, or a named preset.' : gpsAvailability === 'unavailable' ? 'GPS is currently unavailable. Try Use GPS again when location services are available.' : gpsAvailability === 'granted' ? 'GPS was available for your last request. Use GPS to refresh the pin.' : 'GPS is requested only when you choose to use it.'}</Text>
            </View>
            <View style={[styles.group, surface]}>
              <SectionHeader title="Suggested San Francisco places" subtitle="Check in at one of these fixed places, or use GPS for your current position. Suggestions are not detected locations." />
              <View style={styles.wrap}>
                {QUICK_CHECKIN_PLACES.map((place) => (
                  <AppPressable key={place.id} accessibilityRole="button" accessibilityState={{ disabled: !canChange }} disabled={!canChange} onPress={() => { if (place.useGps) { void changeSharing('live', place); } else { setPendingPlace(place); setPendingGpsAction(null); } }} style={[styles.checkin, { borderColor: colors.controlBorder, borderRadius: radii.input, backgroundColor: place.useGps ? colors.accent : colors.surfaceElevated }]}>
                    <Text style={[styles.body, { color: place.useGps ? colors.onAccent : colors.ink, fontWeight: '600' }]}>{place.label}</Text>
                  </AppPressable>
                ))}
              </View>
              {pendingPlace ? (
                <View style={[styles.confirm, { backgroundColor: colors.surfaceElevated, borderRadius: radii.input }]}>
                  <Text style={[styles.body, { color: colors.ink }]}>Share a check-in at {pendingPlace.placeName} ({pendingPlace.lat?.toFixed(4)}, {pendingPlace.lng?.toFixed(4)})? This selects the place coordinates, not your GPS position, and sets sharing to Live.</Text>
                  <KeepItButton label="Share this place" disabled={!canChange} onPress={() => { if (pendingPlace) void changeSharing('live', pendingPlace, true); }} />
                  <KeepItButton label="Cancel check-in" variant="secondary" onPress={() => setPendingPlace(null)} />
                </View>
              ) : null}
            </View>
            <View style={[styles.group, surface]}>
              <SectionHeader title="Your circle" subtitle={`${activePins} visible ${activePins === 1 ? 'pin' : 'pins'}${distance ? ` · ${distance} from ${partnerName}` : ''}`} />
              {people.length ? people.map((person) => {
                const record = person.record;
                const coordinates = hasCoordinates(record);
                const apart = coordinates && hasCoordinates(mine) ? formatDistanceApart(computeDistanceMeters(mine.lat, mine.lng, record.lat, record.lng)) : null;
                return (
                  <View key={person.id} style={[styles.person, { backgroundColor: colors.surfaceElevated, borderRadius: radii.input }]}>
                    <View style={styles.personHeading}>
                      <View style={[styles.avatar, { backgroundColor: colors.accent }]}><Text style={[styles.sectionTitle, { color: colors.onAccent }]}>{(person.name.trim()[0] ?? '?').toUpperCase()}</Text></View>
                      <View style={styles.personCopy}><Text style={[styles.body, { color: colors.ink, fontWeight: '600' }]}>{person.name}</Text><Text style={[styles.secondary, { color: colors.inkMuted }]}>{person.role}</Text></View>
                    </View>
                    <Text style={[styles.body, { color: colors.ink }]}>{!record ? 'No sharing information available' : record.mode === 'ghost' ? 'Ghost mode · Location hidden' : !coordinates ? record.mode === 'on_moment' ? 'Waiting for a located Moment' : 'No coordinates shared yet' : record.place_name ?? 'Shared coordinates'}</Text>
                    <Text style={[styles.secondary, { color: colors.inkMuted }]}>{apart ? `${apart} away · ` : ''}{record?.location_updated_at && coordinates ? `Updated ${formatRelativeTimeAgo(record.location_updated_at)}` : record ? formatLocationModeLabel(record.mode) : 'Location unavailable'}</Text>
                    <KeepItButton label={`Message ${person.name}`} variant="secondary" onPress={() => router.navigate({ pathname: '/(tabs)/messages', params: { peerId: person.id, peerName: person.name } })} />
                  </View>
                );
              }) : <EmptyState title="Your circle is quiet" message="Pair with someone or add friends from your profile to see shared pins here." actionLabel="Open profile" onAction={() => router.navigate('/(tabs)/profile' as never)} />}
            </View>
            <View style={[styles.group, surface]}>
              <SectionHeader title="Sharing history" subtitle="Recent mode changes and check-ins. This is not a delivery receipt." />
              {events.length ? events.slice(0, 5).map((event) => (
                <View key={event.id} style={styles.event}>
                  <Text style={[styles.body, { color: colors.ink }]}>{event.actor_id === user?.id ? 'You' : event.actor_id === partner?.id ? partnerName : friends.find((friend) => friend.user_id === event.actor_id)?.display_name ?? 'Circle member'} · {event.payload.note ?? `${formatLocationModeLabel(event.payload.previous_mode ?? 'ghost')} to ${formatLocationModeLabel(event.payload.new_mode ?? 'ghost')}`}</Text>
                  <Text style={[styles.secondary, { color: colors.inkMuted }]}>{formatRelativeTimeAgo(event.created_at)}</Text>
                </View>
              )) : <Text style={[styles.body, { color: colors.inkMuted }]}>No sharing changes yet. Check-ins and mode changes will appear here.</Text>}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, maxWidth: APP_LAYOUT.maxContentWidth, width: '100%', alignSelf: 'center', paddingHorizontal: APP_LAYOUT.pageInset, paddingTop: 20, paddingBottom: APP_LAYOUT.tabBarClearance, gap: 20 },
  group: { padding: APP_LAYOUT.cardPadding, gap: 16 },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
  secondary: { fontSize: 13, lineHeight: 20 },
  stack: { gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mode: { minHeight: 44, padding: 14, borderWidth: 1, gap: 4 },
  checkin: { minHeight: 44, maxWidth: '100%', paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, justifyContent: 'center' },
  confirm: { padding: 16, gap: 12 },
  person: { padding: 16, gap: 10 },
  personHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  personCopy: { flex: 1, minWidth: 0 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  event: { paddingVertical: 8, gap: 4 },
});
