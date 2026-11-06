// src/api/social.ts
// Social layer for KeepIt:
// - Friends circle (add by friend code/handle, list friends, remove friend, seed demo besties)
// - Direct Messages (DMs) with Partner & Friends (text, emoji reactions, moment replies, Snap Once 15s messages)
// - Curated Music Tracks & Location Presets for Moments
// - Filter preset definitions (Warm Film, Polaroid, Noir, Cyber Neon, Golden Hour, VHS Retro, Dreamy)

import AsyncStorage from '@react-native-async-storage/async-storage';

import { broadcastCoupleSync } from '@/api/realtimeSync';
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

export async function fetchFriendsCircle(params: {
  userId: string;
  partner?: UserProfile | null;
}): Promise<FriendRecord[]> {
  const stored = await readLocalFriends();
  const mine = stored.filter((f) => f.user_id === params.userId);

  // Seed default besties so the user immediately has friends they can tag, message, and view on the Friends feed/map
  if (mine.length === 0) {
    const nowIso = new Date().toISOString();
    const seeded: FriendRecord[] = [
      {
        id: `fr_${params.userId}_sora`,
        user_id: params.userId,
        friend_id: 'friend_sora_k',
        relationship: 'bestie',
        created_at: nowIso,
        friend_profile: {
          id: 'friend_sora_k',
          display_name: 'Sora Kim',
          username: 'sora.frames',
          bio: 'Matcha runs & 35mm street snaps',
          pronouns: 'she/her',
          mood_song: 'Shibuya Lo-Fi Rain',
          banner_color: '#8B5CF6',
          friend_code: 'SOR-812',
          avatar_path: null,
          timezone: 'UTC',
          push_token: null,
          created_at: nowIso,
        },
      },
      {
        id: `fr_${params.userId}_leo`,
        user_id: params.userId,
        friend_id: 'friend_leo_v',
        relationship: 'friend',
        created_at: nowIso,
        friend_profile: {
          id: 'friend_leo_v',
          display_name: 'Leo Vance',
          username: 'leovance',
          bio: 'Late night vinyl & skate sessions',
          pronouns: 'he/him',
          mood_song: 'Midnight Drive',
          banner_color: '#0EA5E9',
          friend_code: 'LEO-409',
          avatar_path: null,
          timezone: 'UTC',
          push_token: null,
          created_at: nowIso,
        },
      },
    ];
    const merged = [...stored, ...seeded];
    await writeLocalFriends(merged);
    return seeded;
  }

  return mine;
}

export async function addFriendByHandleOrCode(params: {
  userId: string;
  coupleId?: string | null;
  query: string;
  relationship?: 'bestie' | 'friend';
}): Promise<FriendRecord> {
  const cleaned = params.query.trim().replace(/^@/, '');
  if (cleaned.length < 2) {
    throw new Error('Enter a friend’s @username, name, or friend code.');
  }

  const existing = await readLocalFriends();
  const normalizedLower = cleaned.toLowerCase();

  // Check if a known user in local_db matches
  const rawDb = await AsyncStorage.getItem(LOCAL_DB_KEY);
  const dbUsers: Record<string, UserProfile> = rawDb
    ? ((JSON.parse(rawDb) as { users?: Record<string, UserProfile> }).users ?? {})
    : {};

  let matchedUser = Object.values(dbUsers).find(
    (u) =>
      u.id !== params.userId &&
      (u.username?.toLowerCase() === normalizedLower ||
        u.display_name.toLowerCase() === normalizedLower ||
        u.friend_code?.toLowerCase() === normalizedLower)
  );

  const nowIso = new Date().toISOString();
  if (!matchedUser) {
    const prettyName = cleaned
      .replace(/[_.-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const friendId = `friend_${cleaned.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    matchedUser = {
      id: friendId,
      display_name: prettyName,
      username: cleaned.toLowerCase().replace(/[^a-z0-9._]/g, ''),
      bio: 'On KeepIt · Sharing daily moments',
      pronouns: 'they/them',
      banner_color: '#EC4899',
      friend_code: buildFriendCode(friendId, prettyName),
      avatar_path: null,
      timezone: 'UTC',
      push_token: null,
      created_at: nowIso,
    };
  }

  const already = existing.find(
    (f) => f.user_id === params.userId && f.friend_id === matchedUser!.id
  );
  if (already) {
    return already;
  }

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
  const next = existing.filter(
    (f) => !(f.user_id === params.userId && (f.id === params.friendRecordId || f.friend_id === params.friendRecordId))
  );
  await writeLocalFriends(next);
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

export async function fetchConversationMessages(params: {
  userId: string;
  peerId: string;
  peerName: string;
}): Promise<DirectMessageRecord[]> {
  const all = await readLocalMessages();
  const convId = buildConversationId(params.userId, params.peerId);
  const filtered = all.filter(
    (m) =>
      m.conversation_id === convId ||
      (m.sender_id === params.userId && m.recipient_id === params.peerId) ||
      (m.sender_id === params.peerId && m.recipient_id === params.userId)
  );

  if (filtered.length === 0) {
    const welcomeMsg: DirectMessageRecord = {
      id: `dm_seed_${convId}`,
      conversation_id: convId,
      sender_id: params.peerId,
      sender_name: params.peerName,
      recipient_id: params.userId,
      text: `Hey! Can’t wait to see your #KeepIt Moment today ✨`,
      snap_once: false,
      viewed_by_user_ids: [],
      reactions: {},
      created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    };
    const next = [...all, welcomeMsg];
    await writeLocalMessages(next);
    return [welcomeMsg];
  }

  return filtered.sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
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
    viewed_by_user_ids: [],
    reactions: {},
    created_at: new Date().toISOString(),
  };

  const all = await readLocalMessages();
  const next = [...all, record].slice(-300);
  await writeLocalMessages(next);

  if (params.coupleId) {
    void broadcastCoupleSync(params.coupleId, { kind: 'dm_upsert', message: record });
  }
  return record;
}

export async function toggleDirectMessageReaction(params: {
  coupleId?: string | null;
  messageId: string;
  userId: string;
  emoji: string;
}): Promise<void> {
  const all = await readLocalMessages();
  const next = all.map((m) => {
    if (m.id !== params.messageId) return m;
    const reactions = { ...(m.reactions ?? {}) };
    if (reactions[params.userId] === params.emoji) {
      delete reactions[params.userId];
    } else {
      reactions[params.userId] = params.emoji;
    }
    return { ...m, reactions };
  });
  await writeLocalMessages(next);
  if (params.coupleId) {
    void broadcastCoupleSync(params.coupleId, {
      kind: 'dm_reaction',
      messageId: params.messageId,
      userId: params.userId,
      emoji: params.emoji,
    });
  }
}

export async function markSnapDirectMessageViewed(params: {
  coupleId?: string | null;
  messageId: string;
  viewerId: string;
}): Promise<void> {
  const all = await readLocalMessages();
  const nowIso = new Date().toISOString();
  const next = all.map((m) => {
    if (m.id !== params.messageId) return m;
    const viewed = new Set(m.viewed_by_user_ids ?? []);
    viewed.add(params.viewerId);
    return {
      ...m,
      viewed_by_user_ids: Array.from(viewed),
      viewed_at: nowIso,
    };
  });
  await writeLocalMessages(next);
  if (params.coupleId) {
    void broadcastCoupleSync(params.coupleId, {
      kind: 'dm_snap_viewed',
      messageId: params.messageId,
      viewerId: params.viewerId,
      viewedAtIso: nowIso,
    });
  }
}
