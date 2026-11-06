import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  computeDistanceMeters,
  FALLBACK_LIVE_COORDS,
  fetchCoupleLocations,
  formatDistanceApart,
  formatLocationModeLabel,
  formatRelativeTimeAgo,
  updateMyLocationShare,
} from '@/api/locations';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { InteractiveCoupleMap } from '@/components/map/InteractiveCoupleMap';
import { InlineNotice, RevealOnAppear } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';
import { LocationMode } from '@/types/database';

const MODE_OPTIONS: readonly {
  mode: LocationMode;
  label: string;
}[] = [
  { mode: 'live', label: 'Live' },
  { mode: 'on_moment', label: 'On Moment' },
  { mode: 'ghost', label: 'Ghost' },
] as const;

interface QuickCheckInOption {
  id: string;
  label: string;
  placeName: string;
  lat: number | null;
  lng: number | null;
  useGps?: boolean;
}

const QUICK_CHECKIN_PLACES: readonly QuickCheckInOption[] = [
  {
    id: 'blue_bottle',
    label: 'Blue Bottle Coffee',
    placeName: 'Blue Bottle Coffee · Hayes Valley',
    lat: 37.7763,
    lng: -122.4232,
  },
  {
    id: 'dolores_park',
    label: 'Dolores Park',
    placeName: 'Dolores Park Overlook',
    lat: 37.7596,
    lng: -122.4269,
  },
  {
    id: 'cozy_home',
    label: 'Cozy Home Studio',
    placeName: 'Cozy Home Studio · SF',
    lat: 37.7749,
    lng: -122.4194,
  },
  {
    id: 'campus_library',
    label: 'Campus Library',
    placeName: 'Campus Library 3F',
    lat: 37.7818,
    lng: -122.4112,
  },
  {
    id: 'use_gps',
    label: 'Use GPS',
    placeName: 'Live GPS Coordinates',
    lat: null,
    lng: null,
    useGps: true,
  },
] as const;

