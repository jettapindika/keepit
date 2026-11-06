import AsyncStorage from '@react-native-async-storage/async-storage';

import { isSupabaseConfigured, supabase } from '@/api/supabase';
import {
  CoupleStatusBundle,
  StatusDurationPreset,
  StatusRecord,
} from '@/types/database';

const LOCAL_STATUS_KEY = 'keepit.local_statuses.v1';

export interface StatusPresetItem {
  id: string;
  emoji: string;
  text: string;
  defaultDuration: StatusDurationPreset;
}

export const STATUS_PRESETS: readonly StatusPresetItem[] = [
  { id: 'in_class', emoji: '📚', text: 'In class', defaultDuration: '3h' },
  { id: 'on_my_way', emoji: '🚶', text: 'On my way', defaultDuration: '1h' },
  { id: 'low_battery', emoji: '🪫', text: 'Low battery', defaultDuration: '3h' },
  { id: 'coffee_run', emoji: '☕', text: 'Coffee run', defaultDuration: '1h' },
  { id: 'deep_work', emoji: '💼', text: 'Deep work', defaultDuration: '3h' },
  { id: 'winding_down', emoji: '🌙', text: 'Winding down', defaultDuration: 'tonight' },
] as const;

export const DURATION_OPTIONS: readonly {
  value: StatusDurationPreset;
  label: string;
  description: string;
}[] = [
  { value: '1h', label: '1 hour', description: 'Clears in 60m' },
  { value: '3h', label: '3 hours', description: 'Clears in 3h' },
  { value: 'tonight', label: 'Till tonight', description: 'Until 23:59 local' },
] as const;

export function computeStatusExpiryIso(preset: StatusDurationPreset, now = new Date()): string {
  const nowMs = now.getTime();
  if (preset === '1h') {
    return new Date(nowMs + 60 * 60 * 1000).toISOString();
  }
  if (preset === '3h') {
    return new Date(nowMs + 3 * 60 * 60 * 1000).toISOString();
  }
  const endOfLocalDay = new Date(now);
  endOfLocalDay.setHours(23, 59, 59, 999);
  const minTonightMs = nowMs + 30 * 60 * 1000;
  return new Date(Math.max(endOfLocalDay.getTime(), minTonightMs)).toISOString();
}

export function formatStatusRemaining(expiresAtIso: string): string {
  const diffMs = new Date(expiresAtIso).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const totalMins = Math.max(1, Math.ceil(diffMs / 60_000));
  if (totalMins < 60) return `${totalMins}m left`;
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins > 0 ? `${hrs}h ${mins}m left` : `${hrs}h left`;
}

async function readLocalStatuses(): Promise<Record<string, StatusRecord>> {
  const raw = await AsyncStorage.getItem(LOCAL_STATUS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, StatusRecord>;
  } catch {
    return {};
  }
}

async function writeLocalStatuses(map: Record<string, StatusRecord>): Promise<void> {
  await AsyncStorage.setItem(LOCAL_STATUS_KEY, JSON.stringify(map));
}

export async function fetchCoupleStatuses(params: {
  coupleId: string;
  userId: string;
}): Promise<CoupleStatusBundle> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc('get_couple_statuses');
    if (error) throw new Error(error.message);
    return data as CoupleStatusBundle;
  }

  const map = await readLocalStatuses();
  const nowMs = Date.now();
  let mutated = false;

  for (const [uid, record] of Object.entries(map)) {
    if (new Date(record.expires_at).getTime() <= nowMs) {
      delete map[uid];
      mutated = true;
    }
  }
  if (mutated) {
    await writeLocalStatuses(map);
  }

  const allForCouple = Object.values(map).filter((s) => s.couple_id === params.coupleId);
  const mine = allForCouple.find((s) => s.user_id === params.userId) ?? null;
  const partner = allForCouple.find((s) => s.user_id !== params.userId) ?? null;

  return { mine, partner };
}

export async function upsertMyStatus(params: {
  coupleId: string;
  userId: string;
  emoji: string;
  text: string;
  durationPreset: StatusDurationPreset;
}): Promise<StatusRecord> {
  const cleanedEmoji = params.emoji.trim();
  const cleanedText = params.text.trim();

  if (cleanedEmoji.length < 1 || cleanedEmoji.length > 8) {
    throw new Error('Choose an emoji for your status.');
  }
  if (cleanedText.length < 1 || cleanedText.length > 40) {
    throw new Error('Enter a short status between 1 and 40 characters.');
  }

  const expiresAtIso = computeStatusExpiryIso(params.durationPreset);

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc('upsert_my_status', {
      p_emoji: cleanedEmoji,
      p_text: cleanedText,
      p_duration_preset: params.durationPreset,
      p_expires_at: expiresAtIso,
    });
    if (error) throw new Error(error.message);
    return data as StatusRecord;
  }

  const map = await readLocalStatuses();
  const record: StatusRecord = {
    user_id: params.userId,
    couple_id: params.coupleId,
    emoji: cleanedEmoji,
    text: cleanedText,
    duration_preset: params.durationPreset,
    expires_at: expiresAtIso,
    updated_at: new Date().toISOString(),
  };
  map[params.userId] = record;
  await writeLocalStatuses(map);
  return record;
}

export async function clearMyStatus(userId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc('clear_my_status');
    if (error) throw new Error(error.message);
    return;
  }

  const map = await readLocalStatuses();
  delete map[userId];
  await writeLocalStatuses(map);
}

// Sandbox helper: lets user simulate partner setting or expiring a status
export async function simulateSandboxPartnerStatus(params: {
  coupleId: string;
  partnerId: string;
  preset?: StatusPresetItem;
}): Promise<StatusRecord> {
  const chosen = params.preset ?? STATUS_PRESETS[0];
  return upsertMyStatus({
    coupleId: params.coupleId,
    userId: params.partnerId,
    emoji: chosen.emoji,
    text: chosen.text,
    durationPreset: chosen.defaultDuration,
  });
}
