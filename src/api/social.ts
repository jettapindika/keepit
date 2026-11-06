// src/api/social.ts
// Social layer for KeepIt:
// - Friends circle (add by friend code/handle, list friends, remove friend, seed demo besties)
// - Direct Messages (DMs) with Partner & Friends (text, emoji reactions, moment replies, Snap Once 15s messages)
// - Curated Music Tracks & Location Presets for Moments
// - Filter preset definitions (Warm Film, Polaroid, Noir, Cyber Neon, Golden Hour, VHS Retro, Dreamy)

import AsyncStorage from '@react-native-async-storage/async-storage';

import { broadcastCoupleSync } from '@/api/realtimeSync';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import {
  DirectMessageRecord,
  FriendRecord,
  MomentFilterPreset,
  MusicTrackAttachment,
  UserProfile,
} from '@/types/database';

const LOCAL_FRIENDS_KEY = 'keepit.local_friends.v1';
const LOCAL_MESSAGES_KEY = 'keepit.local_messages.v1';
const LOCAL_DB_KEY = 'keepit.local_db.v1';

export const KNOWN_DIRECTORY_PROFILES: readonly UserProfile[] = [] as const;
export interface FilterPresetMeta {
  id: MomentFilterPreset;
  label: string;
  badge: string;
  tintOverlay: string;
  borderAccent: string;
  vignetteOpacity: number;
  webCssFilter: string;
  svgTintHex: string;
}

export const MOMENT_FILTER_PRESETS: readonly FilterPresetMeta[] = [
  {
    id: 'normal',
    label: 'Natural',
    badge: 'RAW',
    tintOverlay: 'transparent',
    borderAccent: '#E0E0E0',
    vignetteOpacity: 0,
    webCssFilter: 'none',
    svgTintHex: '#D95D39',
  },
  {
    id: 'warm_film',
    label: 'Warm 35mm',
    badge: '35MM',
    tintOverlay: 'rgba(255, 166, 94, 0.18)',
    borderAccent: '#F5A623',
    vignetteOpacity: 0.22,
    webCssFilter: 'sepia(0.28) saturate(1.35) contrast(1.06)',
    svgTintHex: '#E8833A',
  },
  {
    id: 'polaroid',
    label: 'Polaroid',
    badge: 'INSTA',
    tintOverlay: 'rgba(255, 238, 208, 0.20)',
    borderAccent: '#F3D299',
    vignetteOpacity: 0.18,
    webCssFilter: 'contrast(1.12) brightness(1.05) saturate(0.88)',
    svgTintHex: '#C79252',
  },
  {
    id: 'noir',
    label: 'Mono Noir',
    badge: 'B&W',
    tintOverlay: 'rgba(18, 18, 22, 0.34)',
    borderAccent: '#9A9AA0',
    vignetteOpacity: 0.38,
    webCssFilter: 'grayscale(1) contrast(1.24)',
    svgTintHex: '#6E6E77',
  },
  {
    id: 'cyber_neon',
    label: 'Cyber Glow',
    badge: 'NEON',
    tintOverlay: 'rgba(168, 85, 247, 0.22)',
    borderAccent: '#C084FC',
    vignetteOpacity: 0.25,
    webCssFilter: 'saturate(1.6) hue-rotate(-14deg) contrast(1.14)',
    svgTintHex: '#A855F7',
  },
  {
    id: 'golden_hour',
    label: 'Golden Hour',
    badge: 'SUN',
    tintOverlay: 'rgba(251, 146, 60, 0.24)',
    borderAccent: '#FB923C',
    vignetteOpacity: 0.2,
    webCssFilter: 'saturate(1.45) sepia(0.22) brightness(1.04)',
    svgTintHex: '#F97316',
  },
  {
    id: 'vhs_retro',
    label: 'VHS 98',
    badge: 'VHS',
    tintOverlay: 'rgba(56, 189, 248, 0.16)',
    borderAccent: '#38BDF8',
    vignetteOpacity: 0.3,
    webCssFilter: 'contrast(1.18) saturate(1.25) hue-rotate(8deg)',
    svgTintHex: '#0EA5E9',
  },
  {
    id: 'dreamy',
    label: 'Soft Bloom',
    badge: 'SOFT',
    tintOverlay: 'rgba(244, 114, 182, 0.18)',
    borderAccent: '#F472B6',
    vignetteOpacity: 0.14,
    webCssFilter: 'brightness(1.08) saturate(1.18) contrast(0.96)',
    svgTintHex: '#EC4899',
  },
] as const;

