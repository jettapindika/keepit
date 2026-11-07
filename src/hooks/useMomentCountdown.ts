import { useEffect, useState } from 'react';

import { PROMPT_WINDOW_SECONDS } from '@/types/database';

export type PromptWindowPhase = 'upcoming' | 'live' | 'late';

export interface CountdownSnapshot {
  phase: PromptWindowPhase;
  secondsRemaining: number;
  secondsOverdue: number;
  formattedTimer: string;
  currentTimeShort: string;
}

function formatDurationClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function computeCountdownSnapshot(
  triggerAtIso: string | null | undefined,
  nowMs = Date.now()
): CountdownSnapshot {
  const currentTimeShort = new Date(nowMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (!triggerAtIso) {
    return {
      phase: 'upcoming',
      secondsRemaining: PROMPT_WINDOW_SECONDS,
      secondsOverdue: 0,
      formattedTimer: '05:00',
      currentTimeShort,
    };
  }

  const triggerMs = new Date(triggerAtIso).getTime();
  if (Number.isNaN(triggerMs)) {
    return {
      phase: 'upcoming',
      secondsRemaining: PROMPT_WINDOW_SECONDS,
      secondsOverdue: 0,
      formattedTimer: '05:00',
      currentTimeShort,
    };
  }

  const elapsedSec = Math.floor((nowMs - triggerMs) / 1000);

  if (elapsedSec < 0) {
    const untilOpen = Math.abs(elapsedSec);
    return {
      phase: 'upcoming',
      secondsRemaining: PROMPT_WINDOW_SECONDS,
      secondsOverdue: 0,
      formattedTimer: formatDurationClock(untilOpen),
      currentTimeShort,
    };
  }

  if (elapsedSec <= PROMPT_WINDOW_SECONDS) {
    const rem = PROMPT_WINDOW_SECONDS - elapsedSec;
    const mins = Math.floor(rem / 60);
    const secs = rem % 60;
    return {
      phase: 'live',
      secondsRemaining: rem,
      secondsOverdue: 0,
      formattedTimer: `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`,
      currentTimeShort,
    };
  }

  const overdue = elapsedSec - PROMPT_WINDOW_SECONDS;
  const totalMins = Math.max(1, Math.round(overdue / 60));
  const hrs = Math.floor(totalMins / 60);
  const remMins = totalMins % 60;
  const overdueLabel =
    hrs > 0
      ? remMins > 0
        ? `${hrs}h ${remMins}m after prompt`
        : `${hrs}h after prompt`
      : `${totalMins}m after prompt`;

  return {
    phase: 'late',
    secondsRemaining: 0,
    secondsOverdue: overdue,
    formattedTimer: overdueLabel,
    currentTimeShort,
  };
}
export function useMomentCountdown(triggerAtIso: string | null | undefined): CountdownSnapshot {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!triggerAtIso) return;
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [triggerAtIso]);

  return computeCountdownSnapshot(triggerAtIso, nowMs);
}
