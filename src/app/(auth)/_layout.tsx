import { Stack } from 'expo-router';
import React from 'react';

import { useAppMotion } from '@/hooks/useAppMotion';
import { useKeepItTheme } from '@/theme/tokens';

export default function AuthLayout() {
  const { colors } = useKeepItTheme();
  const { reduced } = useAppMotion();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
        animation: reduced ? 'none' : 'fade',
      }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="pair" />
    </Stack>
  );
}
