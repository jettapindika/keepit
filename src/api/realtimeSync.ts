// src/api/realtimeSync.ts
// Cross-device Supabase Realtime Broadcast + Presence sync bus for paired couples.
// Reuses the active subscribed couple channel so broadcastCoupleSync never unsubscribes the listener!

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { isSupabaseConfigured, supabase } from '@/api/supabase';
import {
  CoupleEventRecord,
  LocationShareRecord,
  MomentRecord,
  StatusRecord,
} from '@/types/database';

const LOCAL_MOMENTS_KEY = 'keepit.local_moments.v1';
const LOCAL_STATUS_KEY = 'keepit.local_statuses.v1';
const LOCAL_LOCATIONS_KEY = 'keepit.local_locations.v1';
const LOCAL_EVENTS_KEY = 'keepit.local_events.v1';

export type CoupleSyncPacket =
  | { kind: 'moment_upsert'; moment: MomentRecord }
  | { kind: 'status_upsert'; status: StatusRecord }
  | { kind: 'status_clear'; userId: string }
  | { kind: 'location_upsert'; location: LocationShareRecord; event?: CoupleEventRecord }
  | { kind: 'nudge_sent'; event: CoupleEventRecord }
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
  }
}
