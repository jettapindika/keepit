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
  surfaceObject: string;
  surfacePressed: string;
  border: string;
  borderGlass: string;
  gridLine: string;
  topHighlight: string;
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
  blue300: string;
  blue400: string;
  blue500: string;
  blue700: string;
  blue900: string;
  blueGlow: string;
  success: string;
  warning: string;
  danger: string;
  dangerSoft: string;
}

// Dark Bento / Electric Blue Light Counterpart (WCAG AA verified)
export const LIGHT_PALETTE: KeepItPalette = {
  primary: '#2F55FF',
  secondary: '#0A0A0D',
  tertiary: '#EEF1F8',
  neutral: '#FFFFFF',
  canvas: '#F4F5F7',
  sheetSurface: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceElevated: '#EEF1F8',
  surfaceObject: '#E5E9F5',
  surfacePressed: '#E2E7F5',
  border: 'rgba(10,16,40,0.09)',
  borderGlass: 'rgba(10,16,40,0.22)',
  gridLine: 'rgba(10,16,40,0.05)',
  topHighlight: 'rgba(255,255,255,0.9)',
  chromeGlass: '#FFFFFF',
  chromeOutline: 'rgba(10,16,40,0.14)',
  chromeHighlight: '#EEF1F8',
  ink: '#0A0A0D',
  inkMuted: '#52525B',
  placeholder: '#6B7280',
  controlBorder: 'rgba(10,16,40,0.16)',
  focusRing: '#2F55FF',
  accent: '#2F55FF',
  accentSoft: 'rgba(47,85,255,0.10)',
  onAccent: '#FFFFFF',
  badgeBg: '#0A0A0D',
  badgeFg: '#FFFFFF',
  blue300: '#2F55FF',
  blue400: '#2F55FF',
  blue500: '#2F55FF',
  blue700: '#122A9E',
  blue900: '#0A1650',
  blueGlow: 'rgba(47,85,255,0.25)',
  success: '#2F55FF',
  warning: '#122A9E',
  danger: '#D92D20',
  dangerSoft: '#FEF3F2',
};

// Dark Bento / Electric Blue Default Palette (black-first, blue-only chroma, WCAG AA verified)
export const DARK_PALETTE: KeepItPalette = {
  primary: '#2F55FF',
  secondary: '#FFFFFF',
  tertiary: '#141414',
  neutral: '#0D0D0D',
  canvas: '#000000',
  sheetSurface: '#0D0D0D',
  surface: '#0D0D0D',
  surfaceElevated: '#141414',
  surfaceObject: '#1C1C1E',
  surfacePressed: '#1F1F24',
  border: 'rgba(255,255,255,0.08)',
  borderGlass: 'rgba(255,255,255,0.22)',
  gridLine: 'rgba(255,255,255,0.05)',
  topHighlight: 'rgba(255,255,255,0.12)',
  chromeGlass: '#0D0D0D',
  chromeOutline: 'rgba(255,255,255,0.10)',
  chromeHighlight: '#1C1C1E',
  ink: '#FFFFFF',
  inkMuted: '#999999',
  placeholder: '#8A8A8E',
  controlBorder: 'rgba(255,255,255,0.14)',
  focusRing: '#4B73FF',
  accent: '#2F55FF',
  accentSoft: 'rgba(47,85,255,0.16)',
  onAccent: '#FFFFFF',
  badgeBg: '#1C1C1E',
  badgeFg: '#FFFFFF',
  blue300: '#8FA8FF',
  blue400: '#4B73FF',
  blue500: '#2F55FF',
  blue700: '#122A9E',
  blue900: '#0A1650',
  blueGlow: 'rgba(47,85,255,0.45)',
  success: '#4B73FF',
  warning: '#8FA8FF',
  danger: '#FF6B6B',
  dangerSoft: '#1C1011',
};

export const RADII = {
  none: 0,
  sm: 6,
  tile: 6,
  md: 10,
  navItem: 12,
  buttonSm: 12,
  input: 14,
  button: 14,
  group: 12,
  card: 16,
  photo: 18,
  lg: 18,
  xl: 24,
  pill: 999,
  full: 9999,
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
    ? '"Inter Tight", "Inter", "Geist", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    : undefined;

export const THREADS_TYPOGRAPHY = {
  headlineDisplay: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 34,
    fontWeight: '600' as const,
    lineHeight: 36,
    letterSpacing: -0.8,
  },
  headlineLg: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 26,
    fontWeight: '600' as const,
    lineHeight: 28,
    letterSpacing: -0.6,
  },
  headlineMd: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 22,
    fontWeight: '600' as const,
    lineHeight: 24,
    letterSpacing: -0.6,
  },
  headlineSm: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 20,
    fontWeight: '600' as const,
    lineHeight: 22,
    letterSpacing: -0.4,
  },
  titleMd: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 22,
    letterSpacing: -0.4,
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
    letterSpacing: -0.2,
  },
  labelMd: {
    fontFamily: SYSTEM_UI_STACK,
    fontSize: 15,
    fontWeight: '600' as const,
    lineHeight: 18,
    letterSpacing: -0.15,
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
    lineHeight: 16,
    letterSpacing: 0,
  },
} as const;

export const MOCHY_TYPE = {
  titleTracking: -0.6,
  bodyTracking: 0,
  fontSans: SYSTEM_UI_STACK,
  fontMono: SYSTEM_UI_STACK,
} as const;

export const MAX_WALLET_LAYOUT = {
  viewportInset: 16,
  sheetHeight: 420,
  sheetBottom: 24,
  sheetRadius: 16,
  contentInset: 24,
  contentWidth: 342,
  buttonRadius: 14,
  primaryButtonHeight: 56,
  secondaryButtonHeight: 52,
  artWidth: 302,
  artHeight: 256,
  artTopGap: 24,
} as const;

export const MAX_WALLET_TYPE = {
  sansFamily: SYSTEM_UI_STACK,
  monoFamily: SYSTEM_UI_STACK,
  titleSize: 34,
  titleLineHeight: 37,
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
