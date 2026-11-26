import { AccessibilityInfo, Platform } from 'react-native';

export type RovingKeyEvent = {
  key?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  preventDefault?: () => void;
};

/**
 * Arrow/Home/End keyboard navigation helper for radiogroup, tablist, and segmented controls on Web.
 */
export function handleRovingKeyDown(
  event: unknown,
  currentIndex: number,
  total: number,
  onSelect: (nextIndex: number) => void
): void {
  if (total <= 1 || !event || typeof event !== 'object') return;
  const e = event as RovingKeyEvent;
  if (e.altKey || e.ctrlKey || e.metaKey) return;

  let nextIndex: number | null = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    nextIndex = (currentIndex + 1) % total;
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    nextIndex = (currentIndex - 1 + total) % total;
  } else if (e.key === 'Home') {
    nextIndex = 0;
  } else if (e.key === 'End') {
    nextIndex = total - 1;
  }

  if (nextIndex !== null && nextIndex !== currentIndex) {
    e.preventDefault?.();
    onSelect(nextIndex);
  }
}

/**
 * Announces status updates politely to VoiceOver/TalkBack on native and #keepit-a11y-announcer on Web.
 */
export function announcePolite(message: string): void {
  const trimmed = message.trim();
  if (!trimmed) return;

  if (Platform.OS !== 'web') {
    try {
      AccessibilityInfo.announceForAccessibility(trimmed);
    } catch {
      // Ignore if ScreenReader service is inactive
    }
    return;
  }

  if (typeof document === 'undefined') return;
  const announcer = document.getElementById('keepit-a11y-announcer');
  if (!announcer) return;

  announcer.textContent = '';
  const schedule =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 16);
  schedule(() => {
    announcer.textContent = trimmed;
  });
}
