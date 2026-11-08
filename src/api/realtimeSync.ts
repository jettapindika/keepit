// src/api/realtimeSync.ts
// Cross-device Supabase Realtime Broadcast + Presence sync bus for paired couples & friends.
// Reuses the active subscribed couple channel so broadcastCoupleSync never unsubscribes the listener!

import type { RealtimeChannel } from '@supabase/supabase-js';

import { readLocalMoments, writeLocalMoments } from '@/api/moments';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { useSessionStore } from '@/store/sessionStore';
import { safeGetStorageItem, safeSetStorageItem } from '@/utils/safeAsyncStorage';
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
import { advanceStreakOnDualPost } from '@/utils/streakEngine';

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
  | { kind: 'moment_comment_delete'; momentId: string; commentId: string }
  | { kind: 'moment_reaction'; momentId: string; userId: string; emoji: string | null }
  | {
      kind: 'moment_snap_viewed';
      momentId: string;
      viewerId: string;
      openedAtIso: string;
      expired?: boolean;
    }
  | { kind: 'status_upsert'; status: StatusRecord }
  | { kind: 'status_clear'; userId: string }
  | { kind: 'location_upsert'; location: LocationShareRecord; event?: CoupleEventRecord }
  | { kind: 'nudge_sent'; event: CoupleEventRecord }
  | { kind: 'dm_upsert'; message: DirectMessageRecord }
  | { kind: 'dm_reaction'; messageId: string; userId: string; emoji: string | null }
  | {
      kind: 'dm_snap_viewed';
      messageId: string;
      viewerId: string;
      openedAtIso?: string;
      viewedAtIso: string;
      expired?: boolean;
    }
  | { kind: 'profile_upsert'; profile: UserProfile }
  | { kind: 'friend_added'; friend: FriendRecord }
  | { kind: 'unpair'; actorId: string };
/**
 * Topic builders for KeepIt Realtime channels.
 * Note: Using standard Realtime broadcast/presence topics so channels connect
 * immediately even when `realtime.messages` RLS migrations have not been applied.
 */
export function buildCoupleSyncChannelTopic(coupleId: string): string {
  return `keepit:couple_sync:${coupleId}`;
}

export function buildInviteChannelTopic(inviteCode: string): string {
  return `keepit:invite:${inviteCode}`;
}

export function buildDirectMessageSyncChannelTopic(conversationId: string): string {
  return `keepit:dm_sync:${conversationId}`;
}

export function buildUserDirectoryChannelTopic(): string {
  return 'keepit:user_directory';
}

let activeCoupleChannel: RealtimeChannel | null = null;
let activeCoupleChannelId: string | null = null;
let activeDirectoryChannel: RealtimeChannel | null = null;

export type DirectoryUserAnnounceListener = (profile: UserProfile) => void;
export type DirectoryInviteAnnounceListener = (payload: {
  couple: {
    id: string;
    user_a_id: string;
    user_b_id: string | null;
    invite_code: string;
    invite_expires_at: string;
    state: 'pending' | 'active';
    paired_at: string | null;
    created_at: string;
  };
  hostProfile: UserProfile;
}) => void;

const userAnnounceListeners = new Set<DirectoryUserAnnounceListener>();
const inviteAnnounceListeners = new Set<DirectoryInviteAnnounceListener>();

export function subscribeDirectoryUserAnnounce(
  listener: DirectoryUserAnnounceListener
): () => void {
  userAnnounceListeners.add(listener);
  return () => {
    userAnnounceListeners.delete(listener);
  };
}

export function emitDirectoryUserAnnounce(profile: UserProfile): void {
  for (const listener of userAnnounceListeners) {
    try {
      listener(profile);
    } catch {
      // Ignore individual listener error
    }
  }
}

export function subscribeDirectoryInviteAnnounce(
  listener: DirectoryInviteAnnounceListener
): () => void {
  inviteAnnounceListeners.add(listener);
  return () => {
    inviteAnnounceListeners.delete(listener);
  };
}

export function emitDirectoryInviteAnnounce(
  payload: Parameters<DirectoryInviteAnnounceListener>[0]
): void {
  for (const listener of inviteAnnounceListeners) {
    try {
      listener(payload);
    } catch {
      // Ignore individual listener error
    }
  }
}

