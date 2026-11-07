import { broadcastCoupleSync } from '@/api/realtimeSync';
import { isSchemaNotMigratedError, isSupabaseConfigured, supabase } from '@/api/supabase';
import { fetchFriendsCircle } from '@/api/social';
import { useSessionStore } from '@/store/sessionStore';
import { safeGetStorageItem, safeSetStorageItem } from '@/utils/safeAsyncStorage';
import {
  CoupleEventRecord,
  CoupleLocationBundle,
  CoupleRecord,
  DailyPromptRecord,
  LocationMode,
  LocationShareRecord,
  MomentRecord,
  StreakRecord,
  UserProfile,
} from '@/types/database';

const LOCAL_LOCATIONS_KEY = 'keepit.local_locations.v1';
const LOCAL_EVENTS_KEY = 'keepit.local_events.v1';
const LOCAL_MOMENTS_KEY = 'keepit.local_moments.v1';
const LOCAL_DB_KEY = 'keepit.local_db.v1';

export const FALLBACK_LIVE_COORDS = {
  lat: 37.7749,
  lng: -122.4194,
  accuracyM: 18,
  placeName: 'Cozy Home Studio · SF',
} as const;

export const DEFAULT_PARTNER_LIVE_COORDS = {
  lat: 37.7793,
  lng: -122.4148,
  accuracyM: 22,
  placeName: 'Blue Bottle Coffee · 620m away',
} as const;

async function resolveFriendLocations(params: {
  coupleId: string;
  userId: string;
  locationsMap: Record<string, LocationShareRecord>;
}): Promise<LocationShareRecord[]> {
  const friendsCircle = await fetchFriendsCircle({ userId: params.userId });
  if (friendsCircle.length === 0) return [];

  const out: LocationShareRecord[] = [];
  for (const friendEntry of friendsCircle) {
    const fId = friendEntry.friend_id;
    const match = Object.values(params.locationsMap).find((row) => row.user_id === fId);
    if (match && match.mode !== 'ghost' && match.lat !== null && match.lng !== null) {
      out.push({
        ...match,
        display_name: match.display_name ?? friendEntry.friend_profile.display_name,
      });
    }
  }
  return out;
}

interface LocalDbSnapshot {
  users: Record<string, UserProfile>;
  couples: Record<string, CoupleRecord>;
}

interface LocalMomentsSnapshot {
  prompts: Record<string, DailyPromptRecord>;
  moments: Record<string, MomentRecord>;
  streaks: Record<string, StreakRecord>;
}

async function readLocalLocations(): Promise<Record<string, LocationShareRecord>> {
  const raw = await safeGetStorageItem(LOCAL_LOCATIONS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, LocationShareRecord>;
    }
    return {};
  } catch {
    return {};
  }
}

async function readLocalEvents(): Promise<CoupleEventRecord[]> {
  const raw = await safeGetStorageItem(LOCAL_EVENTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CoupleEventRecord[]) : [];
  } catch {
    return [];
  }
}

