import * as Haptics from 'expo-haptics';
import React from 'react';
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
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useKeepItTheme } from '@/theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const PRESS_EASING = Easing.bezier(0.23, 1, 0.32, 1);

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function KeepItButton({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const { colors, radii } = useKeepItTheme();
  const scale = useSharedValue(1);
  const isDisabled = disabled || loading;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  const handlePressIn = () => {
    if (isDisabled) return;
    scale.set(withTiming(0.97, { duration: 120, easing: PRESS_EASING }));
  };

  const handlePressOut = () => {
    scale.set(withTiming(1, { duration: 150, easing: PRESS_EASING }));
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

  const borderColor =
    variant === 'secondary'
      ? colors.border
      : variant === 'danger'
        ? colors.danger
        : 'transparent';

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={[
        styles.buttonBase,
        {
          backgroundColor: bgByVariant,
          borderRadius: radii.pill,
          borderColor,
          borderWidth: variant === 'secondary' || variant === 'danger' ? 1 : 0,
          opacity: isDisabled ? 0.52 : 1,
        },
        animatedStyle,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={textByVariant} />
      ) : (
        <Text style={[styles.buttonText, { color: textByVariant }]}>{label}</Text>
      )}
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
    success: { bg: colors.accentSoft, border: colors.accent, fg: colors.ink },
  }[tone];

  return (
    <View
      accessibilityRole="alert"
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

export function DualFrameMark({ size = 56 }: { size?: number }) {
  const { colors } = useKeepItTheme();
  const pipW = Math.round(size * 0.42);
  const pipH = Math.round(size * 0.54);

  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: Math.round(size * 1.18),
        borderRadius: Math.round(size * 0.32),
        borderCurve: 'continuous',
        backgroundColor: colors.surface,
        borderWidth: 1.5,
        borderColor: colors.border,
        padding: Math.round(size * 0.12),
        justifyContent: 'space-between',
      }}>
      <View
        style={{
          width: pipW,
          height: pipH,
          borderRadius: Math.round(size * 0.18),
          borderCurve: 'continuous',
          backgroundColor: colors.accentSoft,
          borderWidth: 1.5,
          borderColor: colors.accent,
        }}
      />
      <View
        style={{
          alignSelf: 'flex-end',
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.accent,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  buttonBase: {
    minHeight: 50,
    paddingHorizontal: 22,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderCurve: 'continuous',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
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
    fontWeight: '500',
  },
});
