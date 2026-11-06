import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
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
  simulateSandboxPartnerLocation,
  updateMyLocationShare,
} from '@/api/locations';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { InteractiveCoupleMap } from '@/components/map/InteractiveCoupleMap';
import { InlineNotice, KeepItButton, RevealOnAppear } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';
import { LocationMode } from '@/types/database';

const MODE_OPTIONS: readonly {
  mode: LocationMode;
  label: string;
  description: string;
}[] = [
  {
    mode: 'live',
    label: 'Live',
    description: 'Updates while app is open',
  },
  {
    mode: 'on_moment',
    label: 'On Moment',
    description: 'Only when you post a Moment',
  },
  {
    mode: 'ghost',
    label: 'Ghost',
    description: 'Sharing off (coords cleared)',
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

  const partnerName = partner?.display_name ?? 'Your partner';
  const partnerId =
    couple && user
      ? (couple.user_a_id === user.id ? couple.user_b_id : couple.user_a_id) ??
        'sandbox_partner_maya'
      : 'sandbox_partner_maya';

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

  // Realtime subscription to location_shares and couple_events
  useEffect(() => {
    const client = supabase;
    if (!couple?.id || !isSupabaseConfigured || !client) return;

    const channel = client
      .channel(`locations:${couple.id}`)
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
  const events = bundle?.events ?? [];
  const currentMode: LocationMode = mine?.mode ?? 'ghost';

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
      let lat: number | null = null;
      let lng: number | null = null;
      let accuracyM: number | null = null;

      if (nextMode === 'live') {
        try {
          const perm = await Location.requestForegroundPermissionsAsync();
          if (perm.status === 'granted') {
            const pos = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
            accuracyM = pos.coords.accuracy ?? 24;
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
      });

      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setNotice({
        text: `${partnerName} was notified that you switched location sharing to ${formatLocationModeLabel(nextMode)}.`,
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

  const handleSimulatePartnerMode = async (mode: LocationMode) => {
    if (!couple || !user) return;
    await simulateSandboxPartnerLocation({
      coupleId: couple.id,
      partnerId,
      mode,
      userId: user.id,
    });
    setNotice({
      text: `${partnerName} switched location sharing to ${formatLocationModeLabel(mode)}.`,
      tone: 'info',
    });
    await queryClient.invalidateQueries({ queryKey: ['couple-locations', couple.id] });
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
            paddingBottom: 118,
          },
        ]}>
        {/* Header */}
        <RevealOnAppear revealKey="map-header">
          <View style={styles.headerRow}>
            <View style={styles.flex}>
              <Text style={[styles.title, { color: colors.ink }]}>Map & Location</Text>
              <Text style={[styles.subtitle, { color: colors.inkMuted }]}>
                End-to-end consent · {partnerName} is notified on every sharing change
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
              {latestEvent.actor_id === user?.id ? 'You' : partnerName} switched location sharing to{' '}
              {formatLocationModeLabel(latestEvent.payload.new_mode ?? 'ghost')} ·{' '}
              {formatRelativeTimeAgo(latestEvent.created_at)}
            </Text>
          </View>
        ) : null}

        {/* Interactive Couple Map Canvas */}
        <RevealOnAppear revealKey="map-canvas">
          <InteractiveCoupleMap
            mine={mine}
            partner={partnerShare}
            myName={user?.display_name ?? 'You'}
            partnerName={partnerName}
          />
        </RevealOnAppear>

        {/* Distance & Partner Status Card */}
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
                  {distanceMeters !== null
                    ? formatDistanceApart(distanceMeters)
                    : partnerShare?.mode === 'ghost'
                      ? `${partnerName} is in Ghost mode`
                      : 'Share your location to see distance apart'}
                </Text>
                <Text style={[styles.distanceMeta, { color: colors.inkMuted }]}>
                  {partnerShare && partnerShare.mode !== 'ghost'
                    ? `${partnerName}: ${formatLocationModeLabel(partnerShare.mode)} · Updated ${formatRelativeTimeAgo(partnerShare.location_updated_at)}`
                    : `${partnerName}’s coordinates are hidden (${formatRelativeTimeAgo(partnerShare?.mode_changed_at)})`}
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
                  You: {formatLocationModeLabel(currentMode)}
                </Text>
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
                      <Text
                        numberOfLines={1}
                        style={[styles.modeDescription, { color: colors.inkMuted }]}>
                        {opt.description}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.disclosureText, { color: colors.inkMuted }]}>
                Changing modes notifies {partnerName} immediately. Ghost mode wipes stored
                coordinates on the server.
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
                No location mode changes recorded yet. Both partners start in Ghost mode by default.
              </Text>
            ) : (
              events.slice(0, 5).map((evt) => {
                const actorLabel = evt.actor_id === user?.id ? 'You' : partnerName;
                const prevLabel = formatLocationModeLabel(evt.payload.previous_mode ?? 'ghost');
                const nextLabel = formatLocationModeLabel(evt.payload.new_mode ?? 'ghost');
                return (
                  <View key={evt.id} style={styles.eventRow}>
                    <Text style={[styles.eventText, { color: colors.ink }]}>
                      {actorLabel}: {prevLabel} → {nextLabel}
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

        {/* Local Sandbox Partner Location Simulator */}
        {!isSupabaseConfigured && couple ? (
          <View
            style={[
              styles.groupCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.group,
                padding: spacing.lg,
                gap: 10,
              },
            ]}>
            <Text style={[styles.sandboxHeader, { color: colors.inkMuted }]}>
              Local Sandbox Controls ({partnerName}’s Location Mode)
            </Text>
            <View style={styles.sandboxRow}>
              <KeepItButton
                label="Live"
                accessibilityLabel={`${partnerName}: Live`}
                variant="secondary"
                onPress={() => void handleSimulatePartnerMode('live')}
                style={styles.flex}
              />
              <KeepItButton
                label="Moment"
                accessibilityLabel={`${partnerName}: On Moment`}
                variant="secondary"
                onPress={() => void handleSimulatePartnerMode('on_moment')}
                style={styles.flex}
              />
              <KeepItButton
                label="Ghost"
                accessibilityLabel={`${partnerName}: Ghost`}
                variant="secondary"
                onPress={() => void handleSimulatePartnerMode('ghost')}
                style={styles.flex}
              />
            </View>
          </View>
        ) : null}
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
  modeDescription: {
    fontSize: 10,
    textAlign: 'center',
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
  },
  eventText: {
    fontSize: 13,
    fontWeight: '600',
  },
  eventTime: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  sandboxHeader: {
    fontSize: 12,
    fontWeight: '700',
  },
  sandboxRow: {
    flexDirection: 'row',
    gap: 8,
  },
});
