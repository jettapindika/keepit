import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { fetchPairingSnapshot, upsertUserProfile } from '@/api/pairing';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { ThemeMode } from '@/theme/tokens';
import { CoupleRecord, UserProfile } from '@/types/database';

const SESSION_STORAGE_KEY = 'keepit.session.v1';

interface PersistedSessionSlice {
  user: UserProfile | null;
  email: string | null;
  themePreference: ThemeMode;
}

interface SessionState {
  hydrated: boolean;
  user: UserProfile | null;
  email: string | null;
  couple: CoupleRecord | null;
  partner: UserProfile | null;
  themePreference: ThemeMode;
  pendingInviteCode: string | null;
  hydrate: () => Promise<void>;
  sendEmailOtp: (email: string) => Promise<void>;
  verifyEmailOtpAndProfile: (params: {
    email: string;
    otp: string;
    displayName: string;
  }) => Promise<void>;
  setPairing: (couple: CoupleRecord | null, partner: UserProfile | null) => void;
  refreshPairing: () => Promise<void>;
  setThemePreference: (mode: ThemeMode) => Promise<void>;
  setPendingInviteCode: (code: string | null) => void;
  signOut: () => Promise<void>;
}

async function persistSessionSlice(slice: PersistedSessionSlice): Promise<void> {
  await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(slice));
}

export const useSessionStore = create<SessionState>((set, get) => ({
  hydrated: false,
  user: null,
  email: null,
  couple: null,
  partner: null,
  themePreference: 'system',
  pendingInviteCode: null,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
      const saved: PersistedSessionSlice | null = raw ? JSON.parse(raw) : null;

      if (saved?.themePreference) {
        set({ themePreference: saved.themePreference });
      }

      if (isSupabaseConfigured && supabase) {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user) {
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();

          if (profile) {
            const pairing = await fetchPairingSnapshot(session.user.id);
            set({
              user: profile as UserProfile,
              email: session.user.email ?? saved?.email ?? null,
              couple: pairing.couple,
              partner: pairing.partner,
              hydrated: true,
            });
            return;
          }
        }
        set({ hydrated: true });
        return;
      }

      if (saved?.user) {
        const pairing = await fetchPairingSnapshot(saved.user.id);
        set({
          user: saved.user,
          email: saved.email,
          couple: pairing.couple,
          partner: pairing.partner,
          hydrated: true,
        });
        return;
      }
    } catch {
      // Fall through to clean unauthenticated state on storage corruption
    }

    set({ hydrated: true });
  },

  sendEmailOtp: async (email: string) => {
    const cleanedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) {
      throw new Error('Enter a valid email address.');
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanedEmail,
        options: { shouldCreateUser: true },
      });
      if (error) throw new Error(error.message);
    }
  },

  verifyEmailOtpAndProfile: async ({ email, otp, displayName }) => {
    const cleanedEmail = email.trim().toLowerCase();
    const cleanedOtp = otp.replace(/\D/g, '');
    const cleanedName = displayName.trim();

    if (cleanedName.length < 1 || cleanedName.length > 40) {
      throw new Error('Enter the first name your partner calls you (1–40 characters).');
    }
    if (cleanedOtp.length !== 6) {
      throw new Error('Enter the 6-digit verification code.');
    }

    let userId = `local_${cleanedEmail.replace(/[^a-z0-9]/g, '_')}`;

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.verifyOtp({
        email: cleanedEmail,
        token: cleanedOtp,
        type: 'email',
      });
      if (error || !data.user) {
        throw new Error(error?.message ?? 'Invalid verification code.');
      }
      userId = data.user.id;
    }

    const profile = await upsertUserProfile({
      userId,
      displayName: cleanedName,
    });
    const pairing = await fetchPairingSnapshot(userId);

    await persistSessionSlice({
      user: profile,
      email: cleanedEmail,
      themePreference: get().themePreference,
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
    });
  },

  setPendingInviteCode: (code) => {
    set({ pendingInviteCode: code });
  },

  signOut: async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    const themePreference = get().themePreference;
    await persistSessionSlice({
      user: null,
      email: null,
      themePreference,
    });
    set({
      user: null,
      email: null,
      couple: null,
      partner: null,
    });
  },
}));