export function registerActiveCoupleChannel(
  coupleId: string | null,
  channel: RealtimeChannel | null
): void {
  activeCoupleChannelId = coupleId;
  activeCoupleChannel = channel;
}

export function registerActiveDirectoryChannel(channel: RealtimeChannel | null): void {
  activeDirectoryChannel = channel;
}

export function getActiveDirectoryChannel(): RealtimeChannel | null {
  return activeDirectoryChannel;
}

export async function syncDirectoryPresence(params: {
  profile: UserProfile;
  couple?: {
    id: string;
    user_a_id: string;
    user_b_id: string | null;
    invite_code: string;
    invite_expires_at: string;
    state: 'pending' | 'active';
    paired_at: string | null;
    created_at: string;
  } | null;
}): Promise<void> {
  if (!activeDirectoryChannel || !params.profile?.id) return;
  let effectiveCouple = params.couple;
  if (effectiveCouple === undefined) {
    const rawDb = await safeGetStorageItem(LOCAL_DB_KEY);
    if (rawDb) {
      try {
        const parsed = JSON.parse(rawDb) as {
          couples?: Record<
            string,
            {
              id: string;
              user_a_id: string;
              user_b_id: string | null;
              invite_code: string;
              invite_expires_at: string;
              state: 'pending' | 'active';
              paired_at: string | null;
              created_at: string;
            }
          >;
        };
        effectiveCouple =
          Object.values(parsed?.couples ?? {}).find(
            (c) => c.user_a_id === params.profile.id && c.state === 'pending'
          ) ?? null;
      } catch {
        effectiveCouple = null;
      }
    }
  }
  await activeDirectoryChannel
    .track({
      profile: params.profile,
      couple:
        effectiveCouple && effectiveCouple.state === 'pending' ? effectiveCouple : undefined,
    })
    .catch(() => {});
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

  const tempTopic = coupleId.startsWith('keepit:')
    ? coupleId
    : buildCoupleSyncChannelTopic(coupleId);

  if (activeDirectoryChannel && tempTopic === buildUserDirectoryChannelTopic()) {
    await activeDirectoryChannel
      .send({
        type: 'broadcast',
        event: 'couple_packet',
        payload: packet,
      })
      .catch(() => {});
    return;
  }

  const client = supabase;
  const existingChannel = client
    .getChannels()
    .find((c) => c.topic === `realtime:${tempTopic}` || c.topic === tempTopic);

  if (existingChannel && existingChannel.state === 'joined') {
    await existingChannel
      .send({
        type: 'broadcast',
        event: 'couple_packet',
        payload: packet,
      })
      .catch(() => {});
    return;
  }

  const ownsChannel = !existingChannel;
  const ch =
    existingChannel ??
    client.channel(tempTopic, {
      config: { broadcast: { ack: true, self: false } },
    });

  if (!ownsChannel) {
    // Channel already exists and is joining; send once joined without removing it!
    await ch
      .send({
        type: 'broadcast',
        event: 'couple_packet',
        payload: packet,
      })
      .catch(() => {});
    return;
  }

  const { promise, resolve } = Promise.withResolvers<void>();
  const timeout = setTimeout(resolve, 1500);
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
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      clearTimeout(timeout);
      resolve();
    }
  });
  await promise;
  void client.removeChannel(ch);
}

