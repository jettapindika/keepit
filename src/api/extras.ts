import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildSimulatedDualPhotos, DEFAULT_WARM_BLURHASH } from '@/api/moments';
import { broadcastCoupleSync } from '@/api/realtimeSync';
import { isSchemaNotMigratedError, isSupabaseConfigured, supabase } from '@/api/supabase';
import { useSessionStore } from '@/store/sessionStore';
import {
  CoupleEventRecord,
  DailyPromptRecord,
  MemoryDayRecord,
  MomentRecord,
  MonthMemoriesBundle,
  StreakRecord,
} from '@/types/database';

const LOCAL_EVENTS_KEY = 'keepit.local_events.v1';
const LOCAL_MOMENTS_KEY = 'keepit.local_moments.v1';
const NUDGE_COOLDOWN_MS = 30_000;
const NUDGE_COOLDOWN_MESSAGE = 'Wait a few seconds before nudging again.';

interface LocalMomentsState {
  prompts: Record<string, DailyPromptRecord>;
  moments: Record<string, MomentRecord>;
  streaks: Record<string, StreakRecord>;
}

async function readLocalEvents(): Promise<CoupleEventRecord[]> {
  const raw = await AsyncStorage.getItem(LOCAL_EVENTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CoupleEventRecord[]) : [];
  } catch {
    return [];
  }
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

export async function sendPartnerNudge(params: {
  coupleId: string;
  userId: string;
  note?: string;
}): Promise<CoupleEventRecord> {
  const cleanedNote = params.note?.trim() ? params.note.trim().slice(0, 40) : 'Thinking of you';

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc('send_partner_nudge', {
      p_note: cleanedNote,
    });

    if (!error && data) {
      const eventRecord = data as CoupleEventRecord;
      void supabase.functions
        .invoke('dispatch-push', {
          body: {
            eventId: eventRecord.id,
            coupleId: params.coupleId,
            actorId: params.userId,
            eventType: 'nudge',
            payload: eventRecord.payload ?? { note: cleanedNote },
          },
        })
        .catch(() => {});
      return eventRecord;
    }
    if (error && error.message.includes('NUDGE_COOLDOWN')) {
      throw new Error(NUDGE_COOLDOWN_MESSAGE);
    }
    if (error && !isSchemaNotMigratedError(error)) {
      throw new Error(error.message);
    }
  }

  const events = await readLocalEvents();
  const nowMs = Date.now();

  const latestMine = events.find(
    (e) =>
      e.event_type === 'nudge' &&
      e.actor_id === params.userId &&
      (!e.couple_id || e.couple_id === params.coupleId)
  );

  if (latestMine) {
    const elapsedMs = nowMs - new Date(latestMine.created_at).getTime();
    if (elapsedMs >= 0 && elapsedMs < NUDGE_COOLDOWN_MS) {
      throw new Error(NUDGE_COOLDOWN_MESSAGE);
    }
  }

  const record: CoupleEventRecord = {
    id: `evt_nudge_${nowMs.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    couple_id: params.coupleId,
    actor_id: params.userId,
    event_type: 'nudge',
    payload: {
      note: cleanedNote,
    },
    created_at: new Date(nowMs).toISOString(),
  };

  const nextEvents = [record, ...events].slice(0, 60);
  await AsyncStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify(nextEvents));
  void broadcastCoupleSync(params.coupleId, { kind: 'nudge_sent', event: record });
  return record;
}

export async function fetchRecentNudges(params: {
  coupleId: string;
}): Promise<CoupleEventRecord[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from('couple_events')
      .select('id, couple_id, actor_id, event_type, payload, created_at')
      .eq('couple_id', params.coupleId)
      .eq('event_type', 'nudge')
      .order('created_at', { ascending: false })
      .limit(12);

    if (!error) return (data ?? []) as CoupleEventRecord[];
    if (!isSchemaNotMigratedError(error)) throw new Error(error.message);
  }

  const events = await readLocalEvents();
  return events
    .filter(
      (e) =>
        e.event_type === 'nudge' && (!e.couple_id || e.couple_id === params.coupleId)
    )
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 12);
}

export async function simulateSandboxPartnerNudge(params: {
  coupleId: string;
  partnerId: string;
  partnerName: string;
}): Promise<CoupleEventRecord> {
  const events = await readLocalEvents();
  const nowMs = Date.now();
  const partnerFirst = params.partnerName.trim() || 'Partner';

  const sampleNotes = [
    'Thinking of you right now',
    `Quick hello from ${partnerFirst}`,
    'Miss your face today',
    'Sending a warm check-in',
  ];
  const note = sampleNotes[events.length % sampleNotes.length];

  const record: CoupleEventRecord = {
    id: `evt_partner_nudge_${nowMs.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    couple_id: params.coupleId,
    actor_id: params.partnerId,
    event_type: 'nudge',
    payload: { note },
    created_at: new Date(nowMs).toISOString(),
  };

  const nextEvents = [record, ...events].slice(0, 60);
  await AsyncStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify(nextEvents));
  return record;
}