async function appendLocationModeEvent(params: {
  coupleId: string;
  actorId: string;
  previousMode: LocationMode;
  newMode: LocationMode;
  note?: string;
  createdAtIso: string;
}): Promise<CoupleEventRecord> {
  const events = await readLocalEvents();
  const record: CoupleEventRecord = {
    id: `evt_loc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    couple_id: params.coupleId,
    actor_id: params.actorId,
    event_type: 'location_mode_changed',
    payload: {
      previous_mode: params.previousMode,
      new_mode: params.newMode,
      ...(params.note ? { note: params.note } : {}),
    },
    created_at: params.createdAtIso,
  };
  const nextEvents = [record, ...events].slice(0, 60);
  await safeSetStorageItem(LOCAL_EVENTS_KEY, JSON.stringify(nextEvents));
  return record;
}

async function resolveSandboxPartnerId(
  coupleId: string,
  userId: string,
  locationsMap: Record<string, LocationShareRecord>
): Promise<string | null> {
  const sessionCouple = useSessionStore.getState().couple;
  if (sessionCouple && sessionCouple.id === coupleId) {
    const other =
      sessionCouple.user_a_id === userId ? sessionCouple.user_b_id : sessionCouple.user_a_id;
    if (other) return other;
  }

  const rawDb = await safeGetStorageItem(LOCAL_DB_KEY);
  if (rawDb) {
    try {
      const db = JSON.parse(rawDb) as LocalDbSnapshot;
      const couple = db.couples?.[coupleId];
      if (couple) {
        const other = couple.user_a_id === userId ? couple.user_b_id : couple.user_a_id;
        if (other) return other;
      }
    } catch {
      // Ignore malformed local db snapshot
    }
  }

  const existingOther = Object.values(locationsMap).find(
    (row) => row.couple_id === coupleId && row.user_id !== userId
  );
  return existingOther?.user_id ?? null;
}

async function findLatestSandboxMomentCoords(
  coupleId: string,
  userId: string
): Promise<{ lat: number; lng: number; postedAt: string; placeName?: string | null } | null> {
  const raw = await safeGetStorageItem(LOCAL_MOMENTS_KEY);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as LocalMomentsSnapshot;
    const myMoments = Object.values(state.moments ?? {})
      .filter((m) => m.couple_id === coupleId && m.user_id === userId)
      .sort((a, b) => (a.posted_at < b.posted_at ? 1 : -1));

    if (myMoments.length === 0) return null;

    const withGps = myMoments.find((m) => m.lat !== null && m.lng !== null);
    if (withGps && withGps.lat !== null && withGps.lng !== null) {
      return {
        lat: withGps.lat,
        lng: withGps.lng,
        postedAt: withGps.posted_at,
        placeName: withGps.location_label ?? null,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function redactGhostShare(record: LocationShareRecord | null): LocationShareRecord | null {
  if (!record) return null;
  if (record.mode !== 'ghost') return record;
  return {
    ...record,
    lat: null,
    lng: null,
    accuracy_m: null,
    place_name: null,
    location_updated_at: null,
  };
}

export function computeDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const earthRadiusM = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const radLat1 = (lat1 * Math.PI) / 180;
  const radLat2 = (lat2 * Math.PI) / 180;

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const a =
    sinLat * sinLat + Math.cos(radLat1) * Math.cos(radLat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return Math.max(0, earthRadiusM * c);
}

export function formatDistanceApart(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) {
    return 'Distance unavailable';
  }
  if (meters < 50) {
    return 'Together (<50 m)';
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m apart`;
  }
  if (meters < 100_000) {
    return `${(meters / 1000).toFixed(1)} km apart`;
  }
  return `${Math.round(meters / 1000)} km apart`;
}

export function formatLocationModeLabel(mode: LocationMode): string {
  if (mode === 'live') return 'Live';
  if (mode === 'on_moment') return 'On Moment';
  return 'Ghost';
}

