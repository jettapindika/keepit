import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { WalletHeroArt, WalletArtSlide } from '@/components/onboarding/WalletHeroArt';
import { useAppMotion } from '@/hooks/useAppMotion';
import {
  MAX_WALLET_LAYOUT as layout,
  MAX_WALLET_MOTION as motion,
  MAX_WALLET_TYPE as type,
  useKeepItTheme,
} from '@/theme/tokens';

interface OnboardingSlide {
  titleLines: readonly [string, string];
  subtitleLines: readonly [string, string];
  artAsset: WalletArtSlide;
}

const slides: readonly OnboardingSlide[] = [
  {
    titleLines: ['Your day,', 'together.'],
    subtitleLines: ['Capture both sides of your day.', 'Share Moments with your partner or friends.'],
    artAsset: 'access',
  },
  {
    titleLines: ['Both sides,', 'one Moment.'],
    subtitleLines: ['Use the front and back cameras.', 'Post yours to see theirs.'],
    artAsset: 'secure',
  },
  {
    titleLines: ['Keep the days', 'worth keeping.'],
    subtitleLines: ['Share a status. Save your Moments.', 'Find them again in your calendar.'],
    artAsset: 'smart',
  },
];

const slideEasing = Easing.bezier(0.22, 1, 0.36, 1);
const fadeEasing = Easing.out(Easing.ease);
const nativeDriver = Platform.OS !== 'web';

