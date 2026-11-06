// src/api/realtimeSync.ts
// Cross-device Supabase Realtime Broadcast + Presence sync bus for paired couples & friends.
// Reuses the active subscribed couple channel so broadcastCoupleSync never unsubscribes the listener!

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { isSupabaseConfigured, supabase } from '@/api/supabase';
import {
  CoupleEventRecord,
  DirectMessageRecord,
  FriendRecord,
  LocationShareRecord,
  MomentCommentRecord,
  MomentRecord,
  StatusRecord,
  UserProfile,
} from '@/types/database';

const LOCAL_MOMENTS_KEY = 'keepit.local_moments.v1';
const LOCAL_STATUS_KEY = 'keepit.local_statuses.v1';
const LOCAL_LOCATIONS_KEY = 'keepit.local_locations.v1';
const LOCAL_EVENTS_KEY = 'keepit.local_events.v1';
const LOCAL_MESSAGES_KEY = 'keepit.local_messages.v1';
const LOCAL_FRIENDS_KEY = 'keepit.local_friends.v1';
const LOCAL_DB_KEY = 'keepit.local_db.v1';

export type CoupleSyncPacket =
  | { kind: 'moment_upsert'; moment: MomentRecord }
  | { kind: 'moment_delete'; momentId: string; userId: string }
  | { kind: 'moment_comment'; momentId: string; comment: MomentCommentRecord }
  | { kind: 'moment_reaction'; momentId: string; userId: string; emoji: string | null }
  | { kind: 'moment_snap_viewed'; momentId: string; viewerId: string; openedAtIso: string; expired?: boolean }
  | { kind: 'status_upsert'; status: StatusRecord }
  | { kind: 'status_clear'; userId: string }
  | { kind: 'location_upsert'; location: LocationShareRecord; event?: CoupleEventRecord }
  | { kind: 'nudge_sent'; event: CoupleEventRecord }
  | { kind: 'dm_upsert'; message: DirectMessageRecord }
  | { kind: 'dm_reaction'; messageId: string; userId: string; emoji: string }
  | { kind: 'dm_snap_viewed'; messageId: string; viewerId: string; viewedAtIso: string }
  | { kind: 'profile_upsert'; profile: UserProfile }
  | { kind: 'friend_added'; friend: FriendRecord }
  | { kind: 'unpair'; actorId: string };

let activeCoupleChannel: RealtimeChannel | null = null;
let activeCoupleChannelId: string | null = null;

export function registerActiveCoupleChannel(
  coupleId: string | null,
  channel: RealtimeChannel | null
): void {
  activeCoupleChannelId = coupleId;
  activeCoupleChannel = channel;
}

export async function broadcastCoupleSync(
  coupleId: string,
  packet: CoupleSyncPacket
): Promise<void> {
  if (!coupleId || !isSupabaseConfigured || !supabase) return;

  if (activeCoupleChannel && activeCoupleChannelId === coupleId) {
    await activeCoupleChannel
      .send({
        type: 'broadcast',
        event: 'couple_packet',
        payload: packet,
      })
      .catch(() => {});
    return;
  }

  const client = supabase;
  const tempTopic = `keepit:couple_sync:${coupleId}`;
  const ch = client.channel(tempTopic, {
    config: { broadcast: { ack: true, self: false } },
  });

  const { promise, resolve } = Promise.withResolvers<void>();
  const timeout = setTimeout(resolve, 1200);
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      void ch
        .send({
          type: 'broadcast',
          event: 'couple_packet',
          payload: packet,
        })
        .finally(() => {
          clearTimeout(timeout);
          resolve();
        });
    }
  });
  await promise;
  void client.removeChannel(ch);
}