export function formatRelativeTimeAgo(
  iso: string | null | undefined,
  nowMs = Date.now()
): string {
  if (!iso) return 'not yet';
  const targetMs = new Date(iso).getTime();
  if (!Number.isFinite(targetMs)) return 'not yet';

  const diffSec = Math.max(0, Math.floor((nowMs - targetMs) / 1000));
  if (diffSec < 45) return 'just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function fetchCoupleLocations(params: {
  coupleId: string;
  userId: string;
}): Promise<CoupleLocationBundle> {
  const nowIso = new Date().toISOString();
  const localLocationsMap = await readLocalLocations();
  const activeFriendLocations = await resolveFriendLocations({
    coupleId: params.coupleId,
    userId: params.userId,
    locationsMap: localLocationsMap,
  });
  const sessionState = useSessionStore.getState();
  const myDisplayName =
    sessionState.user?.id === params.userId ? sessionState.user.display_name : undefined;
  const sessionPartnerName = sessionState.partner?.display_name;

  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase.rpc('get_couple_locations');
      if (!error && data) {
        const raw = data as CoupleLocationBundle;
        const rawMine = raw.mine ?? {
          user_id: params.userId,
          couple_id: params.coupleId,
          display_name: myDisplayName,
          mode: 'ghost' as LocationMode,
          lat: null,
          lng: null,
          accuracy_m: null,
          place_name: null,
          location_updated_at: null,
          mode_changed_at: nowIso,
        };
        const hydratedMine: LocationShareRecord = rawMine;

        const isPaired = Boolean(
          !params.coupleId.startsWith('solo_') && sessionState.partner?.id
        );
        const rawPartner = !isPaired
          ? null
          : (raw.partner ?? {
              user_id: sessionState.partner!.id,
              couple_id: params.coupleId,
              display_name: sessionPartnerName ?? 'Partner',
              mode: 'ghost' as LocationMode,
              lat: null,
              lng: null,
              accuracy_m: null,
              place_name: null,
              location_updated_at: null,
              mode_changed_at: nowIso,
            });
        const hydratedPartner: LocationShareRecord | null = rawPartner;
        return {
          mine: redactGhostShare(hydratedMine),
          partner: redactGhostShare(hydratedPartner),
          friends: Array.isArray(raw.friends) ? raw.friends : activeFriendLocations,
          events: Array.isArray(raw.events) ? raw.events : [],
        };
      }
    } catch {
      // Preserve offline cached shares without inventing missing coordinates.
    }
  }

  const locationsMap = await readLocalLocations();
  let mutated = false;

  const myKey = `${params.coupleId}:${params.userId}`;
  const existingMine = locationsMap[myKey];
  if (!existingMine) {
    locationsMap[myKey] = {
      user_id: params.userId,
      couple_id: params.coupleId,
      display_name: myDisplayName,
      mode: 'ghost',
      lat: null,
      lng: null,
      accuracy_m: null,
      place_name: null,
      location_updated_at: null,
      mode_changed_at: nowIso,
    };
    mutated = true;
  }

  const resolvedPartnerId =
    !params.coupleId.startsWith('solo_')
      ? ((await resolveSandboxPartnerId(params.coupleId, params.userId, locationsMap)) ??
          sessionState.partner?.id ??
          null)
      : null;
  let partnerRecord: LocationShareRecord | null = null;

  if (resolvedPartnerId) {
    const partnerKey = `${params.coupleId}:${resolvedPartnerId}`;
    const existingPartner = locationsMap[partnerKey];
    if (!existingPartner) {
      locationsMap[partnerKey] = {
        user_id: resolvedPartnerId,
        couple_id: params.coupleId,
        display_name: sessionPartnerName ?? 'Partner',
        mode: 'ghost',
        lat: null,
        lng: null,
        accuracy_m: null,
        place_name: null,
        location_updated_at: null,
        mode_changed_at: nowIso,
      };
      mutated = true;
    }
    partnerRecord = locationsMap[partnerKey];
  }

  if (mutated) {
    await safeSetStorageItem(LOCAL_LOCATIONS_KEY, JSON.stringify(locationsMap));
  }

  const allEvents = await readLocalEvents();
  const locationEvents = allEvents
    .filter(
      (evt) =>
        evt.event_type === 'location_mode_changed' &&
        (!evt.couple_id || evt.couple_id === params.coupleId)
    )
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 12);

  return {
    mine: redactGhostShare(locationsMap[myKey]),
    partner: redactGhostShare(partnerRecord),
    friends: activeFriendLocations,
    events: locationEvents,
  };
}