export default function MapScreen() {
  const queryClient = useQueryClient();
  const { colors, radii, spacing } = useKeepItTheme();

  const user = useSessionStore((s) => s.user);
  const partner = useSessionStore((s) => s.partner);
  const couple = useSessionStore((s) => s.couple);

  const [updatingMode, setUpdatingMode] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' | 'success' } | null>(
    null
  );

  const isPartnerPaired = Boolean(partner && couple && !couple.id.startsWith('solo_'));
  const partnerName = partner?.display_name ?? 'Partner';

  const locationQuery = useQuery({
    queryKey: ['couple-locations', couple?.id, user?.id],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () =>
      fetchCoupleLocations({
        coupleId: couple!.id,
        userId: user!.id,
      }),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const client = supabase;
    if (!couple?.id || !isSupabaseConfigured || !client) return;

    const channel = client
      .channel(`locations:${couple.id}:${Date.now().toString(36)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'location_shares',
          filter: `couple_id=eq.${couple.id}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['couple-locations', couple.id] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'couple_events',
          filter: `couple_id=eq.${couple.id}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['couple-locations', couple.id] });
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [couple?.id, queryClient]);

  const bundle = locationQuery.data;
  const mine = bundle?.mine ?? null;
  const partnerShare = bundle?.partner ?? null;
  const friends = bundle?.friends ?? [];
  const events = bundle?.events ?? [];
  const currentMode: LocationMode = mine?.mode ?? 'live';

  const bothHaveCoords = Boolean(
    mine &&
      partnerShare &&
      mine.mode !== 'ghost' &&
      partnerShare.mode !== 'ghost' &&
      mine.lat !== null &&
      mine.lng !== null &&
      partnerShare.lat !== null &&
      partnerShare.lng !== null
  );

  const distanceMeters = bothHaveCoords
    ? computeDistanceMeters(mine!.lat!, mine!.lng!, partnerShare!.lat!, partnerShare!.lng!)
    : null;

  const handleSelectMode = async (nextMode: LocationMode) => {
    if (!couple || !user || updatingMode) return;
    setUpdatingMode(true);
    setNotice(null);

    try {
      let lat: number | null = mine?.lat ?? null;
      let lng: number | null = mine?.lng ?? null;
      let accuracyM: number | null = mine?.accuracy_m ?? null;

      if (nextMode === 'live' && (lat === null || lng === null)) {
        try {
          const perm = await Location.requestForegroundPermissionsAsync();
          if (perm.status === 'granted') {
            const pos = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
            accuracyM = pos.coords.accuracy ?? 18;
          } else {
            lat = FALLBACK_LIVE_COORDS.lat;
            lng = FALLBACK_LIVE_COORDS.lng;
            accuracyM = FALLBACK_LIVE_COORDS.accuracyM;
          }
        } catch {
          lat = FALLBACK_LIVE_COORDS.lat;
          lng = FALLBACK_LIVE_COORDS.lng;
          accuracyM = FALLBACK_LIVE_COORDS.accuracyM;
        }
      }

      await updateMyLocationShare({
        coupleId: couple.id,
        userId: user.id,
        mode: nextMode,
        lat,
        lng,
        accuracyM,
        placeName: nextMode === 'ghost' ? null : (mine?.place_name ?? FALLBACK_LIVE_COORDS.placeName),
      });

      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setNotice({
        text: isPartnerPaired
          ? `${partnerName} was notified that you switched location sharing to ${formatLocationModeLabel(nextMode)}.`
          : `Switched location sharing to ${formatLocationModeLabel(nextMode)}.`,
        tone: 'success',
      });

      await queryClient.invalidateQueries({ queryKey: ['couple-locations', couple.id] });
    } catch (err) {
      setNotice({
        text: err instanceof Error ? err.message : 'Could not update location mode.',
        tone: 'error',
      });
    } finally {
      setUpdatingMode(false);
    }
  };

  const handleQuickCheckIn = async (option: QuickCheckInOption) => {
    if (!couple || !user || updatingMode) return;
    setUpdatingMode(true);
    setNotice(null);

    try {
      let lat = option.lat ?? FALLBACK_LIVE_COORDS.lat;
      let lng = option.lng ?? FALLBACK_LIVE_COORDS.lng;
      let accuracyM = 16;
      let resolvedPlaceName = option.placeName;

      if (option.useGps) {
        try {
          const perm = await Location.requestForegroundPermissionsAsync();
          if (perm.status === 'granted') {
            const pos = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
            accuracyM = Math.round(pos.coords.accuracy ?? 18);
            resolvedPlaceName = `Live GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
          }
        } catch {
          resolvedPlaceName = 'Live GPS · SF Downtown';
        }
      }

      await updateMyLocationShare({
        coupleId: couple.id,
        userId: user.id,
        mode: 'live',
        lat,
        lng,
        accuracyM,
        placeName: resolvedPlaceName,
      });

      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setNotice({
        text: isPartnerPaired
          ? `Checked in at ${resolvedPlaceName} · ${partnerName} & friends notified.`
          : `Checked in at ${resolvedPlaceName}.`,
        tone: 'success',
      });

      await queryClient.invalidateQueries({ queryKey: ['couple-locations', couple.id] });
    } catch (err) {
      setNotice({
        text: err instanceof Error ? err.message : 'Could not check in to location.',
        tone: 'error',
      });
    } finally {
      setUpdatingMode(false);
    }
  };

  const latestEvent = events[0] ?? null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.xl,
            paddingBottom: 124,
          },
        ]}>
        {/* Header */}
        <RevealOnAppear revealKey="map-header">
          <View style={styles.headerRow}>
            <View style={styles.flex}>
              <Text style={[styles.title, { color: colors.ink }]}>Map</Text>
              <Text style={[styles.subtitle, { color: colors.inkMuted }]}>
                {mine?.mode !== 'ghost' && mine?.place_name
                  ? `You: ${mine.place_name}`
                  : 'Real-time couple & friends radar'}
              </Text>
            </View>
            <View
              style={[
                styles.modeBadge,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                  borderRadius: radii.pill,
                },
              ]}>
              <Text style={[styles.modeBadgeText, { color: colors.ink }]}>
                You · {formatLocationModeLabel(currentMode)}
              </Text>
            </View>
          </View>
        </RevealOnAppear>

        {/* Latest Notification Banner */}
        {notice ? (
          <InlineNotice message={notice.text} tone={notice.tone} />
        ) : latestEvent ? (
          <View
            style={[
              styles.alertStrip,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.card,
              },
            ]}>
            <Text style={[styles.alertStripText, { color: colors.ink }]}>
              {latestEvent.payload.note
                ? `${latestEvent.actor_id === user?.id ? 'You' : partnerName}: ${latestEvent.payload.note} · ${formatRelativeTimeAgo(latestEvent.created_at)}`
                : `${latestEvent.actor_id === user?.id ? 'You' : partnerName} switched location sharing to ${formatLocationModeLabel(latestEvent.payload.new_mode ?? 'live')} · ${formatRelativeTimeAgo(latestEvent.created_at)}`}
            </Text>
          </View>
        ) : null}

        {/* Interactive Couple & Friends Map Canvas */}
        <RevealOnAppear revealKey="map-canvas">
          <InteractiveCoupleMap
            mine={mine}
            partner={partnerShare}
            friends={friends}
            myName={user?.display_name ?? 'You'}
            partnerName={partnerName}
          />
        </RevealOnAppear>

        {/* Quick Check-In Place Picker */}
        <RevealOnAppear revealKey="map-quick-checkin">
          <View
            style={[
              styles.groupCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.group,
                padding: spacing.lg,
                gap: spacing.sm,
              },
            ]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: colors.ink }]}>
                Quick Check-In Place Picker
              </Text>
              <Text style={[styles.sectionHint, { color: colors.inkMuted }]}>1-tap pin update</Text>
            </View>
            <View style={styles.chipsWrap}>
              {QUICK_CHECKIN_PLACES.map((place) => {
                const isCurrent =
                  mine?.mode !== 'ghost' &&
                  Boolean(
                    mine?.place_name &&
                      mine.place_name.toLowerCase().includes(place.label.toLowerCase())
                  );
                return (
                  <Pressable
                    key={place.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Check in at ${place.label}`}
                    disabled={updatingMode}
                    onPress={() => void handleQuickCheckIn(place)}
                    style={[
                      styles.placeChip,
                      {
                        backgroundColor: isCurrent ? colors.accent : colors.surfaceElevated,
                        borderColor: isCurrent ? colors.accent : colors.border,
                        borderRadius: radii.pill,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.placeChipText,
                        { color: isCurrent ? colors.onAccent : colors.ink },
                      ]}>
                      {place.useGps ? '◎ ' : '📍 '}
                      {place.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </RevealOnAppear>

        {/* Live Circle List (Partner + Friends) */}
        <RevealOnAppear revealKey="map-live-circle">
          <View
            style={[
              styles.groupCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.group,
                padding: spacing.xl,
                gap: spacing.md,
              },
            ]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: colors.ink }]}>Live Circle</Text>
              <Text style={[styles.sectionHint, { color: colors.inkMuted }]}>
                {(isPartnerPaired ? 1 : 0) + friends.length} active{' '}
                {(isPartnerPaired ? 1 : 0) + friends.length === 1 ? 'pin' : 'pins'}
              </Text>
            </View>

            {/* Partner Row */}
            {isPartnerPaired ? (
              <View
                style={[
                  styles.circlePersonCard,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                    borderRadius: radii.card,
                  },
                ]}>
                <View
                  style={[
                    styles.personAvatar,
                    {
                      backgroundColor: colors.accent,
                    },
                  ]}>
                  <Text style={[styles.personAvatarText, { color: colors.onAccent }]}>
                    {(partnerName.trim().slice(0, 1) || 'P').toUpperCase()}
                  </Text>
                </View>
                <View style={styles.personMetaCol}>
                  <View style={styles.personTitleRow}>
                    <Text numberOfLines={1} style={[styles.personName, { color: colors.ink }]}>
                      {partnerName}
                    </Text>
                    <View
                      style={[
                        styles.roleTag,
                        {
                          backgroundColor: colors.canvas,
                          borderColor: colors.border,
                          borderRadius: radii.pill,
                        },
                      ]}>
                      <Text style={[styles.roleTagText, { color: colors.success }]}>Partner</Text>
                    </View>
                  </View>
                  <Text numberOfLines={1} style={[styles.personPlace, { color: colors.ink }]}>
                    {partnerShare?.mode === 'ghost'
                      ? 'Ghost mode · Location hidden'
                      : (partnerShare?.place_name ?? 'Sharing live location')}
                  </Text>
                  <Text style={[styles.personDistance, { color: colors.inkMuted }]}>
                    {distanceMeters !== null
                      ? `${formatDistanceApart(distanceMeters)} · ${formatRelativeTimeAgo(partnerShare?.location_updated_at)}`
                      : formatLocationModeLabel(partnerShare?.mode ?? 'ghost')}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${partnerName}`}
                  onPress={() => {
                    if (Platform.OS !== 'web') {
                      void Haptics.selectionAsync();
                    }
                    router.push('/(tabs)/messages' as never);
                  }}
                  style={[
                    styles.messageBtn,
                    {
                      backgroundColor: colors.accent,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.messageBtnText, { color: colors.onAccent }]}>Message</Text>
                </Pressable>
              </View>
            ) : null}

            {!isPartnerPaired && friends.length === 0 ? (
              <Text style={[styles.disclosureText, { color: colors.inkMuted }]}>
                No partner or friends in your Live Circle yet. Pair with a partner or add friends on your Profile to see their pins here.
              </Text>
            ) : null}

            {/* Friends Rows */}
            {friends.map((friend, index) => {
              const friendName = friend.display_name ?? 'Friend';
              const friendDistance =
                mine?.lat != null &&
                mine?.lng != null &&
                mine.mode !== 'ghost' &&
                friend.lat != null &&
                friend.lng != null
                  ? formatDistanceApart(
                      computeDistanceMeters(mine.lat, mine.lng, friend.lat, friend.lng)
                    )
                  : 'Live pin';
              const badgeColor = index % 2 === 0 ? '#A855F7' : '#0EA5E9';

              return (
                <View
                  key={friend.user_id}
                  style={[
                    styles.circlePersonCard,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                      borderRadius: radii.card,
                    },
                  ]}>
                  <View style={[styles.personAvatar, { backgroundColor: badgeColor }]}>
                    <Text style={[styles.personAvatarText, { color: '#FFFFFF' }]}>
                      {(friendName.trim().slice(0, 1) || 'F').toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.personMetaCol}>
                    <View style={styles.personTitleRow}>
                      <Text numberOfLines={1} style={[styles.personName, { color: colors.ink }]}>
                        {friendName}
                      </Text>
                      <View
                        style={[
                          styles.roleTag,
                          {
                            backgroundColor: colors.canvas,
                            borderColor: colors.border,
                            borderRadius: radii.pill,
                          },
                        ]}>
                        <Text style={[styles.roleTagText, { color: colors.inkMuted }]}>
                          Friend
                        </Text>
                      </View>
                    </View>
                    <Text numberOfLines={1} style={[styles.personPlace, { color: colors.ink }]}>
                      {friend.place_name ?? 'Sharing live pin'}
                    </Text>
                    <Text style={[styles.personDistance, { color: colors.inkMuted }]}>
                      {friendDistance} · {formatRelativeTimeAgo(friend.location_updated_at)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Message ${friendName}`}
                    onPress={() => {
                      if (Platform.OS !== 'web') {
                        void Haptics.selectionAsync();
                      }
                      router.push('/(tabs)/messages' as never);
                    }}
                    style={[
                      styles.messageBtn,
                      {
                        backgroundColor: colors.canvas,
                        borderColor: colors.border,
                        borderWidth: 1,
                        borderRadius: radii.pill,
                      },
                    ]}>
                    <Text style={[styles.messageBtnText, { color: colors.ink }]}>Message</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </RevealOnAppear>

        {/* Distance & Privacy Control Card */}
        <RevealOnAppear revealKey="map-distance-card">
          <View
            style={[
              styles.groupCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.group,
                padding: spacing.xl,
                gap: spacing.md,
              },
            ]}>
            <View style={styles.distanceRow}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.distanceValue, { color: colors.ink }]}>
                  {!isPartnerPaired
                    ? 'Solo · No partner paired'
                    : distanceMeters !== null
                      ? formatDistanceApart(distanceMeters)
                      : `${partnerName} · Ghost mode`}
                </Text>
                {isPartnerPaired && partnerShare && partnerShare.mode !== 'ghost' ? (
                  <Text style={[styles.distanceMeta, { color: colors.inkMuted }]}>
                    {partnerName}: {partnerShare.place_name ?? formatLocationModeLabel(partnerShare.mode)}{' '}
                    · {formatRelativeTimeAgo(partnerShare.location_updated_at)}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* 3-Segment Privacy Control */}
            <View style={{ gap: 8 }}>
              <Text style={[styles.sectionTitle, { color: colors.ink }]}>
                Your location privacy
              </Text>
              <View
                accessibilityRole="radiogroup"
                style={[
                  styles.modeTrack,
                  {
                    backgroundColor: colors.canvas,
                    borderColor: colors.border,
                    borderRadius: radii.input,
                  },
                ]}>
                {MODE_OPTIONS.map((opt) => {
                  const selected = currentMode === opt.mode;
                  return (
                    <Pressable
                      key={opt.mode}
                      accessibilityRole="radio"
                      accessibilityLabel={`Location mode ${opt.label}`}
                      accessibilityState={{ selected, disabled: updatingMode }}
                      disabled={updatingMode}
                      onPress={() => void handleSelectMode(opt.mode)}
                      style={[
                        styles.modeOption,
                        {
                          backgroundColor: selected ? colors.surfaceElevated : 'transparent',
                          borderColor: selected ? colors.inkMuted : 'transparent',
                          borderRadius: radii.input - 2,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.modeLabel,
                          {
                            color: selected ? colors.ink : colors.inkMuted,
                            fontWeight: selected ? '700' : '500',
                          },
                        ]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.disclosureText, { color: colors.inkMuted }]}>
                {isPartnerPaired
                  ? `${partnerName} is notified when your mode changes.`
                  : 'Your location is hidden in Ghost mode by default.'}
              </Text>
            </View>
          </View>
        </RevealOnAppear>

        {/* Privacy Notification Audit Log */}
        <RevealOnAppear revealKey="map-audit-log">
          <View
            style={[
              styles.groupCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.group,
                padding: spacing.xl,
                gap: spacing.sm,
              },
            ]}>
            <Text style={[styles.sectionTitle, { color: colors.ink }]}>
              Recent sharing notifications
            </Text>
            {events.length === 0 ? (
              <Text style={[styles.disclosureText, { color: colors.inkMuted }]}>
                No mode changes yet.
              </Text>
            ) : (
              events.slice(0, 5).map((evt) => {
                const actorLabel = evt.actor_id === user?.id ? 'You' : partnerName;
                const prevLabel = formatLocationModeLabel(evt.payload.previous_mode ?? 'live');
                const nextLabel = formatLocationModeLabel(evt.payload.new_mode ?? 'live');
                return (
                  <View key={evt.id} style={styles.eventRow}>
                    <Text style={[styles.eventText, { color: colors.ink }]}>
                      {evt.payload.note
                        ? `${actorLabel} · ${evt.payload.note}`
                        : `${actorLabel}: ${prevLabel} → ${nextLabel}`}
                    </Text>
                    <Text style={[styles.eventTime, { color: colors.inkMuted }]}>
                      {formatRelativeTimeAgo(evt.created_at)}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        </RevealOnAppear>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    gap: 18,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -1.0,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginTop: 2,
  },
  alertStrip: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderCurve: 'continuous',
  },
  alertStripText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  groupCard: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHint: {
    fontSize: 12,
    fontWeight: '600',
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  placeChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderCurve: 'continuous',
  },
  placeChipText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  circlePersonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    padding: 12,
    borderCurve: 'continuous',
  },
  personAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personAvatarText: {
    fontSize: 16,
    fontWeight: '800',
  },
  personMetaCol: {
    flex: 1,
    gap: 2,
  },
  personTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  personName: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  roleTag: {
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 1.5,
  },
  roleTagText: {
    fontSize: 10,
    fontWeight: '700',
  },
  personPlace: {
    fontSize: 12,
    fontWeight: '600',
  },
  personDistance: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  messageBtn: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  messageBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  distanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  distanceValue: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  distanceMeta: {
    fontSize: 13,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  modeBadge: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderCurve: 'continuous',
  },
  modeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    width: '100%',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  modeTrack: {
    flexDirection: 'row',
    borderWidth: 1,
    padding: 4,
    gap: 6,
    borderCurve: 'continuous',
  },
  modeOption: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderCurve: 'continuous',
  },
  modeLabel: {
    fontSize: 13,
    letterSpacing: -0.2,
  },
  disclosureText: {
    fontSize: 12,
    lineHeight: 18,
  },
  eventRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 8,
  },
  eventText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  eventTime: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
});
