import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  computeDistanceMeters,
  fetchCoupleLocations,
  formatDistanceApart,
  formatLocationModeLabel,
  formatRelativeTimeAgo,
  updateMyLocationShare,
} from '@/api/locations';
import { requestRealtimeCatchUpSync } from '@/api/realtimeSync';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { InteractiveCoupleMap } from '@/components/map/InteractiveCoupleMap';
import {
  ChatBubbleIcon,
  CoupleLinkIcon,
  CrosshairIcon,
  DirectionChevronIcon,
  FriendsClusterIcon,
  GhostCloakIcon,
  HistoryClockIcon,
  LiveBeaconIcon,
  MomentPinIcon,
} from '@/components/map/MapIcons';
import { InlineNotice, KeepItButton, SkeletonBlock } from '@/components/ui/Primitives';
import { AppPressable, EmptyState, PageHeader } from '@/components/ui/ScreenKit';
import { useSessionStore } from '@/store/sessionStore';
import { APP_LAYOUT, useKeepItTheme } from '@/theme/tokens';
import { LocationMode, LocationShareRecord } from '@/types/database';

const MODE_OPTIONS: {
  mode: LocationMode;
  label: string;
  description: string;
}[] = [
  {
    mode: 'live',
    label: 'Live',
    description: 'Share your current GPS pin.',
  },
  {
    mode: 'on_moment',
    label: 'On Moment',
    description: 'Share location when you post a located Moment.',
  },
  {
    mode: 'ghost',
    label: 'Ghost',
    description: 'Pause sharing and hide your coordinates.',
  },
];

function hasCoordinates(
  record: LocationShareRecord | null,
): record is LocationShareRecord & { lat: number; lng: number } {
  return Boolean(record && record.mode !== 'ghost' && record.lat != null && record.lng != null);
}

