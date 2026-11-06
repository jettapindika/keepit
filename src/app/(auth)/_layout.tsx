import { Stack } from 'expo-router';
import React from 'react';

import { useKeepItTheme } from '@/theme/tokens';

export default function AuthLayout() {
  const { colors } = useKeepItTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
        animation: 'fade',
      }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="pair" />
    </Stack>
  );
}
