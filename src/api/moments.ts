import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

import { broadcastCoupleSync } from '@/api/realtimeSync';
import { fetchFriendsCircle, getFilterPresetMeta } from '@/api/social';
import { isSchemaNotMigratedError, isSupabaseConfigured, supabase } from '@/api/supabase';
import { formatMomentWatermarkTimestamp, KEEPIT_WATERMARK_SVG_PATH_D } from '@/utils/momentExport';
import { useSessionStore } from '@/store/sessionStore';
import {
  DailyPromptRecord,
  MAX_DAILY_MOMENTS_PER_DAY,
  MomentCommentRecord,
  MomentFilterPreset,
  MomentMediaType,
  MomentRecord,
  MusicTrackAttachment,
  PartnerMomentView,
  PhotoOverlayItem,
  PROMPT_WINDOW_SECONDS,
  PostVisibility,
  StreakRecord,
  TaggedPerson,
  TodayMomentBundle,
} from '@/types/database';
import { advanceStreakOnDualPost, enrichStreakWithRecentChain } from '@/utils/streakEngine';

const LOCAL_MOMENTS_KEY = 'keepit.local_moments.v1';

interface LocalMomentsState {
  prompts: Record<string, DailyPromptRecord>; // key: `${coupleId}:${date}`
  moments: Record<string, MomentRecord>; // key: momentId (and legacy `${promptId}:${userId}`)
  streaks: Record<string, StreakRecord>; // key: coupleId
}

export const DEFAULT_WARM_BLURHASH = 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH';

