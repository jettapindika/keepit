import { create } from 'zustand';

import { buildDefaultUsername } from '@/api/social';
import { fetchPairingSnapshot, upsertUserProfile } from '@/api/pairing';
import { syncDirectoryPresence } from '@/api/realtimeSync';
import {
  describeSupabaseError,
  getAuthRedirectUrl,
  isNetworkOrTransientError,
  isSupabaseConfigured,
  supabase,
} from '@/api/supabase';
import { AnimationSpeed } from '@/theme/motion';
import { ThemeMode } from '@/theme/tokens';
import { CoupleRecord, PairingSnapshot, UserProfile, WidgetLayoutMode } from '@/types/database';
import { stopMusicPreview } from '@/utils/audioPreview';
import {
  safeClearAllStorage,
  safeGetStorageItem,
  safeRemoveStorageItem,
  safeSetStorageItem,
  spillDataUriToFileIfLarge,
} from '@/utils/safeAsyncStorage';

const SESSION_STORAGE_KEY = 'keepit.session.v1';
const LEGACY_LOCAL_ACCOUNTS_KEY = 'keepit.local_accounts.v1';
export const STORAGE_SCHEMA_EPOCH_KEY = 'keepit.storage_epoch.v1';
export const CURRENT_STORAGE_SCHEMA_EPOCH = '0.4.4-reset-1';
function buildSoloFallbackCouple(userId: string, createdAt?: string): CoupleRecord {
  return {
    id: `solo_${userId}`,
    user_a_id: userId,
    user_b_id: null,
    invite_code: '',
    invite_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    state: 'active',
    paired_at: null,
    created_at: createdAt ?? new Date().toISOString(),
  };
}
function buildDeterministicEmailUserId(cleanedEmail: string): string {
  return `local_${cleanedEmail.replace(/[^a-z0-9]/g, '_')}`;
}

interface SupabaseAuthUserLike {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

export function isEmailConfirmedUser(user: SupabaseAuthUserLike | null | undefined): boolean {
  if (!user) return false;
  const confirmedAt = user.email_confirmed_at ?? user.confirmed_at;
  return typeof confirmedAt === 'string' && confirmedAt.trim().length > 0;
}

interface UserMetadataProfileHints {
  displayName?: string;
  username?: string;
  friendCode?: string;
  bio?: string;
  pronouns?: string;
  moodSong?: string;
  bannerColor?: string;
  bannerPath?: string | null;
  avatarPath?: string | null;
  website?: string;
  isPrivate?: boolean;
  dumpMode?: boolean;
}

function extractUserMetadataProfileHints(
  metadata: Record<string, unknown> | null | undefined
): UserMetadataProfileHints {
  if (!metadata || typeof metadata !== 'object') return {};
  return {
    displayName:
      typeof metadata.display_name === 'string' && metadata.display_name.trim().length > 0
        ? metadata.display_name.trim()
        : undefined,
    username:
      typeof metadata.username === 'string' && metadata.username.trim().length >= 2
        ? metadata.username.trim()
        : undefined,
    friendCode:
      typeof metadata.friend_code === 'string' && metadata.friend_code.trim().length > 0
        ? metadata.friend_code.trim()
        : undefined,
    bio: typeof metadata.bio === 'string' ? metadata.bio : undefined,
    pronouns: typeof metadata.pronouns === 'string' ? metadata.pronouns : undefined,
    moodSong: typeof metadata.mood_song === 'string' ? metadata.mood_song : undefined,
    bannerColor: typeof metadata.banner_color === 'string' ? metadata.banner_color : undefined,
    bannerPath:
      metadata.banner_path === null
        ? null
        : typeof metadata.banner_path === 'string'
          ? metadata.banner_path
          : undefined,
    avatarPath:
      metadata.avatar_path === null
        ? null
        : typeof metadata.avatar_path === 'string'
          ? metadata.avatar_path
          : undefined,
    website: typeof metadata.website === 'string' ? metadata.website : undefined,
    isPrivate: typeof metadata.is_private === 'boolean' ? metadata.is_private : undefined,
    dumpMode: typeof metadata.dump_mode === 'boolean' ? metadata.dump_mode : undefined,
  };
}

function mergeRemoteProfileWithMetadataHints(
  remote: UserProfile,
  metaHints: UserMetadataProfileHints,
  fallbackDisplayName: string
): UserProfile {
  return {
    ...remote,
    display_name: metaHints.displayName ?? (remote.display_name || fallbackDisplayName),
    username: metaHints.username ?? remote.username,
    friend_code: metaHints.friendCode ?? remote.friend_code,
    bio: metaHints.bio !== undefined ? metaHints.bio : (remote.bio ?? ''),
    pronouns: metaHints.pronouns !== undefined ? metaHints.pronouns : (remote.pronouns ?? ''),
    mood_song: metaHints.moodSong !== undefined ? metaHints.moodSong : (remote.mood_song ?? ''),
    banner_color:
      metaHints.bannerColor !== undefined
        ? metaHints.bannerColor
        : (remote.banner_color || '#1C1C1E'),
    banner_path:
      remote.banner_path !== undefined && remote.banner_path !== null
        ? (metaHints.bannerPath === null ? null : remote.banner_path)
        : (metaHints.bannerPath ?? null),
    avatar_path:
      remote.avatar_path !== undefined && remote.avatar_path !== null
        ? (metaHints.avatarPath === null ? null : remote.avatar_path)
        : (metaHints.avatarPath ?? null),
    website: metaHints.website !== undefined ? metaHints.website : (remote.website ?? ''),
    is_private:
      metaHints.isPrivate !== undefined
        ? metaHints.isPrivate
        : (remote.is_private ?? false),
    dump_mode:
      metaHints.dumpMode !== undefined
        ? metaHints.dumpMode
        : (remote.dump_mode ?? false),
  };
}
export function isEmailRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err && typeof err.code === 'string' ? err.code : '';
  const status = 'status' in err && typeof err.status === 'number' ? err.status : 0;
  const msg = 'message' in err && typeof err.message === 'string' ? err.message : '';
  return (
    code === 'over_email_send_rate_limit' ||
    /email rate limit|over_email_send_rate_limit|for security purposes, you can only request this after|error sending confirmation email/i.test(
      msg
    ) ||
    (status === 429 && /email|confirmation|security purposes|rate limit/i.test(msg))
  );
}

