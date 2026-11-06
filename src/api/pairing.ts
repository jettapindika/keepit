import AsyncStorage from '@react-native-async-storage/async-storage';

import { isSchemaNotMigratedError, isSupabaseConfigured, supabase } from '@/api/supabase';
import {
  CoupleRecord,
  PairingError,
  PairingErrorCode,
  PairingSnapshot,
  UserProfile,
} from '@/types/database';

const LOCAL_DB_KEY = 'keepit.local_db.v1';
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface LocalDbState {
  users: Record<string, UserProfile>;
  couples: Record<string, CoupleRecord>;
}

const KNOWN_ERROR_MESSAGES: Record<PairingErrorCode, string> = {
  UNAUTHENTICATED: 'Sign in first to pair with your partner.',
  INVALID_CODE_FORMAT: 'Enter all 6 characters of your partner’s invite code.',
  ALREADY_PAIRED: 'Your account is already paired with a partner.',
  CODE_NOT_FOUND: 'No active invite matches that 6-character code.',
  SELF_INVITE_FORBIDDEN: 'That is your own invite code. Share it with your partner instead.',
  COUPLE_FULL: 'This couple space already has 2 partners.',
  CODE_EXPIRED: 'This invite code expired. Ask your partner to tap Refresh Code.',
  NETWORK_ERROR: 'Could not reach KeepIt servers. Check your connection and try again.',
};

export function normalizeInviteCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function formatInviteCodeDisplay(code: string): string {
  const clean = normalizeInviteCode(code);
  if (clean.length <= 3) return clean;
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}`;
}

export function buildInviteDeepLink(code: string): string {
  return `keepit://pair?code=${normalizeInviteCode(code)}`;
}

function mapRpcError(err: unknown): PairingError {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const matchedCode = (Object.keys(KNOWN_ERROR_MESSAGES) as PairingErrorCode[]).find((code) =>
    rawMessage.includes(code)
  );
  if (matchedCode) {
    return new PairingError(matchedCode, KNOWN_ERROR_MESSAGES[matchedCode]);
  }
  if (err instanceof PairingError) {
    return err;
  }
  return new PairingError('NETWORK_ERROR', KNOWN_ERROR_MESSAGES.NETWORK_ERROR);
}

// ============================================================================
// Local Sandbox Store (used automatically when EXPO_PUBLIC_SUPABASE_URL is unset)
// ============================================================================

async function readLocalDb(): Promise<LocalDbState> {
  const raw = await AsyncStorage.getItem(LOCAL_DB_KEY);
  if (!raw) {
    return { users: {}, couples: {} };
  }
  try {
    return JSON.parse(raw) as LocalDbState;
  } catch {
    return { users: {}, couples: {} };
  }
}

async function writeLocalDb(db: LocalDbState): Promise<void> {
  await AsyncStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
}

function generateLocalCode(existingCodes: Set<string>): string {
  while (true) {
    let code = '';
    for (let i = 0; i < 6; i += 1) {
      code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
    }
    if (!existingCodes.has(code)) return code;
  }
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// Public Pairing & Auth Profile API
// ============================================================================

export async function upsertUserProfile(params: {
  userId: string;
  displayName: string;
  timezone?: string;
}): Promise<UserProfile> {
  const trimmedName = params.displayName.trim();
  const tz = params.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from('users')
      .upsert(
        {
          id: params.userId,
          display_name: trimmedName,
          timezone: tz,
        },
        { onConflict: 'id' }
      )
      .select('*')
      .single();

    if (!error) return data as UserProfile;
    if (!isSchemaNotMigratedError(error)) throw mapRpcError(error);
  }

  const db = await readLocalDb();
  const existing = db.users[params.userId];
  const profile: UserProfile = {
    id: params.userId,
    display_name: trimmedName,
    avatar_path: existing?.avatar_path ?? null,
    timezone: tz,
    push_token: existing?.push_token ?? null,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };
  db.users[params.userId] = profile;
  await writeLocalDb(db);
  return profile;
}

export async function fetchPairingSnapshot(userId: string): Promise<PairingSnapshot> {
  if (isSupabaseConfigured && supabase) {
    const { data: coupleData, error: coupleError } = await supabase
      .from('couples')
      .select('*')
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .maybeSingle();

    if (!coupleError) {
      if (!coupleData) return { couple: null, partner: null };
      const couple = coupleData as CoupleRecord;
      const partnerId = couple.user_a_id === userId ? couple.user_b_id : couple.user_a_id;
      if (!partnerId) return { couple, partner: null };
      const { data: partnerData, error: partnerError } = await supabase
        .from('users')
        .select('*')
        .eq('id', partnerId)
        .maybeSingle();
      if (partnerError && !isSchemaNotMigratedError(partnerError)) throw mapRpcError(partnerError);
      return { couple, partner: (partnerData as UserProfile | null) ?? null };
    }
    if (!isSchemaNotMigratedError(coupleError)) throw mapRpcError(coupleError);
  }

  const db = await readLocalDb();
  const couple =
    Object.values(db.couples).find((c) => c.user_a_id === userId || c.user_b_id === userId) ?? null;
  if (!couple) return { couple: null, partner: null };

  const partnerId = couple.user_a_id === userId ? couple.user_b_id : couple.user_a_id;
  const partner = partnerId ? (db.users[partnerId] ?? null) : null;
  return { couple, partner };
}

