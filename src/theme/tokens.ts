import { useColorScheme } from 'react-native';

import { useSessionStore } from '@/store/sessionStore';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface KeepItPalette {
  canvas: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  ink: string;
  inkMuted: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  success: string;
  warning: string;
  danger: string;
  dangerSoft: string;
}

export const LIGHT_PALETTE: KeepItPalette = {
  canvas: '#FAF7F2',
  surface: '#F2ECE4',
  surfaceElevated: '#FFFFFF',
  border: '#E4DCD2',
  ink: '#1F1B18',
  inkMuted: '#6B625B',
  accent: '#D95D39',
  accentSoft: '#F8E5DE',
  onAccent: '#FFFFFF',
  success: '#2E7D5B',
  warning: '#B86B19',
  danger: '#C43B31',
  dangerSoft: '#FBEAE8',
};

export const DARK_PALETTE: KeepItPalette = {
  canvas: '#141210',
  surface: '#1E1B18',
  surfaceElevated: '#282420',
  border: '#332E29',
  ink: '#F5F0EA',
  inkMuted: '#A69B90',
  accent: '#E66E4C',
  accentSoft: '#36211B',
  onAccent: '#141210',
  success: '#4BA37C',
  warning: '#E09132',
  danger: '#E55A4F',
  dangerSoft: '#351B19',
};

export const RADII = {
  photo: 24,
  card: 20,
  input: 12,
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
  };
}
