import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

import { broadcastCoupleSync } from '@/api/realtimeSync';
import { getFilterPresetMeta } from '@/api/social';
import { isSchemaNotMigratedError, isSupabaseConfigured, supabase } from '@/api/supabase';
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
  PostVisibility,
  StreakRecord,
  TaggedPerson,
  TodayMomentBundle,
} from '@/types/database';

const LOCAL_MOMENTS_KEY = 'keepit.local_moments.v1';

interface LocalMomentsState {
  prompts: Record<string, DailyPromptRecord>; // key: `${coupleId}:${date}`
  moments: Record<string, MomentRecord>; // key: momentId (and legacy `${promptId}:${userId}`)
  streaks: Record<string, StreakRecord>; // key: coupleId
}

export const DEFAULT_WARM_BLURHASH = 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH';

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
  const timeStamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
      <text x="96" y="1142" font-family="system-ui, sans-serif" font-size="32" font-weight="800" fill="#FFFFFF" opacity="0.95">
        #KeepIt
      </text>
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
    </svg>
  `;

  const backDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(backSvg.trim())}`;
  const frontDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(frontSvg.trim())}`;

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
      const base64 = await file.base64();
      if (base64 && base64.length > 0) {
        return `data:image/jpeg;base64,${base64}`;
      }
    } catch {
      // Fallback to original URI if File API read fails
    }
  }
  return uri;
}

async function readLocalMoments(): Promise<LocalMomentsState> {
  const raw = await AsyncStorage.getItem(LOCAL_MOMENTS_KEY);
  if (!raw) return { prompts: {}, moments: {}, streaks: {} };
  try {
    return JSON.parse(raw) as LocalMomentsState;
  } catch {
    return { prompts: {}, moments: {}, streaks: {} };
  }
}

async function writeLocalMoments(state: LocalMomentsState): Promise<void> {
  await AsyncStorage.setItem(LOCAL_MOMENTS_KEY, JSON.stringify(state));
}

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
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

async function uploadPhotoToSupabaseStorage(params: {
  coupleId: string;
  promptDate: string;
  userId: string;
  lens: 'back' | 'front';
  localUri: string;
}): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (params.localUri.startsWith('data:image/svg+xml')) {
    return params.localUri;
  }
  const storagePath = `${params.coupleId}/${params.promptDate}/${params.userId}_${params.lens}_${Date.now()}.jpg`;

  const response = await fetch(params.localUri);
  const blob = await response.blob();

  const { error } = await supabase.storage.from('moments').upload(storagePath, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: true,
  });

  if (error) throw new Error(error.message);
  return storagePath;
}

export function formatLateDuration(lateBySeconds: number): string {
  if (lateBySeconds <= 120) return 'On time';
  const overdueSec = lateBySeconds - 120;
  const mins = Math.max(1, Math.round(overdueSec / 60));
  if (mins < 60) return `${mins}m late`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m late` : `${hrs}h late`;
}

function toPartnerMomentView(rawPartner: MomentRecord, unlocked: boolean): PartnerMomentView {
  const resolvedBack = rawPartner.back_photo_url || rawPartner.back_photo_path;
  const resolvedFront = rawPartner.front_photo_url || rawPartner.front_photo_path;

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
      watermark_tag: rawPartner.watermark_tag ?? '#KeepIt',
      media_type: rawPartner.media_type ?? 'photo',
      video_uri: null,
      video_duration_seconds: rawPartner.video_duration_seconds ?? null,
      filter_preset: rawPartner.filter_preset ?? 'normal',
      back_photo_url: null,
      front_photo_url: null,
    };
  }

  return {
    id: rawPartner.id,
    user_id: rawPartner.user_id,
    author_name: rawPartner.author_name,
    author_username: rawPartner.author_username,
    author_avatar: rawPartner.author_avatar,
    locked: false,
    back_photo_path: resolvedBack,
    front_photo_path: resolvedFront,
    back_blurhash: rawPartner.back_blurhash || DEFAULT_WARM_BLURHASH,
    caption: rawPartner.caption,
    captured_at: rawPartner.captured_at,
    posted_at: rawPartner.posted_at,
    late_by_seconds: rawPartner.late_by_seconds,
    is_late: rawPartner.is_late,
    retake_count: rawPartner.retake_count,
    daily_index: rawPartner.daily_index ?? 1,
    lat: rawPartner.lat,
    lng: rawPartner.lng,
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
    watermark_tag: rawPartner.watermark_tag ?? '#KeepIt',
    media_type: rawPartner.media_type ?? 'photo',
    video_uri: rawPartner.video_uri ?? null,
    video_duration_seconds: rawPartner.video_duration_seconds ?? null,
    filter_preset: rawPartner.filter_preset ?? 'normal',
    back_photo_url: resolvedBack,
    front_photo_url: resolvedFront,
  };
}