export function WalletOnboarding({
  onCreateAccount,
  onSignIn,
  initialSlideIndex = 0,
  onSlideChange,
}: {
  onCreateAccount: () => void;
  onSignIn: () => void;
  initialSlideIndex?: number;
  onSlideChange?: (index: number) => void;
}) {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { reduced: reducedMotion } = useAppMotion();
  const { colors, isDark } = useKeepItTheme();
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, Math.min(slides.length - 1, initialSlideIndex)));
  const [outgoingIndex, setOutgoingIndex] = useState<number | null>(null);
  const [direction, setDirection] = useState(1);
  const [heroFocused, setHeroFocused] = useState(false);
  const [progress] = useState(() => new Animated.Value(1));
  const [fade] = useState(() => new Animated.Value(1));
  const [float] = useState(() => new Animated.Value(0));

  const bottomSpace = Math.max(layout.sheetBottom, insets.bottom - 8);
  const availableHeight = Math.max(0, height - insets.top);
  const adaptive = width < 350 || height < 700 || fontScale > 1;
  const heroHeight = adaptive
    ? Math.max(200, availableHeight - layout.sheetHeight - bottomSpace)
    : availableHeight - layout.sheetHeight - bottomSpace;
  const sheetWidth = Math.min(layout.contentWidth + layout.contentInset * 2, width - layout.viewportInset * 2);
  const artScale = Math.min(1, (width - layout.viewportInset * 2) / layout.artWidth, (heroHeight - 56) / layout.artHeight);
  const artTop = heroHeight - layout.artTopGap - layout.artHeight / 2 - (layout.artHeight * artScale) / 2;
  const sansFamily = type.sansFamily;

  const changeSlide = useCallback(
    (index: number) => {
      const nextIndex = Math.max(0, Math.min(slides.length - 1, index));
      if (nextIndex === activeIndex || outgoingIndex !== null) return;
      setDirection(nextIndex > activeIndex ? 1 : -1);
      onSlideChange?.(nextIndex);
      if (Platform.OS === 'ios') {
        AccessibilityInfo.announceForAccessibility(`Slide ${nextIndex + 1} of ${slides.length}. ${slides[nextIndex].titleLines.join(' ')} ${slides[nextIndex].subtitleLines.join(' ')}`);
      }
      if (reducedMotion) {
        setActiveIndex(nextIndex);
        return;
      }
      progress.setValue(0);
      fade.setValue(0);
      setOutgoingIndex(activeIndex);
      setActiveIndex(nextIndex);
    },
    [activeIndex, fade, onSlideChange, outgoingIndex, progress, reducedMotion],
  );

  useEffect(() => {
    if (outgoingIndex === null) return;
    const animation = Animated.parallel([
      Animated.timing(progress, {
        toValue: 1,
        duration: reducedMotion ? 0 : motion.slide,
        easing: slideEasing,
        useNativeDriver: nativeDriver,
      }),
      Animated.timing(fade, {
        toValue: 1,
        duration: reducedMotion ? 0 : motion.heroFade,
        easing: fadeEasing,
        useNativeDriver: nativeDriver,
      }),
    ]);
    animation.start(({ finished }) => {
      if (finished) setOutgoingIndex(null);
    });
    return () => animation.stop();
  }, [fade, outgoingIndex, progress, reducedMotion]);

  useEffect(() => {
    float.setValue(0);
    if (reducedMotion || outgoingIndex !== null) return;
    // One quiet up-and-back cycle per slide, never an endless ambient loop.
    const animation = Animated.sequence([
      Animated.timing(float, {
        toValue: -4,
        duration: motion.heroFloat,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: nativeDriver,
        isInteraction: false,
      }),
      Animated.timing(float, {
        toValue: 0,
        duration: motion.heroFloat,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: nativeDriver,
        isInteraction: false,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [activeIndex, float, outgoingIndex, reducedMotion]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      changeSlide(activeIndex + (event.key === 'ArrowRight' ? 1 : -1));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, changeSlide]);

  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
      onPanResponderRelease: (_, gesture) => {
        if (Math.abs(gesture.dx) > 45 || Math.abs(gesture.vx) > 0.45) {
          changeSlide(activeIndex + (gesture.dx < 0 ? 1 : -1));
        }
      },
    }),
    [activeIndex, changeSlide],
  );

  const layerStyle = (index: number) => {
    if (index === activeIndex) {
      return {
        opacity: fade,
        transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [direction * sheetWidth, 0] }) }],
      };
    }
    return {
      opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -direction * sheetWidth] }) }],
    };
  };
  const visibleSlides = outgoingIndex === null ? [activeIndex] : [outgoingIndex, activeIndex];
  const currentSlide = slides[activeIndex];

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        scrollEnabled={adaptive}
        showsVerticalScrollIndicator={adaptive}
        contentContainerStyle={[styles.page, { backgroundColor: colors.canvas, minHeight: availableHeight, paddingBottom: bottomSpace }]}
      >
        <View {...panResponder.panHandlers}>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel={`Slide ${activeIndex + 1} of ${slides.length}. ${currentSlide.titleLines.join(' ')} ${currentSlide.subtitleLines.join(' ')}`}
            accessibilityValue={{ min: 1, max: slides.length, now: activeIndex + 1 }}
            accessibilityHint="Swipe left or right, or activate to show the next slide."
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
            onAccessibilityAction={({ nativeEvent }) => {
              changeSlide(nativeEvent.actionName === 'activate'
                ? (activeIndex + 1) % slides.length
                : activeIndex + (nativeEvent.actionName === 'decrement' ? -1 : 1));
            }}
            onPress={() => changeSlide((activeIndex + 1) % slides.length)}
            onFocus={() => setHeroFocused(true)}
            onBlur={() => setHeroFocused(false)}
            style={[styles.heroZone, { height: heroHeight }, heroFocused && [styles.heroFocusRing, { outlineColor: colors.focusRing }]]}
          >
            {visibleSlides.map((index) => (
              <Animated.View
                key={index}
                pointerEvents="none"
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[
                  styles.heroLayer,
                  { top: artTop, left: (width - layout.artWidth) / 2 },
                  layerStyle(index),
                ]}
              >
                <Animated.View style={{ transform: [{ scale: artScale }, { translateY: float }] }}>
                  <WalletHeroArt slide={slides[index].artAsset} />
                </Animated.View>
              </Animated.View>
            ))}
          </Pressable>

          <View
            testID="onboarding-sheet"
            style={[styles.sheet, { width: sheetWidth, backgroundColor: colors.surface, borderColor: colors.border }, adaptive ? styles.adaptiveSheet : styles.fixedSheet]}
          >
            <View style={[styles.copyViewport, !adaptive && styles.copyClipping]}>
              {visibleSlides.map((index) => (
                <Animated.View
                  key={index}
                  accessibilityElementsHidden={index !== activeIndex}
                  importantForAccessibility={index === activeIndex ? 'auto' : 'no-hide-descendants'}
                  style={[
                    index !== activeIndex && styles.outgoingCopy,
                    layerStyle(index),
                  ]}
                >
                  <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
                    {slides[index].titleLines.join('\n')}
                  </Text>
                  <Text style={[styles.subtitle, { color: colors.inkMuted }]}>{slides[index].subtitleLines.join('\n')}</Text>
                </Animated.View>
              ))}
            </View>

            <View
              accessibilityLabel={`Slide ${activeIndex + 1} of ${slides.length}`}
              accessibilityLiveRegion="polite"
              style={styles.pagination}
            >
              {slides.map((_, index) => (
                <Pressable
                  key={index}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to slide ${index + 1}`}
                  accessibilityState={{ selected: index === activeIndex }}
                  hitSlop={8}
                  onPress={() => changeSlide(index)}
                  style={styles.paginationDotBtn}
                >
                  <PaginationIndicator active={index === activeIndex} reducedMotion={reducedMotion} />
                </Pressable>
              ))}
            </View>

            <View style={styles.primaryGap}>
              <OnboardingButton
                label="Create account"
                primary
                sansFamily={sansFamily}
                reducedMotion={reducedMotion}
                onPress={onCreateAccount}
              />
            </View>
            <View style={styles.secondaryGap}>
              <OnboardingButton
                label="I already have an account"
                sansFamily={sansFamily}
                reducedMotion={reducedMotion}
                onPress={onSignIn}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PaginationIndicator({ active, reducedMotion }: { active: boolean; reducedMotion: boolean }) {
  const { colors } = useKeepItTheme();
  const [value] = useState(() => new Animated.Value(active ? 1 : 0));
  useEffect(() => {
    const animation = Animated.timing(value, {
      toValue: active ? 1 : 0,
      duration: reducedMotion ? 0 : motion.pagination,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [active, reducedMotion, value]);

  return (
    <Animated.View
      style={[
        {
          backgroundColor: active ? colors.primary : colors.ink,
          width: value.interpolate({ inputRange: [0, 1], outputRange: [6, 20] }),
          height: 6,
          borderRadius: 3,
          opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.22, 1] }),
        },
      ]}
    />
  );
}

function OnboardingButton({
  label,
  primary = false,
  disabled = false,
  sansFamily,
  reducedMotion,
  onPress,
}: {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  sansFamily?: string;
  reducedMotion: boolean;
  onPress: () => void;
}) {
  const { colors } = useKeepItTheme();
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [scale] = useState(() => new Animated.Value(1));
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(scale, {
        toValue: pressed && !reducedMotion ? 0.985 : 1,
        duration: reducedMotion ? 0 : pressed ? motion.pressIn : motion.pressOut,
        easing: fadeEasing,
        useNativeDriver: nativeDriver,
      }),
      Animated.timing(opacity, {
        toValue: disabled ? 0.42 : pressed ? 0.88 : 1,
        duration: reducedMotion ? 0 : pressed ? motion.pressIn : motion.pressOut,
        easing: fadeEasing,
        useNativeDriver: nativeDriver,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [disabled, opacity, pressed, reducedMotion, scale]);

  return (
    <Animated.View style={{ opacity, transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onPress={onPress}
        style={[
          styles.button,
          primary
            ? [styles.primaryButton, { backgroundColor: hovered ? colors.primary : colors.accent }]
            : [styles.secondaryButton, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }],
          focused && [styles.focusRing, { outlineColor: colors.focusRing }],
        ]}
      >
        <Text style={[
          styles.buttonLabel,
          primary ? styles.primaryLabel : styles.secondaryLabel,
          { fontFamily: sansFamily, color: primary ? colors.onAccent : colors.ink },
        ]}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  page: { flexGrow: 1 },
  heroZone: { width: '100%', overflow: 'hidden' },
  heroLayer: { position: 'absolute', width: layout.artWidth, height: layout.artHeight },
  sheet: {
    alignSelf: 'center',
    minHeight: layout.sheetHeight,
    paddingHorizontal: layout.contentInset,
    paddingTop: 32,
    paddingBottom: 28,
    borderRadius: layout.sheetRadius,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  fixedSheet: { minHeight: layout.sheetHeight },
  adaptiveSheet: { paddingBottom: 28 },
  copyViewport: { minHeight: 124 },
  copyClipping: { overflow: 'hidden' },
  outgoingCopy: { position: 'absolute', top: 0, left: 0, right: 0 },
  title: {
    minHeight: 70,
    fontFamily: type.sansFamily,
    fontSize: type.titleSize,
    fontWeight: '600',
    lineHeight: type.titleLineHeight,
    letterSpacing: 0,
    textAlign: 'center',
    includeFontPadding: false,
  },
  subtitle: {
    minHeight: 44,
    marginTop: 12,
    fontFamily: type.sansFamily,
    fontSize: type.bodySize,
    fontWeight: '400',
    lineHeight: type.bodyLineHeight,
    letterSpacing: 0,
    textAlign: 'center',
    includeFontPadding: false,
  },
  pagination: { height: 24, marginTop: 20, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  paginationDotBtn: { minHeight: 24, paddingHorizontal: 4, justifyContent: 'center', alignItems: 'center' },
  primaryGap: { marginTop: 24 },
  secondaryGap: { marginTop: 12 },
  button: { width: '100%', paddingVertical: 14, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', borderCurve: 'continuous' },
  primaryButton: { minHeight: layout.primaryButtonHeight, borderRadius: layout.buttonRadius },
  secondaryButton: { minHeight: layout.secondaryButtonHeight, borderRadius: layout.buttonRadius, borderWidth: 1 },
  buttonLabel: { lineHeight: 20, fontWeight: '600', textAlign: 'center', includeFontPadding: false, flexShrink: 1 },
  primaryLabel: { fontSize: type.primarySize, letterSpacing: 0 },
  secondaryLabel: { fontSize: type.secondarySize, letterSpacing: 0 },
  focusRing: { outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 3 },
  heroFocusRing: { outlineWidth: 2, outlineStyle: 'solid', outlineOffset: -4 },
});