export async function applyIncomingCouplePacket(packet: CoupleSyncPacket): Promise<void> {
  if (packet.kind === 'moment_upsert') {
    const state = await readLocalMoments();

    const m = packet.moment;
    const existing = state.moments[m.id];
    const mergedMoment: MomentRecord = existing
      ? {
          ...existing,
          ...m,
          back_photo_path:
            m.back_photo_path || m.back_photo_url || existing.back_photo_path,
          front_photo_path:
            m.front_photo_path || m.front_photo_url || existing.front_photo_path,
          back_photo_url:
            m.back_photo_url || m.back_photo_path || existing.back_photo_url,
          front_photo_url:
            m.front_photo_url || m.front_photo_path || existing.front_photo_url,
        }
      : {
          ...m,
          back_photo_url: m.back_photo_url || m.back_photo_path,
          front_photo_url: m.front_photo_url || m.front_photo_path,
        };
    state.moments[m.id] = mergedMoment;
    // Also maintain legacy key if needed so both lookups succeed
    state.moments[`${m.prompt_id}:${m.user_id}`] = mergedMoment;

    const promptMoments = Object.values(state.moments).filter(
      (item) => item.prompt_id === m.prompt_id && !item.user_id.startsWith('friend_')
    );
    const distinctUsers = new Set(promptMoments.map((item) => item.user_id));
    if (distinctUsers.size >= 2) {
      const today = (m.posted_at || new Date().toISOString()).slice(0, 10);
      const bothOnTime = promptMoments.every((item) => !item.is_late);
      state.streaks[m.couple_id] = advanceStreakOnDualPost({
        previous: state.streaks[m.couple_id],
        coupleId: m.couple_id,
        todayDate: today,
        bothOnTime,
      });
    }
    await writeLocalMoments(state);
    return;
  }
  if (packet.kind === 'moment_delete') {
    const state = await readLocalMoments();
    for (const [k, rec] of Object.entries(state.moments)) {
      if (rec.id === packet.momentId) {
        delete state.moments[k];
      }
    }
    await writeLocalMoments(state);
    return;
  }

  if (packet.kind === 'moment_comment') {
    const state = await readLocalMoments();
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
    await writeLocalMoments(state);
    return;
  }
  if (packet.kind === 'moment_comment_delete') {
    const state = await readLocalMoments();
    for (const [k, rec] of Object.entries(state.moments)) {
      if (rec.id === packet.momentId) {
        state.moments[k] = {
          ...rec,
          comments: (rec.comments ?? []).filter((c) => c.id !== packet.commentId),
        };
      }
    }
    await writeLocalMoments(state);
    return;
  }

  if (packet.kind === 'moment_reaction') {
    const state = await readLocalMoments();
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
    await writeLocalMoments(state);
    return;
  }

  if (packet.kind === 'moment_snap_viewed') {
    const state = await readLocalMoments();
    for (const [k, rec] of Object.entries(state.moments)) {
      if (rec.id === packet.momentId) {
        if (rec.user_id === packet.viewerId) continue;
        const openedMap = { ...(rec.snap_opened_at_by_user ?? {}) };
        if (!openedMap[packet.viewerId]) {
          openedMap[packet.viewerId] = packet.openedAtIso;
        }
        const viewedSet = new Set(rec.viewed_by_user_ids ?? []);
        if (packet.expired) {
          viewedSet.add(packet.viewerId);
        }
        const currentViewerId = useSessionStore.getState().user?.id;
        const shouldScrubOnThisDevice = Boolean(
          packet.expired && currentViewerId && currentViewerId === packet.viewerId
        );
        state.moments[k] = {
          ...rec,
          snap_opened_at_by_user: openedMap,
          viewed_by_user_ids: Array.from(viewedSet),
          ...(shouldScrubOnThisDevice
            ? {
                back_photo_path: '',
                front_photo_path: '',
                back_photo_url: null,
                front_photo_url: null,
                video_uri: null,
                caption: null,
              }
            : {}),
        };
      }
    }
    await writeLocalMoments(state);
    return;
  }

  if (packet.kind === 'status_upsert') {
    const raw = await safeGetStorageItem(LOCAL_STATUS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, StatusRecord>) : {};
    map[packet.status.user_id] = packet.status;
    await safeSetStorageItem(LOCAL_STATUS_KEY, JSON.stringify(map));
    return;
  }

  if (packet.kind === 'status_clear') {
    const raw = await safeGetStorageItem(LOCAL_STATUS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, StatusRecord>) : {};
    delete map[packet.userId];
    await safeSetStorageItem(LOCAL_STATUS_KEY, JSON.stringify(map));
    return;
  }

  if (packet.kind === 'location_upsert') {
    const raw = await safeGetStorageItem(LOCAL_LOCATIONS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, LocationShareRecord>) : {};
    const loc = packet.location;
    map[`${loc.couple_id}:${loc.user_id}`] = loc;
    await safeSetStorageItem(LOCAL_LOCATIONS_KEY, JSON.stringify(map));

    if (packet.event) {
      const rawEvents = await safeGetStorageItem(LOCAL_EVENTS_KEY);
      const events = rawEvents ? (JSON.parse(rawEvents) as CoupleEventRecord[]) : [];
      await safeSetStorageItem(
        LOCAL_EVENTS_KEY,
        JSON.stringify([packet.event, ...events].slice(0, 60))
      );
    }
    return;
  }

  if (packet.kind === 'nudge_sent') {
    const rawEvents = await safeGetStorageItem(LOCAL_EVENTS_KEY);
    const events = rawEvents ? (JSON.parse(rawEvents) as CoupleEventRecord[]) : [];
    await safeSetStorageItem(
      LOCAL_EVENTS_KEY,
      JSON.stringify([packet.event, ...events].slice(0, 60))
    );
    return;
  }

  if (packet.kind === 'dm_upsert') {
    const raw = await safeGetStorageItem(LOCAL_MESSAGES_KEY);
    const list = raw ? (JSON.parse(raw) as DirectMessageRecord[]) : [];
    const idx = list.findIndex((m) => m.id === packet.message.id);
    if (idx >= 0) {
      list[idx] = packet.message;
    } else {
      list.push(packet.message);
    }
    await safeSetStorageItem(LOCAL_MESSAGES_KEY, JSON.stringify(list.slice(-300)));
    return;
  }

  if (packet.kind === 'dm_reaction') {
    const raw = await safeGetStorageItem(LOCAL_MESSAGES_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as DirectMessageRecord[];
    const next = list.map((m) => {
      if (m.id !== packet.messageId) return m;
      const nextReactions = { ...(m.reactions ?? {}) };
      if (packet.emoji) {
        nextReactions[packet.userId] = packet.emoji;
      } else {
        delete nextReactions[packet.userId];
      }
      return {
        ...m,
        reactions: nextReactions,
      };
    });
    await safeSetStorageItem(LOCAL_MESSAGES_KEY, JSON.stringify(next));
    return;
  }

  if (packet.kind === 'dm_snap_viewed') {
    const raw = await safeGetStorageItem(LOCAL_MESSAGES_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as DirectMessageRecord[];
    const next = list.map((m) => {
      if (m.id !== packet.messageId) return m;
      if (m.sender_id === packet.viewerId) return m;
      const openedMap = { ...(m.snap_opened_at_by_user ?? {}) };
      if (!openedMap[packet.viewerId]) {
        openedMap[packet.viewerId] = packet.openedAtIso ?? packet.viewedAtIso;
      }
      const viewed = new Set(m.viewed_by_user_ids ?? []);
      const isExpired = packet.expired !== false;
      if (isExpired) {
        viewed.add(packet.viewerId);
      }
      return {
        ...m,
        snap_opened_at_by_user: openedMap,
        viewed_by_user_ids: Array.from(viewed),
        viewed_at: isExpired ? packet.viewedAtIso : (m.viewed_at ?? null),
        text: isExpired ? '' : m.text,
        media_uri: isExpired ? null : m.media_uri,
      };
    });
    await safeSetStorageItem(LOCAL_MESSAGES_KEY, JSON.stringify(next));
    return;
  }

  if (packet.kind === 'profile_upsert') {
    const rawDb = await safeGetStorageItem(LOCAL_DB_KEY);
    const db = rawDb
      ? (JSON.parse(rawDb) as { users: Record<string, UserProfile>; couples: Record<string, unknown> })
      : { users: {}, couples: {} };
    db.users[packet.profile.id] = packet.profile;
    await safeSetStorageItem(LOCAL_DB_KEY, JSON.stringify(db));
    return;
  }

  if (packet.kind === 'friend_added') {
    const raw = await safeGetStorageItem(LOCAL_FRIENDS_KEY);
    const list = raw ? (JSON.parse(raw) as FriendRecord[]) : [];
    const existingIdx = list.findIndex(
      (f) => f.id === packet.friend.id || (f.user_id === packet.friend.user_id && f.friend_id === packet.friend.friend_id)
    );
    if (existingIdx >= 0) {
      list[existingIdx] = packet.friend;
    } else {
      list.push(packet.friend);
    }
    await safeSetStorageItem(LOCAL_FRIENDS_KEY, JSON.stringify(list));

    if (packet.friend.friend_profile?.id) {
      const rawDb = await safeGetStorageItem(LOCAL_DB_KEY);
      const db = rawDb
        ? (JSON.parse(rawDb) as { users: Record<string, UserProfile>; couples: Record<string, unknown> })
        : { users: {}, couples: {} };
      db.users[packet.friend.friend_profile.id] = packet.friend.friend_profile;
      await safeSetStorageItem(LOCAL_DB_KEY, JSON.stringify(db));
    }
  }
}
