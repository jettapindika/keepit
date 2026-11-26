import React, { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';

import { announcePolite } from '@/utils/a11y';

const openModalStack: symbol[] = [];

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]:not([aria-disabled="true"])',
  '[role="tab"]:not([aria-disabled="true"])',
  '[role="radio"]:not([aria-disabled="true"])',
  '[role="switch"]:not([aria-disabled="true"])',
].join(', ');

/**
 * Accessible dialog hook:
 * - Announces dialog opening politely on native screen readers
 * - Captures previous active element and restores focus on close
 * - Traps Tab / Shift+Tab inside the topmost dialog on Web and handles Escape
 */
export function useAccessibleModal({
  visible,
  onClose,
  disabled = false,
  title,
}: {
  visible: boolean;
  onClose: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const dialogRef = useRef<React.ComponentRef<typeof View>>(null);
  const onCloseRef = useRef(onClose);
  const disabledRef = useRef(disabled);
  const wasVisibleRef = useRef(false);
  onCloseRef.current = onClose;
  disabledRef.current = disabled;

  useEffect(() => {
    if (visible && !wasVisibleRef.current && title) {
      announcePolite(title);
    }
    wasVisibleRef.current = visible;
  }, [visible, title]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof document === 'undefined') return;

    const modalToken = Symbol('keepit-modal');
    openModalStack.push(modalToken);
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusFirst = () => {
      const root = dialogRef.current as unknown as HTMLElement | null;
      if (!root || typeof root.querySelectorAll !== 'function') return;
      if (root.contains(document.activeElement)) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (focusable[0]) {
        focusable[0].focus();
      } else {
        if (!root.hasAttribute('tabindex')) {
          root.setAttribute('tabindex', '-1');
        }
        root.focus();
      }
    };

    const timer = setTimeout(focusFirst, 20);

    const onKeyDown = (event: KeyboardEvent) => {
      if (openModalStack[openModalStack.length - 1] !== modalToken) return;

      if (event.key === 'Escape') {
        if (!disabledRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (event.key !== 'Tab') return;
      const root = dialogRef.current as unknown as HTMLElement | null;
      if (!root || typeof root.querySelectorAll !== 'function') return;

      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      const idx = openModalStack.lastIndexOf(modalToken);
      if (idx !== -1) {
        openModalStack.splice(idx, 1);
      }
      if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
    };
  }, [visible]);

  const dialogA11yProps =
    Platform.OS === 'web'
      ? ({
          accessibilityViewIsModal: true,
          role: 'dialog',
          'aria-modal': true,
        } as Record<string, unknown>)
      : ({
          accessibilityViewIsModal: true,
        } as Record<string, unknown>);

  return { dialogRef, dialogA11yProps };
}