export async function updateMyLocationShare(params: {
  coupleId: string;
  userId: string;
  mode: LocationMode;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  placeName?: string | null;
}): Promise<CoupleLocationBundle> {
  if (isSupabaseConfigured && supabase) {
    const currentBundle = await fetchCoupleLocations({
      coupleId: params.coupleId,
      userId: params.userId,
    });
    const previousMode: LocationMode = currentBundle.mine?.mode ?? 'ghost';

    const { error } = await supabase.rpc('update_my_location_share', {
      p_mode: params.mode,
      p_lat: params.mode === 'ghost' ? null : (params.lat ?? null),
      p_lng: params.mode === 'ghost' ? null : (params.lng ?? null),
      p_accuracy_m: params.mode === 'ghost' ? null : (params.accuracyM ?? null),
    });

    if (!error) {
      const updatedBundle = await fetchCoupleLocations({
        coupleId: params.coupleId,
        userId: params.userId,
      });

      const hydratedMine: LocationShareRecord | null = updatedBundle.mine
        ? {
            ...updatedBundle.mine,
            place_name:
              params.mode === 'ghost'
                ? null
                : (params.placeName ?? updatedBundle.mine.place_name ?? null),
          }
        : null;

      if (previousMode !== params.mode || params.placeName) {
        const latestEvent = updatedBundle.events.find((e) => e.actor_id === params.userId);
        void supabase.functions
          .invoke('dispatch-push', {
            body: {
              eventId: latestEvent?.id,
              coupleId: params.coupleId,
              actorId: params.userId,
              eventType: 'location_mode_changed',
              payload: {
                previous_mode: previousMode,
                new_mode: params.mode,
                ...(params.placeName ? { note: `Checked in at ${params.placeName}` } : {}),
              },
            },
          })
          .catch(() => {});
      }

      return {
        ...updatedBundle,
        mine: hydratedMine,
      };
    }
    if (!isSchemaNotMigratedError(error)) throw new Error(error.message);
  }
  const locationsMap = await readLocalLocations();
  const nowIso = new Date().toISOString();
  const myKey = `${params.coupleId}:${params.userId}`;
  const existing = locationsMap[myKey];
  const previousMode: LocationMode = existing?.mode ?? 'ghost';
  const myDisplayName = useSessionStore.getState().user?.display_name;

  let nextLat: number | null = null;
  let nextLng: number | null = null;
  let nextAccuracy: number | null = null;
  let nextPlaceName: string | null = existing?.place_name ?? null;
  let nextUpdatedAt: string | null = existing?.location_updated_at ?? null;

  if (params.mode === 'ghost') {
    nextLat = null;
    nextLng = null;
    nextAccuracy = null;
    nextPlaceName = null;
    nextUpdatedAt = null;
  } else if (params.mode === 'on_moment') {
    if (
      params.lat !== undefined &&
      params.lat !== null &&
      params.lng !== undefined &&
      params.lng !== null
    ) {
      nextLat = params.lat;
      nextLng = params.lng;
      nextAccuracy = params.accuracyM ?? 36;
      nextPlaceName = params.placeName ?? existing?.place_name ?? 'Moment Check-In';
      nextUpdatedAt = nowIso;
    } else {
      const momentCoords = await findLatestSandboxMomentCoords(params.coupleId, params.userId);
      if (momentCoords) {
        nextLat = momentCoords.lat;
        nextLng = momentCoords.lng;
        nextAccuracy = 40;
        nextPlaceName = params.placeName ?? momentCoords.placeName ?? 'Moment Check-In';
        nextUpdatedAt = momentCoords.postedAt;
      } else {
        nextLat = existing?.lat ?? null;
        nextLng = existing?.lng ?? null;
        nextAccuracy = existing?.accuracy_m ?? null;
        nextPlaceName = params.placeName ?? existing?.place_name ?? null;
        nextUpdatedAt = existing?.location_updated_at ?? null;
      }
    }
  } else {
    nextLat = params.lat ?? existing?.lat ?? null;
    nextLng = params.lng ?? existing?.lng ?? null;
    nextAccuracy = params.accuracyM ?? existing?.accuracy_m ?? null;
    nextPlaceName = params.placeName ?? existing?.place_name ?? null;
    nextUpdatedAt = nextLat !== null && nextLng !== null ? nowIso : null;
  }

  locationsMap[myKey] = {
    user_id: params.userId,
    couple_id: params.coupleId,
    display_name: existing?.display_name ?? myDisplayName,
    mode: params.mode,
    lat: nextLat,
    lng: nextLng,
    accuracy_m: nextAccuracy,
    place_name: nextPlaceName,
    location_updated_at: nextUpdatedAt,
    mode_changed_at:
      previousMode !== params.mode ? nowIso : (existing?.mode_changed_at ?? nowIso),
  };

  await safeSetStorageItem(LOCAL_LOCATIONS_KEY, JSON.stringify(locationsMap));

  let modeEvent: CoupleEventRecord | undefined;
  if (previousMode !== params.mode || params.placeName !== undefined) {
    modeEvent = await appendLocationModeEvent({
      coupleId: params.coupleId,
      actorId: params.userId,
      previousMode,
      newMode: params.mode,
      note: params.placeName ? `Checked in at ${params.placeName}` : undefined,
      createdAtIso: nowIso,
    });
  }

  void broadcastCoupleSync(params.coupleId, {
    kind: 'location_upsert',
    location: locationsMap[myKey],
    event: modeEvent,
  });
  return fetchCoupleLocations({
    coupleId: params.coupleId,
    userId: params.userId,
  });
}

