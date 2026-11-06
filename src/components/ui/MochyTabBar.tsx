// src/components/ui/MochyTabBar.tsx
// React Native Reanimated 4 floating stadium navigation dock with central Dual Camera shutter:
// Left: Home (`index`), Map (`map`) | Center: Raised Camera Shutter (`/camera`) | Right: Chat (`messages`), Profile (`profile`)

import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSessionStore } from '@/store/sessionStore';
import { MOCHY_SPRINGS, mochyTiming } from '@/theme/motion';
import { useKeepItTheme } from '@/theme/tokens';

const NAV_BAR_HEIGHT = 64;
const HIGHLIGHT_INSET = 6;
const HIGHLIGHT_GAP = 4;
const DOCK_TAB_ORDER = ['index', 'map', 'messages', 'profile'] as const;
const TOTAL_DOCK_SLOTS = 5;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface MochyTabBarProps {
  state: {
    index: number;
    routes: readonly { key: string; name: string; params?: object }[];
  };
  descriptors: Record<
    string,
    {
      options: {
        title?: string;
        tabBarLabel?: string | ((props: unknown) => React.ReactNode);
      };
    }
  >;
  emitter?: {
    emit: (event: {
      type: 'tabPress';
      target: string;
      canPreventDefault: boolean;
    }) => { defaultPrevented: boolean };
  };
  navigateToTab?: (routeKey: string) => void;
  navigation?: {
    emit?: (event: {
      type: 'tabPress';
      target: string;
      canPreventDefault: boolean;
    }) => { defaultPrevented: boolean };
    navigate?: (name: string, params?: object) => void;
  };
}

type IconMap = {
  ios: string;
  android: string;
  web: string;
};

const TAB_ICONS: Record<string, IconMap> = {
  index: { ios: 'house.fill', android: 'home', web: 'home' },
  map: { ios: 'location.fill', android: 'location_on', web: 'location_on' },
  messages: { ios: 'bubble.left.and.bubble.right.fill', android: 'chat_bubble', web: 'chat_bubble' },
  profile: { ios: 'person.crop.circle.fill', android: 'person', web: 'person' },
  memories: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  settings: { ios: 'gearshape.fill', android: 'settings', web: 'settings' },
};

const CAMERA_SHUTTER_ICON: IconMap = {
  ios: 'camera.fill',
  android: 'photo_camera',
  web: 'photo_camera',
};

