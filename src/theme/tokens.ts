import { Platform, useColorScheme } from 'react-native';

import { useSessionStore } from '@/store/sessionStore';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface KeepItPalette {
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

// Warm monochrome chrome keeps the app consistent with the approved onboarding.
export const DARK_PALETTE: KeepItPalette = {
  canvas: '#0A0708',
  sheetSurface: '#1F1D1E',
  surface: '#1F1D1E',
  surfaceElevated: '#2A2729',
  surfacePressed: '#353133',
  border: '#494247',
  chromeGlass: '#1F1D1E',
  chromeOutline: '#494247',
  chromeHighlight: '#353133',
  ink: '#FFFFFF',
  inkMuted: '#C0B9BD',
  placeholder: '#AAA2A6',
  controlBorder: '#91858C',
  focusRing: '#FFFFFF',
  accent: '#FFFFFF',
  accentSoft: '#353133',
  onAccent: '#0A0708',
  badgeBg: '#FFFFFF',
  badgeFg: '#1F1D1E',
  success: '#92D6AB',
  warning: '#DDD4D8',
  danger: '#FFACA8',
  dangerSoft: '#3C2325',
};

// The light counterpart shares the same warm neutral family and geometry.
export const LIGHT_PALETTE: KeepItPalette = {
  canvas: '#F8F6F7',
  sheetSurface: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceElevated: '#F0ECEE',
  surfacePressed: '#E8E3E6',
  border: '#D5CED2',
  chromeGlass: '#FFFFFF',
  chromeOutline: '#D5CED2',
  chromeHighlight: '#F0ECEE',
  ink: '#161214',
  inkMuted: '#62595F',
  placeholder: '#71656C',
  controlBorder: '#8A7D85',
  focusRing: '#161214',
  accent: '#161214',
  accentSoft: '#E8E3E6',
  onAccent: '#FFFFFF',
  badgeBg: '#161214',
  badgeFg: '#FFFFFF',
  success: '#236C44',
  warning: '#6E5B66',
  danger: '#AD2E35',
  dangerSoft: '#FBEDEF',
};

export const RADII = {
  group: 22,
  photo: 18,
  card: 22,
  input: 10,
  pill: 999,
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const APP_LAYOUT = {
  pageInset: 20,
  cardPadding: 20,
  maxContentWidth: 640,
  modalWidth: 520,
  tabBarClearance: 132,
  minimumTarget: 44,
} as const;

export const MOCHY_TYPE = {
  titleTracking: -0.3,
  bodyTracking: 0,
  fontSans: Platform.OS === 'web'
    ? '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Inter, Arial, sans-serif'
    : undefined,
  fontMono: Platform.OS === 'ios' ? 'SFMono-Regular' : 'monospace',
} as const;

export const MAX_WALLET_LAYOUT = {
  viewportInset: 20,
  sheetHeight: 434,
  sheetBottom: 26,
  sheetRadius: 22,
  contentInset: 20,
  contentWidth: 310,
  buttonRadius: 10,
  primaryButtonHeight: 58,
  secondaryButtonHeight: 44,
  artWidth: 302,
  artHeight: 278,
  artTopGap: 31,
} as const;

export const MAX_WALLET_TYPE = {
  sansFamily:
    Platform.OS === 'web'
      ? '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Inter, "Helvetica Neue", Arial, sans-serif'
      : undefined,
  monoFamily: Platform.OS === 'ios' ? 'SFMono-Regular' : 'monospace',
  titleSize: 28,
  titleLineHeight: 34,
  bodySize: 13,
  bodyLineHeight: 20,
  primarySize: 16,
  secondarySize: 15,
  legalSize: 12,
  legalLineHeight: 18,
} as const;

export const MAX_WALLET_MOTION = {
  slide: 320,
  heroFade: 220,
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
      ? systemScheme === 'light'
        ? 'light'
        : 'dark'
      : themePreference;

  return {
    scheme: resolvedScheme,
    isDark: resolvedScheme === 'dark',
    colors: resolvedScheme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE,
    radii: RADII,
    spacing: SPACING,
    type: MOCHY_TYPE,
  };
}