function ModeGlyph({
  mode,
  color,
  accentColor,
  size = 18,
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
  const [gpsAvailability, setGpsAvailability] = useState<
    'unknown' | 'granted' | 'denied' | 'unavailable'
  >('unknown');
  const [pendingGpsAction, setPendingGpsAction] = useState<'live_mode' | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [notice, setNotice] = useState<{
    text: string;
    tone: 'info' | 'error' | 'success';
  } | null>(null);

  const locationQuery = useQuery({
    queryKey: ['couple-locations', couple?.id, user?.id],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () => fetchCoupleLocations({ coupleId: couple!.id, userId: user!.id }),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
        },
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
        },
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel).catch(() => {});
    };
  }, [couple?.id, queryClient]);

  const bundle = locationQuery.data;
  const mine = bundle?.mine ?? null;
  const partnerShare = paired ? bundle?.partner ?? null : null;
  const friends = bundle?.friends ?? [];
  const events = bundle?.events ?? [];
  const currentMode = mine?.mode ?? 'ghost';
  const canChange = Boolean(couple && user && bundle) && !busy;
  const distance =
    hasCoordinates(mine) && hasCoordinates(partnerShare)
      ? formatDistanceApart(
          computeDistanceMeters(mine.lat, mine.lng, partnerShare.lat, partnerShare.lng),
        )
      : null;
  const activePins =
    (hasCoordinates(partnerShare) ? 1 : 0) + friends.filter(hasCoordinates).length;

  const requestGps = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (mounted.current) setGpsPrimed(true);
    if (permission.status !== 'granted') {
      if (mounted.current) setGpsAvailability('denied');
      throw new Error(
        'Location permission is off. Allow location in your device or browser settings, then try GPS again. Sharing mode has not changed.',
      );
    }
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (mounted.current) setGpsAvailability('granted');
      return {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyM: position.coords.accuracy,
      };
    } catch {
      if (mounted.current) setGpsAvailability('unavailable');
      throw new Error(
        'Your device could not get a location. Check location services and try GPS again, or pick a spot.',
      );
    }
  };

  const changeSharing = async (
    mode: LocationMode,
    skipPrimer = false,
  ) => {
    if (!couple || !user || saving.current || !bundle) return;
    const needsGps = mode === 'live' && !hasCoordinates(mine);
    if (needsGps && !gpsPrimed && !skipPrimer) {
      setPendingGpsAction('live_mode');
      scroll.current?.scrollTo({ y: 0, animated: false });
      return;
    }
    saving.current = true;
    setBusy(true);
    setNotice(null);
    setPendingGpsAction(null);
    try {
      let lat = mode === 'ghost' ? null : mine?.lat ?? null;
      let lng = mode === 'ghost' ? null : mine?.lng ?? null;
      let accuracyM = mode === 'ghost' ? null : mine?.accuracy_m ?? null;
      let placeName = mode === 'ghost' ? null : mine?.place_name ?? null;
      if (needsGps) {
        const gps = await requestGps();
        lat = gps.lat;
        lng = gps.lng;
        accuracyM = gps.accuracyM;
        placeName = `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      }
      const updated = await updateMyLocationShare({
        coupleId: couple.id,
        userId: user.id,
        mode,
        lat,
        lng,
        accuracyM,
        placeName,
      });
      queryClient.setQueryData(['couple-locations', couple.id, user.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['couple-locations', couple.id] });
      if (mounted.current) {
        setNotice({
          text: `Mode switched to ${formatLocationModeLabel(mode)}.`,
          tone: 'success',
        });
      }
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch (error) {
      if (mounted.current) {
        setNotice({
          text:
            error instanceof Error
              ? error.message
              : 'Could not update sharing. Try your selection again.',
          tone: 'error',
        });
      }
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const people = [
    ...(paired
      ? [{ id: partner?.id ?? 'partner', name: partnerName, role: 'Partner', record: partnerShare }]
      : []),
    ...friends.map((record) => ({
      id: record.user_id,
      name: record.display_name ?? 'Friend',
      role: 'Friend',
      record,
    })),
  ];

  const surface = { backgroundColor: colors.surface, borderRadius: radii.card };
  const statusHeadline =
    currentMode === 'ghost'
      ? 'Hidden · Ghost'
      : hasCoordinates(mine)
        ? mine.place_name ?? 'Active pin'
        : currentMode === 'on_moment'
          ? 'Waiting for Moment photo'
          : 'No pin yet';

  const handlePullRefresh = async () => {
    if (pullRefreshing) return;
    setPullRefreshing(true);
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync().catch(() => {});
    }
    try {
      await Promise.all([
        useSessionStore.getState().refreshPairing(),
        requestRealtimeCatchUpSync({ userId: user?.id, coupleId: couple?.id }),
      ]);
      const { promise: delayPromise, resolve: resolveDelay } = Promise.withResolvers<void>();
      setTimeout(resolveDelay, 200);
      await delayPromise;
      await Promise.all([
        locationQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['friends-list'] }),
      ]);
    } finally {
      if (mounted.current) setPullRefreshing(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <ScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="automatic"
        alwaysBounceVertical
        overScrollMode="always"
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => void handlePullRefresh()}
            tintColor={colors.ink}
            colors={[colors.ink]}
            progressBackgroundColor={colors.surfaceElevated}
          />
        }
        contentContainerStyle={styles.content}
      >
        <PageHeader
          title="Map"
          action={
            distance ? (
              <View
                accessible
                accessibilityLabel={`Distance between you and ${partnerName}: ${distance}`}
                style={[
                  styles.distancePill,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.controlBorder,
                    borderRadius: radii.pill,
                  },
                ]}
              >
                <CoupleLinkIcon color={colors.ink} size={15} />
                <Text style={[styles.distanceText, { color: colors.ink }]}>{distance}</Text>
              </View>
            ) : undefined
          }
        />

        {notice ? <InlineNotice message={notice.text} tone={notice.tone} /> : null}

        {pendingGpsAction ? (
          <View style={[styles.compactCard, surface, { borderColor: colors.border }]}>
            <View style={styles.promptHeader}>
              <View
                style={[
                  styles.iconTile,
                  { backgroundColor: colors.surfaceElevated, borderRadius: radii.input },
                ]}
              >
                <CrosshairIcon color={colors.ink} size={20} />
              </View>
              <View style={styles.promptCopy}>
                <Text style={[styles.cardTitle, { color: colors.ink }]}>Allow foreground GPS?</Text>
                <Text style={[styles.secondary, { color: colors.inkMuted }]}>
                  One-time check-in pin. No background tracking.
                </Text>
              </View>
            </View>
            <View style={styles.promptActions}>
              <KeepItButton
                label="Allow GPS"
                disabled={busy}
                onPress={() => {
                  void changeSharing('live', true);
                }}
              />
              <KeepItButton
                label="Cancel"
                variant="secondary"
                onPress={() => setPendingGpsAction(null)}
              />
            </View>
          </View>
        ) : null}

        {locationQuery.isError ? (
          <View style={styles.stack}>
            <InlineNotice
              message={
                locationQuery.error instanceof Error
                  ? locationQuery.error.message
                  : 'Shared locations could not load.'
              }
            />
            <KeepItButton
              label="Retry shared locations"
              variant="secondary"
              loading={locationQuery.isFetching}
              onPress={() => void locationQuery.refetch()}
            />
          </View>
        ) : null}

        {locationQuery.isLoading && !bundle ? (
          <SkeletonBlock height={340} label="Loading shared locations…" />
        ) : null}

        {!couple || !user ? (
          <EmptyState
            title="Map is not ready"
            message="Your account session is not available. Return to Home to continue."
            actionLabel="Open Home"
            onAction={() => router.navigate('/(tabs)' as never)}
          />
        ) : null}

        {bundle ? (
          <>
            {/* Simplified Location Sharing Mode Card */}
            <View style={[styles.compactCard, surface]}>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Location sharing mode"
                style={[
                  styles.modeGrid,
                  {
                    backgroundColor: colors.canvas,
                    borderColor: colors.controlBorder,
                    borderRadius: radii.input,
                  },
                ]}
              >
                {MODE_OPTIONS.map((option) => {
                  const selected = currentMode === option.mode;
                  const fg = selected ? colors.canvas : colors.inkMuted;
                  return (
                    <AppPressable
                      key={option.mode}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: !canChange, busy }}
                      accessibilityLabel={`${option.label} mode. ${option.description}`}
                      disabled={!canChange}
                      onPress={() => void changeSharing(option.mode)}
                      style={[
                        styles.modeSegment,
                        {
                          borderRadius: radii.input - 2,
                          backgroundColor: selected ? colors.ink : 'transparent',
                        },
                      ]}
                    >
                      <ModeGlyph
                        mode={option.mode}
                        color={fg}
                        accentColor={selected ? colors.canvas : colors.success}
                        size={16}
                      />
                      <Text style={[styles.segmentTitle, { color: fg }]}>{option.label}</Text>
                    </AppPressable>
                  );
                })}
              </View>

              <View style={styles.statusRowCompact}>
                <Text numberOfLines={1} style={[styles.bodyStrong, { color: colors.ink, flex: 1 }]}>
                  {busy ? 'Updating pin…' : statusHeadline}
                </Text>
                <Text numberOfLines={1} style={[styles.secondary, { color: colors.inkMuted }]}>
                  {mine?.location_updated_at
                    ? formatRelativeTimeAgo(mine.location_updated_at)
                    : formatLocationModeLabel(currentMode)}
                  {gpsAvailability === 'denied'
                    ? ' · GPS off'
                    : gpsAvailability === 'unavailable'
                      ? ' · GPS unavailable'
                      : ''}
                </Text>
              </View>
            </View>

            {/* Interactive Map + Floating Icon HUD */}
            <InteractiveCoupleMap
              mine={mine}
              partner={partnerShare}
              friends={friends}
              myName={user?.display_name ?? 'You'}
              partnerName={partnerName}
            />

            {/* Compact Circle Strip with Icon Badges & Direct Chat Button */}
            <View style={[styles.compactCard, surface]}>
              <View style={styles.sectionTitleRow}>
                <View style={styles.sectionTitleLeft}>
                  <FriendsClusterIcon color={colors.ink} size={18} />
                  <Text style={[styles.cardTitle, { color: colors.ink }]}>Circle</Text>
                </View>
                <View
                  style={[
                    styles.countBadge,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderRadius: radii.pill,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <LiveBeaconIcon
                    color={colors.ink}
                    accentColor={activePins > 0 ? colors.success : colors.inkMuted}
                    size={12}
                  />
                  <Text style={[styles.secondary, { color: colors.ink }]}>{activePins}</Text>
                </View>
              </View>

              {people.length ? (
                <View style={styles.stack}>
                  {people.map((person) => {
                    const record = person.record;
                    const coordinates = hasCoordinates(record);
                    const apart =
                      coordinates && hasCoordinates(mine)
                        ? formatDistanceApart(
                            computeDistanceMeters(mine.lat, mine.lng, record.lat, record.lng),
                          )
                        : null;
                    const mode = record?.mode ?? 'ghost';
                    const summary = !record
                      ? 'Offline'
                      : record.mode === 'ghost'
                        ? 'Ghost · Hidden'
                        : !coordinates
                          ? record.mode === 'on_moment'
                            ? 'Waiting for Moment'
                            : 'No pin'
                          : record.place_name ?? 'Shared pin';

                    return (
                      <View
                        key={person.id}
                        style={[
                          styles.personRow,
                          {
                            backgroundColor: colors.surfaceElevated,
                            borderRadius: radii.input,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <View style={styles.avatarWrap}>
                          <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
                            <Text style={[styles.avatarInitial, { color: colors.onAccent }]}>
                              {(person.name.trim()[0] ?? '?').toUpperCase()}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.avatarModeBadge,
                              {
                                backgroundColor: colors.surface,
                                borderColor: colors.controlBorder,
                              },
                            ]}
                          >
                            <ModeGlyph
                              mode={mode}
                              color={colors.ink}
                              accentColor={colors.success}
                              size={10}
                            />
                          </View>
                        </View>

                        <View style={styles.personCopy}>
                          <View style={styles.personTopLine}>
                            <Text
                              numberOfLines={1}
                              style={[styles.bodyStrong, { color: colors.ink }]}
                            >
                              {person.name}
                            </Text>
                            {apart ? (
                              <Text style={[styles.apartPill, { color: colors.inkMuted }]}>
                                · {apart}
                              </Text>
                            ) : null}
                          </View>
                          <Text
                            numberOfLines={1}
                            style={[styles.secondary, { color: colors.inkMuted }]}
                          >
                            {summary}
                            {record?.location_updated_at && coordinates
                              ? ` · ${formatRelativeTimeAgo(record.location_updated_at)}`
                              : ''}
                          </Text>
                        </View>

                        <AppPressable
                          accessibilityRole="button"
                          accessibilityLabel={`Message ${person.name}`}
                          onPress={() =>
                            router.navigate({
                              pathname: '/(tabs)/messages',
                              params: { peerId: person.id, peerName: person.name },
                            })
                          }
                          style={[
                            styles.iconActionBtn,
                            {
                              borderColor: colors.controlBorder,
                              borderRadius: radii.input,
                              backgroundColor: colors.surface,
                            },
                          ]}
                        >
                          <ChatBubbleIcon color={colors.ink} size={18} />
                        </AppPressable>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <EmptyState
                  title="Circle is quiet"
                  message="Pair or add friends in Profile to see shared pins."
                  actionLabel="Open Profile"
                  onAction={() => router.navigate('/(tabs)/profile' as never)}
                />
              )}
            </View>

            {/* Collapsible Icon Activity Log */}
            <View style={[styles.compactCard, surface]}>
              <AppPressable
                accessibilityRole="button"
                accessibilityLabel={`Sharing activity (${events.length} events)`}
                accessibilityState={{ expanded: historyOpen }}
                onPress={() => setHistoryOpen((value) => !value)}
                style={styles.historyToggle}
              >
                <View style={styles.sectionTitleLeft}>
                  <HistoryClockIcon color={colors.ink} size={18} />
                  <Text style={[styles.cardTitle, { color: colors.ink }]}>Activity</Text>
                  <Text style={[styles.secondary, { color: colors.inkMuted }]}>
                    ({events.length})
                  </Text>
                </View>
                <View
                  style={[
                    styles.chevronBadge,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.controlBorder,
                      borderRadius: radii.input,
                    },
                  ]}
                >
                  <DirectionChevronIcon
                    color={colors.ink}
                    direction={historyOpen ? 'up' : 'down'}
                    size={15}
                  />
                </View>
              </AppPressable>

              {historyOpen ? (
                events.length ? (
                  <View style={styles.stack}>
                    {events.slice(0, 5).map((event) => {
                      const actorName =
                        event.actor_id === user?.id
                          ? 'You'
                          : event.actor_id === partner?.id
                            ? partnerName
                            : friends.find((friend) => friend.user_id === event.actor_id)
                                ?.display_name ?? 'Circle';
                      const eventMode: LocationMode = event.payload.new_mode ?? 'live';
                      const summary =
                        event.payload.note ??
                        formatLocationModeLabel(event.payload.new_mode ?? 'ghost');

                      return (
                        <View
                          key={event.id}
                          style={[
                            styles.eventRow,
                            {
                              backgroundColor: colors.surfaceElevated,
                              borderRadius: radii.input,
                            },
                          ]}
                        >
                          <ModeGlyph
                            mode={eventMode}
                            color={colors.ink}
                            accentColor={colors.success}
                            size={16}
                          />
                          <Text
                            numberOfLines={1}
                            style={[styles.eventCopy, { color: colors.ink }]}
                          >
                            <Text style={styles.bodyStrong}>{actorName}</Text> · {summary}
                          </Text>
                          <Text style={[styles.secondary, { color: colors.inkMuted }]}>
                            {formatRelativeTimeAgo(event.created_at)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={[styles.secondary, { color: colors.inkMuted }]}>
                    No check-ins or mode switches yet.
                  </Text>
                )
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flexGrow: 1,
    maxWidth: APP_LAYOUT.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: APP_LAYOUT.pageInset,
    paddingTop: 16,
    paddingBottom: APP_LAYOUT.tabBarClearance,
    gap: 14,
  },
  compactCard: {
    padding: 14,
    gap: 12,
  },
  distancePill: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  distanceText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  modeGrid: {
    flexDirection: 'row',
    borderWidth: 1,
    padding: 3,
    gap: 4,
  },
  modeSegment: {
    flex: 1,
    minWidth: 0,
    minHeight: 42,
    paddingVertical: 8,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  segmentTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  statusRowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 4,
  },
  statusCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  bodyStrong: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  secondary: {
    fontSize: 12,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  stack: { gap: 8 },
  personRow: {
    padding: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarWrap: {
    width: 42,
    height: 42,
    position: 'relative',
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
  },
  avatarModeBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  personTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  apartPill: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  iconActionBtn: {
    minWidth: 44,
    minHeight: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyToggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  chevronBadge: {
    minWidth: 44,
    minHeight: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  eventCopy: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
  },
  promptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconTile: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  promptActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
