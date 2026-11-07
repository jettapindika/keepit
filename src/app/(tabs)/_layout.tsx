import { Tabs } from 'expo-router';
import React from 'react';

import { MochyTabBar, MochyTabBarProps } from '@/components/ui/MochyTabBar';
import { useKeepItTheme } from '@/theme/tokens';

export default function TabsLayout() {
  const { colors } = useKeepItTheme();

  return (
    <Tabs
      tabBar={(props) => <MochyTabBar {...(props as unknown as MochyTabBarProps)} />}
      screenOptions={{
        headerShown: false,
        animation: 'none',
        tabBarHideOnKeyboard: true,
        sceneStyle: {
          backgroundColor: colors.canvas,
        },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="map" options={{ title: 'Map' }} />
      <Tabs.Screen name="memories" options={{ title: 'Memories' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen name="messages" options={{ title: 'Chat' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
