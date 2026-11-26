import { createClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

import {
  safeGetStorageItem,
  safeRemoveStorageItem,
  safeSetStorageItem,
} from '@/utils/safeAsyncStorage';
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
        storage: {
          getItem: (key: string) => safeGetStorageItem(key),
          setItem: (key: string, value: string) => safeSetStorageItem(key, value),
          removeItem: (key: string) => safeRemoveStorageItem(key),
        },
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
      },
    })
  : null;

const NETWORK_ERROR_MESSAGE = 'Could not reach KeepIt servers. Check your connection and try again.';

/**
 * True when a Supabase failure means "the request never got an answer" (offline,
 * DNS, TLS, aborted radio, gateway 5xx) rather than "the server answered no".
 * Auth transport failures surface as `AuthRetryableFetchError` (status 0 for
 * fetch/TLS/abort failures, 5xx for gateway errors); PostgREST/Realtime failures
 * surface as fetch TypeErrors or PGRST 5xx codes.
 */
export function isNetworkOrTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = 'name' in err && typeof err.name === 'string' ? err.name : '';
  const status = 'status' in err && typeof err.status === 'number' ? err.status : undefined;
  const code = 'code' in err && typeof err.code === 'string' ? err.code : '';
  const message = 'message' in err && typeof err.message === 'string' ? err.message : '';
  const cause = 'cause' in err ? err.cause : undefined;

  if (name === 'AuthRetryableFetchError' || name === 'AbortError') return true;
  if (typeof status === 'number' && status >= 500 && status <= 599) return true;
  if (/^PGRST[0-9]*5[0-9][0-9]$/.test(code)) return true;
  if (
    /fetch failed|network request failed|networkerror|failed to fetch|unable to resolve host|connection (?:reset|refused|closed)|timed out|timeout|socket hang up|no address associated|offline/i.test(
      message
    )
  ) {
    return true;
  }
  if (
    cause &&
    typeof cause === 'object' &&
    'code' in cause &&
    typeof cause.code === 'string' &&
    /^(EAI_AGAIN|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ENETUNREACH|UND_ERR_)/.test(cause.code)
  ) {
    return true;
  }
  return false;
}

/**
 * A reachability failure must reach the user as "check your connection", never as
 * a wrong-credentials or generic failure that sends them retyping a password.
 */
export function describeSupabaseError(err: unknown, fallback: string): string {
  if (isNetworkOrTransientError(err)) return NETWORK_ERROR_MESSAGE;
  const message = err instanceof Error ? err.message : '';
  return message || fallback;
}

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