function MochyNavItem({
  routeKey,
  routeName,
  label,
  isFocused,
  onPress,
}: {
  routeKey: string;
  routeName: string;
  label: string;
  isFocused: boolean;
  onPress: () => void;
}) {
  const { colors } = useKeepItTheme();
  const motionEnabled = useSessionStore((s) => s.motionEnabled);
  const motionSpeed = useSessionStore((s) => s.motionSpeed);

  const scale = useSharedValue(1);
  const lit = useSharedValue(isFocused ? 1 : 0.7);

  useEffect(() => {
    lit.set(
      withTiming(
        isFocused ? 1 : 0.7,
        mochyTiming(200, undefined, motionEnabled, motionSpeed)
      )
    );
  }, [isFocused, motionEnabled, motionSpeed, lit]);

  const itemStyle = useAnimatedStyle(() => ({
    opacity: lit.get(),
    transform: [{ scale: scale.get() }],
  }));

  const iconSpec = TAB_ICONS[routeName] ?? TAB_ICONS.index;

  return (
    <Pressable
      key={routeKey}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: isFocused }}
      onPressIn={() => {
        if (!motionEnabled) return;
        scale.set(withSpring(0.88, MOCHY_SPRINGS.pressIn(motionSpeed)));
      }}
      onPressOut={() => {
        if (!motionEnabled) {
          scale.set(1);
          return;
        }
        scale.set(withSpring(1, MOCHY_SPRINGS.pressRelease(motionSpeed)));
      }}
      onPress={() => {
        if (Platform.OS !== 'web') {
          void Haptics.selectionAsync();
        }
        onPress();
      }}
      style={styles.tabItem}>
      <Animated.View pointerEvents="none" style={[styles.tabItemInner, itemStyle]}>
        <SymbolView
          name={iconSpec as never}
          tintColor={isFocused ? colors.ink : colors.inkMuted}
          size={20}
        />
        <Text
          numberOfLines={1}
          style={[
            styles.tabLabel,
            {
              color: isFocused ? colors.ink : colors.inkMuted,
              fontWeight: isFocused ? '700' : '600',
            },
          ]}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function CenterCameraShutter({ onPress }: { onPress: () => void }) {
  const { colors } = useKeepItTheme();
  const motionEnabled = useSessionStore((s) => s.motionEnabled);
  const motionSpeed = useSessionStore((s) => s.motionSpeed);
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  return (
    <View style={styles.centerSlot}>
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel="Open Dual Camera"
        onPressIn={() => {
          if (!motionEnabled) return;
          scale.set(withSpring(0.9, MOCHY_SPRINGS.pressIn(motionSpeed)));
        }}
        onPressOut={() => {
          if (!motionEnabled) {
            scale.set(1);
            return;
          }
          scale.set(withSpring(1, MOCHY_SPRINGS.pressRelease(motionSpeed)));
        }}
        onPress={() => {
          if (Platform.OS !== 'web') {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }
          onPress();
        }}
        style={[
          styles.cameraOuterRing,
          {
            borderColor: colors.accent,
            backgroundColor: colors.surfaceElevated,
          },
          animatedStyle,
        ]}>
        <View
          style={[
            styles.cameraInnerCore,
            {
              backgroundColor: colors.accent,
            },
          ]}>
          <SymbolView
            name={CAMERA_SHUTTER_ICON as never}
            tintColor={colors.onAccent}
            size={20}
          />
        </View>
        <View
          pointerEvents="none"
          style={[
            styles.cameraPlusBadge,
            {
              backgroundColor: colors.canvas,
              borderColor: colors.accent,
            },
          ]}>
          <Text style={[styles.cameraPlusText, { color: colors.ink }]}>+</Text>
        </View>
      </AnimatedPressable>
    </View>
  );
}

