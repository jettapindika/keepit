import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildInviteChannelTopic, broadcastCoupleSync } from '@/api/realtimeSync';
import { buildDefaultUsername, buildFriendCode } from '@/api/social';
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

export interface RealtimeInvitePresence {
  couple: CoupleRecord;
  hostProfile: UserProfile;
}

export interface RealtimeRedeemPayload {
  couple: CoupleRecord;
  hostProfile: UserProfile;
  joinerProfile: UserProfile;
}

const KNOWN_ERROR_MESSAGES: Record<PairingErrorCode, string> = {
  UNAUTHENTICATED: 'Sign in first to pair with your partner.',
  INVALID_CODE_FORMAT: 'Enter all 6 characters of your partner’s invite code.',
  ALREADY_PAIRED: 'Your account is already paired with a partner.',
  CODE_NOT_FOUND: 'No active invite matches that 6-character code.',
  SELF_INVITE_FORBIDDEN: 'That is your own invite code. Share it with your partner instead.',
  COUPLE_FULL: 'This couple space already has 2 partners.',
  CODE_EXPIRED: 'This invite code expired. Ask your partner to tap Refresh Code.',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Wait a few minutes before trying another code.',
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

export async function saveCompletedPairingLocally(params: {
  couple: CoupleRecord;
  partner: UserProfile;
  selfProfile?: UserProfile | null;
}): Promise<void> {
  const db = await readLocalDb();
  if (params.selfProfile) {
    db.users[params.selfProfile.id] = params.selfProfile;
  }
  db.users[params.partner.id] = params.partner;

  // Remove any stale pending invites for either user
  for (const [coupleId, rec] of Object.entries(db.couples)) {
    if (
      rec.id !== params.couple.id &&
      (rec.user_a_id === params.couple.user_a_id ||
        rec.user_a_id === params.couple.user_b_id ||
        rec.user_b_id === params.couple.user_a_id ||
        rec.user_b_id === params.couple.user_b_id)
    ) {
      delete db.couples[coupleId];
    }
  }

  db.couples[params.couple.id] = params.couple;
  await writeLocalDb(db);
}

/**
 * Resolves a partner's 6-character invite across devices over Supabase Realtime
 * Presence + Broadcast when Postgres tables are not yet migrated.
 */
async function tryRedeemViaRealtimeRoom(params: {
  cleanedCode: string;
  joinerProfile: UserProfile;
}): Promise<PairingSnapshot | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const client = supabase;
  const channelName = buildInviteChannelTopic(params.cleanedCode);
  const room = client.channel(channelName, {
    config: {
      private: true,
      broadcast: { ack: true, self: false },
      presence: { key: `joiner_${params.joinerProfile.id}` },
    },
  });

  const waiter = Promise.withResolvers<PairingSnapshot | null>();
  let settled = false;

  const finish = (result: PairingSnapshot | null) => {
    if (settled) return;
    settled = true;
    waiter.resolve(result);
  };

  const timer = setTimeout(() => {
    finish(null);
  }, 2400);

  const tryExtractHostFromPresence = async () => {
    const state = room.presenceState();
    for (const entries of Object.values(state)) {
      for (const rawEntry of entries as unknown[]) {
        if (
          rawEntry &&
          typeof rawEntry === 'object' &&
          'couple' in rawEntry &&
          'hostProfile' in rawEntry
        ) {
          const entry = rawEntry as RealtimeInvitePresence;
          if (entry.couple?.invite_code === params.cleanedCode) {
            if (entry.couple.user_a_id === params.joinerProfile.id) {
              clearTimeout(timer);
              void client.removeChannel(room);
              throw new PairingError(
                'SELF_INVITE_FORBIDDEN',
                KNOWN_ERROR_MESSAGES.SELF_INVITE_FORBIDDEN
              );
            }
            const activeCouple: CoupleRecord = {
              ...entry.couple,
              user_b_id: params.joinerProfile.id,
              state: 'active',
              paired_at: new Date().toISOString(),
            };
            const redeemPayload: RealtimeRedeemPayload = {
              couple: activeCouple,
              hostProfile: entry.hostProfile,
              joinerProfile: params.joinerProfile,
            };
            await room
              .send({
                type: 'broadcast',
                event: 'invite_redeemed',
                payload: redeemPayload,
              })
              .catch(() => {});

            finish({
              couple: activeCouple,
              partner: entry.hostProfile,
            });
            return;
          }
        }
      }
    }
  };

  room
    .on('presence', { event: 'sync' }, () => {
      void tryExtractHostFromPresence().catch((err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          waiter.reject(err);
        }
      });
    })
    .on('broadcast', { event: 'invite_host_announce' }, (msg) => {
      const payload = msg.payload as RealtimeInvitePresence | undefined;
      if (!payload?.couple || !payload?.hostProfile) return;
      if (payload.couple.user_a_id === params.joinerProfile.id) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          waiter.reject(
            new PairingError(
              'SELF_INVITE_FORBIDDEN',
              KNOWN_ERROR_MESSAGES.SELF_INVITE_FORBIDDEN
            )
          );
        }
        return;
      }
      const activeCouple: CoupleRecord = {
        ...payload.couple,
        user_b_id: params.joinerProfile.id,
        state: 'active',
        paired_at: new Date().toISOString(),
      };
      const redeemPayload: RealtimeRedeemPayload = {
        couple: activeCouple,
        hostProfile: payload.hostProfile,
        joinerProfile: params.joinerProfile,
      };
      void room
        .send({
          type: 'broadcast',
          event: 'invite_redeemed',
          payload: redeemPayload,
        })
        .finally(() => {
          finish({
            couple: activeCouple,
            partner: payload.hostProfile,
          });
        });
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void room
          .send({
            type: 'broadcast',
            event: 'WhoHasInvite',
            payload: { code: params.cleanedCode, joiner: params.joinerProfile },
          })
          .catch(() => {});
      }
    });

  try {
    const result = await waiter.promise;
    return result;
  } finally {
    clearTimeout(timer);
    void client.removeChannel(room);
  }
}

