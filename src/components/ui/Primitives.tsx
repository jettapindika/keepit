import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useAppMotion } from '@/hooks/useAppMotion';
import { MOCHY_REVEAL_EASING, MOCHY_SPRINGS, mochyTiming } from '@/theme/motion';
import { useKeepItTheme } from '@/theme/tokens';
import {
  buildKeepItWatermarkSvgDataUri,
  KEEPIT_WATERMARK_SVG_DATA_URI,
  KEEPIT_WATERMARK_SVG_PATH_D,
} from '@/utils/momentExport';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Seen-key registry matching Mochy-Music's RevealSeenState (RevealOnAppear.kt:64)
const seenRevealKeys = new Set<string>();
let burstStartedAt = 0;
let burstCount = 0;

function nextCascadeDelayMs(cascade: boolean): number {
  if (!cascade) return 0;
  const now = Date.now();
  if (now - burstStartedAt > 120) {
    burstStartedAt = now;
    burstCount = 0;
  }
  const step = Math.min(burstCount, 4);
  burstCount += 1;
  return step * 35;
}

/** First-mount feedback stays quiet and respects system and app motion settings. */
export function RevealOnAppear({
  revealKey,
  cascade = true,
  delayMs = 0,
  style,
  children,
}: {
  revealKey: string;
  cascade?: boolean;
  delayMs?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const { enabled: motionEnabled, speed: motionSpeed } = useAppMotion();
  const alreadySeen = seenRevealKeys.has(revealKey);

  const progress = useSharedValue(alreadySeen || !motionEnabled ? 1 : 0.85);

  useEffect(() => {
    if (seenRevealKeys.has(revealKey)) {
      progress.set(1);
      return;
    }
    seenRevealKeys.add(revealKey);
    if (!motionEnabled) {
      progress.set(1);
      return;
    }
    const waitMs = Math.round(
      (delayMs + nextCascadeDelayMs(cascade)) / Math.max(0.25, motionSpeed)
    );
    const cfg = mochyTiming(220, MOCHY_REVEAL_EASING, motionEnabled, motionSpeed);
    progress.set(withDelay(waitMs, withTiming(1, cfg)));
  }, [revealKey, cascade, delayMs, motionEnabled, motionSpeed, progress]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * 10 }],
    };
  });

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

/** A content surface; only actionable cards receive press feedback. */
export function MochyCard({
  onPress,
  accessibilityLabel,
  style,
  children,
}: {
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const { colors, radii } = useKeepItTheme();
  const { enabled: motionEnabled, speed: motionSpeed } = useAppMotion();
  const scale = useSharedValue(1);
  const [focused, setFocused] = useState(false);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  if (!onPress) {
    return (
      <View
        style={[
          styles.cardBase,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.card,
          },
          style,
        ]}>
        {children}
      </View>
    );
  }

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPressIn={() => {
        if (!motionEnabled) return;
        scale.set(withSpring(0.985, MOCHY_SPRINGS.pressIn(motionSpeed)));
      }}
      onPressOut={() => {
        if (!motionEnabled) return;
        scale.set(withSpring(1, MOCHY_SPRINGS.pressRelease(motionSpeed)));
      }}
      onPress={() => {
        if (Platform.OS !== 'web') {
          void Haptics.selectionAsync();
        }
        onPress();
      }}
      style={[
        styles.cardBase,
        {
          backgroundColor: colors.surface,
          borderColor: focused ? colors.accent : colors.border,
          borderRadius: radii.card,
        },
        animatedStyle,
        style,
        focused && { outlineColor: colors.focusRing, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 3 },
      ]}>
      {children}
    </AnimatedPressable>
  );
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** The monochrome action shape follows the approved 10px reference radius. */
export function KeepItButton({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  loadingLabel,
  disabled = false,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const { colors, radii, type } = useKeepItTheme();
  const { enabled: motionEnabled, speed: motionSpeed } = useAppMotion();
  const scale = useSharedValue(1);
  const [focused, setFocused] = useState(false);
  const isDisabled = disabled || loading;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  const handlePressIn = () => {
    if (isDisabled || !motionEnabled) return;
    scale.set(withTiming(0.98, mochyTiming(100, undefined, motionEnabled, motionSpeed)));
  };

  const handlePressOut = () => {
    if (!motionEnabled) {
      scale.set(1);
      return;
    }
    scale.set(withTiming(1, mochyTiming(120, undefined, motionEnabled, motionSpeed)));
  };

  const handlePress = () => {
    if (isDisabled) return;
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  };

  const bgByVariant = {
    primary: colors.accent,
    secondary: colors.surfaceElevated,
    danger: colors.dangerSoft,
    ghost: 'transparent',
  }[variant];

  const textByVariant = {
    primary: colors.onAccent,
    secondary: colors.ink,
    danger: colors.danger,
    ghost: colors.inkMuted,
  }[variant];

  const borderColor = focused
    ? colors.ink
    : variant === 'secondary'
      ? colors.controlBorder
      : variant === 'danger'
        ? colors.danger
        : 'transparent';

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={[
        styles.buttonBase,
        {
          backgroundColor: bgByVariant,
          borderRadius: radii.input,
          borderColor,
          borderWidth: variant === 'secondary' || variant === 'danger' ? 1 : 0,
          opacity: disabled && !loading ? 0.42 : 1,
        },
        animatedStyle,
        style,
        focused && { outlineColor: colors.focusRing, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 3 },
      ]}>
      {loading ? <ActivityIndicator pointerEvents="none" size="small" color={textByVariant} /> : null}
      <Text pointerEvents="none" style={[styles.buttonText, { color: textByVariant, fontFamily: type.fontSans }]}>
        {loading ? (loadingLabel ?? `${label}…`) : label}
      </Text>
    </AnimatedPressable>
  );
}

