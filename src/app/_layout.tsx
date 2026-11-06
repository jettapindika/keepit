import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  useGlobalSearchParams,
  useRootNavigationState,
  useRouter,
  useSegments,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';

import { useRealtimePairing } from '@/hooks/useRealtimePairing';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
    },
  },
});

function NavigationGuard() {
  const router = useRouter();
  const segments = useSegments();
  const navState = useRootNavigationState();
  const globalParams = useGlobalSearchParams<{ code?: string }>();

  const hydrated = useSessionStore((s) => s.hydrated);
  const user = useSessionStore((s) => s.user);
  const couple = useSessionStore((s) => s.couple);
  const setPendingInviteCode = useSessionStore((s) => s.setPendingInviteCode);
  useRealtimePairing();

  useEffect(() => {
    if (!hydrated || !navState?.key) return;

    void SplashScreen.hideAsync();

    const inAuthGroup = segments[0] === '(auth)';
    const authLeaf = segments[1];
    const isPaired = Boolean(user && couple?.state === 'active');

    const incomingCode =
      typeof globalParams.code === 'string' && globalParams.code.trim().length > 0
        ? globalParams.code.trim()
        : null;

    if (incomingCode) {
      setPendingInviteCode(incomingCode);
    }

    if (!user) {
      if (!inAuthGroup || authLeaf !== 'welcome') {
        router.replace('/(auth)/welcome');
      }
      return;
    }

    if (!isPaired) {
      if (!inAuthGroup || authLeaf !== 'pair') {
        router.replace(
          incomingCode ? { pathname: '/(auth)/pair', params: { code: incomingCode } } : '/(auth)/pair'
        );
      }
      return;
    }

    if (inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [
    hydrated,
    navState?.key,
    user,
    couple?.state,
    segments,
    router,
    globalParams.code,
    setPendingInviteCode,
  ]);

  return null;
}

export default function RootLayout() {
  const hydrate = useSessionStore((s) => s.hydrate);
  const hydrated = useSessionStore((s) => s.hydrated);
  const { colors, isDark } = useKeepItTheme();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const navTheme = isDark
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: colors.canvas,
          card: colors.surface,
          text: colors.ink,
          border: colors.border,
          primary: colors.accent,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: colors.canvas,
          card: colors.surface,
          text: colors.ink,
          border: colors.border,
          primary: colors.accent,
        },
      };

  if (!hydrated) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={navTheme}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <NavigationGuard />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.canvas },
          }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="camera"
            options={{
              presentation: 'fullScreenModal',
              animation: 'fade_from_bottom',
            }}
          />
          <Stack.Screen
            name="status-sheet"
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
            }}
          />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