function buildSeededFriendMoments(coupleId: string, promptId: string, today: string): MomentRecord[] {
  const soraPhotos = buildSimulatedDualPhotos({
    authorLabel: 'Sora Kim',
    sceneLabel: 'Iced matcha & sketchbook',
    accentHex: '#8B5CF6',
    filterPreset: 'warm_film',
  });
  const leoPhotos = buildSimulatedDualPhotos({
    authorLabel: 'Leo Vance',
    sceneLabel: 'Sunset skate & vinyl crates',
    accentHex: '#0EA5E9',
    filterPreset: 'vhs_retro',
  });

  return [
    {
      id: `moment_friend_sora_${today}`,
      couple_id: coupleId,
      prompt_id: promptId,
      user_id: 'friend_sora_k',
      author_name: 'Sora Kim',
      author_username: 'sora.frames',
      back_photo_path: soraPhotos.backUri,
      front_photo_path: soraPhotos.frontUri,
      back_blurhash: DEFAULT_WARM_BLURHASH,
      collage_photo_path: null,
      caption: 'Afternoon matcha break before studio critique',
      captured_at: new Date(Date.now() - 22 * 60_000).toISOString(),
      posted_at: new Date(Date.now() - 22 * 60_000).toISOString(),
      late_by_seconds: 44,
      is_late: false,
      retake_count: 0,
      daily_index: 1,
      lat: 37.7763,
      lng: -122.4232,
      location_label: 'Blue Bottle Coffee · Downtown',
      music_track: {
        id: 'trk_tokyo_rain',
        title: 'Shibuya Lo-Fi Rain',
        artist: 'Mochy Beats',
        coverColor: '#0EA5E9',
        previewNote: '0:33 · Vinyl crackle + Rhodes',
      },
      tagged_users: [],
      overlays: [
        {
          id: 'ov_sora_1',
          kind: 'emoji',
          content: '🍵',
          size: 'md',
          xPct: 78,
          yPct: 22,
        },
      ],
      visibility: 'friends',
      snap_once: false,
      snap_duration_seconds: 15,
      viewed_by_user_ids: [],
      comments: [],
      reactions: {},
      watermark_tag: '#KeepIt',
      media_type: 'photo',
      filter_preset: 'warm_film',
      back_photo_url: soraPhotos.backUri,
      front_photo_url: soraPhotos.frontUri,
    },
    {
      id: `moment_friend_leo_${today}`,
      couple_id: coupleId,
      prompt_id: promptId,
      user_id: 'friend_leo_v',
      author_name: 'Leo Vance',
      author_username: 'leovance',
      back_photo_path: leoPhotos.backUri,
      front_photo_path: leoPhotos.frontUri,
      back_blurhash: DEFAULT_WARM_BLURHASH,
      collage_photo_path: null,
      caption: 'Golden hour session at the pier',
      captured_at: new Date(Date.now() - 48 * 60_000).toISOString(),
      posted_at: new Date(Date.now() - 48 * 60_000).toISOString(),
      late_by_seconds: 310,
      is_late: true,
      retake_count: 1,
      daily_index: 1,
      lat: 37.8086,
      lng: -122.4098,
      location_label: 'Golden Gate Pier Walk',
      music_track: {
        id: 'trk_midnight_city',
        title: 'Midnight Drive',
        artist: 'M83 & Neon',
        coverColor: '#8B5CF6',
        previewNote: '0:42 · Synthwave chorus',
      },
      tagged_users: [],
      overlays: [
        {
          id: 'ov_leo_1',
          kind: 'text',
          content: 'skate or die 🛹',
          bgStyle: 'glass',
          size: 'sm',
          xPct: 50,
          yPct: 78,
        },
      ],
      visibility: 'friends',
      snap_once: false,
      snap_duration_seconds: 15,
      viewed_by_user_ids: [],
      comments: [],
      reactions: {},
      watermark_tag: '#KeepIt',
      media_type: 'photo',
      filter_preset: 'vhs_retro',
      back_photo_url: leoPhotos.backUri,
      front_photo_url: leoPhotos.frontUri,
    },
  ];
}