export async function fetchMonthMemories(params: {
  coupleId: string;
  userId: string;
  year: number;
  month: number; // 1..12
}): Promise<MonthMemoriesBundle> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc('get_month_memories', {
      p_year: params.year,
      p_month: params.month,
    });
    if (!error && data) {
      const rawBundle = data as MonthMemoriesBundle;
      const days = [...(rawBundle.days ?? [])].sort((a, b) =>
        a.prompt_date < b.prompt_date ? 1 : a.prompt_date > b.prompt_date ? -1 : 0
      );
      const client = supabase;
      await Promise.all(
        days.map(async (day) => {
          if (!day.mine && !day.partner) return;
          const { data: signedData } = await client.functions.invoke('sign-moment-urls', {
            body: { promptId: day.prompt_id },
          });
          const urlMap = (signedData as { urls?: Record<string, string> } | null)?.urls ?? {};
          if (day.mine) {
            day.mine.back_photo_url =
              urlMap[day.mine.back_photo_path] ?? day.mine.back_photo_url ?? day.mine.back_photo_path;
            day.mine.front_photo_url =
              urlMap[day.mine.front_photo_path] ??
              day.mine.front_photo_url ??
              day.mine.front_photo_path;
          }
          if (day.partner) {
            day.partner.back_photo_url =
              urlMap[day.partner.back_photo_path] ??
              day.partner.back_photo_url ??
              day.partner.back_photo_path;
            day.partner.front_photo_url =
              urlMap[day.partner.front_photo_path] ??
              day.partner.front_photo_url ??
              day.partner.front_photo_path;
          }
        })
      );
      return {
        days,
        streak: rawBundle.streak ?? {
          couple_id: params.coupleId,
          current_count: 0,
          longest_count: 0,
          last_completed_date: null,
        },
      };
    }
    if (error && !isSchemaNotMigratedError(error)) throw new Error(error.message);
  }

  const state = await readLocalMoments();
  const monthPrefix = `${String(params.year).padStart(4, '0')}-${String(params.month).padStart(2, '0')}-`;
  const todayUtc = new Date().toISOString().slice(0, 10);

  const promptsInMonth = Object.values(state.prompts).filter(
    (p) => p.couple_id === params.coupleId && p.prompt_date.startsWith(monthPrefix)
  );

  const days: MemoryDayRecord[] = [];

  for (const prompt of promptsInMonth) {
    const promptMoments = Object.values(state.moments).filter((m) => {
      const mDate = (m.posted_at || m.captured_at || '').slice(0, 10);
      return (
        m.prompt_id === prompt.id ||
        (m.couple_id === params.coupleId && mDate === prompt.prompt_date)
      );
    });
    if (promptMoments.length === 0) continue;

    const rawMine = promptMoments.find((m) => m.user_id === params.userId) ?? null;
    const rawPartner =
      promptMoments.find((m) => m.user_id !== params.userId && !m.user_id.startsWith('friend_')) ??
      null;

    const canRevealPartner = prompt.prompt_date < todayUtc || Boolean(rawMine);

    const mine: MomentRecord | null = rawMine
      ? {
          ...rawMine,
          back_photo_url: rawMine.back_photo_url ?? rawMine.back_photo_path,
          front_photo_url: rawMine.front_photo_url ?? rawMine.front_photo_path,
        }
      : null;

    const partner: MomentRecord | null =
      rawPartner && canRevealPartner
        ? {
            ...rawPartner,
            back_photo_url: rawPartner.back_photo_url ?? rawPartner.back_photo_path,
            front_photo_url: rawPartner.front_photo_url ?? rawPartner.front_photo_path,
          }
        : null;

    if (mine || partner) {
      days.push({
        prompt_id: prompt.id,
        prompt_date: prompt.prompt_date,
        mine,
        partner,
      });
    }
  }

  days.sort((a, b) =>
    a.prompt_date < b.prompt_date ? 1 : a.prompt_date > b.prompt_date ? -1 : 0
  );

  const streak: StreakRecord = state.streaks[params.coupleId] ?? {
    couple_id: params.coupleId,
    current_count: 0,
    longest_count: 0,
    last_completed_date: null,
  };

  return { days, streak };
}

