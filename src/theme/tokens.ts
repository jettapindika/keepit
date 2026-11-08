import { Platform, useColorScheme } from 'react-native';

import { useSessionStore } from '@/store/sessionStore';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface KeepItPalette {
  primary: string;
  secondary: string;
  tertiary: string;
  neutral: string;
  canvas: string;
  sheetSurface: string;
  surface: string;
  surfaceElevated: string;
  surfacePressed: string;
  border: string;
  chromeGlass: string;
  chromeOutline: string;
  chromeHighlight: string;
  ink: string;
  inkMuted: string;
  placeholder: string;
  controlBorder: string;
  focusRing: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  badgeBg: string;
  badgeFg: string;
  success: string;
  warning: string;
  danger: string;
  dangerSoft: string;
}

// Threads Light System: primary default palette from design.md
export const LIGHT_PALETTE: KeepItPalette = {
  primary: '#1876F2',
  secondary: '#000000',
  tertiary: '#F5F5F5',
  neutral: '#FFFFFF',
  canvas: '#FFFFFF',
  sheetSurface: '#FFFFFF',
  surface: '#F5F5F5',
  surfaceElevated: '#FFFFFF',
  surfacePressed: '#EBEBEB',
  border: '#00000026',
  chromeGlass: '#FFFFFF',
  chromeOutline: '#00000026',
  chromeHighlight: '#F5F5F5',
  ink: '#000000',
  inkMuted: '#5C5C5C',
  placeholder: '#8E8E8E',
  controlBorder: '#00000026',
  focusRing: '#1876F2',
  accent: '#000000',
  accentSoft: '#F5F5F5',
  onAccent: '#FFFFFF',
  badgeBg: '#000000',
  badgeFg: '#FFFFFF',
  success: '#1876F2',
  warning: '#000000',
  danger: '#D92D20',
  dangerSoft: '#FEF3F2',
};

// Threads Dark Counterpart: preserves the same system-ui hierarchy, radii, and #1876F2 blue focus/active accent
export const DARK_PALETTE: KeepItPalette = {
  primary: '#1876F2',
  secondary: '#FFFFFF',
  tertiary: '#181818',
  neutral: '#101010',
  canvas: '#0A0A0A',
  sheetSurface: '#121212',
  surface: '#181818',
  surfaceElevated: '#121212',
  surfacePressed: '#242424',
  border: '#FFFFFF26',
  chromeGlass: '#121212',
  chromeOutline: '#FFFFFF26',
  chromeHighlight: '#1E1E1E',
  ink: '#FFFFFF',
  inkMuted: '#A3A3A3',
  placeholder: '#8E8E8E',
  controlBorder: '#FFFFFF26',
  focusRing: '#1876F2',
  accent: '#FFFFFF',
  accentSoft: '#222222',
  onAccent: '#000000',
  badgeBg: '#FFFFFF',
  badgeFg: '#0A0A0A',
  success: '#4796FF',
  warning: '#E5E5E5',
  danger: '#F04438',
  dangerSoft: '#2C1514',
};

export const RADII = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 20,
  xl: 24,
  full: 9999,
  group: 24,
  photo: 20,
  card: 24,
  button: 20,
  input: 20,
  navItem: 8,
  pill: 9999,
} as const;

export const SPACING = {
  xs: 6,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 24,
  xxl: 32,
  xxxl: 56,
} as const;

export const THREADS_SPACING = {
  xs: 6,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 56,
} as const;

export const APP_LAYOUT = {
  pageInset: 16,
  cardPadding: 24,
  cardPaddingTop: 32,
  cardPaddingBottom: 28,
  maxContentWidth: 620,
  modalWidth: 520,
  tabBarClearance: 120,
  minimumTarget: 44,
} as const;

const SYSTEM_UI_STACK =
  Platform.OS === 'web'
    ? 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    : undefined;

export const THREADS_TYPOGRAPHY = {
  headlineDisplay: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 32,
    fontWeight: '600' as const,
    lineHeight: 35,
    letterSpacing: 0,
  },
  headlineLg: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 24,
    fontWeight: '600' as const,
    lineHeight: 28,
    letterSpacing: 0,
  },
  headlineMd: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 22,
    fontWeight: '600' as const,
    lineHeight: 26,
    letterSpacing: 0,
  },
  headlineSm: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 20,
    fontWeight: '600' as const,
    lineHeight: 24,
    letterSpacing: 0,
  },
  titleMd: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 22,
    letterSpacing: 0,
  },
  bodyLg: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 23,
    letterSpacing: 0,
  },
  bodyMd: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 22,
    letterSpacing: 0,
  },
  bodySm: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 15,
    fontWeight: '400' as const,
    lineHeight: 21,
    letterSpacing: 0,
  },
  labelLg: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 20,
    letterSpacing: 0,
  },
  labelMd: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 15,
    fontWeight: '600' as const,
    lineHeight: 18,
    letterSpacing: 0,
  },
  labelSm: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 14,
    fontWeight: '600' as const,
    lineHeight: 17,
    letterSpacing: 0,
  },
  micro: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 15,
    letterSpacing: 0,
  },
} as const;

export const MOCHY_TYPE = {
  titleTracking: 0,
  bodyTracking: 0,
  fontSans: SYSTEM_UI_STACK,
  fontMono: SYSTEM_UI_STACK,
} as const;

export const MAX_WALLET_LAYOUT = {
  viewportInset: 16,
  sheetHeight: 420,
  sheetBottom: 24,
  sheetRadius: 24,
  contentInset: 24,
  contentWidth: 342,
  buttonRadius: 20,
  primaryButtonHeight: 56,
  secondaryButtonHeight: 52,
  artWidth: 302,
  artHeight: 256,
  artTopGap: 24,
} as const;

export const MAX_WALLET_TYPE = {
  sansFamily: SYSTEM_UI_STACK,
  monoFamily: SYSTEM_UI_STACK,
  titleSize: 32,
  titleLineHeight: 35,
  bodySize: 16,
  bodyLineHeight: 23,
  primarySize: 15,
  secondarySize: 15,
  legalSize: 12,
  legalLineHeight: 16,
} as const;

export const MAX_WALLET_MOTION = {
  slide: 260,
  heroFade: 200,
  heroFloat: 1_800,
  pagination: 180,
  pressIn: 100,
  pressOut: 120,
} as const;

export function useKeepItTheme() {
  const systemScheme = useColorScheme();
  const themePreference = useSessionStore((s) => s.themePreference);

  const resolvedScheme: 'light' | 'dark' =
    themePreference === 'system'
      ? systemScheme === 'dark'
        ? 'dark'
        : 'light'
      : themePreference;

  return {
    scheme: resolvedScheme,
    isDark: resolvedScheme === 'dark',
    colors: resolvedScheme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE,
    radii: RADII,
    spacing: SPACING,
    type: MOCHY_TYPE,
    typography: THREADS_TYPOGRAPHY,
  };
}