export function getFilterPresetMeta(preset?: MomentFilterPreset | null): FilterPresetMeta {
  return (
    MOMENT_FILTER_PRESETS.find((p) => p.id === preset) ?? MOMENT_FILTER_PRESETS[0]
  );
}

export const CURATED_MUSIC_TRACKS: readonly MusicTrackAttachment[] = [
  {
    id: 'trk_sunset_lover',
    title: 'Sunset Lover',
    artist: 'Petit Biscuit',
    coverColor: '#F97316',
    previewNote: '0:24 · Warm synth loop',
    bpm: 91,
  },
  {
    id: 'trk_coffee_breath',
    title: 'Coffee Breath',
    artist: 'Sofia Mills',
    coverColor: '#D97706',
    previewNote: '0:18 · Indie bedroom pop',
    bpm: 102,
  },
  {
    id: 'trk_midnight_city',
    title: 'Midnight Drive',
    artist: 'M83 & Neon',
    coverColor: '#8B5CF6',
    previewNote: '0:42 · Synthwave chorus',
    bpm: 105,
  },
  {
    id: 'trk_golden_hour',
    title: 'golden hour',
    artist: 'JVKE',
    coverColor: '#EAB308',
    previewNote: '1:05 · Piano crescendo',
    bpm: 94,
  },
  {
    id: 'trk_tokyo_rain',
    title: 'Shibuya Lo-Fi Rain',
    artist: 'Mochy Beats',
    coverColor: '#0EA5E9',
    previewNote: '0:33 · Vinyl crackle + Rhodes',
    bpm: 82,
  },
  {
    id: 'trk_best_part',
    title: 'Best Part',
    artist: 'Daniel Caesar & H.E.R.',
    coverColor: '#EC4899',
    previewNote: '0:50 · Acoustic duet',
    bpm: 75,
  },
] as const;

export const QUICK_LOCATION_PRESETS: readonly {
  label: string;
  lat: number;
  lng: number;
}[] = [
  { label: 'Blue Bottle Coffee · Downtown', lat: 37.7763, lng: -122.4232 },
  { label: 'Dolores Park Overlook', lat: 37.7596, lng: -122.4269 },
  { label: 'Cozy Home Studio', lat: 37.7749, lng: -122.4194 },
  { label: 'Late Night Ramen Bar', lat: 37.7852, lng: -122.4089 },
  { label: 'Golden Gate Pier Walk', lat: 37.8086, lng: -122.4098 },
  { label: 'Campus Library 3F', lat: 37.8719, lng: -122.2585 },
] as const;

export function buildDefaultUsername(displayName: string, userId: string): string {
  const base = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 14);
  const suffix = userId.replace(/[^a-z0-9]/gi, '').slice(-3).toLowerCase() || '24';
  return `${base || 'keepit'}_${suffix}`;
}

export function buildFriendCode(userId: string, displayName: string): string {
  const cleanName = displayName.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3).padEnd(3, 'K');
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) % 900 + 100;
  }
  return `${cleanName}-${String(hash).slice(0, 3)}`;
}