export async function seedSandboxSampleMemories(params: {
  coupleId: string;
  userId: string;
  partnerId: string;
  userName: string;
  partnerName: string;
}): Promise<void> {
  const state = await readLocalMoments();
  const now = new Date();
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth(); // 0..11
  const currentDayOfMonth = now.getUTCDate();

  const sampleTemplates: {
    myScene: string;
    myCaption: string;
    myLateSec: number;
    myAccent: string;
    partnerScene: string;
    partnerCaption: string;
    partnerLateSec: number;
    partnerAccent: string;
    triggerHourUtc: number;
  }[] = [
    {
      myScene: 'Morning pour-over by the window',
      myCaption: 'Morning pour-over before the commute',
      myLateSec: 38,
      myAccent: '#C96A4A',
      partnerScene: 'Sunny walk past the corner bakery',
      partnerCaption: 'Grabbed a warm croissant on the walk',
      partnerLateSec: 54,
      partnerAccent: '#3D7A68',
      triggerHourUtc: 15,
    },
    {
      myScene: 'Notebook sketches at the desk',
      myCaption: 'Afternoon tea and page notes',
      myLateSec: 72,
      myAccent: '#B57B4C',
      partnerScene: 'Reading on the studio couch',
      partnerCaption: 'Quiet chapter break between calls',
      partnerLateSec: 95,
      partnerAccent: '#5C6F8C',
      triggerHourUtc: 18,
    },
    {
      myScene: 'Grocery run for pasta night',
      myCaption: 'Picked up basil and cherry tomatoes',
      myLateSec: 44,
      myAccent: '#4E7D5E',
      partnerScene: 'Train platform at golden hour',
      partnerCaption: 'Heading home right on schedule',
      partnerLateSec: 260,
      partnerAccent: '#C47D4E',
      triggerHourUtc: 20,
    },
    {
      myScene: 'Rain on the balcony railing',
      myCaption: 'Listening to the rain let up',
      myLateSec: 63,
      myAccent: '#5D707F',
      partnerScene: 'Matcha cup beside the keyboard',
      partnerCaption: 'Second cup to finish the afternoon',
      partnerLateSec: 81,
      partnerAccent: '#6B8E67',
      triggerHourUtc: 16,
    },
    {
      myScene: 'Evening lamp light in the kitchen',
      myCaption: 'Simmering soup for tonight',
      myLateSec: 29,
      myAccent: '#C25E49',
      partnerScene: 'Bookshop aisle on 4th street',
      partnerCaption: 'Found that paperback you mentioned',
      partnerLateSec: 68,
      partnerAccent: '#7B648A',
      triggerHourUtc: 19,
    },
  ];

  // Pick 5 distinct days inside the current UTC month, preferring days strictly before today
  // so every sample day sits in the current month view cleanly.
  const targetDays: number[] = [];
  for (let offset = 1; offset <= currentDayOfMonth - 1 && targetDays.length < 5; offset += 1) {
    targetDays.push(currentDayOfMonth - offset);
  }
  const daysInCurrentMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  for (
    let dayNum = currentDayOfMonth;
    dayNum <= daysInCurrentMonth && targetDays.length < 5;
    dayNum += 1
  ) {
    if (!targetDays.includes(dayNum)) {
      targetDays.push(dayNum);
    }
  }

  targetDays.sort((a, b) => b - a);

  targetDays.forEach((dayOfMonth, idx) => {
    const tpl = sampleTemplates[idx % sampleTemplates.length];
    const dateStr = `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
    const promptKey = `${params.coupleId}:${dateStr}`;
    const existingPrompt = state.prompts[promptKey];
    const triggerIso = new Date(
      Date.UTC(year, monthIndex, dayOfMonth, tpl.triggerHourUtc, 14, 0)
    ).toISOString();

    const promptId = existingPrompt?.id ?? `prompt_${params.coupleId}_${dateStr}`;
    state.prompts[promptKey] = {
      id: promptId,
      couple_id: params.coupleId,
      prompt_date: dateStr,
      trigger_at: existingPrompt?.trigger_at ?? triggerIso,
      notified_at: existingPrompt?.notified_at ?? triggerIso,
    };

    const baseTriggerMs = new Date(state.prompts[promptKey].trigger_at).getTime();

    const myPhotos = buildSimulatedDualPhotos({
      authorLabel: params.userName,
      sceneLabel: tpl.myScene,
      accentHex: tpl.myAccent,
    });
    const myCapturedIso = new Date(baseTriggerMs + tpl.myLateSec * 1000).toISOString();
    const myKey = `${promptId}:${params.userId}`;

    state.moments[myKey] = {
      id: state.moments[myKey]?.id ?? `moment_seed_me_${dateStr}`,
      couple_id: params.coupleId,
      prompt_id: promptId,
      user_id: params.userId,
      back_photo_path: myPhotos.backUri,
      front_photo_path: myPhotos.frontUri,
      back_blurhash: DEFAULT_WARM_BLURHASH,
      collage_photo_path: null,
      caption: tpl.myCaption,
      captured_at: myCapturedIso,
      posted_at: myCapturedIso,
      late_by_seconds: tpl.myLateSec,
      is_late: tpl.myLateSec > 120,
      retake_count: idx === 1 ? 1 : 0,
      lat: null,
      lng: null,
      back_photo_url: myPhotos.backUri,
      front_photo_url: myPhotos.frontUri,
    };

    const partnerPhotos = buildSimulatedDualPhotos({
      authorLabel: params.partnerName,
      sceneLabel: tpl.partnerScene,
      accentHex: tpl.partnerAccent,
    });
    const partnerCapturedIso = new Date(baseTriggerMs + tpl.partnerLateSec * 1000).toISOString();
    const partnerKey = `${promptId}:${params.partnerId}`;

    state.moments[partnerKey] = {
      id: state.moments[partnerKey]?.id ?? `moment_seed_partner_${dateStr}`,
      couple_id: params.coupleId,
      prompt_id: promptId,
      user_id: params.partnerId,
      back_photo_path: partnerPhotos.backUri,
      front_photo_path: partnerPhotos.frontUri,
      back_blurhash: DEFAULT_WARM_BLURHASH,
      collage_photo_path: null,
      caption: tpl.partnerCaption,
      captured_at: partnerCapturedIso,
      posted_at: partnerCapturedIso,
      late_by_seconds: tpl.partnerLateSec,
      is_late: tpl.partnerLateSec > 120,
      retake_count: 0,
      lat: null,
      lng: null,
      back_photo_url: partnerPhotos.backUri,
      front_photo_url: partnerPhotos.frontUri,
    };
  });

  const latestSeededDate =
    targetDays.length > 0
      ? `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${String(targetDays[0]).padStart(2, '0')}`
      : now.toISOString().slice(0, 10);

  const existingStreak = state.streaks[params.coupleId];
  state.streaks[params.coupleId] = {
    couple_id: params.coupleId,
    current_count: 6,
    longest_count: Math.max(6, existingStreak?.longest_count ?? 0),
    last_completed_date: latestSeededDate,
    updated_at: new Date().toISOString(),
  };

  await AsyncStorage.setItem(LOCAL_MOMENTS_KEY, JSON.stringify(state));
}

export async function deleteAccountAndAllData(params: { userId: string }): Promise<void> {
  if (!params.userId) {
    throw new Error('No active account found to delete.');
  }

  if (isSupabaseConfigured && supabase) {
    try {
      const { error: fnError } = await supabase.functions.invoke('delete-couple-or-user', {
        body: { mode: 'delete_account' },
      });
      if (fnError) {
        await supabase.rpc('delete_my_account_data');
      }
      await supabase.auth.signOut().catch(() => {});
    } catch {
      // Proceed to local wipe
    }
  }

  await useSessionStore.getState().wipeLocalAccount();
}
