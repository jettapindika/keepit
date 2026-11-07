import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useSessionStore } from '@/store/sessionStore';

export function useAppMotion() {
  const initiallyReduced = useReducedMotion();
  const [systemReduced, setSystemReduced] = useState(() =>
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : initiallyReduced,
  );
  const preference = useSessionStore((state) => state.motionEnabled);
  const speed = useSessionStore((state) => state.motionSpeed);

  useEffect(() => {
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduced);
    if (Platform.OS !== 'web') {
      let active = true;
      void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
        if (active) setSystemReduced(enabled);
      });
      return () => { active = false; subscription.remove(); };
    }

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReduced(media.matches);
    media.addEventListener('change', update);
    return () => {
      subscription.remove();
      media.removeEventListener('change', update);
    };
  }, []);

  return { enabled: preference && !systemReduced, reduced: !preference || systemReduced, speed };
}
