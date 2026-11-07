import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://dozgfwhoqtyzqhkpkzeb.supabase.co';

export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  'sb_publishable_SXE72e9oSwWWB_8MWrAMqw_KTvwuChf';

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 15
);

export function getAuthRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/`;
  }
  try {
    return Linking.createURL('auth-callback', { scheme: 'keepit' });
  } catch {
    return 'keepit://auth-callback';
  }
}

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
      },
    })
  : null;

/**
 * Returns true when a PostgREST / Supabase RPC error indicates the SQL migration
 * tables/functions have not yet been applied to the remote project (PGRST205 / PGRST202 / 42P01),
 * allowing seamless local-persisted operation while connected to the project.
 */
export function isSchemaNotMigratedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err && typeof err.code === 'string' ? err.code : '';
  const msg = 'message' in err && typeof err.message === 'string' ? err.message : '';
  return (
    code === 'PGRST205' ||
    code === 'PGRST202' ||
    code === '42P01' ||
    code === '42883' ||
    msg.includes('Could not find the table') ||
    msg.includes('Could not find the function')
  );
}