export function formatEmailRateLimitMessage(err: unknown): string {
  const msg =
    err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
      ? err.message
      : '';
  const waitSecondsMatch = msg.match(/after\s+(\d+)\s+seconds/i);
  if (waitSecondsMatch?.[1]) {
    return `Confirmation email was just sent. Wait ${waitSecondsMatch[1]} seconds before requesting another email, or check your inbox and spam folder.`;
  }
  return 'Email confirmation rate limit reached (Supabase default is 2 emails/hour). If you already received a link, check your inbox or spam folder; otherwise wait before retrying or configure Custom SMTP / disable Confirm Email in Supabase Auth settings.';
}
export function extractAuthRedirectParams(rawUrl: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!rawUrl || typeof rawUrl !== 'string') return out;

  const collectParams = (segment: string) => {
    if (!segment) return;
    const sp = new URLSearchParams(segment.replace(/^[?#]/, ''));
    sp.forEach((value, key) => {
      if (value) out[key] = value;
    });
  };

  const hashIdx = rawUrl.indexOf('#');
  const queryIdx = rawUrl.indexOf('?');
  if (queryIdx !== -1) {
    const queryEnd = hashIdx !== -1 && hashIdx > queryIdx ? hashIdx : rawUrl.length;
    collectParams(rawUrl.slice(queryIdx + 1, queryEnd));
  }
  if (hashIdx !== -1) {
    collectParams(rawUrl.slice(hashIdx + 1));
  }
  if (!out.token_hash && out.token) {
    out.token_hash = out.token;
  }
  return out;
}

interface PersistedSessionSlice {
  user: UserProfile | null;
  email: string | null;
  themePreference: ThemeMode;
  motionEnabled: boolean;
  motionSpeed: AnimationSpeed;
  widgetLayout: WidgetLayoutMode;
  mirrorFrontCamera: boolean;
  /** Last known couple space, so first paint renders the real space offline. */
  couple?: CoupleRecord | null;
  partner?: UserProfile | null;
}

interface SessionState {
  hydrated: boolean;
  user: UserProfile | null;
  email: string | null;
  couple: CoupleRecord | null;
  partner: UserProfile | null;
  themePreference: ThemeMode;
  motionEnabled: boolean;
  motionSpeed: AnimationSpeed;
  widgetLayout: WidgetLayoutMode;
  mirrorFrontCamera: boolean;
  pendingInviteCode: string | null;
  hydrate: () => Promise<void>;
  consumeAuthRedirectUrl: (url: string) => Promise<boolean>;
  signUpWithPassword: (params: {
    displayName: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) => Promise<void>;
  signInWithPassword: (params: {
    email: string;
    password: string;
  }) => Promise<void>;
  resendConfirmationEmail: (email: string) => Promise<string>;
  setPairing: (couple: CoupleRecord | null, partner: UserProfile | null) => void;
  updateProfile: (params: {
    displayName: string;
    username?: string;
    bio?: string;
    pronouns?: string;
    moodSong?: string;
    bannerColor?: string;
    bannerPath?: string | null;
    website?: string;
    avatarPath?: string | null;
    isPrivate?: boolean;
    dumpMode?: boolean;
  }) => Promise<UserProfile>;
  refreshPairing: () => Promise<void>;
  setThemePreference: (mode: ThemeMode) => Promise<void>;
  setMotionEnabled: (enabled: boolean) => Promise<void>;
  setMotionSpeed: (speed: AnimationSpeed) => Promise<void>;
  setWidgetLayout: (layout: WidgetLayoutMode) => Promise<void>;
  setMirrorFrontCamera: (mirror: boolean) => Promise<void>;
  setPendingInviteCode: (code: string | null) => void;
  signOut: () => Promise<void>;
  wipeLocalAccount: () => Promise<void>;
}

type PersistedStateSource = Pick<
  SessionState,
  | 'user'
  | 'email'
  | 'themePreference'
  | 'motionEnabled'
  | 'motionSpeed'
  | 'widgetLayout'
  | 'mirrorFrontCamera'
  | 'couple'
  | 'partner'
>;

/**
 * Builds the persisted slice from live store state. Preferences are never
 * enumerated per call site: a missing field silently erased the others, which is
 * how a theme change used to wipe the widget layout and camera mirror setting.
 */
function collectPersistedSlice(state: PersistedStateSource): PersistedSessionSlice {
  return {
    user: state.user,
    email: state.email,
    themePreference: state.themePreference,
    motionEnabled: state.motionEnabled,
    motionSpeed: state.motionSpeed,
    widgetLayout: state.widgetLayout,
    mirrorFrontCamera: state.mirrorFrontCamera,
    couple: state.couple,
    partner: state.partner,
  };
}

/**
 * Remote pairing wins when it exists, but an unreachable or partial answer must not
 * blank a cached space: a transient failure would otherwise unpair the screen.
 */
async function mergeRemotePairingWithCache(
  userId: string,
  cached: Partial<PersistedSessionSlice> | null
): Promise<PairingSnapshot> {
  const cachedCouple =
    cached?.couple && (cached.couple.user_a_id === userId || cached.couple.user_b_id === userId)
      ? cached.couple
      : null;
  const cachedPartner =
    cached?.partner && cachedPartnerBelongsTo(cachedCouple, cached.partner, userId)
      ? cached.partner
      : null;
  try {
    const remote = await fetchPairingSnapshot(userId);
    return {
      couple: remote.couple ?? cachedCouple,
      partner: remote.partner ?? (remote.couple ? null : cachedPartner),
    };
  } catch {
    return { couple: cachedCouple, partner: cachedPartner };
  }
}

function cachedPartnerBelongsTo(
  couple: CoupleRecord | null,
  partner: UserProfile,
  userId: string
): boolean {
  if (couple) {
    return couple.user_a_id === partner.id || couple.user_b_id === partner.id;
  }
  return partner.id !== userId;
}

let pendingSessionWrite: Promise<void> = Promise.resolve();
let sessionGeneration = 0;

/**
 * Serializes the session slice to AsyncStorage. Writes are chained because the
 * avatar/banner spill step is async: two concurrent writes could otherwise land
 * out of order and commit an older snapshot over a newer one.
 */
function persistSessionSlice(slice: PersistedSessionSlice): Promise<void> {
  const write = pendingSessionWrite.then(async () => {
    let effectiveUser = slice.user;
    let effectivePartner = slice.partner;
    if (effectiveUser) {
      const nextAvatar =
        effectiveUser.avatar_path?.startsWith('data:') &&
        effectiveUser.avatar_path.length > 90_000
          ? await spillDataUriToFileIfLarge(
              effectiveUser.avatar_path,
              `session-avatar-${effectiveUser.id}`
            )
          : effectiveUser.avatar_path;
      const nextBanner =
        effectiveUser.banner_path?.startsWith('data:') &&
        effectiveUser.banner_path.length > 90_000
          ? await spillDataUriToFileIfLarge(
              effectiveUser.banner_path,
              `session-banner-${effectiveUser.id}`
            )
          : effectiveUser.banner_path;
      if (nextAvatar !== effectiveUser.avatar_path || nextBanner !== effectiveUser.banner_path) {
        effectiveUser = {
          ...effectiveUser,
          avatar_path: nextAvatar,
          banner_path: nextBanner,
        };
      }
    }
    if (effectivePartner?.avatar_path?.startsWith('data:') && effectivePartner.avatar_path.length > 90_000) {
      effectivePartner = {
        ...effectivePartner,
        avatar_path: await spillDataUriToFileIfLarge(
          effectivePartner.avatar_path,
          `session-partner-avatar-${effectivePartner.id}`
        ),
      };
    }
    await safeSetStorageItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        ...slice,
        user: effectiveUser,
        partner: effectivePartner ?? null,
      })
    );
  });
  pendingSessionWrite = write.catch(() => {});
  return write;
}

