import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { APP_LAYOUT, useKeepItTheme } from '@/theme/tokens';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    access_token?: string;
    refresh_token?: string;
    token_hash?: string;
    token?: string;
    type?: string;
    code?: string;
    error_description?: string;
    error?: string;
  }>();
  const { colors, radii, spacing } = useKeepItTheme();
  const user = useSessionStore((s) => s.user);
  const consumeAuthRedirectUrl = useSessionStore((s) => s.consumeAuthRedirectUrl);
  const [status, setStatus] = useState<'verifying' | 'verified' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const processedRef = useRef(false);
  const effectiveStatus = user ? 'verified' : status;

  useEffect(() => {
    if (user) {
      const timer = setTimeout(() => {
        router.replace('/(tabs)');
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [user, router]);

  useEffect(() => {
    if (processedRef.current || user) return;
    processedRef.current = true;

    let active = true;
    void (async () => {
      try {
        if (params.error_description || params.error) {
          if (!active) return;
          const rawErr = String(params.error_description || params.error).replace(/\+/g, ' ');
          setErrorMessage(rawErr || 'This confirmation link has expired or was already used.');
          setStatus('error');
          return;
        }

        const candidateUrls: string[] = [];
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.href) {
          candidateUrls.push(window.location.href);
        } else {
          const initialUrl = await Linking.getInitialURL().catch(() => null);
          if (initialUrl) candidateUrls.push(initialUrl);
        }

        const search = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
          if (typeof v === 'string' && v.trim()) {
            search.set(k, v.trim());
          }
        }
        const queryString = search.toString();
        if (queryString) {
          candidateUrls.push(`keepit://auth-callback?${queryString}`);
        }

        let verified = false;
        for (const candidate of candidateUrls) {
          const ok = await consumeAuthRedirectUrl(candidate);
          if (ok) {
            verified = true;
            break;
          }
        }

        if (!active) return;

        if (verified || useSessionStore.getState().user) {
          setStatus('verified');
          router.replace('/(tabs)');
          return;
        }

        // Even when Supabase redirected without inline session tokens (e.g., server-side
        // GET /auth/v1/verify already marked email_confirmed_at and redirected to keepit://auth-callback),
        // the user's email is now confirmed and they can sign in directly on the Welcome screen.
        setStatus('verified');
        setTimeout(() => {
          if (active && !useSessionStore.getState().user) {
            router.replace({
              pathname: '/(auth)/welcome',
              params: { confirmed: '1' },
            });
          }
        }, 900);
      } catch (err) {
        if (!active) return;
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Could not verify your email link. Try signing in with your email and password.'
        );
        setStatus('error');
      }
    })();

    return () => {
      active = false;
    };
  }, [params, user, consumeAuthRedirectUrl, router]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.group,
            padding: spacing.xl,
          },
        ]}>
        {effectiveStatus === 'verifying' ? (
          <>
            <ActivityIndicator size="large" color={colors.ink} />
            <Text style={[styles.title, { color: colors.ink }]}>Confirming your account…</Text>
            <Text style={[styles.body, { color: colors.inkMuted }]}>
              Verifying your KeepIt email link and signing you in.
            </Text>
          </>
        ) : effectiveStatus === 'verified' ? (
          <>
            <Text style={[styles.title, { color: colors.ink }]}>Email confirmed</Text>
            <Text style={[styles.body, { color: colors.inkMuted }]}>
              {user
                ? 'Taking you to your KeepIt feed…'
                : 'Your email is verified. Opening Sign In…'}
            </Text>
            <KeepItButton
              label={user ? 'Continue to KeepIt' : 'Continue to Sign In'}
              onPress={() => {
                if (useSessionStore.getState().user) {
                  router.replace('/(tabs)');
                } else {
                  router.replace({ pathname: '/(auth)/welcome', params: { confirmed: '1' } });
                }
              }}
            />
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: colors.ink }]}>Verification link notice</Text>
            <InlineNotice
              tone="error"
              message={
                errorMessage ??
                'This confirmation link could not be completed automatically. If you already confirmed your email, sign in below.'
              }
            />
            <KeepItButton
              label="Go to Sign In"
              onPress={() =>
                router.replace({ pathname: '/(auth)/welcome', params: { confirmed: '1' } })
              }
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: APP_LAYOUT.pageInset,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    alignItems: 'center',
    gap: 16,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});
