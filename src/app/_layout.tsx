import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
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
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchTodayMomentBundle } from '@/api/moments';
import { fetchCoupleStatuses } from '@/api/statuses';
import { useRealtimePairing } from '@/hooks/useRealtimePairing';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';

// Polyfill ES2024 Promise.withResolvers for older Android/iOS Hermes runtimes
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

try {
  void SplashScreen.preventAutoHideAsync().catch(() => {});
} catch {
  // Ignore if splash screen already hidden
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <View style={errorStyles.container}>
          <Text style={errorStyles.title}>KeepIt recovered from an error</Text>
          <Text style={errorStyles.message}>{this.state.error.message}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue to KeepIt"
            onPress={() => this.setState({ error: null })}
            style={errorStyles.button}>
            <Text style={errorStyles.buttonText}>Continue</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  message: {
    color: '#9A9AA0',
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#E0E0E0',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 8,
  },
  buttonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
});
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

  const partner = useSessionStore((s) => s.partner);
  const globalBundleQuery = useQuery({
    queryKey: ['today-moment', couple?.id, user?.id],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () =>
      fetchTodayMomentBundle({
        coupleId: couple!.id,
        userId: user!.id,
      }),
  });
  const globalStatusQuery = useQuery({
    queryKey: ['couple-statuses', couple?.id, user?.id],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () =>
      fetchCoupleStatuses({
        coupleId: couple!.id,
        userId: user!.id,
      }),
  });
  useWidgetSync({
    partnerName: partner?.display_name ?? 'Partner',
    coupleId: couple?.id,
    momentBundle: globalBundleQuery.data,
    statusBundle: globalStatusQuery.data,
  });

  useEffect(() => {
    if (!hydrated || !navState?.key) return;

    void SplashScreen.hideAsync().catch(() => {});

    const inAuthGroup = segments[0] === '(auth)';
    const authLeaf = segments[1];

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

    // Users do NOT need to pair with a partner to use KeepIt!
    // Only open /(auth)/pair automatically if they explicitly tapped an incoming invite code link,
    // or if they manually navigated to /(auth)/pair to link a partner.
    if (incomingCode && (!inAuthGroup || authLeaf !== 'pair')) {
      router.replace({ pathname: '/(auth)/pair', params: { code: incomingCode } });
      return;
    }

    if (inAuthGroup && authLeaf === 'welcome') {
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
    <AppErrorBoundary>
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
    </AppErrorBoundary>
  );
}
