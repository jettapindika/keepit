// src/components/ui/MochyTabBar.tsx
// Exact React Native Reanimated 4 port of Mochy-Music's floating stadium navigation bar:
// - AppNavigation.kt:261-388 (64dp stadium pill, 8dp inset, 4dp gap, stretching lead/trail highlight)
// - FrostedGlass.kt:30-42 (#131313 @ 78-84% frosted chrome, subtle hairline outline, ChromeHighlightColor)
// - TouchFeedback.kt:115 (pressBounce squish 0.88 -> bouncy rebound)

import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useEffect, useState } from 'react';
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
  navigation: {
    emit: (event: {
      type: 'tabPress';
      target: string;
      canPreventDefault: boolean;
    }) => { defaultPrevented: boolean };
    navigate: (name: string, params?: object) => void;
  };
}
type IconMap = {
  ios: string;
  android: string;
  web: string;
};

const TAB_ICONS: Record<string, IconMap> = {
  index: { ios: 'camera.on.rectangle.fill', android: 'photo_camera', web: 'photo_camera' },
  map: { ios: 'location.fill', android: 'location_on', web: 'location_on' },
  memories: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  settings: { ios: 'gearshape.fill', android: 'settings', web: 'settings' },
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
      <Animated.View style={[styles.tabItemInner, itemStyle]}>
        <SymbolView
          name={iconSpec as never}
          tintColor={isFocused ? colors.ink : colors.inkMuted}
          size={21}
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

export function MochyTabBar({ state, descriptors, navigation }: MochyTabBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useKeepItTheme();
  const motionEnabled = useSessionStore((s) => s.motionEnabled);
  const motionSpeed = useSessionStore((s) => s.motionSpeed);

  const [barWidth, setBarWidth] = useState(0);
  const tabCount = state.routes.length;
  const activeIndex = state.index;

  // Stretching lead/trail values matching AppNavigation.kt:350-387
  const startIdx = useSharedValue(activeIndex);
  const endIdx = useSharedValue(activeIndex);

  useEffect(() => {
    const target = activeIndex;
    if (!motionEnabled) {
      startIdx.set(target);
      endIdx.set(target);
      return;
    }
    const mid = (startIdx.get() + endIdx.get()) / 2;
    const movingRight = target >= mid;
    startIdx.set(
      withSpring(
        target,
        movingRight ? MOCHY_SPRINGS.navTrail(motionSpeed) : MOCHY_SPRINGS.navLead(motionSpeed)
      )
    );
    endIdx.set(
      withSpring(
        target,
        movingRight ? MOCHY_SPRINGS.navLead(motionSpeed) : MOCHY_SPRINGS.navTrail(motionSpeed)
      )
    );
  }, [activeIndex, motionEnabled, motionSpeed, startIdx, endIdx]);

  const highlightStyle = useAnimatedStyle(() => {
    if (barWidth <= 0 || tabCount === 0) {
      return { opacity: 0 };
    }
    const slot = barWidth / tabCount;
    const left = startIdx.get() * slot + HIGHLIGHT_INSET + HIGHLIGHT_GAP / 2;
    const right = (endIdx.get() + 1) * slot - HIGHLIGHT_INSET - HIGHLIGHT_GAP / 2;
    return {
      opacity: 1,
      left,
      width: Math.max(24, right - left),
    };
  });

  const handleLayout = (e: LayoutChangeEvent) => {
    setBarWidth(e.nativeEvent.layout.width);
  };

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
        {/* Sliding & Stretching Lit Pill Highlight */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.slidingHighlight,
            { backgroundColor: colors.chromeHighlight },
            highlightStyle,
          ]}
        />

        {state.routes.map((route, idx) => {
          const { options } = descriptors[route.key];
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : options.title ?? route.name;
          const isFocused = state.index === idx;

          const onPress = () => {
            if (isFocused) return;
            const href = route.name === 'index' ? '/(tabs)' : (`/(tabs)/${route.name}` as never);
            router.replace(href);
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
        })}
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
    maxWidth: 440,
    height: NAV_BAR_HEIGHT,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
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
    letterSpacing: -0.25,
  },
});