export async function fetchTodayMomentBundle(params: {
  coupleId: string;
  userId: string;
}): Promise<TodayMomentBundle> {
  // Local + Realtime synced state is primary when Postgres schema is not migrated,
  // and also merges any cross-device Realtime moments.
  const state = await readLocalMoments();
  const today = todayUtcDateString();
  const promptKey = `${params.coupleId}:${today}`;

  let prompt = state.prompts[promptKey];
  if (!prompt) {
    const triggerAt = new Date(Date.now() - 8_000).toISOString();
    prompt = {
      id: `prompt_${params.coupleId}_${today}`,
      couple_id: params.coupleId,
      prompt_date: today,
      trigger_at: triggerAt,
      notified_at: triggerAt,
    };
    state.prompts[promptKey] = prompt;
    await writeLocalMoments(state);
  }

  // Match moments by prompt_id OR by couple_id + today's date so cross-device prompts never mismatch!
  const allUnique = deduplicateMoments(Object.values(state.moments));
  const allForToday = allUnique.filter((m) => {
    const mDate = (m.posted_at || m.captured_at || '').slice(0, 10);
    return (
      m.prompt_id === prompt.id ||
      (m.couple_id === params.coupleId && mDate === today)
    );
  });

  const myMomentsToday = allForToday
    .filter((m) => m.user_id === params.userId)
    .map((m) => ({
      ...m,
      back_photo_url: m.back_photo_url || m.back_photo_path,
      front_photo_url: m.front_photo_url || m.front_photo_path,
      watermark_tag: m.watermark_tag ?? '#KeepIt',
      filter_preset: m.filter_preset ?? 'normal',
      media_type: m.media_type ?? 'photo',
    }));

  const rawPartnerMoments = allForToday.filter(
    (m) => m.user_id !== params.userId && !m.user_id.startsWith('friend_')
  );

  // Unlock partner moments as soon as BOTH partners have posted at least 1 Moment today
  // OR if the partner moment was explicitly shared across devices
  const unlocked = Boolean(myMomentsToday.length > 0 && rawPartnerMoments.length > 0);

  const partnerMomentsToday = rawPartnerMoments.map((pm) => toPartnerMomentView(pm, unlocked));
  const mine = myMomentsToday[0] ?? null;
  const partner = partnerMomentsToday[0] ?? null;

  const friendMomentsToday = [
    ...allForToday.filter((m) => m.user_id.startsWith('friend_')),
    ...buildSeededFriendMoments(params.coupleId, prompt.id, today),
  ];

  const streak = state.streaks[params.coupleId] ?? {
    couple_id: params.coupleId,
    current_count: unlocked ? 1 : 0,
    longest_count: unlocked ? 1 : 0,
    last_completed_date: unlocked ? today : null,
  };

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

  // Convert local file:// URIs to portable base64 data URIs so Partner's phone can render them immediately
  const [portableBackUri, portableFrontUri] = await Promise.all([
    ensureCrossDeviceShareableUri(params.backUri),
    ensureCrossDeviceShareableUri(params.frontUri),
  ]);

  let finalBackUri = portableBackUri;
  let finalFrontUri = portableFrontUri;

  if (isSupabaseConfigured && supabase) {
    try {
      const today = todayUtcDateString();
      const [backPath, frontPath] = await Promise.all([
        uploadPhotoToSupabaseStorage({
          coupleId: params.coupleId,
          promptDate: today,
          userId: params.userId,
          lens: 'back',
          localUri: portableBackUri,
        }),
        uploadPhotoToSupabaseStorage({
          coupleId: params.coupleId,
          promptDate: today,
          userId: params.userId,
          lens: 'front',
          localUri: portableFrontUri,
        }),
      ]);
      if (backPath.startsWith('http') || backPath.startsWith('data:')) {
        finalBackUri = backPath;
      }
      if (frontPath.startsWith('http') || frontPath.startsWith('data:')) {
        finalFrontUri = frontPath;
      }
    } catch {
      // Keep portable data URI / local URI when storage bucket is not migrated
    }
  }

  const state = await readLocalMoments();
  const today = todayUtcDateString();
  const promptKey = `${params.coupleId}:${today}`;

  let prompt =
    Object.values(state.prompts).find((p) => p.id === params.promptId) ??
    state.prompts[promptKey];

  if (!prompt) {
    const triggerAt = new Date(Date.now() - 8_000).toISOString();
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
  const lateBySeconds = Math.max(0, Math.floor((capturedMs - triggerMs) / 1000));

  const allUnique = deduplicateMoments(Object.values(state.moments));
  const myTodayList = allUnique.filter((m) => {
    const mDate = (m.posted_at || m.captured_at || '').slice(0, 10);
    return (
      m.user_id === params.userId &&
      (m.prompt_id === prompt.id || (m.couple_id === params.coupleId && mDate === today))
    );
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

  const retakeCount = existingToReplace ? existingToReplace.retake_count + 1 : 0;
  const momentId =
    existingToReplace?.id ??
    `moment_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const record: MomentRecord = {
    id: momentId,
    couple_id: params.coupleId,
    prompt_id: prompt.id,
    user_id: params.userId,
    author_name: params.authorName,
    author_username: params.authorUsername,
    author_avatar: params.authorAvatar ?? null,
    back_photo_path: finalBackUri,
    front_photo_path: finalFrontUri,
    back_blurhash: DEFAULT_WARM_BLURHASH,
    collage_photo_path: null,
    caption: trimmedCaption,
    captured_at: capturedAt,
    posted_at: new Date(nowMs).toISOString(),
    late_by_seconds: lateBySeconds,
    is_late: lateBySeconds > 120,
    retake_count: retakeCount,
    daily_index: dailyIndex,
    lat: params.lat ?? null,
    lng: params.lng ?? null,
    location_label: params.locationLabel ?? null,
    music_track: params.musicTrack ?? null,
    tagged_users: params.taggedUsers ?? [],
    overlays: params.overlays ?? [],
    visibility: params.visibility ?? 'everyone',
    snap_once: Boolean(params.snapOnce),
    snap_duration_seconds: params.snapDurationSeconds ?? 15,
    viewed_by_user_ids: existingToReplace?.viewed_by_user_ids ?? [],
    snap_opened_at_by_user: existingToReplace?.snap_opened_at_by_user ?? {},
    comments: existingToReplace?.comments ?? [],
    reactions: existingToReplace?.reactions ?? {},
    watermark_tag: '#KeepIt',
    media_type: params.mediaType ?? 'photo',
    video_uri: params.videoUri ?? null,
    video_duration_seconds: params.videoDurationSeconds ?? null,
    filter_preset: params.filterPreset ?? 'normal',
    back_photo_url: finalBackUri,
    front_photo_url: finalFrontUri,
  };

  state.moments[record.id] = record;
  // Also keep latest pointer on `${prompt.id}:${params.userId}` for backwards compatibility
  state.moments[`${prompt.id}:${params.userId}`] = record;

  // Advance streak if both partners have posted today
  const distinctPosters = new Set(
    Object.values(state.moments)
      .filter((m) => m.couple_id === params.coupleId && !m.user_id.startsWith('friend_'))
      .map((m) => m.user_id)
  );
  if (distinctPosters.size >= 2) {
    const prev = state.streaks[params.coupleId] ?? {
      couple_id: params.coupleId,
      current_count: 0,
      longest_count: 0,
      last_completed_date: null,
    };
    if (prev.last_completed_date !== prompt.prompt_date) {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const nextCount = prev.last_completed_date === yesterday ? prev.current_count + 1 : 1;
      state.streaks[params.coupleId] = {
        couple_id: params.coupleId,
        current_count: nextCount,
        longest_count: Math.max(prev.longest_count, nextCount),
        last_completed_date: prompt.prompt_date,
        updated_at: new Date().toISOString(),
      };
    }
  }

  await writeLocalMoments(state);
  void broadcastCoupleSync(params.coupleId, { kind: 'moment_upsert', moment: record });
  return record;
}

export async function updateMomentDetails(params: {
  momentId: string;
  userId: string;
  caption?: string | null;
  locationLabel?: string | null;
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

  const updated: MomentRecord = {
    ...base,
    caption: nextCaption,
    location_label:
      params.locationLabel !== undefined ? params.locationLabel : base.location_label,
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
  for (const [k, rec] of Object.entries(state.moments)) {
    if (rec.id === params.momentId && rec.user_id === params.userId) {
      delete state.moments[k];
      deleted = true;
    }
  }
  if (!deleted) {
    throw new Error('Could not find that Moment to delete.');
  }
  await writeLocalMoments(state);
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
  for (const [k, rec] of Object.entries(state.moments)) {
    if (rec.id === params.momentId) {
      state.moments[k] = {
        ...rec,
        comments: [...(rec.comments ?? []), comment],
      };
    }
  }
  await writeLocalMoments(state);
  void broadcastCoupleSync(params.coupleId, {
    kind: 'moment_comment',
    momentId: params.momentId,
    comment,
  });
  return comment;
}

export async function toggleMomentReaction(params: {
  momentId: string;
  coupleId: string;
  userId: string;
  emoji: string;
}): Promise<void> {
  const state = await readLocalMoments();
  let nextEmoji: string | null = params.emoji;
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
      state.moments[k] = {
        ...rec,
        reactions,
      };
    }
  }
  await writeLocalMoments(state);
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
  for (const [k, rec] of Object.entries(state.moments)) {
    if (rec.id === params.momentId) {
      const openedMap = { ...(rec.snap_opened_at_by_user ?? {}) };
      if (!openedMap[params.viewerId]) {
        openedMap[params.viewerId] = nowIso;
      }
      const viewedSet = new Set(rec.viewed_by_user_ids ?? []);
      if (params.expired) {
        viewedSet.add(params.viewerId);
      }
      state.moments[k] = {
        ...rec,
        snap_opened_at_by_user: openedMap,
        viewed_by_user_ids: Array.from(viewedSet),
      };
    }
  }
  await writeLocalMoments(state);
  void broadcastCoupleSync(params.coupleId, {
    kind: 'moment_snap_viewed',
    momentId: params.momentId,
    viewerId: params.viewerId,
    openedAtIso: nowIso,
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
  const today = todayUtcDateString();
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
    capturedAtIso: new Date(
      Date.now() - (params.isLate ? 8 * 60_000 : 10_000)
    ).toISOString(),
  });
}