async function clearAccountSpecificCacheKeys(): Promise<void> {
  const cacheKeys = [
    LEGACY_LOCAL_ACCOUNTS_KEY,
    'keepit.local_moments.v1',
    'keepit.local_statuses.v1',
    'keepit.local_locations.v1',
    'keepit.local_events.v1',
    'keepit.local_messages.v1',
    'keepit.local_friends.v1',
    'keepit.local_friends_seeded.v1',
    'keepit.widget_snapshot.v1',
    'keepit.widget_pinned.v1',
  ];
  await Promise.all(cacheKeys.map((k) => safeRemoveStorageItem(k)));
}

async function resetLocalDbForFreshUser(userId: string): Promise<void> {
  try {
    const rawDb = await safeGetStorageItem('keepit.local_db.v1');
    if (!rawDb) return;
    const parsed = JSON.parse(rawDb) as {
      users?: Record<string, UserProfile>;
      couples?: Record<string, CoupleRecord>;
    };
    let mutated = false;
    if (parsed.users && parsed.users[userId]) {
      delete parsed.users[userId];
      mutated = true;
    }
    if (parsed.couples) {
      for (const [cId, rec] of Object.entries(parsed.couples)) {
        if (rec.user_a_id === userId || rec.user_b_id === userId) {
          delete parsed.couples[cId];
          mutated = true;
        }
      }
    }
    if (mutated) {
      await safeSetStorageItem('keepit.local_db.v1', JSON.stringify(parsed));
    }
  } catch {
    // Ignore malformed local db
  }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  hydrated: false,
  user: null,
  email: null,
  couple: null,
  partner: null,
  themePreference: 'dark',
  motionEnabled: true,
  motionSpeed: 1,
  widgetLayout: 'side_by_side',
  mirrorFrontCamera: false,
  pendingInviteCode: null,

  hydrate: async () => {
    const hydrateGen = sessionGeneration;
    let saved: Partial<PersistedSessionSlice> | null = null;
    try {
      await safeRemoveStorageItem(LEGACY_LOCAL_ACCOUNTS_KEY);
      const storedEpoch = await safeGetStorageItem(STORAGE_SCHEMA_EPOCH_KEY);
      if (storedEpoch !== CURRENT_STORAGE_SCHEMA_EPOCH) {
        await safeClearAllStorage();
        await clearAccountSpecificCacheKeys();
        await Promise.all([
          safeRemoveStorageItem(SESSION_STORAGE_KEY),
          safeRemoveStorageItem('keepit.local_db.v1'),
        ]);
        if (isSupabaseConfigured && supabase) {
          await supabase.auth.signOut().catch(() => {});
        }
        await safeSetStorageItem(STORAGE_SCHEMA_EPOCH_KEY, CURRENT_STORAGE_SCHEMA_EPOCH);
      }
      const raw = await safeGetStorageItem(SESSION_STORAGE_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      // Clean fallback on corrupted storage
    }

    // First paint comes from the local cache only: no request may hold the splash screen.
    const cachedUser = saved?.user ?? null;
    set({
      themePreference: saved?.themePreference ?? get().themePreference,
      motionEnabled:
        typeof saved?.motionEnabled === 'boolean' ? saved.motionEnabled : get().motionEnabled,
      motionSpeed: saved?.motionSpeed ?? get().motionSpeed,
      widgetLayout:
        saved?.widgetLayout === 'partner_only' || saved?.widgetLayout === 'side_by_side'
          ? saved.widgetLayout
          : get().widgetLayout,
      mirrorFrontCamera:
        typeof saved?.mirrorFrontCamera === 'boolean'
          ? saved.mirrorFrontCamera
          : get().mirrorFrontCamera,
      user: cachedUser,
      email: saved?.email ?? null,
      couple: cachedUser
        ? (saved?.couple ?? buildSoloFallbackCouple(cachedUser.id, cachedUser.created_at))
        : null,
      partner: cachedUser ? (saved?.partner ?? null) : null,
      hydrated: true,
    });

    type CachedSessionRead =
      | { ok: true; user: SupabaseAuthUserLike | null }
      | { ok: false };

    const readCachedSession = async (): Promise<CachedSessionRead> => {
      if (!isSupabaseConfigured || !supabase) return { ok: true, user: cachedUser };
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        return { ok: true, user: session?.user ?? null };
      } catch {
        // Unreadable here is not proof of sign-out: keep the cached identity.
        return { ok: false };
      }
    };

    // Attempt a restore only when the session cache itself is still readable, so a
    // transient refresh failure cannot sign a user out of their own account.
    if (!isSupabaseConfigured || !supabase) {
      if (cachedUser) {
        void fetchPairingSnapshot(cachedUser.id)
          .then((pairing) => {
            if (get().user?.id !== cachedUser.id) return;
            set({
              couple:
                pairing.couple ?? buildSoloFallbackCouple(cachedUser.id, cachedUser.created_at),
              partner: pairing.partner,
            });
          })
          .catch(() => {});
      }
      return;
    }

    const sessionRead = await readCachedSession();
    if (!sessionRead.ok || hydrateGen !== sessionGeneration) return;
    const sessionUser = sessionRead.user;
    if (sessionUser) {
      if (!isEmailConfirmedUser(sessionUser)) {
        await supabase.auth.signOut().catch(() => {});
        if (hydrateGen === sessionGeneration && cachedUser?.id === sessionUser.id) {
          await persistSessionSlice({
            ...collectPersistedSlice(get()),
            user: null,
            email: null,
            couple: null,
            partner: null,
          });
          set({ user: null, email: null, couple: null, partner: null });
        }
        return;
      }

      // Authenticated but offline/cached: this user is not signed out. Refresh in the
      // background and patch state when the network answers.
      void (async () => {
        const fallbackDisplayName =
          (typeof sessionUser.user_metadata?.display_name === 'string' &&
          sessionUser.user_metadata.display_name.trim()
            ? sessionUser.user_metadata.display_name.trim()
            : null) ??
          cachedUser?.display_name ??
          sessionUser.email?.split('@')[0] ??
          'KeepIt User';
        const metaHints = extractUserMetadataProfileHints(sessionUser.user_metadata);
        let effectiveProfile: UserProfile;
        try {
          const { data: profile, error: profileErr } = await supabase
            .from('users')
            .select('*')
            .eq('id', sessionUser.id)
            .maybeSingle();
          if (!profileErr && profile) {
            effectiveProfile = mergeRemoteProfileWithMetadataHints(
              profile as UserProfile,
              metaHints,
              fallbackDisplayName
            );
          } else if (cachedUser?.id === sessionUser.id) {
            effectiveProfile = mergeRemoteProfileWithMetadataHints(
              cachedUser,
              metaHints,
              fallbackDisplayName
            );
          } else {
            effectiveProfile = await upsertUserProfile({
              userId: sessionUser.id,
              displayName: fallbackDisplayName,
              ...metaHints,
            });
          }
        } catch {
          return;
        }
        if (hydrateGen !== sessionGeneration) return;
        const liveUserIdAfterProfile = get().user?.id;
        if (liveUserIdAfterProfile && liveUserIdAfterProfile !== sessionUser.id) return;

        const pairing = await mergeRemotePairingWithCache(sessionUser.id, saved);
        if (hydrateGen !== sessionGeneration) return;
        const liveUserIdAfterPairing = get().user?.id;
        if (liveUserIdAfterPairing && liveUserIdAfterPairing !== sessionUser.id) return;

        const effectiveCouple: CoupleRecord =
          pairing.couple ?? buildSoloFallbackCouple(effectiveProfile.id, effectiveProfile.created_at);
        const effectiveEmail = sessionUser.email ?? saved?.email ?? null;
        set({
          user: effectiveProfile,
          email: effectiveEmail,
          couple: effectiveCouple,
          partner: pairing.partner,
        });
        void persistSessionSlice({
          ...collectPersistedSlice(get()),
          user: effectiveProfile,
          email: effectiveEmail,
          couple: effectiveCouple,
          partner: pairing.partner,
        }).catch(() => {});
      })();
      return;
    }

    // No readable Supabase session (signed out or the session cache is gone).
    if (cachedUser) {
      await persistSessionSlice({
        ...collectPersistedSlice(get()),
        user: null,
        email: null,
        couple: null,
        partner: null,
      });
      set({ user: null, email: null, couple: null, partner: null });
    }
  },

  consumeAuthRedirectUrl: async (url: string) => {
    if (!isSupabaseConfigured || !supabase || !url) return false;
    sessionGeneration += 1;
    const params = extractAuthRedirectParams(url);
    const accessToken = params.access_token;
    const refreshToken = params.refresh_token;
    const tokenHash = params.token_hash || params.token;
    const otpType = (params.type || 'signup') as
      | 'signup'
      | 'email'
      | 'recovery'
      | 'invite'
      | 'magiclink';
    const authCode = params.code;

    let sessionUser: SupabaseAuthUserLike | null = null;

    if (accessToken && refreshToken) {
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error || !data?.session?.user) return false;
      sessionUser = data.session.user;
    } else if (tokenHash && otpType) {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType,
      });
      if (!error && data?.session?.user) {
        sessionUser = data.session.user;
      } else if (
        url.startsWith('http') &&
        url.includes('/auth/v1/verify') &&
        typeof globalThis.fetch === 'function'
      ) {
        // Fallback if a custom-template link passed an legacy verification URL directly
        try {
          const verifyRes = await globalThis.fetch(url, { redirect: 'manual' });
          const redirectLoc = verifyRes.headers?.get?.('location') ?? verifyRes.url ?? '';
          const locParams = extractAuthRedirectParams(redirectLoc);
          if (locParams.access_token && locParams.refresh_token) {
            const { data: sessData, error: sessErr } = await supabase.auth.setSession({
              access_token: locParams.access_token,
              refresh_token: locParams.refresh_token,
            });
            if (!sessErr && sessData?.session?.user) {
              sessionUser = sessData.session.user;
            }
          } else if (locParams.code && locParams.code.length > 12) {
            const { data: codeData, error: codeErr } =
              await supabase.auth.exchangeCodeForSession(locParams.code);
            if (!codeErr && codeData?.session?.user) {
              sessionUser = codeData.session.user;
            }
          }
        } catch {
          // Ignore network fallback failure
        }
      }
      if (!sessionUser) return false;
    } else if (authCode && authCode.length > 12) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);
      if (error || !data?.session?.user) return false;
      sessionUser = data.session.user;
    } else {
      return false;
    }

    if (!sessionUser || !isEmailConfirmedUser(sessionUser)) {
      await supabase.auth.signOut().catch(() => {});
      return false;
    }

    const cleanedEmail = (sessionUser.email ?? '').trim().toLowerCase() || null;
    const displayName =
      (typeof sessionUser.user_metadata?.display_name === 'string' &&
      sessionUser.user_metadata.display_name.trim()
        ? sessionUser.user_metadata.display_name.trim()
        : null) ??
      (cleanedEmail ? cleanedEmail.split('@')[0] : null) ??
      'KeepIt User';

    const prevUserId = get().user?.id;
    if (prevUserId && prevUserId !== sessionUser.id) {
      await clearAccountSpecificCacheKeys();
    }

    const metaHints = extractUserMetadataProfileHints(sessionUser.user_metadata);
    // The session is already established here; a failing profile or pairing read must
    // not make a confirmed email link look broken.
    const profile: UserProfile = await upsertUserProfile({
      userId: sessionUser.id,
      displayName,
      ...metaHints,
    }).catch(
      (): UserProfile => ({
        id: sessionUser!.id,
        display_name: displayName,
        username: metaHints.username ?? buildDefaultUsername(displayName, sessionUser!.id),
        friend_code: metaHints.friendCode ?? '',
        bio: metaHints.bio ?? '',
        pronouns: metaHints.pronouns ?? '',
        mood_song: metaHints.moodSong ?? '',
        banner_color: metaHints.bannerColor ?? '#1C1C1E',
        banner_path: metaHints.bannerPath ?? null,
        website: metaHints.website ?? '',
        is_private: metaHints.isPrivate ?? false,
        dump_mode: metaHints.dumpMode ?? false,
        avatar_path: metaHints.avatarPath ?? null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
        push_token: null,
        created_at: new Date().toISOString(),
      })
    );
    let pairing: PairingSnapshot;
    try {
      pairing = await fetchPairingSnapshot(sessionUser.id);
    } catch {
      pairing = { couple: get().couple, partner: get().partner };
    }
    const soloFallbackCouple: CoupleRecord =
      pairing.couple ?? buildSoloFallbackCouple(sessionUser.id, profile.created_at);

    set({
      user: profile,
      email: cleanedEmail,
      couple: soloFallbackCouple,
      partner: pairing.partner,
      hydrated: true,
    });
    await persistSessionSlice(collectPersistedSlice(get()));
    return true;
  },

  signUpWithPassword: async ({ displayName, email, password, confirmPassword }) => {
    sessionGeneration += 1;
    const cleanedName = displayName.trim();
    const cleanedEmail = email.trim().toLowerCase();

    if (cleanedName.length < 1 || cleanedName.length > 40) {
      throw new Error('Enter your first name (1 to 40 characters).');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) {
      throw new Error('Enter a valid email address.');
    }
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match.');
    }

    let userId = '';

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.signUp({
        email: cleanedEmail,
        password,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
          data: { display_name: cleanedName },
        },
      });

      if (error) {
        if (isNetworkOrTransientError(error)) {
          throw new Error(describeSupabaseError(error, 'Could not create account.'));
        }
        if (/already registered|already exists/i.test(error.message)) {
          // Never guess credentials on signup: an existing account must go through
          // the sign-in flow so we do not act as a password oracle / account hijack path.
          throw new Error('An account with this email already exists. Sign in instead.');
        }
        if (isEmailRateLimitError(error)) {
          throw new Error(formatEmailRateLimitMessage(error));
        }
        // Email-confirmation pending, SMTP rate limits, and similar provider errors must
        // surface to the user instead of minting an unauthenticated local account.
        throw new Error(describeSupabaseError(error, 'Could not create account.'));
      }

      if (!data?.user?.id) {
        throw new Error('Could not create account. Please try again.');
      }

      // Supabase returns empty identities[] when an email is already registered and
      // Confirm Email is enabled (anti-enumeration behavior).
      if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('An account with this email already exists. Sign in instead.');
      }

      if (!data.session || !isEmailConfirmedUser(data.user)) {
        if (data.session) {
          await supabase.auth.signOut().catch(() => {});
        }
        throw new Error('Check your inbox to confirm your email, then sign in.');
      }

      userId = data.user.id;
    } else {
      // Offline / unconfigured Supabase: keep the deterministic local account so the
      // app remains usable, but never mix it with a real Supabase identity.
      userId = buildDeterministicEmailUserId(cleanedEmail);
    }
    await clearAccountSpecificCacheKeys();
    await resetLocalDbForFreshUser(userId);

    const profile = await upsertUserProfile({
      userId,
      displayName: cleanedName,
    });
    const pairing = await fetchPairingSnapshot(userId);
    const soloFallbackCouple: CoupleRecord =
      pairing.couple ?? buildSoloFallbackCouple(userId, profile.created_at);

    set({
      user: profile,
      email: cleanedEmail,
      couple: soloFallbackCouple,
      partner: pairing.partner,
    });
    await persistSessionSlice(collectPersistedSlice(get()));
  },

  signInWithPassword: async ({ email, password }) => {
    sessionGeneration += 1;
    const cleanedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) {
      throw new Error('Enter a valid email address.');
    }
    if (password.length < 6) {
      throw new Error('Enter your password (at least 6 characters).');
    }

    let userId = '';
    let displayName = cleanedEmail.split('@')[0] ?? 'KeepIt User';
    const prevUserId = get().user?.id;

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanedEmail,
        password,
      });

      if (error || !data?.user) {
        // A dropped connection is not a wrong password: saying so makes users retype
        // credentials that were already correct.
        if (isNetworkOrTransientError(error)) {
          throw new Error(describeSupabaseError(error, 'Could not sign in.'));
        }
        if (error && /rate limit|too many requests/i.test(error.message)) {
          throw new Error('Too many sign-in attempts. Please wait a moment and try again.');
        }
        if (error && /Email not confirmed/i.test(error.message)) {
          throw new Error('Confirm your email first. Check your inbox, then sign in.');
        }
        throw new Error('Incorrect email or password.');
      } else {
        if (!isEmailConfirmedUser(data.user)) {
          await supabase.auth.signOut().catch(() => {});
          throw new Error('Confirm your email first. Check your inbox, then sign in.');
        }
        userId = data.user.id;
        const metaName =
          typeof data.user.user_metadata?.display_name === 'string'
            ? data.user.user_metadata.display_name
            : null;
        if (metaName) displayName = metaName;
      }
    } else {
      // Offline / unconfigured Supabase: deterministic local-only account.
      userId = buildDeterministicEmailUserId(cleanedEmail);
    }

    if (prevUserId && prevUserId !== userId) {
      await clearAccountSpecificCacheKeys();
    } else {
      await safeRemoveStorageItem(LEGACY_LOCAL_ACCOUNTS_KEY);
    }

    let metaHints: UserMetadataProfileHints = {};
    let existingRemoteProfile: UserProfile | null = null;
    if (isSupabaseConfigured && supabase) {
      const { data: sessionData } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      metaHints = extractUserMetadataProfileHints(sessionData?.user?.user_metadata);
      try {
        const { data: remoteRow, error: remoteErr } = await supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        if (!remoteErr && remoteRow) {
          existingRemoteProfile = remoteRow as UserProfile;
        }
      } catch {
        // Fall back to upsert with metadata hints
      }
    }

    // Authentication has already succeeded: a failing profile/pairing lookup must not
    // strand the user as signed out, so fall back to whatever is cached locally.
    const profile: UserProfile = existingRemoteProfile
      ? mergeRemoteProfileWithMetadataHints(existingRemoteProfile, metaHints, displayName)
      : await upsertUserProfile({
          userId,
          displayName,
          ...metaHints,
        }).catch((): UserProfile => {
          if (prevUserId === userId && get().user) return get().user!;
          return {
            id: userId,
            display_name: displayName,
            username: metaHints.username ?? buildDefaultUsername(displayName, userId),
            friend_code: metaHints.friendCode ?? '',
            bio: metaHints.bio ?? '',
            pronouns: metaHints.pronouns ?? '',
            mood_song: metaHints.moodSong ?? '',
            banner_color: metaHints.bannerColor ?? '#1C1C1E',
            banner_path: metaHints.bannerPath ?? null,
            website: metaHints.website ?? '',
            is_private: metaHints.isPrivate ?? false,
            dump_mode: metaHints.dumpMode ?? false,
            avatar_path: metaHints.avatarPath ?? null,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
            push_token: null,
            created_at: new Date().toISOString(),
          } as UserProfile;
        });
    const pairing = await mergeRemotePairingWithCache(userId, {
      couple: get().couple,
      partner: get().partner,
    });
    const soloFallbackCouple: CoupleRecord =
      pairing.couple ?? buildSoloFallbackCouple(userId, profile.created_at);

    set({
      user: profile,
      email: cleanedEmail,
      couple: soloFallbackCouple,
      partner: pairing.partner,
    });
    await persistSessionSlice(collectPersistedSlice(get()));
  },

  resendConfirmationEmail: async (rawEmail: string) => {
    const cleanedEmail = rawEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) {
      throw new Error('Enter your email address first to resend the confirmation link.');
    }
    if (!isSupabaseConfigured || !supabase) {
      return 'Confirmation email is not required in local mode. Sign in directly.';
    }
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: cleanedEmail,
      options: {
        emailRedirectTo: getAuthRedirectUrl(),
      },
    });
    if (error) {
      if (isEmailRateLimitError(error)) {
        throw new Error(formatEmailRateLimitMessage(error));
      }
      throw new Error(error.message || 'Could not resend confirmation email. Try again in a moment.');
    }
    return `Confirmation link sent to ${cleanedEmail}. Check your inbox and spam folder.`;
  },

  setPairing: (couple, partner) => {
    const currentUser = get().user;
    const effectiveCouple =
      couple ??
      (currentUser ? buildSoloFallbackCouple(currentUser.id, currentUser.created_at) : null);
    set({ couple: effectiveCouple, partner });
    void persistSessionSlice(collectPersistedSlice(get())).catch(() => {});
  },
  updateProfile: async (params) => {
    const currentUser = get().user;
    if (!currentUser) {
      throw new Error('Sign in first to edit your profile.');
    }
    const cleanedName = params.displayName.trim();
    if (cleanedName.length < 1 || cleanedName.length > 40) {
      throw new Error('Display name must be between 1 and 40 characters.');
    }
    const updated = await upsertUserProfile({
      userId: currentUser.id,
      displayName: cleanedName,
      username: params.username,
      bio: params.bio,
      pronouns: params.pronouns,
      moodSong: params.moodSong,
      bannerColor: params.bannerColor,
      bannerPath: params.bannerPath,
      website: params.website,
      avatarPath: params.avatarPath,
      isPrivate: params.isPrivate,
      dumpMode: params.dumpMode,
      coupleId: get().couple?.id ?? null,
    });
    set({ user: updated });
    await persistSessionSlice(collectPersistedSlice(get()));
    void syncDirectoryPresence({ profile: updated, couple: get().couple });
    return updated;
  },

  refreshPairing: async () => {
    const currentUser = get().user;
    if (!currentUser) return;
    // Offline: the cache wins instead of surfacing a reachability error to every
    // refresh control on every tab.
    const pairing = await mergeRemotePairingWithCache(currentUser.id, {
      couple: get().couple,
      partner: get().partner,
    });
    if (get().user?.id !== currentUser.id) return;
    const effectiveCouple: CoupleRecord =
      pairing.couple ?? buildSoloFallbackCouple(currentUser.id, currentUser.created_at);
    set({ couple: effectiveCouple, partner: pairing.partner });
    void persistSessionSlice(collectPersistedSlice(get())).catch(() => {});
  },

  setThemePreference: async (mode: ThemeMode) => {
    set({ themePreference: mode });
    await persistSessionSlice(collectPersistedSlice(get()));
  },

  setMotionEnabled: async (enabled: boolean) => {
    set({ motionEnabled: enabled });
    await persistSessionSlice(collectPersistedSlice(get()));
  },

  setMotionSpeed: async (speed: AnimationSpeed) => {
    set({ motionSpeed: speed });
    await persistSessionSlice(collectPersistedSlice(get()));
  },

  setWidgetLayout: async (layout: WidgetLayoutMode) => {
    set({ widgetLayout: layout });
    await persistSessionSlice(collectPersistedSlice(get()));
  },

  setMirrorFrontCamera: async (mirror: boolean) => {
    set({ mirrorFrontCamera: mirror });
    await persistSessionSlice(collectPersistedSlice(get()));
  },

  setPendingInviteCode: (code) => {
    set({ pendingInviteCode: code });
  },

  signOut: async () => {
    sessionGeneration += 1;
    stopMusicPreview();
    if (isSupabaseConfigured && supabase) {
      // Local scope: a reachability failure must not trap the user in an account
      // they asked to leave, and other devices are not affected.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error && !isNetworkOrTransientError(error)) {
        throw new Error(describeSupabaseError(error, 'Could not sign out.'));
      }
    }
    await clearAccountSpecificCacheKeys();
    set({
      user: null,
      email: null,
      couple: null,
      partner: null,
      pendingInviteCode: null,
    });
    await persistSessionSlice(collectPersistedSlice(get()));
  },

  wipeLocalAccount: async () => {
    sessionGeneration += 1;
    stopMusicPreview();
    await clearAccountSpecificCacheKeys();
    await Promise.all([
      safeRemoveStorageItem(SESSION_STORAGE_KEY),
      safeRemoveStorageItem('keepit.local_db.v1'),
    ]);
    set({
      user: null,
      email: null,
      couple: null,
      partner: null,
      pendingInviteCode: null,
    });
    await persistSessionSlice(collectPersistedSlice(get()));
  },
}));
