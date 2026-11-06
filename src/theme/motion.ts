// src/theme/motion.ts
// Exact React Native Reanimated 4 port of realidkroo/Mochy-Music motion primitives:
// - AppMotion.kt (speed multiplier 0.5x..2x + enabled gate)
// - TouchFeedback.kt (pressBounce: stiffness 1600 squish -> dampingRatio 0.38, stiffness 520 rebound)
// - AppNavigation.kt (NavHighlightLead stiffness 700 / NavHighlightTrail stiffness 320 @ dampingRatio 0.82)
// - RevealOnAppear.kt (RevealEasing bezier(0.2, 0, 0, 1), 520ms fade+20dp slide, 60ms cascade up to 6 steps)
// - LibraryDownloadIcon.kt / HeroCarousel.kt (PopIn: dampingRatio 0.45, stiffness 420)

import { Easing, WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';

export const ANIMATION_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type AnimationSpeed = (typeof ANIMATION_SPEEDS)[number];

// Mochy-Music CubicBezierEasing curves
export const MOCHY_REVEAL_EASING = Easing.bezier(0.2, 0, 0, 1); // RevealOnAppear.kt:44
export const MOCHY_CLOSE_EASING = Easing.bezier(0.4, 0, 0.1, 1); // ContainerTransform.kt:54
export const MOCHY_SHEET_EASING = Easing.bezier(0.57, 0.53, 0, 1); // SearchDesign.kt:112 / MenuSheet.kt:70
export const MOCHY_HERO_EASING = Easing.bezier(0.32, 0, 0.15, 1); // HeroCarousel.kt:163

/**
 * Converts Android Compose `spring(dampingRatio, stiffness, mass=1)` into Reanimated 4 physics config.
 * Critical damping c = 2 * sqrt(k * m); actual damping = dampingRatio * 2 * sqrt(stiffness).
 */
export function composeSpring(
  dampingRatio: number,
  stiffness: number,
  speedMultiplier = 1
): WithSpringConfig {
  const scaledStiffness = stiffness * Math.max(0.25, speedMultiplier * speedMultiplier);
  const damping = dampingRatio * 2 * Math.sqrt(scaledStiffness);
  return {
    stiffness: scaledStiffness,
    damping,
    mass: 1,
    overshootClamping: dampingRatio >= 1,
  };
}

export function mochyTiming(
  durationMs: number,
  easing = MOCHY_REVEAL_EASING,
  motionEnabled = true,
  speedMultiplier = 1
): WithTimingConfig {
  if (!motionEnabled) {
    return { duration: 0, easing: Easing.linear };
  }
  const scaled = Math.max(16, Math.round(durationMs / Math.max(0.25, speedMultiplier)));
  return {
    duration: scaled,
    easing,
  };
}

// Named Mochy-Music spring presets
export const MOCHY_SPRINGS = {
  // TouchFeedback.kt:126 - instant finger squish
  pressIn: (speed = 1) => composeSpring(1.0, 1600, speed),
  // TouchFeedback.kt:133 - bouncy release overshoot
  pressRelease: (speed = 1) => composeSpring(0.38, 520, speed),
  // ButtonStyles.kt:228 - pill squish/expand
  pillPress: (speed = 1) => composeSpring(0.6, 700, speed),
  // Press3D.kt:27 - 3D card tilt spring
  tilt3D: (speed = 1) => composeSpring(1.0, 420, speed),
  // AppNavigation.kt:277-278 - stretching tab pill lead & trail
  navLead: (speed = 1) => composeSpring(0.82, 700, speed),
  navTrail: (speed = 1) => composeSpring(0.82, 320, speed),
  // LibraryDownloadIcon.kt:58 - badge / PIP / nudge pop-in
  popIn: (speed = 1) => composeSpring(0.45, 420, speed),
  // PopupSheet.kt:291 - smooth non-bouncy sheet settle
  popupSheet: (speed = 1) => composeSpring(1.0, 220, speed),
} as const;

export function formatAnimationSpeedLabel(speed: number): string {
  return `${Number.isInteger(speed) ? speed.toFixed(0) : speed}x`;
}