export async function applyIncomingCouplePacket(packet: CoupleSyncPacket): Promise<void> {
  if (packet.kind === 'moment_upsert') {
    const raw = await AsyncStorage.getItem(LOCAL_MOMENTS_KEY);
    const state = raw
      ? (JSON.parse(raw) as {
          prompts: Record<string, unknown>;
          moments: Record<string, MomentRecord>;
          streaks: Record<
            string,
            {
              couple_id: string;
              current_count: number;
              longest_count: number;
              last_completed_date: string | null;
            }
          >;
        })
      : { prompts: {}, moments: {}, streaks: {} };

    const m = packet.moment;
    state.moments[m.id] = m;
    // Also maintain legacy key if needed so both lookups succeed
    state.moments[`${m.prompt_id}:${m.user_id}`] = m;

    const distinctUsers = new Set(
      Object.values(state.moments)
        .filter((item) => item.prompt_id === m.prompt_id)
        .map((item) => item.user_id)
    );
    if (distinctUsers.size >= 2) {
      const prev = state.streaks[m.couple_id] ?? {
        couple_id: m.couple_id,
        current_count: 0,
        longest_count: 0,
        last_completed_date: null,
      };
      const today = new Date().toISOString().slice(0, 10);
      if (prev.last_completed_date !== today) {
        const nextCount = prev.current_count + 1;
        state.streaks[m.couple_id] = {
          couple_id: m.couple_id,
          current_count: nextCount,
          longest_count: Math.max(prev.longest_count, nextCount),
          last_completed_date: today,
        };
      }
    }
    await AsyncStorage.setItem(LOCAL_MOMENTS_KEY, JSON.stringify(state));
    return;
  }

  if (packet.kind === 'moment_delete') {
    const raw = await AsyncStorage.getItem(LOCAL_MOMENTS_KEY);
    if (!raw) return;
    const state = JSON.parse(raw) as {
      prompts: Record<string, unknown>;
      moments: Record<string, MomentRecord>;
      streaks: Record<string, unknown>;
    };
    for (const [k, rec] of Object.entries(state.moments)) {
      if (rec.id === packet.momentId) {
        delete state.moments[k];
      }
    }
    await AsyncStorage.setItem(LOCAL_MOMENTS_KEY, JSON.stringify(state));
    return;
  }

  if (packet.kind === 'moment_comment') {
    const raw = await AsyncStorage.getItem(LOCAL_MOMENTS_KEY);
    if (!raw) return;
    const state = JSON.parse(raw) as {
      prompts: Record<string, unknown>;
      moments: Record<string, MomentRecord>;
      streaks: Record<string, unknown>;
    };
    for (const [k, rec] of Object.entries(state.moments)) {
      if (rec.id === packet.momentId) {
        const existingComments = rec.comments ?? [];
        if (!existingComments.some((c) => c.id === packet.comment.id)) {
          state.moments[k] = {
            ...rec,
            comments: [...existingComments, packet.comment],
          };
        }
      }
    }
    await AsyncStorage.setItem(LOCAL_MOMENTS_KEY, JSON.stringify(state));
    return;
  }

  if (packet.kind === 'moment_reaction') {
    const raw = await AsyncStorage.getItem(LOCAL_MOMENTS_KEY);
    if (!raw) return;
    const state = JSON.parse(raw) as {
      prompts: Record<string, unknown>;
      moments: Record<string, MomentRecord>;
      streaks: Record<string, unknown>;
    };
    for (const [k, rec] of Object.entries(state.moments)) {
      if (rec.id === packet.momentId) {
        const nextReactions = { ...(rec.reactions ?? {}) };
        if (packet.emoji) {
          nextReactions[packet.userId] = packet.emoji;
        } else {
          delete nextReactions[packet.userId];
        }
        state.moments[k] = {
          ...rec,
          reactions: nextReactions,
        };
      }
    }
    await AsyncStorage.setItem(LOCAL_MOMENTS_KEY, JSON.stringify(state));
    return;
  }

  if (packet.kind === 'moment_snap_viewed') {
    const raw = await AsyncStorage.getItem(LOCAL_MOMENTS_KEY);
    if (!raw) return;
    const state = JSON.parse(raw) as {
      prompts: Record<string, unknown>;
      moments: Record<string, MomentRecord>;
      streaks: Record<string, unknown>;
    };
    for (const [k, rec] of Object.entries(state.moments)) {
      if (rec.id === packet.momentId) {
        const openedMap = { ...(rec.snap_opened_at_by_user ?? {}) };
        if (!openedMap[packet.viewerId]) {
          openedMap[packet.viewerId] = packet.openedAtIso;
        }
        const viewedSet = new Set(rec.viewed_by_user_ids ?? []);
        if (packet.expired) {
          viewedSet.add(packet.viewerId);
        }
        state.moments[k] = {
          ...rec,
          snap_opened_at_by_user: openedMap,
          viewed_by_user_ids: Array.from(viewedSet),
        };
      }
    }
    await AsyncStorage.setItem(LOCAL_MOMENTS_KEY, JSON.stringify(state));
    return;
  }

  if (packet.kind === 'status_upsert') {
    const raw = await AsyncStorage.getItem(LOCAL_STATUS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, StatusRecord>) : {};
    map[packet.status.user_id] = packet.status;
    await AsyncStorage.setItem(LOCAL_STATUS_KEY, JSON.stringify(map));
    return;
  }

  if (packet.kind === 'status_clear') {
    const raw = await AsyncStorage.getItem(LOCAL_STATUS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, StatusRecord>) : {};
    delete map[packet.userId];
    await AsyncStorage.setItem(LOCAL_STATUS_KEY, JSON.stringify(map));
    return;
  }

  if (packet.kind === 'location_upsert') {
    const raw = await AsyncStorage.getItem(LOCAL_LOCATIONS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, LocationShareRecord>) : {};
    const loc = packet.location;
    map[`${loc.couple_id}:${loc.user_id}`] = loc;
    await AsyncStorage.setItem(LOCAL_LOCATIONS_KEY, JSON.stringify(map));

    if (packet.event) {
      const rawEvents = await AsyncStorage.getItem(LOCAL_EVENTS_KEY);
      const events = rawEvents ? (JSON.parse(rawEvents) as CoupleEventRecord[]) : [];
      await AsyncStorage.setItem(
        LOCAL_EVENTS_KEY,
        JSON.stringify([packet.event, ...events].slice(0, 60))
      );
    }
    return;
  }

  if (packet.kind === 'nudge_sent') {
    const rawEvents = await AsyncStorage.getItem(LOCAL_EVENTS_KEY);
    const events = rawEvents ? (JSON.parse(rawEvents) as CoupleEventRecord[]) : [];
    await AsyncStorage.setItem(
      LOCAL_EVENTS_KEY,
      JSON.stringify([packet.event, ...events].slice(0, 60))
    );
    return;
  }

  if (packet.kind === 'dm_upsert') {
    const raw = await AsyncStorage.getItem(LOCAL_MESSAGES_KEY);
    const list = raw ? (JSON.parse(raw) as DirectMessageRecord[]) : [];
    const idx = list.findIndex((m) => m.id === packet.message.id);
    if (idx >= 0) {
      list[idx] = packet.message;
    } else {
      list.push(packet.message);
    }
    await AsyncStorage.setItem(LOCAL_MESSAGES_KEY, JSON.stringify(list.slice(-300)));
    return;
  }

  if (packet.kind === 'dm_reaction') {
    const raw = await AsyncStorage.getItem(LOCAL_MESSAGES_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as DirectMessageRecord[];
    const next = list.map((m) => {
      if (m.id !== packet.messageId) return m;
      return {
        ...m,
        reactions: { ...(m.reactions ?? {}), [packet.userId]: packet.emoji },
      };
    });
    await AsyncStorage.setItem(LOCAL_MESSAGES_KEY, JSON.stringify(next));
    return;
  }

  if (packet.kind === 'dm_snap_viewed') {
    const raw = await AsyncStorage.getItem(LOCAL_MESSAGES_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as DirectMessageRecord[];
    const next = list.map((m) => {
      if (m.id !== packet.messageId) return m;
      const viewed = new Set(m.viewed_by_user_ids ?? []);
      viewed.add(packet.viewerId);
      return {
        ...m,
        viewed_by_user_ids: Array.from(viewed),
        viewed_at: packet.viewedAtIso,
      };
    });
    await AsyncStorage.setItem(LOCAL_MESSAGES_KEY, JSON.stringify(next));
    return;
  }

  if (packet.kind === 'profile_upsert') {
    const rawDb = await AsyncStorage.getItem(LOCAL_DB_KEY);
    const db = rawDb
      ? (JSON.parse(rawDb) as { users: Record<string, UserProfile>; couples: Record<string, unknown> })
      : { users: {}, couples: {} };
    db.users[packet.profile.id] = packet.profile;
    await AsyncStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
    return;
  }

  if (packet.kind === 'friend_added') {
    const raw = await AsyncStorage.getItem(LOCAL_FRIENDS_KEY);
    const list = raw ? (JSON.parse(raw) as FriendRecord[]) : [];
    if (!list.some((f) => f.id === packet.friend.id)) {
      list.push(packet.friend);
      await AsyncStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(list));
    }
  }
}