async function readLocalFriends(): Promise<FriendRecord[]> {
  const raw = await AsyncStorage.getItem(LOCAL_FRIENDS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as FriendRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeLocalFriends(list: FriendRecord[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(list));
}

async function readLocalDbUsers(): Promise<Record<string, UserProfile>> {
  const rawDb = await AsyncStorage.getItem(LOCAL_DB_KEY);
  const parsed: { users: Record<string, UserProfile>; couples: Record<string, unknown> } = rawDb
    ? (JSON.parse(rawDb) as { users: Record<string, UserProfile>; couples: Record<string, unknown> })
    : { users: {}, couples: {} };
  return parsed.users ?? {};
}
export async function fetchFriendsCircle(params: {
  userId: string;
  partner?: UserProfile | null;
}): Promise<FriendRecord[]> {
  const stored = await readLocalFriends();

  // Hydrate from Supabase `public.friendships` if available
  if (isSupabaseConfigured && supabase) {
    try {
      const { data: remoteRows, error: remoteErr } = await supabase
        .from('friendships')
        .select('id, user_id, friend_id, relationship, created_at')
        .eq('user_id', params.userId);

      if (!remoteErr && Array.isArray(remoteRows) && remoteRows.length > 0) {
        const friendIds = remoteRows.map((r) => String(r.friend_id));
        const { data: profiles } = await supabase
          .from('users')
          .select('*')
          .in('id', friendIds);
        const profileMap = new Map<string, UserProfile>(
          (profiles ?? []).map((p) => [String((p as UserProfile).id), p as UserProfile])
        );
        let changed = false;
        for (const r of remoteRows) {
          const fProfile = profileMap.get(String(r.friend_id));
          if (!fProfile) continue;
          const exists = stored.some(
            (loc) => loc.user_id === params.userId && loc.friend_id === fProfile.id
          );
          if (!exists) {
            stored.push({
              id: String(r.id),
              user_id: params.userId,
              friend_id: fProfile.id,
              friend_profile: fProfile,
              relationship: (r.relationship as 'bestie' | 'friend') ?? 'friend',
              created_at: String(r.created_at),
            });
            changed = true;
          }
        }
        if (changed) {
          await writeLocalFriends(stored);
        }
      }
    } catch {
      // Use local friends cache when offline
    }
  }

  return stored.filter((f) => f.user_id === params.userId);
}

export async function addFriendByHandleOrCode(params: {
  userId: string;
  coupleId?: string | null;
  query: string;
  relationship?: 'bestie' | 'friend';
}): Promise<FriendRecord> {
  const cleaned = params.query.trim().replace(/^@/, '');
  if (cleaned.length < 2) {
    throw new Error('Enter a friend’s @username, display name, or Friend Code.');
  }

  const existing = await readLocalFriends();
  const normalizedLower = cleaned.toLowerCase();
  const dbUsers = await readLocalDbUsers();
  // Check existing friends first so searching an already-added friend's code/handle returns existing
  const alreadyByQuery = existing.find(
    (f) =>
      f.user_id === params.userId &&
      (f.friend_profile.username?.toLowerCase() === normalizedLower ||
        f.friend_profile.display_name.toLowerCase() === normalizedLower ||
        f.friend_profile.friend_code?.toLowerCase() === normalizedLower)
  );
  if (alreadyByQuery) {
    if (params.relationship && alreadyByQuery.relationship !== params.relationship) {
      alreadyByQuery.relationship = params.relationship;
      await writeLocalFriends(existing);
    }
    return alreadyByQuery;
  }

  let matchedUser: UserProfile | undefined = Object.values(dbUsers).find(
    (u) =>
      u.id !== params.userId &&
      (u.username?.toLowerCase() === normalizedLower ||
        u.display_name.toLowerCase() === normalizedLower ||
        u.friend_code?.toLowerCase() === normalizedLower)
  );

  if (!matchedUser && isSupabaseConfigured && supabase) {
    try {
      const { data: remoteMatches } = await supabase
        .from('users')
        .select('*')
        .or(
          `username.ilike.${cleaned},friend_code.ilike.${cleaned},display_name.ilike.${cleaned}`
        )
        .neq('id', params.userId)
        .limit(1);
      if (Array.isArray(remoteMatches) && remoteMatches.length > 0) {
        matchedUser = remoteMatches[0] as UserProfile;
      }
    } catch {
      // Ignore remote lookup failure when offline
    }
  }

  if (!matchedUser) {
    throw new Error(
      `No KeepIt user found matching "${params.query.trim()}". Enter a registered @username, display name, or Friend Code.`
    );
  }

  if (matchedUser.id === params.userId) {
    throw new Error('You cannot add yourself to your Friends Circle.');
  }

  const already = existing.find(
    (f) => f.user_id === params.userId && f.friend_id === matchedUser!.id
  );
  if (already) {
    return already;
  }

  const nowIso = new Date().toISOString();
  const record: FriendRecord = {
    id: `fr_${params.userId}_${matchedUser.id}_${Date.now().toString(36)}`,
    user_id: params.userId,
    friend_id: matchedUser.id,
    friend_profile: matchedUser,
    relationship: params.relationship ?? 'friend',
    created_at: nowIso,
  };

  existing.push(record);
  await writeLocalFriends(existing);

  if (isSupabaseConfigured && supabase) {
    try {
      await supabase.from('friendships').upsert(
        {
          user_id: params.userId,
          friend_id: matchedUser.id,
          relationship: record.relationship,
        },
        { onConflict: 'user_id,friend_id' }
      );
    } catch {
      // Ignore when offline or table unmigrated
    }
  }

  if (params.coupleId) {
    void broadcastCoupleSync(params.coupleId, { kind: 'friend_added', friend: record });
  }
  return record;
}

export async function removeFriend(params: {
  userId: string;
  friendRecordId: string;
}): Promise<void> {
  const existing = await readLocalFriends();
  const target = existing.find(
    (f) =>
      f.user_id === params.userId &&
      (f.id === params.friendRecordId || f.friend_id === params.friendRecordId)
  );
  const next = existing.filter(
    (f) =>
      !(
        f.user_id === params.userId &&
        (f.id === params.friendRecordId || f.friend_id === params.friendRecordId)
      )
  );
  await writeLocalFriends(next);

  if (target && isSupabaseConfigured && supabase) {
    try {
      await supabase
        .from('friendships')
        .delete()
        .eq('user_id', params.userId)
        .eq('friend_id', target.friend_id);
    } catch {
      // Ignore when offline
    }
  }
}

// Direct Messages (DMs)
async function readLocalMessages(): Promise<DirectMessageRecord[]> {
  const raw = await AsyncStorage.getItem(LOCAL_MESSAGES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as DirectMessageRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeLocalMessages(list: DirectMessageRecord[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_MESSAGES_KEY, JSON.stringify(list));
}

export function buildConversationId(userA: string, userB: string): string {
  return [userA, userB].sort().join('::');
}

export function isSnapDmExpiredForViewer(
  msg: DirectMessageRecord,
  viewerId: string,
  nowMs = Date.now()
): boolean {
  if (!msg.snap_once) return false;
  // If any recipient (anyone other than sender) has completed viewing, it is expired
  const recipientViewed = (msg.viewed_by_user_ids ?? []).some((id) => id !== msg.sender_id);
  if (recipientViewed) return true;

  const openedMap = msg.snap_opened_at_by_user ?? {};
  for (const [openerId, openedIso] of Object.entries(openedMap)) {
    if (openerId === msg.sender_id) continue;
    const openedMs = new Date(openedIso).getTime();
    const durationMs = (msg.snap_duration_seconds ?? 15) * 1000;
    if (Number.isFinite(openedMs) && nowMs >= openedMs + durationMs) {
      return true;
    }
  }
  return false;
}

export function getSnapDmRemainingSeconds(
  msg: DirectMessageRecord,
  viewerId: string,
  nowMs = Date.now()
): number | null {
  if (!msg.snap_once || viewerId === msg.sender_id) return null;
  if (isSnapDmExpiredForViewer(msg, viewerId, nowMs)) return 0;
  const openedIso = msg.snap_opened_at_by_user?.[viewerId];
  if (!openedIso) return null;
  const openedMs = new Date(openedIso).getTime();
  if (!Number.isFinite(openedMs)) return null;
  const durationSec = msg.snap_duration_seconds ?? 15;
  const elapsedSec = Math.floor((nowMs - openedMs) / 1000);
  return Math.max(0, durationSec - elapsedSec);
}

export function redactExpiredSnapDm(
  msg: DirectMessageRecord,
  viewerId: string,
  nowMs = Date.now()
): DirectMessageRecord {
  if (!isSnapDmExpiredForViewer(msg, viewerId, nowMs)) {
    return msg;
  }
  const viewedSet = new Set(msg.viewed_by_user_ids ?? []);
  if (viewerId !== msg.sender_id) {
    viewedSet.add(viewerId);
  } else if (msg.recipient_id) {
    viewedSet.add(msg.recipient_id);
  }
  return {
    ...msg,
    viewed_by_user_ids: Array.from(viewedSet),
    viewed_at: msg.viewed_at ?? new Date(nowMs).toISOString(),
    text: '',
    media_uri: null,
  };
}

export async function fetchConversationMessages(params: {
  userId: string;
  peerId: string;
  peerName: string;
}): Promise<DirectMessageRecord[]> {
  if (!params.userId || !params.peerId) {
    throw new Error('Select a conversation participant first.');
  }
  const all = await readLocalMessages();
  const convId = buildConversationId(params.userId, params.peerId);
  let mutated = false;

  // Hydrate from Supabase `public.direct_messages` when available
  if (isSupabaseConfigured && supabase) {
    try {
      const { data: remoteMsgs, error: remoteErr } = await supabase
        .from('direct_messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true })
        .limit(100);

      if (!remoteErr && Array.isArray(remoteMsgs)) {
        for (const rawMsg of remoteMsgs) {
          const remoteRec = rawMsg as DirectMessageRecord;
          if (!remoteRec?.id) continue;
          const existingIdx = all.findIndex((m) => m.id === remoteRec.id);
          if (existingIdx >= 0) {
            all[existingIdx] = { ...all[existingIdx], ...remoteRec };
          } else {
            all.push(remoteRec);
          }
          mutated = true;
        }
      }
    } catch {
      // Use local messages cache when offline
    }
  }

  // Scrub any expired Snap Once DMs in local storage
  const nowMs = Date.now();
  for (let i = 0; i < all.length; i += 1) {
    const msg = all[i];
    if (isSnapDmExpiredForViewer(msg, params.userId, nowMs)) {
      if (msg.text !== '' || msg.media_uri !== null) {
        all[i] = redactExpiredSnapDm(msg, params.userId, nowMs);
        mutated = true;
      }
    }
  }

  if (mutated) {
    await writeLocalMessages(all);
  }

  const filtered = all.filter(
    (m) =>
      m.conversation_id === convId ||
      (m.sender_id === params.userId && m.recipient_id === params.peerId) ||
      (m.sender_id === params.peerId && m.recipient_id === params.userId)
  );

  return filtered
    .map((m) => redactExpiredSnapDm(m, params.userId, nowMs))
    .sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
}

export async function sendDirectMessage(params: {
  coupleId?: string | null;
  senderId: string;
  senderName: string;
  recipientId: string;
  text: string;
  mediaUri?: string | null;
  replyMomentId?: string | null;
  replyMomentPreview?: string | null;
  snapOnce?: boolean;
}): Promise<DirectMessageRecord> {
  const cleaned = params.text.trim();
  if (!cleaned && !params.mediaUri) {
    throw new Error('Write a message before sending.');
  }

  const convId = buildConversationId(params.senderId, params.recipientId);
  const record: DirectMessageRecord = {
    id: `dm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    conversation_id: convId,
    sender_id: params.senderId,
    sender_name: params.senderName,
    recipient_id: params.recipientId,
    text: cleaned,
    media_uri: params.mediaUri ?? null,
    reply_moment_id: params.replyMomentId ?? null,
    reply_moment_preview: params.replyMomentPreview ?? null,
    snap_once: Boolean(params.snapOnce),
    snap_duration_seconds: 15,
    snap_opened_at_by_user: {},
    viewed_by_user_ids: [],
    reactions: {},
    created_at: new Date().toISOString(),
  };

  const all = await readLocalMessages();
  const next = [...all, record].slice(-300);
  await writeLocalMessages(next);

  if (isSupabaseConfigured && supabase) {
    try {
      await supabase.from('direct_messages').upsert(
        {
          id: record.id,
          conversation_id: record.conversation_id,
          sender_id: record.sender_id,
          sender_name: record.sender_name,
          recipient_id: record.recipient_id,
          text: record.text,
          media_uri: record.media_uri,
          reply_moment_id: record.reply_moment_id,
          reply_moment_preview: record.reply_moment_preview,
          snap_once: record.snap_once,
          viewed_by_user_ids: record.viewed_by_user_ids,
          reactions: record.reactions,
          created_at: record.created_at,
        },
        { onConflict: 'id' }
      );
    } catch {
      // Ignore when offline
    }
  }

  const syncChannelKey = params.coupleId || `conv_${convId}`;
  void broadcastCoupleSync(syncChannelKey, { kind: 'dm_upsert', message: record });
  return record;
}

export async function toggleDirectMessageReaction(params: {
  coupleId?: string | null;
  messageId: string;
  userId: string;
  emoji: string;
}): Promise<void> {
  const all = await readLocalMessages();
  let nextEmoji: string | null = params.emoji;
  let updatedReactions: Record<string, string> | null = null;
  let convId = '';

  const next = all.map((m) => {
    if (m.id !== params.messageId) return m;
    convId = m.conversation_id;
    const reactions = { ...(m.reactions ?? {}) };
    if (reactions[params.userId] === params.emoji) {
      delete reactions[params.userId];
      nextEmoji = null;
    } else {
      reactions[params.userId] = params.emoji;
      nextEmoji = params.emoji;
    }
    updatedReactions = reactions;
    return { ...m, reactions };
  });
  await writeLocalMessages(next);

  if (isSupabaseConfigured && supabase && updatedReactions) {
    try {
      await supabase
        .from('direct_messages')
        .update({ reactions: updatedReactions })
        .eq('id', params.messageId);
    } catch {
      // Ignore when offline
    }
  }

  const syncChannelKey = params.coupleId || (convId ? `conv_${convId}` : null);
  if (syncChannelKey) {
    void broadcastCoupleSync(syncChannelKey, {
      kind: 'dm_reaction',
      messageId: params.messageId,
      userId: params.userId,
      emoji: nextEmoji,
    });
  }
}

export async function markSnapDirectMessageViewed(params: {
  coupleId?: string | null;
  messageId: string;
  viewerId: string;
  expired?: boolean;
}): Promise<void> {
  const all = await readLocalMessages();
  const nowIso = new Date().toISOString();
  let openedAtIso = nowIso;
  const isExpired = params.expired !== false;
  let convId = '';
  let updatedViewedIds: string[] | null = null;
  let senderGuardTriggered = false;

  const next = all.map((m) => {
    if (m.id !== params.messageId) return m;
    // Never allow the sender's own tap/preview to consume or expire the recipient's Snap Once DM
    if (m.sender_id === params.viewerId) {
      senderGuardTriggered = true;
      return m;
    }
    convId = m.conversation_id;
    const openedMap = { ...(m.snap_opened_at_by_user ?? {}) };
    if (!openedMap[params.viewerId]) {
      openedMap[params.viewerId] = nowIso;
    } else {
      openedAtIso = openedMap[params.viewerId];
    }
    const viewed = new Set(m.viewed_by_user_ids ?? []);
    if (isExpired) {
      viewed.add(params.viewerId);
    }
    updatedViewedIds = Array.from(viewed);
    return {
      ...m,
      snap_opened_at_by_user: openedMap,
      viewed_by_user_ids: updatedViewedIds,
      viewed_at: isExpired ? nowIso : (m.viewed_at ?? null),
      text: isExpired ? '' : m.text,
      media_uri: isExpired ? null : m.media_uri,
    };
  });

  if (senderGuardTriggered) return;
  await writeLocalMessages(next);

  if (isSupabaseConfigured && supabase && updatedViewedIds) {
    try {
      await supabase
        .from('direct_messages')
        .update({
          snap_opened_at: openedAtIso,
          viewed_by_user_ids: updatedViewedIds,
          ...(isExpired ? { viewed_at: nowIso, text: '', media_uri: null } : {}),
        })
        .eq('id', params.messageId);
    } catch {
      // Ignore when offline
    }
  }

  const syncChannelKey = params.coupleId || (convId ? `conv_${convId}` : null);
  if (syncChannelKey) {
    void broadcastCoupleSync(syncChannelKey, {
      kind: 'dm_snap_viewed',
      messageId: params.messageId,
      viewerId: params.viewerId,
      openedAtIso,
      viewedAtIso: nowIso,
      expired: isExpired,
    });
  }
}
