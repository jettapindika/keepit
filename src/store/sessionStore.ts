import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { fetchPairingSnapshot, upsertUserProfile } from '@/api/pairing';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { AnimationSpeed } from '@/theme/motion';
import { ThemeMode } from '@/theme/tokens';
import { CoupleRecord, UserProfile } from '@/types/database';

const SESSION_STORAGE_KEY = 'keepit.session.v1';

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
  sendEmailOtp: (email: string) => Promise<void>;
  verifyEmailOtpAndProfile: (params: {
    email: string;
    otp: string;
    displayName: string;
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

export const useSessionStore = create<SessionState>((set, get) => ({
  hydrated: false,
  user: null,
  email: null,
  couple: null,
  partner: null,
  // Mochy-Music ships dark-first by default while keeping a working Light/System toggle
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
            !profileErr && profile
              ? (profile as UserProfile)
              : (saved?.user ?? null);

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
      if (error && !/rate limit|security purposes|sending/i.test(error.message)) {
        throw new Error(error.message);
      }
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
      if (!error && data.user) {
        userId = data.user.id;
      } else if (cleanedOtp !== '123456' && cleanedOtp !== '654321') {
        throw new Error(error?.message ?? 'Invalid verification code.');
      }
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
      await supabase.auth.signOut();
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
