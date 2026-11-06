import { useColorScheme } from 'react-native';

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

// Mochy-Music Dark Color System (Theme.kt + SearchDesign.kt + FrostedGlass.kt + SettingsGroup.kt)
export const DARK_PALETTE: KeepItPalette = {
  canvas: '#000000',
  sheetSurface: '#0B0B0C',
  surface: '#141416',
  surfaceElevated: '#1E1E21',
  surfacePressed: '#2C2C2C',
  border: '#232326',
  chromeGlass: 'rgba(19, 19, 19, 0.84)',
  chromeOutline: 'rgba(255, 255, 255, 0.06)',
  chromeHighlight: 'rgba(255, 255, 255, 0.11)',
  ink: '#FFFFFF',
  inkMuted: '#9A9AA0',
  placeholder: '#77777D',
  accent: '#E0E0E0',
  accentSoft: '#282830',
  onAccent: '#000000',
  badgeBg: '#E5E5EA',
  badgeFg: '#1C1C1E',
  success: '#34C759',
  warning: '#F5A623',
  danger: '#FF453A',
  dangerSoft: '#2C1517',
};

// Mochy-Music Light Counterpart (Theme.kt lightColorScheme)
export const LIGHT_PALETTE: KeepItPalette = {
  canvas: '#FFFFFF',
  sheetSurface: '#F7F7F8',
  surface: '#F0F0F2',
  surfaceElevated: '#FFFFFF',
  surfacePressed: '#E4E4E8',
  border: '#DCDCE0',
  chromeGlass: 'rgba(245, 245, 247, 0.88)',
  chromeOutline: 'rgba(0, 0, 0, 0.06)',
  chromeHighlight: 'rgba(0, 0, 0, 0.08)',
  ink: '#000000',
  inkMuted: '#55555C',
  placeholder: '#77777D',
  accent: '#141416',
  accentSoft: '#E5E5EA',
  onAccent: '#FFFFFF',
  badgeBg: '#1C1C1E',
  badgeFg: '#FFFFFF',
  success: '#248A3D',
  warning: '#B25000',
  danger: '#D70015',
  dangerSoft: '#FCE8E8',
};

export const RADII = {
  group: 28,
  photo: 24,
  card: 20,
  input: 14,
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

export const MOCHY_TYPE = {
  titleTracking: -0.7,
  bodyTracking: -0.35,
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