export async function simulateSandboxPartnerLocation(params: {
  coupleId: string;
  partnerId: string;
  mode: LocationMode;
  userId?: string;
}): Promise<CoupleLocationBundle> {
  const locationsMap = await readLocalLocations();
  const nowIso = new Date().toISOString();

  const callerUserId =
    params.userId ??
    useSessionStore.getState().user?.id ??
    Object.values(locationsMap).find(
      (row) => row.couple_id === params.coupleId && row.user_id !== params.partnerId
    )?.user_id ??
    'sandbox_user_self';

  const myKey = `${params.coupleId}:${callerUserId}`;
  const partnerKey = `${params.coupleId}:${params.partnerId}`;

  const mine = locationsMap[myKey];
  const existingPartner = locationsMap[partnerKey];
  const previousMode: LocationMode = existingPartner?.mode ?? 'ghost';

  const baseLat = mine?.lat ?? FALLBACK_LIVE_COORDS.lat;
  const baseLng = mine?.lng ?? FALLBACK_LIVE_COORDS.lng;
  const cosLat = Math.max(0.2, Math.cos((baseLat * Math.PI) / 180));

  let nextLat: number | null = null;
  let nextLng: number | null = null;
  let nextAccuracy: number | null = null;
  let nextUpdatedAt: string | null = null;

  let nextPlaceName: string | null = null;

  if (params.mode === 'live') {
    nextLat = DEFAULT_PARTNER_LIVE_COORDS.lat;
    nextLng = DEFAULT_PARTNER_LIVE_COORDS.lng;
    nextAccuracy = DEFAULT_PARTNER_LIVE_COORDS.accuracyM;
    nextPlaceName = DEFAULT_PARTNER_LIVE_COORDS.placeName;
    nextUpdatedAt = nowIso;
  } else if (params.mode === 'on_moment') {
    // ~1.8 km northwest Moment check-in pin
    nextLat = baseLat + 0.0114;
    nextLng = baseLng - 0.0115 / cosLat;
    nextAccuracy = 42;
    nextPlaceName = 'Moment Check-In · SF';
    nextUpdatedAt = nowIso;
  }

  locationsMap[partnerKey] = {
    user_id: params.partnerId,
    couple_id: params.coupleId,
    display_name: existingPartner?.display_name ?? useSessionStore.getState().partner?.display_name,
    mode: params.mode,
    lat: nextLat,
    lng: nextLng,
    accuracy_m: nextAccuracy,
    place_name: nextPlaceName,
    location_updated_at: nextUpdatedAt,
    mode_changed_at: nowIso,
  };
  await safeSetStorageItem(LOCAL_LOCATIONS_KEY, JSON.stringify(locationsMap));

  await appendLocationModeEvent({
    coupleId: params.coupleId,
    actorId: params.partnerId,
    previousMode,
    newMode: params.mode,
    createdAtIso: nowIso,
  });

  return fetchCoupleLocations({
    coupleId: params.coupleId,
    userId: callerUserId,
  });
}