// ============================================================================
// Public Pairing & Auth Profile API
// ============================================================================

export async function upsertUserProfile(params: {
  userId: string;
  displayName: string;
  username?: string;
  bio?: string;
  pronouns?: string;
  moodSong?: string;
  bannerColor?: string;
  website?: string;
  avatarPath?: string | null;
  isPrivate?: boolean;
  dumpMode?: boolean;
  timezone?: string;
  coupleId?: string | null;
}): Promise<UserProfile> {
  const trimmedName = params.displayName.trim();
  const tz = params.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';

  const db = await readLocalDb();
  const existing = db.users[params.userId];
  const rawRequestedUsername =
    params.username !== undefined
      ? params.username.trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._]/g, '').slice(0, 24)
      : undefined;

  if (rawRequestedUsername !== undefined && rawRequestedUsername.length < 2) {
    throw new Error('Username must be between 2 and 24 characters (letters, numbers, . or _).');
  }

  const candidateUsername =
    rawRequestedUsername ??
    existing?.username ??
    buildDefaultUsername(trimmedName, params.userId);

  const duplicateLocalUser = Object.values(db.users).find(
    (u) =>
      u.id !== params.userId &&
      u.username &&
      u.username.toLowerCase() === candidateUsername.toLowerCase()
  );
  if (duplicateLocalUser) {
    throw new Error(`@${candidateUsername} is already taken. Choose another handle.`);
  }

  if (isSupabaseConfigured && supabase && rawRequestedUsername) {
    try {
      const { data: conflictRow, error: conflictErr } = await supabase
        .from('users')
        .select('id, username')
        .ilike('username', candidateUsername)
        .neq('id', params.userId)
        .maybeSingle();
      if (!conflictErr && conflictRow) {
        throw new Error(`@${candidateUsername} is already taken. Choose another handle.`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('already taken')) {
        throw err;
      }
    }
  }

  const profile: UserProfile = {
    id: params.userId,
    display_name: trimmedName,
    username: candidateUsername,
    bio:
      params.bio !== undefined
        ? params.bio.trim().slice(0, 140)
        : (existing?.bio ?? ''),
    pronouns:
      params.pronouns !== undefined
        ? params.pronouns.trim().slice(0, 24)
        : (existing?.pronouns ?? ''),
    mood_song:
      params.moodSong !== undefined
        ? params.moodSong.trim().slice(0, 60)
        : (existing?.mood_song ?? ''),
    banner_color:
      params.bannerColor !== undefined
        ? params.bannerColor
        : (existing?.banner_color ?? '#1C1C1E'),
    website:
      params.website !== undefined
        ? params.website.trim().slice(0, 80)
        : (existing?.website ?? ''),
    friend_code: existing?.friend_code ?? buildFriendCode(params.userId, trimmedName),
    is_private:
      params.isPrivate !== undefined ? params.isPrivate : (existing?.is_private ?? false),
    dump_mode:
      params.dumpMode !== undefined ? params.dumpMode : (existing?.dump_mode ?? false),
    avatar_path:
      params.avatarPath !== undefined ? params.avatarPath : (existing?.avatar_path ?? null),
    timezone: tz,
    push_token: existing?.push_token ?? null,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };
  db.users[params.userId] = profile;
  await writeLocalDb(db);

  if (params.coupleId) {
    void broadcastCoupleSync(params.coupleId, { kind: 'profile_upsert', profile });
  }

  if (isSupabaseConfigured && supabase) {
    try {
      const { data: upsertedRow, error: fullUpsertErr } = await supabase
        .from('users')
        .upsert(
          {
            id: params.userId,
            display_name: profile.display_name,
            username: profile.username,
            bio: profile.bio,
            pronouns: profile.pronouns,
            mood_song: profile.mood_song,
            banner_color: profile.banner_color,
            website: profile.website,
            friend_code: profile.friend_code,
            is_private: profile.is_private,
            dump_mode: profile.dump_mode,
            avatar_path: profile.avatar_path,
            timezone: tz,
          },
          { onConflict: 'id' }
        )
        .select('*')
        .single();

      if (fullUpsertErr) {
        if (fullUpsertErr.code === '23505') {
          throw new Error(`@${candidateUsername} is already taken. Choose another handle.`);
        }
        await supabase
          .from('users')
          .upsert(
            {
              id: params.userId,
              display_name: trimmedName,
              avatar_path: profile.avatar_path,
              timezone: tz,
            },
            { onConflict: 'id' }
          )
          .select('*')
          .single();
      } else if (upsertedRow) {
        const merged = { ...profile, ...(upsertedRow as Partial<UserProfile>) };
        db.users[params.userId] = merged;
        await writeLocalDb(db);
        return merged;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('already taken')) {
        throw err;
      }
    }
  }
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
  if (target) {
    if (target.user_a_id === userId) {
      throw new PairingError('SELF_INVITE_FORBIDDEN', KNOWN_ERROR_MESSAGES.SELF_INVITE_FORBIDDEN);
    }
    if (target.state === 'active' || target.user_b_id !== null) {
      throw new PairingError('COUPLE_FULL', KNOWN_ERROR_MESSAGES.COUPLE_FULL);
    }
    if (new Date(target.invite_expires_at).getTime() <= Date.now()) {
      throw new PairingError('CODE_EXPIRED', KNOWN_ERROR_MESSAGES.CODE_EXPIRED);
    }

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

  // Try cross-device Supabase Realtime room discovery (when partner generated the code on another device!)
  const joinerProfile: UserProfile = db.users[userId] ?? {
    id: userId,
    display_name: 'Partner',
    avatar_path: null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    push_token: null,
    created_at: new Date().toISOString(),
  };

  const realtimeResult = await tryRedeemViaRealtimeRoom({
    cleanedCode: cleaned,
    joinerProfile,
  });

  if (realtimeResult && realtimeResult.couple && realtimeResult.partner) {
    await saveCompletedPairingLocally({
      couple: realtimeResult.couple,
      partner: realtimeResult.partner,
      selfProfile: joinerProfile,
    });
    return realtimeResult;
  }

  throw new PairingError('CODE_NOT_FOUND', KNOWN_ERROR_MESSAGES.CODE_NOT_FOUND);
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