function toSvgDataUri(svg: string): string {
  const bytes = new TextEncoder().encode(svg.trim());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

export function buildSimulatedDualPhotos(params: {
  authorLabel: string;
  sceneLabel: string;
  accentHex?: string;
  filterPreset?: MomentFilterPreset;
  primaryLens?: 'back' | 'front';
  shotNumber?: number;
  mediaType?: MomentMediaType;
}): { backUri: string; frontUri: string } {
  const filterMeta = getFilterPresetMeta(params.filterPreset);
  const accent = params.accentHex ?? filterMeta.svgTintHex ?? '#D95D39';
  const safeAuthor = params.authorLabel.replace(/&/g, 'and').replace(/[<>"']/g, '');
  const safeScene = params.sceneLabel.replace(/&/g, 'and').replace(/[<>"']/g, '');
  const timeStamp = formatMomentWatermarkTimestamp(new Date().toISOString());
  const shotBadge = params.shotNumber && params.shotNumber > 1 ? ` · #${params.shotNumber}` : '';
  const modeLabel = params.mediaType === 'video' ? 'VIDEO LOOP' : 'DUAL LENS';

  const skyTop =
    params.filterPreset === 'noir'
      ? '#2C2C30'
      : params.filterPreset === 'cyber_neon'
        ? '#1E1035'
        : params.filterPreset === 'golden_hour'
          ? '#FDBA74'
          : params.filterPreset === 'vhs_retro'
            ? '#0F2942'
            : '#EBD8C8';
  const skyMid =
    params.filterPreset === 'noir'
      ? '#52525B'
      : params.filterPreset === 'cyber_neon'
        ? '#4C1D95'
        : params.filterPreset === 'golden_hour'
          ? '#F97316'
          : params.filterPreset === 'vhs_retro'
            ? '#0284C7'
            : '#D7B49E';

  const backSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${skyTop}"/>
          <stop offset="55%" stop-color="${skyMid}"/>
          <stop offset="100%" stop-color="#1E1B18"/>
        </linearGradient>
      </defs>
      <rect width="900" height="1200" fill="url(#sky)"/>
      <circle cx="670" cy="280" r="115" fill="${accent}" opacity="0.82"/>
      <rect x="90" y="650" width="720" height="430" rx="36" fill="#231E1B" opacity="0.90"/>
      <circle cx="310" cy="830" r="95" fill="#F2ECE4"/>
      <circle cx="310" cy="830" r="68" fill="#8C5A3C"/>
      <rect x="470" y="760" width="260" height="160" rx="20" fill="#FAF7F2" opacity="0.92"/>
      <text x="96" y="530" font-family="system-ui, sans-serif" font-size="38" font-weight="800" fill="#FFFFFF">
        ${safeScene}${shotBadge}
      </text>
      <text x="96" y="582" font-family="system-ui, sans-serif" font-size="25" font-weight="600" fill="#F4F4F5">
        ${safeAuthor} · ${modeLabel} · ${filterMeta.label} · ${timeStamp}
      </text>
      <g transform="translate(42, 1084) scale(3.52)">
        <title>#keepit</title>
        <path d="${KEEPIT_WATERMARK_SVG_PATH_D}" fill="#FFFFFF"/>
      </g>
      <text x="42" y="1154" text-anchor="start" font-family="system-ui, sans-serif" font-size="22" font-weight="700" fill="#FFFFFF" opacity="0.92">${timeStamp}</text>
    </svg>
  `;

  const frontSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
      <rect width="600" height="800" fill="#221D1A"/>
      <circle cx="300" cy="300" r="128" fill="#E3B99B"/>
      <circle cx="258" cy="282" r="12" fill="#1F1B18"/>
      <circle cx="342" cy="282" r="12" fill="#1F1B18"/>
      <path d="M262 338 Q300 368 338 338" stroke="#1F1B18" stroke-width="8" fill="none" stroke-linecap="round"/>
      <path d="M120 740 C135 545, 465 545, 480 740 Z" fill="${accent}"/>
      <text x="300" y="728" text-anchor="middle" font-family="system-ui, sans-serif" font-size="28" font-weight="700" fill="#FAF7F2">
        ${safeAuthor} · Selfie
      </text>
      <g transform="translate(28, 708) scale(2.35)">
        <title>#keepit</title>
        <path d="${KEEPIT_WATERMARK_SVG_PATH_D}" fill="#FFFFFF"/>
      </g>
      <text x="28" y="756" text-anchor="start" font-family="system-ui, sans-serif" font-size="15" font-weight="700" fill="#FFFFFF" opacity="0.92">${timeStamp}</text>
    </svg>
  `;

  const backDataUri = toSvgDataUri(backSvg);
  const frontDataUri = toSvgDataUri(frontSvg);

  // If the user started from the front camera, primary frame is selfie and PIP is back lens
  if (params.primaryLens === 'front') {
    return {
      backUri: frontDataUri,
      frontUri: backDataUri,
    };
  }

  return {
    backUri: backDataUri,
    frontUri: frontDataUri,
  };
}

/**
 * Ensures any local `file://` camera photo is converted into a portable `data:image/jpeg;base64,...`
 * URI before broadcasting across devices when Supabase Storage bucket is unavailable, fixing Bug #2
 * ("partner's image is not visible even both already posted").
 */
export async function ensureCrossDeviceShareableUri(uri: string): Promise<string> {
  if (!uri) return uri;
  if (uri.startsWith('data:') || uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }
  if (Platform.OS !== 'web' && uri.startsWith('file://')) {
    try {
      const file = new FileSystem.File(uri);
      const byteSize = typeof file.size === 'number' ? file.size : 0;
      if (byteSize > 180_000) {
        return uri;
      }
      const base64 = await file.base64();
      // Keep base64 payload bounded (< 240 KB) so Android SQLite CursorWindow (2 MB) and Realtime Broadcast never overflow
      if (base64 && base64.length > 0 && base64.length <= 240_000) {
        return `data:image/jpeg;base64,${base64}`;
      }
    } catch {
      // Fallback to original URI if File API read fails
    }
  }
  return uri;
}

async function readLocalMoments(): Promise<LocalMomentsState> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_MOMENTS_KEY);
    if (!raw) return { prompts: {}, moments: {}, streaks: {} };
    const parsed = JSON.parse(raw) as LocalMomentsState;
    return {
      prompts: parsed?.prompts ?? {},
      moments: parsed?.moments ?? {},
      streaks: parsed?.streaks ?? {},
    };
  } catch {
    await AsyncStorage.removeItem(LOCAL_MOMENTS_KEY).catch(() => {});
    return { prompts: {}, moments: {}, streaks: {} };
  }
}

async function writeLocalMoments(state: LocalMomentsState): Promise<void> {
  const serialized = JSON.stringify(state);
  // Guard against Android SQLite 2MB CursorWindow limit (~1.4MB safe ceiling)
  if (serialized.length > 1_400_000) {
    const sorted = Object.entries(state.moments).sort(([, a], [, b]) =>
      a.posted_at < b.posted_at ? 1 : -1
    );
    const trimmedMoments: Record<string, MomentRecord> = {};
    for (const [k, v] of sorted.slice(0, 12)) {
      trimmedMoments[k] = v;
    }
    state.moments = trimmedMoments;
  }
  await AsyncStorage.setItem(LOCAL_MOMENTS_KEY, JSON.stringify(state));
}

export function todayLocalDateString(date = new Date()): string {
  const yr = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const dy = String(date.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

function momentLocalDateString(m: MomentRecord): string {
  const rawIso = m.captured_at || m.posted_at;
  if (!rawIso) return todayLocalDateString();
  const parsed = new Date(rawIso);
  if (Number.isNaN(parsed.getTime())) {
    return rawIso.slice(0, 10);
  }
  return todayLocalDateString(parsed);
}

export function isSnapOnceExpiredForViewer(
  moment: Pick<
    MomentRecord,
    'snap_once' | 'user_id' | 'viewed_by_user_ids' | 'snap_opened_at_by_user' | 'snap_duration_seconds'
  >,
  viewerId: string,
  nowMs = Date.now()
): boolean {
  if (!moment.snap_once || !viewerId || moment.user_id === viewerId) {
    return false;
  }
  if (moment.viewed_by_user_ids?.includes(viewerId)) {
    return true;
  }
  const openedIso = moment.snap_opened_at_by_user?.[viewerId];
  if (openedIso) {
    const openedMs = new Date(openedIso).getTime();
    const durationMs = (moment.snap_duration_seconds ?? 15) * 1000;
    if (Number.isFinite(openedMs) && nowMs >= openedMs + durationMs) {
      return true;
    }
  }
  return false;
}

export function getSnapOnceRemainingSeconds(
  moment: Pick<
    MomentRecord,
    'snap_once' | 'user_id' | 'viewed_by_user_ids' | 'snap_opened_at_by_user' | 'snap_duration_seconds'
  >,
  viewerId: string,
  nowMs = Date.now()
): number | null {
  if (!moment.snap_once || !viewerId || moment.user_id === viewerId) {
    return null;
  }
  if (isSnapOnceExpiredForViewer(moment, viewerId, nowMs)) {
    return 0;
  }
  const openedIso = moment.snap_opened_at_by_user?.[viewerId];
  if (!openedIso) {
    return null;
  }
  const openedMs = new Date(openedIso).getTime();
  if (!Number.isFinite(openedMs)) return null;
  const durationSec = moment.snap_duration_seconds ?? 15;
  const elapsedSec = Math.floor((nowMs - openedMs) / 1000);
  return Math.max(0, durationSec - elapsedSec);
}

export function redactExpiredSnapMomentForViewer(
  moment: MomentRecord,
  viewerId: string,
  nowMs = Date.now()
): MomentRecord {
  if (!isSnapOnceExpiredForViewer(moment, viewerId, nowMs)) {
    return moment;
  }
  const viewedSet = new Set(moment.viewed_by_user_ids ?? []);
  viewedSet.add(viewerId);
  return {
    ...moment,
    viewed_by_user_ids: Array.from(viewedSet),
    back_photo_path: '',
    front_photo_path: '',
    back_photo_url: null,
    front_photo_url: null,
    video_uri: null,
    caption: null,
  };
}

function deduplicateMoments(records: MomentRecord[]): MomentRecord[] {
  const byId = new Map<string, MomentRecord>();
  for (const rec of records) {
    if (!rec?.id) continue;
    const prev = byId.get(rec.id);
    if (!prev || rec.posted_at >= prev.posted_at) {
      byId.set(rec.id, rec);
    }
  }
  return Array.from(byId.values()).sort((a, b) => (a.posted_at < b.posted_at ? 1 : -1));
}

async function uploadMediaToSupabaseStorage(params: {
  coupleId: string;
  promptDate: string;
  userId: string;
  slot: 'back' | 'front' | 'video';
  localUri: string;
}): Promise<{ storagePath: string; signedUrl: string | null }> {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (params.localUri.startsWith('data:image/svg+xml')) {
    return { storagePath: params.localUri, signedUrl: params.localUri };
  }
  const isVideo = params.slot === 'video' || params.localUri.endsWith('.mp4') || params.localUri.endsWith('.mov');
  const ext = isVideo ? 'mp4' : 'jpg';
  const defaultMime = isVideo ? 'video/mp4' : 'image/jpeg';
  const storagePath = `${params.coupleId}/${params.promptDate}/${params.userId}_${params.slot}_${Date.now()}.${ext}`;

  let uploadBody: Uint8Array | Blob;
  let contentType = defaultMime;

  if (Platform.OS !== 'web' && params.localUri.startsWith('file://')) {
    const file = new FileSystem.File(params.localUri);
    const byteSize = typeof file.size === 'number' ? file.size : 0;
    if (byteSize > 4_000_000) {
      throw new Error('Local media exceeds safe direct upload buffer.');
    }
    uploadBody = await file.bytes();
  } else if (params.localUri.startsWith('data:')) {
    const commaIdx = params.localUri.indexOf(',');
    if (commaIdx < 0) throw new Error('Invalid data URI.');
    const header = params.localUri.slice(5, commaIdx);
    const mimeMatch = header.split(';')[0];
    if (mimeMatch) contentType = mimeMatch;
    const b64 = params.localUri.slice(commaIdx + 1);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    uploadBody = bytes;
  } else {
    const response = await fetch(params.localUri);
    const blob = await response.blob();
    uploadBody = blob;
    if (blob.type) contentType = blob.type;
  }

  const { error } = await supabase.storage.from('moments').upload(storagePath, uploadBody, {
    contentType,
    upsert: true,
  });

  if (error) throw new Error(error.message);

  const { data: signedData } = await supabase.storage
    .from('moments')
    .createSignedUrl(storagePath, 3600);

  return {
    storagePath,
    signedUrl: signedData?.signedUrl ?? null,
  };
}

async function resolveStorageSignedUrlIfNeeded(pathOrUri: string | null | undefined): Promise<string | null> {
  if (!pathOrUri) return null;
  if (
    pathOrUri.startsWith('data:') ||
    pathOrUri.startsWith('http://') ||
    pathOrUri.startsWith('https://') ||
    pathOrUri.startsWith('file://')
  ) {
    return pathOrUri;
  }
  if (isSupabaseConfigured && supabase) {
    try {
      const { data } = await supabase.storage.from('moments').createSignedUrl(pathOrUri, 3600);
      if (data?.signedUrl) return data.signedUrl;
    } catch {
      // Ignore signed URL resolution failure offline
    }
  }
  return pathOrUri;
}
export function computeDeterministicPromptTriggerIso(
  coupleId: string,
  dateStr: string
): string {
  const cleanCouple = (coupleId || 'couple').trim();
  const seed = `${cleanCouple}:${dateStr}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  // Deterministic offset within 09:00..21:00 local window (43,200 seconds)
  const offsetSec = 9 * 3600 + (unsigned % (12 * 3600));
  const parts = dateStr.split('-').map(Number);
  const baseLocalMidnight =
    parts.length === 3 && parts.every((n) => Number.isFinite(n))
      ? new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0)
      : new Date(`${dateStr}T00:00:00.000Z`);
  return new Date(baseLocalMidnight.getTime() + offsetSec * 1000).toISOString();
}

export function isMomentPromptCheckIn(
  moment?: {
    is_prompt_checkin?: boolean;
    daily_index?: number;
    couple_id?: string | null;
    user_id?: string | null;
    late_by_seconds?: number;
    is_late?: boolean;
  } | null
): boolean {
  if (!moment) return false;
  if (typeof moment.is_prompt_checkin === 'boolean') {
    return moment.is_prompt_checkin;
  }
  if (moment.couple_id?.startsWith('solo_') || moment.user_id?.startsWith('friend_')) {
    return false;
  }
  if ((moment.daily_index ?? 1) > 1) {
    return false;
  }
  return true;
}

export function formatLateDuration(
  lateBySeconds: number,
  options?: { isPromptCheckIn?: boolean }
): string {
  if (options?.isPromptCheckIn === false) {
    return 'Shared';
  }
  if (lateBySeconds <= PROMPT_WINDOW_SECONDS) return 'On time';
  const overdueSec = lateBySeconds - PROMPT_WINDOW_SECONDS;
  const mins = Math.max(1, Math.round(overdueSec / 60));
  if (mins < 60) return `${mins}m after prompt`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m after prompt` : `${hrs}h after prompt`;
}

function toPartnerMomentView(
  rawPartner: MomentRecord,
  unlocked: boolean,
  viewerId?: string
): PartnerMomentView {
  const effectivePartner = viewerId
    ? redactExpiredSnapMomentForViewer(rawPartner, viewerId)
    : rawPartner;
  const expiredSnap = viewerId
    ? isSnapOnceExpiredForViewer(effectivePartner, viewerId)
    : false;
  const resolvedBack = expiredSnap
    ? null
    : (effectivePartner.back_photo_url || effectivePartner.back_photo_path || null);
  const resolvedFront = expiredSnap
    ? null
    : (effectivePartner.front_photo_url || effectivePartner.front_photo_path || null);
  if (!unlocked) {
    return {
      id: rawPartner.id,
      user_id: rawPartner.user_id,
      author_name: rawPartner.author_name,
      author_username: rawPartner.author_username,
      author_avatar: rawPartner.author_avatar,
      locked: true,
      back_photo_path: null,
      front_photo_path: null,
      back_blurhash: rawPartner.back_blurhash || DEFAULT_WARM_BLURHASH,
      caption: null,
      captured_at: rawPartner.captured_at,
      posted_at: rawPartner.posted_at,
      late_by_seconds: rawPartner.late_by_seconds,
      is_late: rawPartner.is_late,
      is_prompt_checkin: isMomentPromptCheckIn(rawPartner),
      retake_count: rawPartner.retake_count,
      daily_index: rawPartner.daily_index ?? 1,
      location_label: rawPartner.location_label ?? null,
      music_track: rawPartner.music_track ?? null,
      tagged_users: rawPartner.tagged_users ?? [],
      overlays: rawPartner.overlays ?? [],
      visibility: rawPartner.visibility ?? 'everyone',
      snap_once: Boolean(rawPartner.snap_once),
      snap_duration_seconds: rawPartner.snap_duration_seconds ?? 15,
      viewed_by_user_ids: rawPartner.viewed_by_user_ids ?? [],
      snap_opened_at_by_user: rawPartner.snap_opened_at_by_user ?? {},
      comments: rawPartner.comments ?? [],
      reactions: rawPartner.reactions ?? {},
      watermark_tag: rawPartner.watermark_tag ?? '#keepit',
      media_type: rawPartner.media_type ?? 'photo',
      video_uri: null,
      video_duration_seconds: rawPartner.video_duration_seconds ?? null,
      filter_preset: rawPartner.filter_preset ?? 'normal',
      back_photo_url: null,
      front_photo_url: null,
    };
  }

  return {
    id: effectivePartner.id,
    user_id: effectivePartner.user_id,
    author_name: effectivePartner.author_name,
    author_username: effectivePartner.author_username,
    author_avatar: effectivePartner.author_avatar,
    locked: false,
    back_photo_path: resolvedBack,
    front_photo_path: resolvedFront,
    back_blurhash: effectivePartner.back_blurhash || DEFAULT_WARM_BLURHASH,
    caption: expiredSnap ? null : effectivePartner.caption,
    captured_at: effectivePartner.captured_at,
    posted_at: effectivePartner.posted_at,
    late_by_seconds: effectivePartner.late_by_seconds,
    is_late: effectivePartner.is_late,
    is_prompt_checkin: isMomentPromptCheckIn(effectivePartner),
    retake_count: effectivePartner.retake_count,
    daily_index: effectivePartner.daily_index ?? 1,
    lat: effectivePartner.lat,
    lng: effectivePartner.lng,
    location_label: effectivePartner.location_label ?? null,
    music_track: effectivePartner.music_track ?? null,
    tagged_users: effectivePartner.tagged_users ?? [],
    overlays: effectivePartner.overlays ?? [],
    visibility: effectivePartner.visibility ?? 'everyone',
    snap_once: Boolean(effectivePartner.snap_once),
    snap_duration_seconds: effectivePartner.snap_duration_seconds ?? 15,
    viewed_by_user_ids: effectivePartner.viewed_by_user_ids ?? [],
    snap_opened_at_by_user: effectivePartner.snap_opened_at_by_user ?? {},
    comments: effectivePartner.comments ?? [],
    reactions: effectivePartner.reactions ?? {},
    watermark_tag: effectivePartner.watermark_tag ?? '#keepit',
    media_type: effectivePartner.media_type ?? 'photo',
    video_uri: expiredSnap ? null : (effectivePartner.video_uri ?? null),
    video_duration_seconds: effectivePartner.video_duration_seconds ?? null,
    filter_preset: effectivePartner.filter_preset ?? 'normal',
    back_photo_url: resolvedBack,
    front_photo_url: resolvedFront,
  };
}


export async function fetchTodayMomentBundle(params: {
  coupleId: string;
  userId: string;
}): Promise<TodayMomentBundle> {
  const state = await readLocalMoments();
  const today = todayLocalDateString();
  const promptKey = `${params.coupleId}:${today}`;
  let stateMutated = false;

  let prompt = state.prompts[promptKey];
  if (isSupabaseConfigured && supabase && !params.coupleId.startsWith('solo_')) {
    try {
      const { data: remotePrompt } = await supabase.rpc('ensure_today_prompt');
      const row = remotePrompt as DailyPromptRecord | null;
      if (row?.id && row?.trigger_at) {
        prompt = {
          id: row.id,
          couple_id: row.couple_id || params.coupleId,
          prompt_date: row.prompt_date || today,
          trigger_at: row.trigger_at,
          notified_at: row.notified_at ?? row.trigger_at,
        };
        state.prompts[promptKey] = prompt;
        stateMutated = true;
      }
    } catch {
      // Fall back to deterministic couple-synced prompt when offline
    }
  }
  if (!prompt) {
    const triggerAt = computeDeterministicPromptTriggerIso(params.coupleId, today);
    prompt = {
      id: `prompt_${params.coupleId}_${today}`,
      couple_id: params.coupleId,
      prompt_date: today,
      trigger_at: triggerAt,
      notified_at: triggerAt,
    };
    state.prompts[promptKey] = prompt;
    stateMutated = true;
  }

  // Fetch active Friends Circle so friend moments respect actual friendships & privacy
  const friendsCircle = await fetchFriendsCircle({ userId: params.userId });
  const friendIdsSet = new Set(friendsCircle.map((f) => f.friend_id));
  const bestieIdsSet = new Set(
    friendsCircle.filter((f) => f.relationship === 'bestie').map((f) => f.friend_id)
  );

  // Hydrate from Supabase `public.moments` when available so offline recipients get missed moments
  if (isSupabaseConfigured && supabase) {
    try {
      const { data: remoteRows, error: remoteErr } = await supabase
        .from('moments')
        .select('*')
        .or(`couple_id.eq.${params.coupleId},user_id.eq.${params.userId}`)
        .order('posted_at', { ascending: false })
        .limit(40);

      if (!remoteErr && Array.isArray(remoteRows)) {
        for (const rawRow of remoteRows) {
          const rec = rawRow as MomentRecord;
          if (!rec?.id) continue;
          const [signedBack, signedFront, signedVideo] = await Promise.all([
            resolveStorageSignedUrlIfNeeded(rec.back_photo_url ?? rec.back_photo_path),
            resolveStorageSignedUrlIfNeeded(rec.front_photo_url ?? rec.front_photo_path),
            resolveStorageSignedUrlIfNeeded(rec.video_uri),
          ]);
          const hydratedRec: MomentRecord = {
            ...rec,
            back_photo_url: signedBack ?? rec.back_photo_path,
            front_photo_url: signedFront ?? rec.front_photo_path,
            video_uri: signedVideo ?? rec.video_uri ?? null,
          };
          const existingLocal = state.moments[rec.id];
          if (!existingLocal || hydratedRec.posted_at >= existingLocal.posted_at) {
            state.moments[rec.id] = {
              ...existingLocal,
              ...hydratedRec,
            };
            stateMutated = true;
          }
        }
      }
    } catch {
      // Use local cache when offline or table unmigrated
    }
  }

  // Enforce permanent Snap Once expiration & local cache scrubbing for any expired moments
  const nowMs = Date.now();
  for (const [k, rec] of Object.entries(state.moments)) {
    if (isSnapOnceExpiredForViewer(rec, params.userId, nowMs)) {
      const alreadyScrubbed =
        rec.viewed_by_user_ids?.includes(params.userId) &&
        !rec.back_photo_path &&
        !rec.front_photo_path &&
        !rec.back_photo_url &&
        !rec.front_photo_url &&
        !rec.video_uri &&
        rec.caption === null;
      if (!alreadyScrubbed) {
        state.moments[k] = redactExpiredSnapMomentForViewer(rec, params.userId, nowMs);
        stateMutated = true;
      }
    }
  }

  if (stateMutated) {
    await writeLocalMoments(state);
  }

  // Match moments by prompt_id OR by couple_id + today's local date
  const allUnique = deduplicateMoments(Object.values(state.moments));
  const allForToday = allUnique.filter((m) => {
    const mLocalDate = momentLocalDateString(m);
    const mUtcDate = (m.posted_at || m.captured_at || '').slice(0, 10);
    return (
      m.prompt_id === prompt.id ||
      (m.couple_id === params.coupleId && (mLocalDate === today || mUtcDate === today)) ||
      (friendIdsSet.has(m.user_id) && (mLocalDate === today || mUtcDate === today))
    );
  });

  const myMomentsToday = allForToday
    .filter((m) => m.user_id === params.userId)
    .map((m) => ({
      ...m,
      back_photo_url: m.back_photo_url || m.back_photo_path,
      front_photo_url: m.front_photo_url || m.front_photo_path,
      watermark_tag: m.watermark_tag ?? '#keepit',
      filter_preset: m.filter_preset ?? 'normal',
      media_type: m.media_type ?? 'photo',
    }));

  const rawPartnerMoments = allForToday.filter(
    (m) =>
      m.user_id !== params.userId &&
      !m.user_id.startsWith('friend_') &&
      !friendIdsSet.has(m.user_id) &&
      m.visibility !== 'friends'
  );

  const unlocked = Boolean(myMomentsToday.length > 0 && rawPartnerMoments.length > 0);

  const partnerMomentsToday = rawPartnerMoments.map((pm) =>
    toPartnerMomentView(pm, unlocked, params.userId)
  );
  const mine = myMomentsToday[0] ?? null;
  const partner = partnerMomentsToday[0] ?? null;

  // Filter Friends feed strictly to active Friends Circle members + respect visibility & private profiles
  const friendMomentsToday = allForToday
    .filter((m) => {
      if (m.user_id === params.userId) return false;
      if (!friendIdsSet.has(m.user_id)) return false;
      if (m.visibility === 'partner') return false;
      const friendEntry = friendsCircle.find((f) => f.friend_id === m.user_id);
      if (friendEntry?.friend_profile.is_private && !bestieIdsSet.has(m.user_id)) {
        return false;
      }
      return true;
    })
    .map((m) => redactExpiredSnapMomentForViewer(m, params.userId, nowMs));

  const rawStreak = state.streaks[params.coupleId] ?? {
    couple_id: params.coupleId,
    current_count: unlocked ? 1 : 0,
    longest_count: unlocked ? 1 : 0,
    last_completed_date: unlocked ? today : null,
  };
  const streak = enrichStreakWithRecentChain({
    streak: rawStreak,
    coupleId: params.coupleId,
    userId: params.userId,
    todayDate: today,
    moments: allUnique,
  });

  return {
    prompt,
    streak,
    mine,
    partner,
    myMomentsToday,
    partnerMomentsToday,
    friendMomentsToday,
    dailyPostCount: myMomentsToday.length,
    maxDailyPosts: MAX_DAILY_MOMENTS_PER_DAY,
  };
}

export async function submitDailyMoment(params: {
  coupleId: string;
  promptId: string;
  userId: string;
  authorName?: string;
  authorUsername?: string;
  authorAvatar?: string | null;
  backUri: string;
  frontUri: string;
  caption?: string;
  capturedAtIso?: string;
  lat?: number | null;
  lng?: number | null;
  locationLabel?: string | null;
  musicTrack?: MusicTrackAttachment | null;
  taggedUsers?: TaggedPerson[];
  overlays?: PhotoOverlayItem[];
  visibility?: PostVisibility;
  snapOnce?: boolean;
  snapDurationSeconds?: number;
  mediaType?: MomentMediaType;
  videoUri?: string | null;
  videoDurationSeconds?: number | null;
  filterPreset?: MomentFilterPreset;
  replaceMomentId?: string | null;
}): Promise<MomentRecord> {
  const capturedAt = params.capturedAtIso ?? new Date().toISOString();
  const trimmedCaption = params.caption?.trim() ? params.caption.trim() : null;

  if (trimmedCaption && trimmedCaption.length > 160) {
    throw new Error('Caption must be 160 characters or fewer.');
  }

  const [portableBackUri, portableFrontUri] = await Promise.all([
    ensureCrossDeviceShareableUri(params.backUri),
    ensureCrossDeviceShareableUri(params.frontUri),
  ]);

  let finalBackPath = portableBackUri;
  let finalFrontPath = portableFrontUri;
  let finalBackUrl = portableBackUri;
  let finalFrontUrl = portableFrontUri;
  let finalVideoUri = params.videoUri ?? null;

  const today = todayLocalDateString(new Date(capturedAt));

  if (isSupabaseConfigured && supabase) {
    try {
      const [backUp, frontUp] = await Promise.all([
        uploadMediaToSupabaseStorage({
          coupleId: params.coupleId,
          promptDate: today,
          userId: params.userId,
          slot: 'back',
          localUri: portableBackUri,
        }),
        uploadMediaToSupabaseStorage({
          coupleId: params.coupleId,
          promptDate: today,
          userId: params.userId,
          slot: 'front',
          localUri: portableFrontUri,
        }),
      ]);
      finalBackPath = backUp.storagePath;
      finalFrontPath = frontUp.storagePath;
      finalBackUrl = backUp.signedUrl ?? portableBackUri;
      finalFrontUrl = frontUp.signedUrl ?? portableFrontUri;

      if (
        params.mediaType === 'video' &&
        params.videoUri &&
        !params.videoUri.startsWith('data:image/svg+xml')
      ) {
        const vidUp = await uploadMediaToSupabaseStorage({
          coupleId: params.coupleId,
          promptDate: today,
          userId: params.userId,
          slot: 'video',
          localUri: params.videoUri,
        });
        finalVideoUri = vidUp.signedUrl ?? vidUp.storagePath;
      }
    } catch {
      // Keep portable data URI / local URI when storage bucket is not migrated
    }
  }

  const state = await readLocalMoments();
  const promptKey = `${params.coupleId}:${today}`;

  let prompt =
    Object.values(state.prompts).find((p) => p.id === params.promptId) ??
    state.prompts[promptKey];

  if (!prompt) {
    const triggerAt = computeDeterministicPromptTriggerIso(params.coupleId, today);
    prompt = {
      id: params.promptId || `prompt_${params.coupleId}_${today}`,
      couple_id: params.coupleId,
      prompt_date: today,
      trigger_at: triggerAt,
      notified_at: triggerAt,
    };
    state.prompts[promptKey] = prompt;
  }

  const nowMs = Date.now();
  const triggerMs = new Date(prompt.trigger_at).getTime();
  const capturedMs = new Date(capturedAt).getTime();

  const allUnique = deduplicateMoments(Object.values(state.moments));
  const myTodayList = allUnique.filter((m) => {
    const mLocalDate = momentLocalDateString(m);
    return m.user_id === params.userId && mLocalDate === today;
  });
  const existingToReplace = params.replaceMomentId
    ? myTodayList.find((m) => m.id === params.replaceMomentId)
    : undefined;

  if (!existingToReplace && myTodayList.length >= MAX_DAILY_MOMENTS_PER_DAY) {
    throw new Error(
      `Daily limit reached (${MAX_DAILY_MOMENTS_PER_DAY}/${MAX_DAILY_MOMENTS_PER_DAY} Moments today). You can edit or delete an earlier post.`
    );
  }

  const dailyIndex = existingToReplace
    ? (existingToReplace.daily_index ?? 1)
    : myTodayList.length + 1;

  const isSoloOrFriend =
    params.coupleId.startsWith('solo_') || params.userId.startsWith('friend_');
  const alreadyCheckedInToday = myTodayList.some(
    (m) =>
      m.id !== existingToReplace?.id &&
      (m.is_prompt_checkin === true ||
        (m.is_prompt_checkin === undefined &&
          new Date(m.captured_at || m.posted_at).getTime() >= triggerMs))
  );
  const isPromptCheckIn =
    !isSoloOrFriend &&
    !alreadyCheckedInToday &&
    Number.isFinite(triggerMs) &&
    capturedMs >= triggerMs;

  const lateBySeconds = isPromptCheckIn
    ? Math.max(0, Math.floor((capturedMs - triggerMs) / 1000))
    : 0;
  const retakeCount = existingToReplace ? existingToReplace.retake_count + 1 : 0;
  const momentId =
    existingToReplace?.id ??
    `moment_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const sessionUser = useSessionStore.getState().user;
  const defaultVisibility: PostVisibility =
    params.visibility ??
    (sessionUser?.id === params.userId && sessionUser?.is_private ? 'partner' : 'everyone');

  const record: MomentRecord = {
    id: momentId,
    couple_id: params.coupleId,
    prompt_id: prompt.id,
    user_id: params.userId,
    author_name: params.authorName,
    author_username: params.authorUsername,
    author_avatar: params.authorAvatar ?? null,
    back_photo_path: finalBackPath,
    front_photo_path: finalFrontPath,
    back_blurhash: DEFAULT_WARM_BLURHASH,
    collage_photo_path: null,
    caption: trimmedCaption,
    captured_at: capturedAt,
    posted_at: new Date(nowMs).toISOString(),
    late_by_seconds: lateBySeconds,
    is_late: isPromptCheckIn && lateBySeconds > PROMPT_WINDOW_SECONDS,
    is_prompt_checkin: isPromptCheckIn,
    retake_count: retakeCount,
    daily_index: dailyIndex,
    lat: params.lat ?? null,
    lng: params.lng ?? null,
    location_label: params.locationLabel ?? null,
    music_track: params.musicTrack ?? null,
    tagged_users: params.taggedUsers ?? [],
    overlays: params.overlays ?? [],
    visibility: defaultVisibility,
    snap_once: Boolean(params.snapOnce),
    snap_duration_seconds: params.snapDurationSeconds ?? 15,
    viewed_by_user_ids: existingToReplace?.viewed_by_user_ids ?? [],
    snap_opened_at_by_user: existingToReplace?.snap_opened_at_by_user ?? {},
    comments: existingToReplace?.comments ?? [],
    reactions: existingToReplace?.reactions ?? {},
    watermark_tag: '#keepit',
    media_type: params.mediaType ?? 'photo',
    video_uri: finalVideoUri,
    video_duration_seconds: params.videoDurationSeconds ?? null,
    filter_preset: params.filterPreset ?? 'normal',
    back_photo_url: finalBackUrl,
    front_photo_url: finalFrontUrl,
  };

  if (isSupabaseConfigured && supabase) {
    try {
      const { error: dbErr } = await supabase.from('moments').upsert(
        {
          id: record.id,
          couple_id: record.couple_id.startsWith('solo_') ? null : record.couple_id,
          prompt_id: record.prompt_id.startsWith('prompt_') ? null : record.prompt_id,
          user_id: record.user_id,
          author_name: record.author_name,
          author_username: record.author_username,
          author_avatar: record.author_avatar,
          back_photo_path: record.back_photo_path,
          front_photo_path: record.front_photo_path,
          back_blurhash: record.back_blurhash,
          caption: record.caption,
          captured_at: record.captured_at,
          posted_at: record.posted_at,
          late_by_seconds: record.late_by_seconds,
          retake_count: record.retake_count,
          daily_index: record.daily_index,
          local_date: today,
          lat: record.lat,
          lng: record.lng,
          location_label: record.location_label,
          music_track: record.music_track,
          tagged_users: record.tagged_users,
          overlays: record.overlays,
          visibility: record.visibility,
          snap_once: record.snap_once,
          snap_duration_seconds: record.snap_duration_seconds,
          viewed_by_user_ids: record.viewed_by_user_ids,
          snap_opened_at_by_user: record.snap_opened_at_by_user,
          comments: record.comments,
          reactions: record.reactions,
          watermark_tag: record.watermark_tag,
          media_type: record.media_type,
          video_uri: record.video_uri,
          video_duration_seconds: record.video_duration_seconds,
          filter_preset: record.filter_preset,
        },
        { onConflict: 'id' }
      );
      if (dbErr && dbErr.message.includes('DAILY_MOMENT_LIMIT_REACHED')) {
        throw new Error(
          `Daily limit reached (${MAX_DAILY_MOMENTS_PER_DAY}/${MAX_DAILY_MOMENTS_PER_DAY} Moments today). You can edit or delete an earlier post.`
        );
      }
      if (dbErr && isSchemaNotMigratedError(dbErr)) {
        await supabase.rpc('submit_daily_moment', {
          p_prompt_id: record.prompt_id,
          p_back_photo_path: record.back_photo_path,
          p_front_photo_path: record.front_photo_path,
          p_back_blurhash: record.back_blurhash,
          p_caption: record.caption,
          p_captured_at: record.captured_at,
          p_lat: record.lat,
          p_lng: record.lng,
        });
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Daily limit reached')) {
        throw err;
      }
    }
  }

  state.moments[record.id] = record;
  state.moments[`${prompt.id}:${params.userId}`] = record;

  // Advance streak if both partners have posted today
  const todayCoupleMoments = Object.values(state.moments).filter(
    (m) =>
      m.couple_id === params.coupleId &&
      !m.user_id.startsWith('friend_') &&
      momentLocalDateString(m) === today
  );
  const distinctPosters = new Set(todayCoupleMoments.map((m) => m.user_id));
  if (distinctPosters.size >= 2) {
    const bothOnTime = todayCoupleMoments.every((m) => !m.is_late);
    state.streaks[params.coupleId] = advanceStreakOnDualPost({
      previous: state.streaks[params.coupleId],
      coupleId: params.coupleId,
      todayDate: today,
      bothOnTime,
    });
  }

  await writeLocalMoments(state);

  // Prefer lightweight URLs in Realtime broadcast packet when signed URLs exist
  const broadcastMoment: MomentRecord = {
    ...record,
    back_photo_path:
      finalBackUrl.startsWith('http') ? finalBackUrl : record.back_photo_path,
    front_photo_path:
      finalFrontUrl.startsWith('http') ? finalFrontUrl : record.front_photo_path,
  };
  void broadcastCoupleSync(params.coupleId, {
    kind: 'moment_upsert',
    moment: broadcastMoment,
  });
  return record;
}

export async function updateMomentDetails(params: {
  momentId: string;
  userId: string;
  caption?: string | null;
  locationLabel?: string | null;
  lat?: number | null;
  lng?: number | null;
  musicTrack?: MusicTrackAttachment | null;
  taggedUsers?: TaggedPerson[];
  overlays?: PhotoOverlayItem[];
  visibility?: PostVisibility;
  snapOnce?: boolean;
  filterPreset?: MomentFilterPreset;
}): Promise<MomentRecord> {
  const state = await readLocalMoments();
  const matchingEntries = Object.entries(state.moments).filter(
    ([, m]) => m.id === params.momentId && m.user_id === params.userId
  );
  if (matchingEntries.length === 0) {
    throw new Error('Moment not found.');
  }

  const base = matchingEntries[0][1];
  const nextCaption =
    params.caption !== undefined
      ? params.caption?.trim()
        ? params.caption.trim()
        : null
      : base.caption;

  if (nextCaption && nextCaption.length > 160) {
    throw new Error('Caption must be 160 characters or fewer.');
  }

  const nextLocationLabel =
    params.locationLabel !== undefined ? params.locationLabel : base.location_label;

  // If location was cleared, clear stale coordinates as well
  const nextLat =
    params.lat !== undefined
      ? params.lat
      : nextLocationLabel === null
        ? null
        : base.lat;
  const nextLng =
    params.lng !== undefined
      ? params.lng
      : nextLocationLabel === null
        ? null
        : base.lng;

  const updated: MomentRecord = {
    ...base,
    caption: nextCaption,
    location_label: nextLocationLabel,
    lat: nextLat,
    lng: nextLng,
    music_track: params.musicTrack !== undefined ? params.musicTrack : base.music_track,
    tagged_users: params.taggedUsers !== undefined ? params.taggedUsers : base.tagged_users,
    overlays: params.overlays !== undefined ? params.overlays : base.overlays,
    visibility: params.visibility !== undefined ? params.visibility : base.visibility,
    snap_once: params.snapOnce !== undefined ? params.snapOnce : base.snap_once,
    filter_preset:
      params.filterPreset !== undefined ? params.filterPreset : base.filter_preset,
  };

  for (const [k] of matchingEntries) {
    state.moments[k] = updated;
  }
  await writeLocalMoments(state);

  if (isSupabaseConfigured && supabase) {
    try {
      await supabase
        .from('moments')
        .update({
          caption: updated.caption,
          location_label: updated.location_label,
          lat: updated.lat,
          lng: updated.lng,
          music_track: updated.music_track,
          tagged_users: updated.tagged_users,
          overlays: updated.overlays,
          visibility: updated.visibility,
          snap_once: updated.snap_once,
          filter_preset: updated.filter_preset,
        })
        .eq('id', updated.id)
        .eq('user_id', params.userId);
    } catch {
      // Ignore when offline
    }
  }

  void broadcastCoupleSync(updated.couple_id, { kind: 'moment_upsert', moment: updated });
  return updated;
}

export async function updateMomentCaption(params: {
  momentId: string;
  userId: string;
  caption: string;
}): Promise<MomentRecord> {
  return updateMomentDetails({
    momentId: params.momentId,
    userId: params.userId,
    caption: params.caption,
  });
}

export async function deleteMomentPost(params: {
  momentId: string;
  userId: string;
  coupleId: string;
}): Promise<void> {
  const state = await readLocalMoments();
  let deleted = false;
  const storagePathsToRemove: string[] = [];
  for (const [k, rec] of Object.entries(state.moments)) {
    if (rec.id === params.momentId && rec.user_id === params.userId) {
      if (rec.back_photo_path && !rec.back_photo_path.startsWith('data:') && !rec.back_photo_path.startsWith('http')) {
        storagePathsToRemove.push(rec.back_photo_path);
      }
      if (rec.front_photo_path && !rec.front_photo_path.startsWith('data:') && !rec.front_photo_path.startsWith('http')) {
        storagePathsToRemove.push(rec.front_photo_path);
      }
      delete state.moments[k];
      deleted = true;
    }
  }
  if (!deleted) {
    throw new Error('Could not find that Moment to delete.');
  }

  // Reassign legacy pointer `${promptId}:${userId}` if the user still has other moments today
  const remainingMineToday = deduplicateMoments(Object.values(state.moments)).filter(
    (m) => m.couple_id === params.coupleId && m.user_id === params.userId
  );
  if (remainingMineToday.length > 0) {
    const latest = remainingMineToday[0];
    state.moments[`${latest.prompt_id}:${params.userId}`] = latest;
  }

  await writeLocalMoments(state);

  if (isSupabaseConfigured && supabase) {
    try {
      if (storagePathsToRemove.length > 0) {
        await supabase.storage.from('moments').remove(storagePathsToRemove).catch(() => {});
      }
      await supabase
        .from('moments')
        .delete()
        .eq('id', params.momentId)
        .eq('user_id', params.userId);
    } catch {
      // Ignore when offline
    }
  }

  void broadcastCoupleSync(params.coupleId, {
    kind: 'moment_delete',
    momentId: params.momentId,
    userId: params.userId,
  });
}

export async function addMomentComment(params: {
  momentId: string;
  coupleId: string;
  authorId: string;
  authorName: string;
  authorUsername?: string;
  text: string;
}): Promise<MomentCommentRecord> {
  const cleaned = params.text.trim();
  if (!cleaned) {
    throw new Error('Write a comment first.');
  }

  const comment: MomentCommentRecord = {
    id: `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    moment_id: params.momentId,
    author_id: params.authorId,
    author_name: params.authorName,
    author_username: params.authorUsername,
    text: cleaned.slice(0, 220),
    created_at: new Date().toISOString(),
  };

  const state = await readLocalMoments();
  let updatedComments: MomentCommentRecord[] | null = null;
  for (const [k, rec] of Object.entries(state.moments)) {
    if (rec.id === params.momentId) {
      const nextList = [...(rec.comments ?? []), comment];
      updatedComments = nextList;
      state.moments[k] = {
        ...rec,
        comments: nextList,
      };
    }
  }
  await writeLocalMoments(state);

  if (isSupabaseConfigured && supabase && updatedComments) {
    try {
      await supabase
        .from('moments')
        .update({ comments: updatedComments })
        .eq('id', params.momentId);
    } catch {
      // Ignore when offline
    }
  }

  void broadcastCoupleSync(params.coupleId, {
    kind: 'moment_comment',
    momentId: params.momentId,
    comment,
  });
  return comment;
}

export async function deleteMomentComment(params: {
  momentId: string;
  commentId: string;
  coupleId: string;
  requesterId: string;
}): Promise<void> {
  const state = await readLocalMoments();
  let updatedComments: MomentCommentRecord[] | null = null;
  for (const [k, rec] of Object.entries(state.moments)) {
    if (rec.id === params.momentId) {
      const targetComment = (rec.comments ?? []).find((c) => c.id === params.commentId);
      if (!targetComment) continue;
      if (targetComment.author_id !== params.requesterId && rec.user_id !== params.requesterId) {
        throw new Error('You can only delete your own comments.');
      }
      const nextList = (rec.comments ?? []).filter((c) => c.id !== params.commentId);
      updatedComments = nextList;
      state.moments[k] = {
        ...rec,
        comments: nextList,
      };
    }
  }
  await writeLocalMoments(state);

  if (isSupabaseConfigured && supabase && updatedComments) {
    try {
      await supabase
        .from('moments')
        .update({ comments: updatedComments })
        .eq('id', params.momentId);
    } catch {
      // Ignore when offline
    }
  }

  void broadcastCoupleSync(params.coupleId, {
    kind: 'moment_comment_delete',
    momentId: params.momentId,
    commentId: params.commentId,
  });
}

export async function toggleMomentReaction(params: {
  momentId: string;
  coupleId: string;
  userId: string;
  emoji: string;
}): Promise<void> {
  const state = await readLocalMoments();
  let nextEmoji: string | null = params.emoji;
  let updatedReactions: Record<string, string> | null = null;
  for (const [k, rec] of Object.entries(state.moments)) {
    if (rec.id === params.momentId) {
      const reactions = { ...(rec.reactions ?? {}) };
      if (reactions[params.userId] === params.emoji) {
        delete reactions[params.userId];
        nextEmoji = null;
      } else {
        reactions[params.userId] = params.emoji;
        nextEmoji = params.emoji;
      }
      updatedReactions = reactions;
      state.moments[k] = {
        ...rec,
        reactions,
      };
    }
  }
  await writeLocalMoments(state);

  if (isSupabaseConfigured && supabase && updatedReactions) {
    try {
      await supabase
        .from('moments')
        .update({ reactions: updatedReactions })
        .eq('id', params.momentId);
    } catch {
      // Ignore when offline
    }
  }

  void broadcastCoupleSync(params.coupleId, {
    kind: 'moment_reaction',
    momentId: params.momentId,
    userId: params.userId,
    emoji: nextEmoji,
  });
}

export async function markSnapOnceMomentState(params: {
  momentId: string;
  coupleId: string;
  viewerId: string;
  expired: boolean;
}): Promise<void> {
  const state = await readLocalMoments();
  const nowIso = new Date().toISOString();
  let openedIsoToSend = nowIso;
  let updatedOpenedMap: Record<string, string> | null = null;
  let updatedViewedList: string[] | null = null;

  for (const [k, rec] of Object.entries(state.moments)) {
    if (rec.id === params.momentId) {
      // Prevent the post author's own preview from expiring the recipient's view
      if (rec.user_id === params.viewerId) {
        return;
      }
      const openedMap = { ...(rec.snap_opened_at_by_user ?? {}) };
      if (!openedMap[params.viewerId]) {
        openedMap[params.viewerId] = nowIso;
      } else {
        openedIsoToSend = openedMap[params.viewerId];
      }
      const viewedSet = new Set(rec.viewed_by_user_ids ?? []);
      if (params.expired) {
        viewedSet.add(params.viewerId);
      }
      updatedOpenedMap = openedMap;
      updatedViewedList = Array.from(viewedSet);

      const nextRecord: MomentRecord = {
        ...rec,
        snap_opened_at_by_user: openedMap,
        viewed_by_user_ids: updatedViewedList,
      };
      state.moments[k] = params.expired
        ? redactExpiredSnapMomentForViewer(nextRecord, params.viewerId)
        : nextRecord;
    }
  }
  await writeLocalMoments(state);

  if (isSupabaseConfigured && supabase && updatedOpenedMap && updatedViewedList) {
    try {
      await supabase
        .from('moments')
        .update({
          snap_opened_at_by_user: updatedOpenedMap,
          viewed_by_user_ids: updatedViewedList,
        })
        .eq('id', params.momentId);
    } catch {
      // Ignore when offline
    }
  }

  void broadcastCoupleSync(params.coupleId, {
    kind: 'moment_snap_viewed',
    momentId: params.momentId,
    viewerId: params.viewerId,
    openedAtIso: openedIsoToSend,
    expired: params.expired,
  });
}

export async function fetchUserMomentsFeed(params: {
  userId: string;
  coupleId?: string | null;
}): Promise<MomentRecord[]> {
  const state = await readLocalMoments();
  const all = deduplicateMoments(Object.values(state.moments));
  return all.filter((m) => m.user_id === params.userId);
}

// Sandbox testing helpers (only shown when EXPO_PUBLIC_SUPABASE_URL is unset)
export async function simulateSandboxPromptState(params: {
  coupleId: string;
  mode: 'live_window' | 'late_window' | 'upcoming';
}): Promise<void> {
  const state = await readLocalMoments();
  const today = todayLocalDateString();
  const promptKey = `${params.coupleId}:${today}`;

  const offsetMs =
    params.mode === 'live_window'
      ? -15_000
      : params.mode === 'late_window'
        ? -7 * 60_000
        : 45 * 60_000;

  const triggerAt = new Date(Date.now() + offsetMs).toISOString();
  const existing = state.prompts[promptKey];

  state.prompts[promptKey] = {
    id: existing?.id ?? `prompt_${params.coupleId}_${today}`,
    couple_id: params.coupleId,
    prompt_date: today,
    trigger_at: triggerAt,
    notified_at: params.mode === 'upcoming' ? null : triggerAt,
  };

  await writeLocalMoments(state);
}

export async function simulateSandboxPartnerMoment(params: {
  coupleId: string;
  promptId: string;
  partnerId: string;
  partnerName: string;
  isLate?: boolean;
}): Promise<MomentRecord> {
  const state = await readLocalMoments();
  const today = todayLocalDateString();
  const promptKey = `${params.coupleId}:${today}`;
  const promptTriggerIso =
    Object.values(state.prompts).find((p) => p.id === params.promptId)?.trigger_at ??
    state.prompts[promptKey]?.trigger_at ??
    computeDeterministicPromptTriggerIso(params.coupleId, today);
  const promptTriggerMs = new Date(promptTriggerIso).getTime();
  const baseMs = Number.isFinite(promptTriggerMs) ? promptTriggerMs : Date.now();
  const offsetMs = params.isLate ? (PROMPT_WINDOW_SECONDS + 8 * 60) * 1000 : 40_000;

  const photos = buildSimulatedDualPhotos({
    authorLabel: params.partnerName,
    sceneLabel: `${params.partnerName}’s desk & warm tea`,
    accentHex: '#4E6E58',
    filterPreset: 'warm_film',
  });

  return submitDailyMoment({
    coupleId: params.coupleId,
    promptId: params.promptId,
    userId: params.partnerId,
    authorName: params.partnerName,
    backUri: photos.backUri,
    frontUri: photos.frontUri,
    caption: 'Thinking of you while studying',
    locationLabel: 'Campus Library 3F',
    filterPreset: 'warm_film',
    capturedAtIso: new Date(baseMs + offsetMs).toISOString(),
  });
}
