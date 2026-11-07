import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppPressable } from '@/components/ui/ScreenKit';
import { useKeepItTheme } from '@/theme/tokens';

export interface MochyTabBarProps {
  state: {
    index: number;
    routes: readonly { key: string; name: string; params?: object }[];
  };
  descriptors: Record<string, {
    options: { title?: string; tabBarLabel?: string | ((props: unknown) => React.ReactNode) };
  }>;
  emitter?: {
    emit: (event: { type: 'tabPress'; target: string; canPreventDefault: boolean }) => { defaultPrevented: boolean };
  };
  navigateToTab?: (routeKey: string) => void;
  navigation?: {
    emit?: (event: { type: 'tabPress'; target: string; canPreventDefault: boolean }) => { defaultPrevented: boolean };
    navigate?: (name: string, params?: object) => void;
  };
}

const tabOrder = ['index', 'map', 'memories', 'profile'] as const;
const icons = {
  index: { ios: 'house', android: 'home', web: 'home' },
  map: { ios: 'map', android: 'map', web: 'map' },
  memories: { ios: 'photo.on.rectangle.angled', android: 'photo_library', web: 'photo_library' },
  profile: { ios: 'person.crop.circle', android: 'person', web: 'person' },
} as const;

export function MochyTabBar({ state, descriptors, emitter, navigateToTab, navigation }: MochyTabBarProps) {
  const router = useRouter();
  const { colors } = useKeepItTheme();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const compactLabels = fontScale > 1.3 || width < 320;
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const routes = useMemo(() => tabOrder.flatMap((name) => {
    const route = state.routes.find((item) => item.name === name);
    return route ? [route] : [];
  }), [state.routes]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    if (Platform.OS !== 'web') return () => { show.remove(); hide.remove(); };

    const update = () => {
      const node = document.activeElement;
      const isTextEntry = node instanceof HTMLElement && (
        node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable
      );
      setKeyboardVisible(window.matchMedia('(pointer: coarse)').matches && isTextEntry);
    };
    document.addEventListener('focusin', update);
    const onFocusOut = () => queueMicrotask(update);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      show.remove();
      hide.remove();
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  if (keyboardVisible) return null;

  const activeName = state.routes[state.index]?.name;
  return (
    <View pointerEvents="box-none" style={[styles.wrapper, { paddingBottom: Math.max(12, insets.bottom) }]}>
      <View
        pointerEvents="auto"
        accessibilityRole="tablist"
        accessibilityLabel="Main navigation"
        style={[styles.dock, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        {routes.map((route, index) => {
          const focused = activeName === route.name;
          const options = descriptors[route.key]?.options;
          const label = typeof options?.tabBarLabel === 'string' ? options.tabBarLabel : options?.title ?? route.name;
          return (
            <React.Fragment key={route.key}>
              {index === 2 ? (
                <AppPressable
                  accessibilityRole="button"
                  accessibilityLabel="Open Dual Camera"
                  accessibilityShowsLargeContentViewer
                  accessibilityLargeContentTitle="Capture"
                  accessibilityHint="Capture a new Moment"
                  onPress={() => router.push('/camera')}
                  style={[styles.capture, { backgroundColor: colors.accent }]}
                >
                  <SymbolView name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }} tintColor={colors.onAccent} size={22} />
                  {!compactLabels ? <Text style={[styles.label, { color: colors.onAccent }]}>Capture</Text> : null}
                </AppPressable>
              ) : null}
              <AppPressable
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityShowsLargeContentViewer
                accessibilityLargeContentTitle={label}
                accessibilityState={{ selected: focused }}
                onPress={() => {
                  const emit = emitter?.emit ?? navigation?.emit;
                  const event = emit?.({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (event?.defaultPrevented) return;
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  if (navigateToTab) navigateToTab(route.key);
                  else if (navigation?.navigate) navigation.navigate(route.name, route.params);
                  else router.navigate(route.name === 'index' ? '/(tabs)' : `/(tabs)/${route.name}` as never);
                }}
                style={[styles.tab, { backgroundColor: focused ? colors.accentSoft : 'transparent' }]}
              >
                <View pointerEvents="none" style={styles.tabContent}>
                  <SymbolView name={icons[route.name as keyof typeof icons]} tintColor={focused ? colors.ink : colors.inkMuted} size={21} />
                  {!compactLabels ? <Text style={[styles.label, { color: focused ? colors.ink : colors.inkMuted, fontWeight: focused ? '700' : '500' }]}>{label}</Text> : null}
                </View>
              </AppPressable>
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', bottom: 0, left: 12, right: 12, alignItems: 'center', zIndex: 20 },
  dock: { width: '100%', maxWidth: 600, minHeight: 76, borderWidth: 1, borderRadius: 22, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  tab: { flex: 1, minWidth: 0, minHeight: 60, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tabContent: { alignItems: 'center', justifyContent: 'center', gap: 5 },
  capture: { flex: 1, minWidth: 0, minHeight: 60, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 5 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600', textAlign: 'center' },
});
