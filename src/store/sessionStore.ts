import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { fetchPairingSnapshot, upsertUserProfile } from '@/api/pairing';
import { getAuthRedirectUrl, isSupabaseConfigured, supabase } from '@/api/supabase';
import { AnimationSpeed } from '@/theme/motion';
import { ThemeMode } from '@/theme/tokens';
import { CoupleRecord, UserProfile } from '@/types/database';

const SESSION_STORAGE_KEY = 'keepit.session.v1';
const LEGACY_LOCAL_ACCOUNTS_KEY = 'keepit.local_accounts.v1';

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
  return out;
}

interface PersistedSessionSlice {
  user: UserProfile | null;
  email: string | null;
  themePreference: ThemeMode;
  motionEnabled: boolean;
  motionSpeed: AnimationSpeed;
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
  setPendingInviteCode: (code: string | null) => void;
  signOut: () => Promise<void>;
  wipeLocalAccount: () => Promise<void>;
}

async function persistSessionSlice(slice: PersistedSessionSlice): Promise<void> {
  await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(slice));
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
  await Promise.all(cacheKeys.map((k) => AsyncStorage.removeItem(k).catch(() => {})));
}

async function resetLocalDbForFreshUser(userId: string): Promise<void> {
  try {
    const rawDb = await AsyncStorage.getItem('keepit.local_db.v1');
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
      await AsyncStorage.setItem('keepit.local_db.v1', JSON.stringify(parsed));
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
  pendingInviteCode: null,

  hydrate: async () => {
    try {
      await AsyncStorage.removeItem(LEGACY_LOCAL_ACCOUNTS_KEY).catch(() => {});
      const raw = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
      const saved: Partial<PersistedSessionSlice> | null = raw ? JSON.parse(raw) : null;

      if (saved?.themePreference) {
        set({ themePreference: saved.themePreference });
      }
      if (typeof saved?.motionEnabled === 'boolean') {
        set({ motionEnabled: saved.motionEnabled });
      }
      if (saved?.motionSpeed) {
        set({ motionSpeed: saved.motionSpeed });
      }

      if (isSupabaseConfigured && supabase) {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user && isEmailConfirmedUser(session.user)) {
          const { data: profile, error: profileErr } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();

          const fallbackDisplayName =
            (typeof session.user.user_metadata?.display_name === 'string' &&
            session.user.user_metadata.display_name.trim()
              ? session.user.user_metadata.display_name.trim()
              : null) ??
            saved?.user?.display_name ??
            session.user.email?.split('@')[0] ??
            'KeepIt User';

          const effectiveProfile: UserProfile =
            !profileErr && profile
              ? (profile as UserProfile)
              : saved?.user?.id === session.user.id
                ? saved.user
                : await upsertUserProfile({
                    userId: session.user.id,
                    displayName: fallbackDisplayName,
                  });

          const pairing = await fetchPairingSnapshot(effectiveProfile.id);
          const soloFallbackCouple: CoupleRecord =
            pairing.couple ??
            buildSoloFallbackCouple(effectiveProfile.id, effectiveProfile.created_at);
          const effectiveEmail = session.user.email ?? saved?.email ?? null;

          await persistSessionSlice({
            user: effectiveProfile,
            email: effectiveEmail,
            themePreference: get().themePreference,
            motionEnabled: get().motionEnabled,
            motionSpeed: get().motionSpeed,
          });

          set({
            user: effectiveProfile,
            email: effectiveEmail,
            couple: soloFallbackCouple,
            partner: pairing.partner,
            hydrated: true,
          });
          return;
        }

        if (session?.user && !isEmailConfirmedUser(session.user)) {
          await supabase.auth.signOut().catch(() => {});
        }

        if (saved?.user) {
          await persistSessionSlice({
            user: null,
            email: null,
            themePreference: get().themePreference,
            motionEnabled: get().motionEnabled,
            motionSpeed: get().motionSpeed,
          });
        }

        set({
          user: null,
          email: null,
          couple: null,
          partner: null,
          hydrated: true,
        });
        return;
      }

      if (saved?.user) {
        const pairing = await fetchPairingSnapshot(saved.user.id);
        const soloFallbackCouple: CoupleRecord =
          pairing.couple ?? buildSoloFallbackCouple(saved.user.id, saved.user.created_at);
        set({
          user: saved.user,
          email: saved.email ?? null,
          couple: soloFallbackCouple,
          partner: pairing.partner,
          hydrated: true,
        });
        return;
      }
    } catch {
      // Clean fallback on corrupted storage
    }

    set({ hydrated: true });
  },

  consumeAuthRedirectUrl: async (url: string) => {
    if (!isSupabaseConfigured || !supabase || !url) return false;
    const params = extractAuthRedirectParams(url);
    const accessToken = params.access_token;
    const refreshToken = params.refresh_token;
    const tokenHash = params.token_hash;
    const otpType = params.type;
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
        type: otpType as 'signup' | 'email' | 'recovery' | 'invite' | 'magiclink',
      });
      if (error || !data?.session?.user) return false;
      sessionUser = data.session.user;
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

    const profile = await upsertUserProfile({
      userId: sessionUser.id,
      displayName,
    });
    const pairing = await fetchPairingSnapshot(sessionUser.id);
    const soloFallbackCouple: CoupleRecord =
      pairing.couple ?? buildSoloFallbackCouple(sessionUser.id, profile.created_at);

    await persistSessionSlice({
      user: profile,
      email: cleanedEmail,
      themePreference: get().themePreference,
      motionEnabled: get().motionEnabled,
      motionSpeed: get().motionSpeed,
    });

    set({
      user: profile,
      email: cleanedEmail,
      couple: soloFallbackCouple,
      partner: pairing.partner,
      hydrated: true,
    });
    return true;
  },

  signUpWithPassword: async ({ displayName, email, password, confirmPassword }) => {
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
        if (/already registered|already exists/i.test(error.message)) {
          // Never guess credentials on signup: an existing account must go through
          // the sign-in flow so we do not act as a password oracle / account hijack path.
          throw new Error('An account with this email already exists. Sign in instead.');
        }
        // Email-confirmation pending, SMTP rate limits, and similar provider errors must
        // surface to the user instead of minting an unauthenticated local account.
        throw new Error(error.message || 'Could not create account.');
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

    await persistSessionSlice({
      user: profile,
      email: cleanedEmail,
      themePreference: get().themePreference,
      motionEnabled: get().motionEnabled,
      motionSpeed: get().motionSpeed,
    });

    set({
      user: profile,
      email: cleanedEmail,
      couple: soloFallbackCouple,
      partner: pairing.partner,
    });
  },

  signInWithPassword: async ({ email, password }) => {
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
      await AsyncStorage.removeItem(LEGACY_LOCAL_ACCOUNTS_KEY).catch(() => {});
    }

    const profile = await upsertUserProfile({
      userId,
      displayName,
    });
    const pairing = await fetchPairingSnapshot(userId);
    const soloFallbackCouple: CoupleRecord =
      pairing.couple ?? buildSoloFallbackCouple(userId, profile.created_at);

    await persistSessionSlice({
      user: profile,
      email: cleanedEmail,
      themePreference: get().themePreference,
      motionEnabled: get().motionEnabled,
      motionSpeed: get().motionSpeed,
    });

    set({
      user: profile,
      email: cleanedEmail,
      couple: soloFallbackCouple,
      partner: pairing.partner,
    });
  },

  setPairing: (couple, partner) => {
    set({ couple, partner });
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
    await persistSessionSlice({
      user: updated,
      email: get().email,
      themePreference: get().themePreference,
      motionEnabled: get().motionEnabled,
      motionSpeed: get().motionSpeed,
    });
    set({ user: updated });
    return updated;
  },

  refreshPairing: async () => {
    const currentUser = get().user;
    if (!currentUser) return;
    const pairing = await fetchPairingSnapshot(currentUser.id);
    const effectiveCouple: CoupleRecord =
      pairing.couple ?? buildSoloFallbackCouple(currentUser.id, currentUser.created_at);
    set({ couple: effectiveCouple, partner: pairing.partner });
  },

  setThemePreference: async (mode: ThemeMode) => {
    set({ themePreference: mode });
    await persistSessionSlice({
      user: get().user,
      email: get().email,
      themePreference: mode,
      motionEnabled: get().motionEnabled,
      motionSpeed: get().motionSpeed,
    });
  },

  setMotionEnabled: async (enabled: boolean) => {
    set({ motionEnabled: enabled });
    await persistSessionSlice({
      user: get().user,
      email: get().email,
      themePreference: get().themePreference,
      motionEnabled: enabled,
      motionSpeed: get().motionSpeed,
    });
  },

  setMotionSpeed: async (speed: AnimationSpeed) => {
    set({ motionSpeed: speed });
    await persistSessionSlice({
      user: get().user,
      email: get().email,
      themePreference: get().themePreference,
      motionEnabled: get().motionEnabled,
      motionSpeed: speed,
    });
  },

  setPendingInviteCode: (code) => {
    set({ pendingInviteCode: code });
  },

  signOut: async () => {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw new Error('Could not sign out. Check your connection and try again.');
    }
    await clearAccountSpecificCacheKeys();
    await persistSessionSlice({
      user: null,
      email: null,
      themePreference: get().themePreference,
      motionEnabled: get().motionEnabled,
      motionSpeed: get().motionSpeed,
    });
    set({
      user: null,
      email: null,
      couple: null,
      partner: null,
      pendingInviteCode: null,
    });
  },

  wipeLocalAccount: async () => {
    const themePreference = get().themePreference;
    const motionEnabled = get().motionEnabled;
    const motionSpeed = get().motionSpeed;
    await clearAccountSpecificCacheKeys();
    await Promise.all([
      AsyncStorage.removeItem(SESSION_STORAGE_KEY).catch(() => {}),
      AsyncStorage.removeItem('keepit.local_db.v1').catch(() => {}),
    ]);
    await persistSessionSlice({
      user: null,
      email: null,
      themePreference,
      motionEnabled,
      motionSpeed,
    });
    set({
      user: null,
      email: null,
      couple: null,
      partner: null,
    });
  },
}));