export async function createOrRefreshInvite(
  userId: string,
  forceRefresh = false
): Promise<CoupleRecord> {
  if (!userId) {
    throw new PairingError('UNAUTHENTICATED', KNOWN_ERROR_MESSAGES.UNAUTHENTICATED);
  }

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc('create_or_refresh_invite', {
      force_refresh: forceRefresh,
    });
    if (!error) return data as CoupleRecord;
    if (!isSchemaNotMigratedError(error)) throw mapRpcError(error);
  }

  const db = await readLocalDb();
  const existingCodes = new Set(Object.values(db.couples).map((c) => c.invite_code));
  const existing = Object.values(db.couples).find(
    (c) => c.user_a_id === userId || c.user_b_id === userId
  );

  const nowMs = Date.now();
  const nextExpiry = new Date(nowMs + 24 * 60 * 60 * 1000).toISOString();

  if (existing) {
    if (existing.state === 'active') return existing;

    const expired = new Date(existing.invite_expires_at).getTime() <= nowMs;
    if (forceRefresh || expired) {
      existingCodes.delete(existing.invite_code);
      existing.invite_code = generateLocalCode(existingCodes);
      existing.invite_expires_at = nextExpiry;
      db.couples[existing.id] = existing;
      await writeLocalDb(db);
    }
    return existing;
  }

  const created: CoupleRecord = {
    id: makeId('couple'),
    user_a_id: userId,
    user_b_id: null,
    invite_code: generateLocalCode(existingCodes),
    invite_expires_at: nextExpiry,
    state: 'pending',
    paired_at: null,
    created_at: new Date(nowMs).toISOString(),
  };
  db.couples[created.id] = created;
  await writeLocalDb(db);
  return created;
}

export async function redeemInviteCode(
  userId: string,
  rawCode: string
): Promise<PairingSnapshot> {
  if (!userId) {
    throw new PairingError('UNAUTHENTICATED', KNOWN_ERROR_MESSAGES.UNAUTHENTICATED);
  }

  const cleaned = normalizeInviteCode(rawCode);
  if (cleaned.length !== 6) {
    throw new PairingError('INVALID_CODE_FORMAT', KNOWN_ERROR_MESSAGES.INVALID_CODE_FORMAT);
  }

  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc('redeem_invite_code', { raw_code: cleaned });
    if (!error) return fetchPairingSnapshot(userId);
    if (!isSchemaNotMigratedError(error)) throw mapRpcError(error);
  }

  const db = await readLocalDb();
  const activeExisting = Object.values(db.couples).find(
    (c) => c.state === 'active' && (c.user_a_id === userId || c.user_b_id === userId)
  );
  if (activeExisting) {
    throw new PairingError('ALREADY_PAIRED', KNOWN_ERROR_MESSAGES.ALREADY_PAIRED);
  }

  const target = Object.values(db.couples).find((c) => c.invite_code === cleaned);
  if (!target) {
    throw new PairingError('CODE_NOT_FOUND', KNOWN_ERROR_MESSAGES.CODE_NOT_FOUND);
  }
  if (target.user_a_id === userId) {
    throw new PairingError('SELF_INVITE_FORBIDDEN', KNOWN_ERROR_MESSAGES.SELF_INVITE_FORBIDDEN);
  }
  if (target.state === 'active' || target.user_b_id !== null) {
    throw new PairingError('COUPLE_FULL', KNOWN_ERROR_MESSAGES.COUPLE_FULL);
  }
  if (new Date(target.invite_expires_at).getTime() <= Date.now()) {
    throw new PairingError('CODE_EXPIRED', KNOWN_ERROR_MESSAGES.CODE_EXPIRED);
  }

  // Delete caller's own unused pending couple row first (mirrors Postgres RPC)
  for (const [coupleId, record] of Object.entries(db.couples)) {
    if (record.user_a_id === userId && record.state === 'pending') {
      delete db.couples[coupleId];
    }
  }

  target.user_b_id = userId;
  target.state = 'active';
  target.paired_at = new Date().toISOString();
  db.couples[target.id] = target;
  await writeLocalDb(db);

  return {
    couple: target,
    partner: db.users[target.user_a_id] ?? null,
  };
}

// Helper for single-device sandbox testing when Supabase env vars are not set:
// simulates a partner creating an invite or joining the current user's invite.
export async function simulateSandboxPartnerJoin(
  currentUserId: string,
  partnerName = 'Maya'
): Promise<PairingSnapshot> {
  const db = await readLocalDb();
  const partnerId = 'sandbox_partner_maya';
  db.users[partnerId] = {
    id: partnerId,
    display_name: partnerName,
    avatar_path: null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    push_token: null,
    created_at: new Date().toISOString(),
  };
  await writeLocalDb(db);

  const myInvite = await createOrRefreshInvite(currentUserId, false);
  await redeemInviteCode(partnerId, myInvite.invite_code);
  return fetchPairingSnapshot(currentUserId);
}

export async function unpairCurrentCouple(userId: string): Promise<void> {
  if (!userId) {
    throw new PairingError('UNAUTHENTICATED', KNOWN_ERROR_MESSAGES.UNAUTHENTICATED);
  }

  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc('unpair_current_couple');
    if (!error) return;
    if (!isSchemaNotMigratedError(error)) throw mapRpcError(error);
  }

  const db = await readLocalDb();
  for (const [coupleId, record] of Object.entries(db.couples)) {
    if (record.user_a_id === userId || record.user_b_id === userId) {
      delete db.couples[coupleId];
    }
  }
  await writeLocalDb(db);
}