export function InlineNotice({
  message,
  tone = 'error',
}: {
  message: string;
  tone?: 'error' | 'info' | 'success';
}) {
  const { colors, radii } = useKeepItTheme();

  const palette = {
    error: { bg: colors.dangerSoft, border: colors.danger, fg: colors.danger },
    info: { bg: colors.surface, border: colors.border, fg: colors.inkMuted },
    success: { bg: colors.accentSoft, border: colors.border, fg: colors.ink },
  }[tone];

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.notice,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderRadius: radii.input,
        },
      ]}>
      <Text style={[styles.noticeText, { color: palette.fg }]}>{message}</Text>
    </View>
  );
}

/**
 * KeepIt dual-frame emblem: overlapping back & front camera frames with a clean viewfinder aperture.
 */
export function DualFrameMark({ size = 56 }: { size?: number }) {
  const { colors } = useKeepItTheme();
  const backW = Math.round(size * 0.68);
  const backH = Math.round(size * 0.84);
  const frontW = Math.round(size * 0.46);
  const frontH = Math.round(size * 0.58);
  const lensSize = Math.max(8, Math.round(size * 0.2));

  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {/* Rear frame */}
      <View
        style={{
          width: backW,
          height: backH,
          borderRadius: Math.round(size * 0.22),
          borderCurve: 'continuous',
          backgroundColor: colors.surfaceElevated,
          borderWidth: 1.5,
          borderColor: colors.ink,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ translateX: Math.round(size * 0.08) }, { translateY: Math.round(size * 0.04) }],
        }}>
        <View
          style={{
            width: lensSize,
            height: lensSize,
            borderRadius: Math.round(lensSize / 2),
            borderWidth: 1.5,
            borderColor: colors.inkMuted,
          }}
        />
      </View>
      {/* Front overlapping PIP frame */}
      <View
        style={{
          position: 'absolute',
          top: Math.round(size * 0.06),
          left: Math.round(size * 0.08),
          width: frontW,
          height: frontH,
          borderRadius: Math.round(size * 0.16),
          borderCurve: 'continuous',
          backgroundColor: colors.ink,
          borderWidth: 2,
          borderColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View
          style={{
            width: Math.max(5, Math.round(size * 0.1)),
            height: Math.max(5, Math.round(size * 0.1)),
            borderRadius: 99,
            backgroundColor: colors.canvas,
          }}
        />
      </View>
    </View>
  );
}

export {
  buildKeepItWatermarkSvgDataUri,
  KEEPIT_WATERMARK_SVG_DATA_URI,
  KEEPIT_WATERMARK_SVG_PATH_D,
};

/**
 * Renders the official #keepit vector watermark logo (50:11 aspect ratio).
 */
export function KeepItWatermarkLogo({
  width = 76,
  height,
  color = '#FFFFFF',
  style,
}: {
  width?: number;
  height?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const resolvedHeight = height ?? Math.round((width * 11) / 50 * 10) / 10;
  const uri =
    color === '#FFFFFF' || color === 'white'
      ? KEEPIT_WATERMARK_SVG_DATA_URI
      : buildKeepItWatermarkSvgDataUri(color);

  if (Platform.OS === 'web') {
    return React.createElement(
      'svg',
      {
        width,
        height: resolvedHeight,
        viewBox: '0 0 50 11',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        role: 'img',
        'aria-label': '#keepit',
        style: {
          display: 'block',
          flexShrink: 0,
        },
      },
      React.createElement('title', null, '#keepit'),
      React.createElement('path', {
        d: KEEPIT_WATERMARK_SVG_PATH_D,
        fill: color,
      })
    );
  }

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="#keepit"
      style={[
        {
          width,
          height: resolvedHeight,
        },
        style,
      ]}>
      <Image
        source={{ uri }}
        contentFit="contain"
        style={{ width, height: resolvedHeight }}
      />
    </View>
  );
}

/**
 * Flat structural skeleton block for perceived performance while loading queries (R-27)
 */
export function SkeletonBlock({
  height = 120,
  borderRadius,
  label = 'Loading content...',
  style,
}: {
  height?: number;
  borderRadius?: number;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, radii } = useKeepItTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={[
        styles.skeletonBase,
        {
          minHeight: height,
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: borderRadius ?? radii.group,
        },
        style,
      ]}>
      <View
        style={[
          styles.skeletonLinePrimary,
          { backgroundColor: colors.surfaceElevated, borderRadius: radii.pill },
        ]}
      />
      <View
        style={[
          styles.skeletonLineSecondary,
          { backgroundColor: colors.surfaceElevated, borderRadius: radii.pill },
        ]}
      />
      <Text style={[styles.loadingText, { color: colors.inkMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cardBase: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  buttonBase: {
    minHeight: 54,
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    borderCurve: 'continuous',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 22,
    textAlign: 'center',
    flexShrink: 1,
  },
  notice: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderCurve: 'continuous',
  },
  noticeText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  skeletonBase: {
    width: '100%',
    borderWidth: 1,
    padding: 20,
    justifyContent: 'center',
    gap: 10,
    borderCurve: 'continuous',
  },
  skeletonLinePrimary: {
    width: '54%',
    height: 14,
  },
  skeletonLineSecondary: {
    width: '36%',
    height: 11,
  },
  loadingText: { fontSize: 14, lineHeight: 20 },
});
