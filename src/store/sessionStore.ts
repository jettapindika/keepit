import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { fetchPairingSnapshot, upsertUserProfile } from '@/api/pairing';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { AnimationSpeed } from '@/theme/motion';
import { ThemeMode } from '@/theme/tokens';
import { CoupleRecord, UserProfile } from '@/types/database';

const SESSION_STORAGE_KEY = 'keepit.session.v1';
const LOCAL_ACCOUNTS_KEY = 'keepit.local_accounts.v1';

interface LocalAccountEntry {
  userId: string;
  email: string;
  password: string;
  displayName: string;
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

async function readLocalAccounts(): Promise<Record<string, LocalAccountEntry>> {
  const raw = await AsyncStorage.getItem(LOCAL_ACCOUNTS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, LocalAccountEntry>;
  } catch {
    return {};
  }
}

async function writeLocalAccounts(accounts: Record<string, LocalAccountEntry>): Promise<void> {
  await AsyncStorage.setItem(LOCAL_ACCOUNTS_KEY, JSON.stringify(accounts));
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

        if (session?.user) {
          const { data: profile, error: profileErr } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();

          const effectiveProfile: UserProfile | null =
            !profileErr && profile ? (profile as UserProfile) : (saved?.user ?? null);

          if (effectiveProfile) {
            const pairing = await fetchPairingSnapshot(effectiveProfile.id);
            set({
              user: effectiveProfile,
              email: session.user.email ?? saved?.email ?? null,
              couple: pairing.couple,
              partner: pairing.partner,
              hydrated: true,
            });
            return;
          }
        }
      }

      if (saved?.user) {
        const pairing = await fetchPairingSnapshot(saved.user.id);
        set({
          user: saved.user,
          email: saved.email ?? null,
          couple: pairing.couple,
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

    let userId = `local_${cleanedEmail.replace(/[^a-z0-9]/g, '_')}`;

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.signUp({
        email: cleanedEmail,
        password,
        options: {
          data: { display_name: cleanedName },
        },
      });

      if (error) {
        if (/already registered|already exists/i.test(error.message)) {
          throw new Error('An account with this email already exists. Sign in instead.');
        }
        if (!/rate limit|security purposes|sending|confirmation/i.test(error.message)) {
          throw new Error(error.message);
        }
      }

      if (data?.user?.id) {
        userId = data.user.id;
      }
    }

    const accounts = await readLocalAccounts();
    accounts[cleanedEmail] = {
      userId,
      email: cleanedEmail,
      password,
      displayName: cleanedName,
    };
    await writeLocalAccounts(accounts);

    const profile = await upsertUserProfile({
      userId,
      displayName: cleanedName,
    });
    const pairing = await fetchPairingSnapshot(userId);

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
      couple: pairing.couple,
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

    const accounts = await readLocalAccounts();
    const localAccount = accounts[cleanedEmail];
    let userId = localAccount?.userId ?? `local_${cleanedEmail.replace(/[^a-z0-9]/g, '_')}`;
    let displayName = localAccount?.displayName ?? cleanedEmail.split('@')[0] ?? 'Partner';

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanedEmail,
        password,
      });

      if (!error && data.user) {
        userId = data.user.id;
        const metaName =
          typeof data.user.user_metadata?.display_name === 'string'
            ? data.user.user_metadata.display_name
            : null;
        if (metaName) displayName = metaName;
      } else if (localAccount) {
        if (localAccount.password !== password) {
          throw new Error('Incorrect email or password.');
        }
        userId = localAccount.userId;
        displayName = localAccount.displayName;
      } else if (error && !/Email not confirmed/i.test(error.message)) {
        throw new Error('Incorrect email or password.');
      }
    } else if (localAccount && localAccount.password !== password) {
      throw new Error('Incorrect email or password.');
    }

    const profile = await upsertUserProfile({
      userId,
      displayName,
    });
    const pairing = await fetchPairingSnapshot(userId);

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
      couple: pairing.couple,
      partner: pairing.partner,
    });
  },

  setPairing: (couple, partner) => {
    set({ couple, partner });
  },

  refreshPairing: async () => {
    const currentUser = get().user;
    if (!currentUser) return;
    const pairing = await fetchPairingSnapshot(currentUser.id);
    set({ couple: pairing.couple, partner: pairing.partner });
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
      await supabase.auth.signOut().catch(() => {});
    }
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
    });
  },

  wipeLocalAccount: async () => {
    const themePreference = get().themePreference;
    const motionEnabled = get().motionEnabled;
    const motionSpeed = get().motionSpeed;
    const keysToWipe = [
      SESSION_STORAGE_KEY,
      LOCAL_ACCOUNTS_KEY,
      'keepit.local_db.v1',
      'keepit.local_moments.v1',
      'keepit.local_statuses.v1',
      'keepit.local_locations.v1',
      'keepit.local_events.v1',
      'keepit.widget_snapshot.v1',
    ];
    await Promise.all(keysToWipe.map((k) => AsyncStorage.removeItem(k)));
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