export function MochyTabBar({ state, descriptors, emitter, navigateToTab, navigation }: MochyTabBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useKeepItTheme();
  const motionEnabled = useSessionStore((s) => s.motionEnabled);
  const motionSpeed = useSessionStore((s) => s.motionSpeed);

  const [barWidth, setBarWidth] = useState(0);

  const stateRoutes = state.routes;
  const visibleRoutes = useMemo(() => {
    const byName = new Map(stateRoutes.map((r) => [r.name, r]));
    return DOCK_TAB_ORDER.map((name) => byName.get(name)).filter(
      (r): r is (typeof stateRoutes)[number] => Boolean(r)
    );
  }, [stateRoutes]);

  const activeRouteName = state.routes[state.index]?.name ?? 'index';

  // Map focused route to its physical 0..4 slot index (slot 2 is the Center Camera Shutter).
  // Hidden sub-screens (`memories`, `settings`) return -1 so the sliding pill hides cleanly.
  const activeVisualSlot = useMemo(() => {
    const orderIdx = DOCK_TAB_ORDER.indexOf(
      activeRouteName as (typeof DOCK_TAB_ORDER)[number]
    );
    if (orderIdx === -1) return -1;
    return orderIdx >= 2 ? orderIdx + 1 : orderIdx;
  }, [activeRouteName]);

  const startSlot = useSharedValue(activeVisualSlot >= 0 ? activeVisualSlot : 0);
  const endSlot = useSharedValue(activeVisualSlot >= 0 ? activeVisualSlot : 0);
  const pillVisible = useSharedValue(activeVisualSlot >= 0 ? 1 : 0);

  useEffect(() => {
    if (activeVisualSlot < 0) {
      pillVisible.set(withTiming(0, mochyTiming(150, undefined, motionEnabled, motionSpeed)));
      return;
    }

    pillVisible.set(withTiming(1, mochyTiming(180, undefined, motionEnabled, motionSpeed)));

    if (!motionEnabled) {
      startSlot.set(activeVisualSlot);
      endSlot.set(activeVisualSlot);
      return;
    }

    const mid = (startSlot.get() + endSlot.get()) / 2;
    const movingRight = activeVisualSlot >= mid;
    startSlot.set(
      withSpring(
        activeVisualSlot,
        movingRight ? MOCHY_SPRINGS.navTrail(motionSpeed) : MOCHY_SPRINGS.navLead(motionSpeed)
      )
    );
    endSlot.set(
      withSpring(
        activeVisualSlot,
        movingRight ? MOCHY_SPRINGS.navLead(motionSpeed) : MOCHY_SPRINGS.navTrail(motionSpeed)
      )
    );
  }, [activeVisualSlot, motionEnabled, motionSpeed, startSlot, endSlot, pillVisible]);

  const highlightStyle = useAnimatedStyle(() => {
    if (barWidth <= 0) {
      return { opacity: 0 };
    }
    const slotWidth = barWidth / TOTAL_DOCK_SLOTS;
    const left = startSlot.get() * slotWidth + HIGHLIGHT_INSET + HIGHLIGHT_GAP / 2;
    const right = (endSlot.get() + 1) * slotWidth - HIGHLIGHT_INSET - HIGHLIGHT_GAP / 2;
    return {
      opacity: pillVisible.get(),
      left,
      width: Math.max(24, right - left),
    };
  });

  const handleLayout = (e: LayoutChangeEvent) => {
    setBarWidth(e.nativeEvent.layout.width);
  };

  const renderTabRoute = (route: (typeof state.routes)[number]) => {
    const options = descriptors[route.key]?.options ?? {};
    const label =
      typeof options.tabBarLabel === 'string'
        ? options.tabBarLabel
        : options.title ?? route.name;
    const isFocused = activeRouteName === route.name;

    const onPress = () => {
      if (isFocused) return;
      const emitFn = emitter?.emit ?? navigation?.emit;
      if (emitFn) {
        const event = emitFn({
          type: 'tabPress',
          target: route.key,
          canPreventDefault: true,
        });
        if (event?.defaultPrevented) return;
      }
      if (navigateToTab) {
        navigateToTab(route.key);
        return;
      }
      const href = route.name === 'index' ? '/(tabs)' : (`/(tabs)/${route.name}` as never);
      router.navigate(href);
    };

    return (
      <MochyNavItem
        key={route.key}
        routeKey={route.key}
        routeName={route.name}
        label={label}
        isFocused={isFocused}
        onPress={onPress}
      />
    );
  };

  const leftTabs = visibleRoutes.filter((r) => r.name === 'index' || r.name === 'map');
  const rightTabs = visibleRoutes.filter((r) => r.name === 'messages' || r.name === 'profile');

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.outerWrap,
        {
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}>
      <View
        onLayout={handleLayout}
        style={[
          styles.pillChrome,
          {
            backgroundColor: colors.chromeGlass,
            borderColor: colors.chromeOutline,
          },
          Platform.OS === 'web'
            ? ({ backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' } as never)
            : null,
        ]}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.slidingHighlight,
            { backgroundColor: colors.chromeHighlight },
            highlightStyle,
          ]}
        />

        {leftTabs.map(renderTabRoute)}

        <CenterCameraShutter onPress={() => router.push('/camera')} />

        {rightTabs.map(renderTabRoute)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  pillChrome: {
    width: '100%',
    maxWidth: 460,
    height: NAV_BAR_HEIGHT,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    overflow: 'visible',
    borderCurve: 'continuous',
    boxShadow: '0px 8px 24px rgba(0, 0, 0, 0.28)',
  },
  slidingHighlight: {
    position: 'absolute',
    top: HIGHLIGHT_INSET,
    bottom: HIGHLIGHT_INSET,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  tabItem: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  tabItemInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabLabel: {
    fontSize: 11,
    letterSpacing: -0.2,
  },
  centerSlot: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  cameraOuterRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    padding: 3,
    marginTop: -12,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
    boxShadow: '0px 6px 18px rgba(0, 0, 0, 0.36)',
  },
  cameraInnerCore: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  cameraPlusBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 19,
    height: 19,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraPlusText: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 14,
  },
});
