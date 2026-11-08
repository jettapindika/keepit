import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
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
import { Platform, Text, View } from 'react-native';

import { fetchTodayMomentBundle } from '@/api/moments';
import { extractInviteCodeFromText, normalizeInviteCode } from '@/api/pairing';
import { fetchCoupleStatuses } from '@/api/statuses';
import { useRealtimePairing } from '@/hooks/useRealtimePairing';
import { KeepItButton } from '@/components/ui/Primitives';
import { useAppMotion } from '@/hooks/useAppMotion';
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
      return <AppErrorFallback error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

function AppErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { colors, radii } = useKeepItTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 24, justifyContent: 'center', alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: 480, backgroundColor: colors.surface, borderRadius: radii.card, padding: 24, gap: 16 }}>
        <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 24, lineHeight: 30, fontWeight: '600' }}>
          This screen couldn’t open
        </Text>
        <Text style={{ color: colors.inkMuted, fontSize: 15, lineHeight: 22 }}>{error.message}</Text>
        <KeepItButton label="Try again" onPress={onRetry} />
      </View>
    </View>
  );
}
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
  const pendingInviteCode = useSessionStore((s) => s.pendingInviteCode);
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
    partnerName: partner?.display_name ?? 'You',
    coupleId: couple?.id,
    momentBundle: globalBundleQuery.data,
    statusBundle: globalStatusQuery.data,
  });

  useEffect(() => {
    if (!hydrated || !navState?.key) return;

    void SplashScreen.hideAsync().catch(() => {});

    const segmentList = segments as readonly string[];
    const inAuthGroup = segmentList[0] === '(auth)';
    const authLeaf = segmentList[1];

    const rawIncomingCode =
      typeof globalParams.code === 'string'
        ? extractInviteCodeFromText(globalParams.code) || normalizeInviteCode(globalParams.code)
        : '';
    const incomingCode = rawIncomingCode.length === 6 ? rawIncomingCode : null;

    if (!user && incomingCode && incomingCode !== pendingInviteCode) {
      setPendingInviteCode(incomingCode);
    }

    if (!user) {
      const inAuthCallback = segmentList[0] === 'auth-callback';
      if (inAuthCallback) {
        return;
      }
      if (!inAuthGroup || authLeaf !== 'welcome') {
        router.replace('/(auth)/welcome');
      }
      return;
    }

    // Users do NOT need to pair with a partner to use KeepIt!
    // Only open /(auth)/pair automatically if they explicitly tapped an incoming invite code link,
    // or if they manually navigated to /(auth)/pair to link a partner.
    const inviteToResume = incomingCode ?? pendingInviteCode;
    if (inviteToResume && (!inAuthGroup || authLeaf !== 'pair')) {
      router.replace({ pathname: '/(auth)/pair', params: { code: inviteToResume } });
      return;
    }

    if ((inAuthGroup && authLeaf === 'welcome') || segmentList[0] === 'auth-callback') {
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
    pendingInviteCode,
    setPendingInviteCode,
  ]);

  return null;
}

export default function RootLayout() {
  const hydrate = useSessionStore((s) => s.hydrate);
  const consumeAuthRedirectUrl = useSessionStore((s) => s.consumeAuthRedirectUrl);
  const setPendingInviteCode = useSessionStore((s) => s.setPendingInviteCode);
  const hydrated = useSessionStore((s) => s.hydrated);
  const { colors, isDark } = useKeepItTheme();
  const { reduced } = useAppMotion();

  useEffect(() => {
    const handleIncomingUrl = async (url: string | null) => {
      if (!url) return;
      if (
        url.includes('access_token=') ||
        url.includes('refresh_token=') ||
        url.includes('token_hash=') ||
        url.includes('token=') ||
        url.includes('auth-callback') ||
        url.includes('/auth/v1/verify') ||
        url.includes('type=signup') ||
        url.includes('type=recovery') ||
        url.includes('type=magiclink') ||
        url.includes('type=email')
      ) {
        const consumed = await consumeAuthRedirectUrl(url);
        if (
          consumed &&
          Platform.OS === 'web' &&
          typeof window !== 'undefined' &&
          window.history?.replaceState
        ) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        return;
      }

      if (url.includes('pair') || /[?&]code=/i.test(url)) {
        const inviteCode = extractInviteCodeFromText(url);
        if (inviteCode.length === 6) {
          setPendingInviteCode(inviteCode);
        }
      }
    };

    void (async () => {
      await hydrate();
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.href) {
        await handleIncomingUrl(window.location.href);
      } else {
        const initialUrl = await Linking.getInitialURL().catch(() => null);
        await handleIncomingUrl(initialUrl);
      }
    })();

    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleIncomingUrl(url);
    });
    return () => subscription.remove();
  }, [hydrate, consumeAuthRedirectUrl, setPendingInviteCode]);
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
              animation: reduced ? 'none' : 'default',
            }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="auth-callback" />
            <Stack.Screen
              name="camera"
              options={{
                presentation: 'fullScreenModal',
                animation: reduced ? 'none' : 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="status-sheet"
              options={{
                presentation: 'modal',
                animation: reduced ? 'none' : 'slide_from_bottom',
              }}
            />
          </Stack>
        </ThemeProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
