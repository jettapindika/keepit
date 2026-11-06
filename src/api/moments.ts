import AsyncStorage from '@react-native-async-storage/async-storage';

import { isSchemaNotMigratedError, isSupabaseConfigured, supabase } from '@/api/supabase';
import {
  DailyPromptRecord,
  MomentRecord,
  PartnerMomentView,
  StreakRecord,
  TodayMomentBundle,
} from '@/types/database';

const LOCAL_MOMENTS_KEY = 'keepit.local_moments.v1';

interface LocalMomentsState {
  prompts: Record<string, DailyPromptRecord>; // key: `${coupleId}:${date}`
  moments: Record<string, MomentRecord>; // key: `${promptId}:${userId}`
  streaks: Record<string, StreakRecord>; // key: coupleId
}

export const DEFAULT_WARM_BLURHASH = 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH';

export function buildSimulatedDualPhotos(params: {
  authorLabel: string;
  sceneLabel: string;
  accentHex?: string;
}): { backUri: string; frontUri: string } {
  const accent = params.accentHex ?? '#D95D39';
  const safeAuthor = params.authorLabel.replace(/&/g, 'and').replace(/[<>"']/g, '');
  const safeScene = params.sceneLabel.replace(/&/g, 'and').replace(/[<>"']/g, '');
  const timeStamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const backSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#EBD8C8"/>
          <stop offset="55%" stop-color="#D7B49E"/>
          <stop offset="100%" stop-color="#4A3D36"/>
        </linearGradient>
      </defs>
      <rect width="900" height="1200" fill="url(#sky)"/>
      <circle cx="670" cy="280" r="110" fill="${accent}" opacity="0.72"/>
      <rect x="90" y="650" width="720" height="430" rx="36" fill="#2B2420" opacity="0.88"/>
      <circle cx="310" cy="830" r="95" fill="#F2ECE4"/>
      <circle cx="310" cy="830" r="68" fill="#8C5A3C"/>
      <rect x="470" y="760" width="260" height="160" rx="20" fill="#FAF7F2" opacity="0.92"/>
      <text x="96" y="540" font-family="system-ui, sans-serif" font-size="38" font-weight="700" fill="#1F1B18">
        ${safeScene}
      </text>
      <text x="96" y="592" font-family="system-ui, sans-serif" font-size="26" fill="#4A3D36">
        Back lens · ${timeStamp}
      </text>
    </svg>
  `;

  const frontSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
      <rect width="600" height="800" fill="#2E2723"/>
      <circle cx="300" cy="310" r="128" fill="#E3B99B"/>
      <path d="M120 740 C135 545, 465 545, 480 740 Z" fill="${accent}"/>
      <text x="300" y="730" text-anchor="middle" font-family="system-ui, sans-serif" font-size="30" font-weight="700" fill="#FAF7F2">
        ${safeAuthor} · Front
      </text>
    </svg>
  `;

  return {
    backUri: `data:image/svg+xml;utf8,${encodeURIComponent(backSvg.trim())}`,
    frontUri: `data:image/svg+xml;utf8,${encodeURIComponent(frontSvg.trim())}`,
  };
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

async function uploadPhotoToSupabaseStorage(params: {
  coupleId: string;
  promptDate: string;
  userId: string;
  lens: 'back' | 'front';
  localUri: string;
}): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
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

export async function fetchTodayMomentBundle(params: {
  coupleId: string;
  userId: string;
}): Promise<TodayMomentBundle> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc('get_today_moment_bundle');
    if (!error && data) {
      const bundle = data as TodayMomentBundle;
      if (bundle.mine || (bundle.partner && !bundle.partner.locked)) {
        const { data: signedData } = await supabase.functions.invoke('sign-moment-urls', {
          body: { promptId: bundle.prompt.id },
        });
        const urlMap = (signedData as { urls?: Record<string, string> } | null)?.urls ?? {};
        if (bundle.mine) {
          bundle.mine.back_photo_url =
            urlMap[bundle.mine.back_photo_path] ?? bundle.mine.back_photo_path;
          bundle.mine.front_photo_url =
            urlMap[bundle.mine.front_photo_path] ?? bundle.mine.front_photo_path;
        }
        if (bundle.partner && !bundle.partner.locked) {
          bundle.partner.back_photo_url = bundle.partner.back_photo_path
            ? (urlMap[bundle.partner.back_photo_path] ?? bundle.partner.back_photo_path)
            : null;
          bundle.partner.front_photo_url = bundle.partner.front_photo_path
            ? (urlMap[bundle.partner.front_photo_path] ?? bundle.partner.front_photo_path)
            : null;
        }
      }
      return bundle;
    }
    if (error && !isSchemaNotMigratedError(error)) throw new Error(error.message);
  }

  // Local Sandbox implementation mirroring Postgres `get_today_moment_bundle`
  const state = await readLocalMoments();
  const today = todayUtcDateString();
  const promptKey = `${params.coupleId}:${today}`;

  let prompt = state.prompts[promptKey];
  if (!prompt) {
    // Open today's prompt immediately in sandbox so the 2-minute window is live out of the box
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

  const allForPrompt = Object.values(state.moments).filter((m) => m.prompt_id === prompt.id);
  const mine = allForPrompt.find((m) => m.user_id === params.userId) ?? null;
  const rawPartner = allForPrompt.find((m) => m.user_id !== params.userId) ?? null;
  const unlocked = Boolean(mine && rawPartner);

  const partner: PartnerMomentView | null = !rawPartner
    ? null
    : unlocked
      ? {
          id: rawPartner.id,
          user_id: rawPartner.user_id,
          locked: false,
          back_photo_path: rawPartner.back_photo_path,
          front_photo_path: rawPartner.front_photo_path,
          back_blurhash: rawPartner.back_blurhash,
          caption: rawPartner.caption,
          captured_at: rawPartner.captured_at,
          posted_at: rawPartner.posted_at,
          late_by_seconds: rawPartner.late_by_seconds,
          is_late: rawPartner.is_late,
          retake_count: rawPartner.retake_count,
          back_photo_url: rawPartner.back_photo_url ?? rawPartner.back_photo_path,
          front_photo_url: rawPartner.front_photo_url ?? rawPartner.front_photo_path,
        }
      : {
          id: rawPartner.id,
          user_id: rawPartner.user_id,
          locked: true,
          back_photo_path: null,
          front_photo_path: null,
          back_blurhash: rawPartner.back_blurhash,
          caption: null,
          captured_at: rawPartner.captured_at,
          posted_at: rawPartner.posted_at,
          late_by_seconds: rawPartner.late_by_seconds,
          is_late: rawPartner.is_late,
          retake_count: rawPartner.retake_count,
          back_photo_url: null,
          front_photo_url: null,
        };

  const streak = state.streaks[params.coupleId] ?? {
    couple_id: params.coupleId,
    current_count: 0,
    longest_count: 0,
    last_completed_date: null,
  };

  return {
    prompt,
    streak,
    mine: mine
      ? {
          ...mine,
          back_photo_url: mine.back_photo_url ?? mine.back_photo_path,
          front_photo_url: mine.front_photo_url ?? mine.front_photo_path,
        }
      : null,
    partner,
  };
}

export async function submitDailyMoment(params: {
  coupleId: string;
  promptId: string;
  userId: string;
  backUri: string;
  frontUri: string;
  caption?: string;
  capturedAtIso?: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<MomentRecord> {
  const capturedAt = params.capturedAtIso ?? new Date().toISOString();
  const trimmedCaption = params.caption?.trim() ? params.caption.trim() : null;

  if (trimmedCaption && trimmedCaption.length > 100) {
    throw new Error('Caption must be 100 characters or fewer.');
  }

  if (isSupabaseConfigured && supabase) {
    try {
      const today = todayUtcDateString();
      const [backPath, frontPath] = await Promise.all([
        uploadPhotoToSupabaseStorage({
          coupleId: params.coupleId,
          promptDate: today,
          userId: params.userId,
          lens: 'back',
          localUri: params.backUri,
        }),
        uploadPhotoToSupabaseStorage({
          coupleId: params.coupleId,
          promptDate: today,
          userId: params.userId,
          lens: 'front',
          localUri: params.frontUri,
        }),
      ]);

      const { data, error } = await supabase.rpc('submit_daily_moment', {
        p_prompt_id: params.promptId,
        p_back_photo_path: backPath,
        p_front_photo_path: frontPath,
        p_back_blurhash: DEFAULT_WARM_BLURHASH,
        p_caption: trimmedCaption,
        p_captured_at: capturedAt,
        p_lat: params.lat ?? null,
        p_lng: params.lng ?? null,
      });

      if (!error && data) return data as MomentRecord;
      if (error && !isSchemaNotMigratedError(error)) throw new Error(error.message);
    } catch {
      // Fall through to local persistence when storage bucket or RPC is not yet migrated
    }
  }

  const state = await readLocalMoments();
  const prompt = Object.values(state.prompts).find((p) => p.id === params.promptId);
  if (!prompt) throw new Error('Today’s prompt window was not found.');

  const nowMs = Date.now();
  const triggerMs = new Date(prompt.trigger_at).getTime();
  if (nowMs < triggerMs) {
    throw new Error('Today’s Moment window has not opened yet.');
  }

  const capturedMs = new Date(capturedAt).getTime();
  const lateBySeconds = Math.max(0, Math.floor((capturedMs - triggerMs) / 1000));
  const momentKey = `${params.promptId}:${params.userId}`;
  const existing = state.moments[momentKey];

  let retakeCount = 0;
  if (existing) {
    if (existing.retake_count >= 2) {
      throw new Error('You have used both retakes for today’s Moment.');
    }
    if (lateBySeconds > 120) {
      throw new Error('Retakes are only available during the 2-minute window.');
    }
    retakeCount = existing.retake_count + 1;
  }

  const record: MomentRecord = {
    id: existing?.id ?? `moment_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    couple_id: params.coupleId,
    prompt_id: params.promptId,
    user_id: params.userId,
    back_photo_path: params.backUri,
    front_photo_path: params.frontUri,
    back_blurhash: DEFAULT_WARM_BLURHASH,
    collage_photo_path: null,
    caption: trimmedCaption,
    captured_at: capturedAt,
    posted_at: new Date(nowMs).toISOString(),
    late_by_seconds: lateBySeconds,
    is_late: lateBySeconds > 120,
    retake_count: retakeCount,
    lat: params.lat ?? null,
    lng: params.lng ?? null,
    back_photo_url: params.backUri,
    front_photo_url: params.frontUri,
  };

  state.moments[momentKey] = record;

  // Advance streak if both partners have posted for this prompt
  const distinctPosters = new Set(
    Object.values(state.moments)
      .filter((m) => m.prompt_id === params.promptId)
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
  return record;
}

export async function updateMomentCaption(params: {
  momentId: string;
  userId: string;
  caption: string;
}): Promise<MomentRecord> {
  const trimmed = params.caption.trim() ? params.caption.trim() : null;
  if (trimmed && trimmed.length > 100) {
    throw new Error('Caption must be 100 characters or fewer.');
  }

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc('update_moment_caption', {
      p_moment_id: params.momentId,
      p_caption: trimmed ?? '',
    });
    if (!error && data) return data as MomentRecord;
    if (error && !isSchemaNotMigratedError(error)) throw new Error(error.message);
  }

  const state = await readLocalMoments();
  const entry = Object.entries(state.moments).find(
    ([, m]) => m.id === params.momentId && m.user_id === params.userId
  );
  if (!entry) throw new Error('Moment not found.');

  const [key, record] = entry;
  const updated: MomentRecord = { ...record, caption: trimmed };
  state.moments[key] = updated;
  await writeLocalMoments(state);
  return updated;
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
      ? -15_000 // 01:45 remaining in 2-min window
      : params.mode === 'late_window'
        ? -7 * 60_000 // 5m past the 2-min window
        : 45 * 60_000; // 45m in the future

  const triggerAt = new Date(Date.now() + offsetMs).toISOString();
  const existing = state.prompts[promptKey];
  state.prompts[promptKey] = {
    id: existing?.id ?? `prompt_${params.coupleId}_${today}`,
    couple_id: params.coupleId,
    prompt_date: today,
    trigger_at: triggerAt,
    notified_at: offsetMs <= 0 ? triggerAt : null,
  };
  await writeLocalMoments(state);
}

export async function simulateSandboxPartnerMoment(params: {
  coupleId: string;
  promptId: string;
  partnerId: string;
  partnerName: string;
  postLate?: boolean;
}): Promise<void> {
  const state = await readLocalMoments();
  const prompt = Object.values(state.prompts).find((p) => p.id === params.promptId);
  if (!prompt) return;

  const triggerMs = new Date(prompt.trigger_at).getTime();
  const capturedAt = new Date(
    triggerMs + (params.postLate ? 380_000 : 42_000)
  ).toISOString();

  const photos = buildSimulatedDualPhotos({
    authorLabel: params.partnerName,
    sceneLabel: 'Iced oat latte before lab',
    accentHex: '#2E7D5B',
  });

  await submitDailyMoment({
    coupleId: params.coupleId,
    promptId: params.promptId,
    userId: params.partnerId,
    backUri: photos.backUri,
    frontUri: photos.frontUri,
    caption: 'Iced oat latte before lab',
    capturedAtIso: capturedAt,
  });
}
