import { useEffect, useState } from 'react';

export type PromptWindowPhase = 'upcoming' | 'live' | 'late';

export interface CountdownSnapshot {
  phase: PromptWindowPhase;
  secondsRemaining: number;
  secondsOverdue: number;
  formattedTimer: string;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function computeSnapshot(triggerAtIso: string | null | undefined): CountdownSnapshot {
  if (!triggerAtIso) {
    return {
      phase: 'upcoming',
      secondsRemaining: 120,
      secondsOverdue: 0,
      formattedTimer: '02:00',
    };
  }

  const elapsedSec = Math.floor((Date.now() - new Date(triggerAtIso).getTime()) / 1000);

  if (elapsedSec < 0) {
    const untilOpen = Math.abs(elapsedSec);
    const mins = Math.floor(untilOpen / 60);
    const secs = untilOpen % 60;
    return {
      phase: 'upcoming',
      secondsRemaining: 120,
      secondsOverdue: 0,
      formattedTimer: `${pad2(mins)}:${pad2(secs)}`,
    };
  }

  if (elapsedSec <= 120) {
    const rem = 120 - elapsedSec;
    const mins = Math.floor(rem / 60);
    const secs = rem % 60;
    return {
      phase: 'live',
      secondsRemaining: rem,
      secondsOverdue: 0,
      formattedTimer: `${pad2(mins)}:${pad2(secs)}`,
    };
  }

  const overdue = elapsedSec - 120;
  const mins = Math.floor(overdue / 60);
  const secs = overdue % 60;
  return {
    phase: 'late',
    secondsRemaining: 0,
    secondsOverdue: overdue,
    formattedTimer: `+${pad2(mins)}:${pad2(secs)} late`,
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

  void nowMs;
  return computeSnapshot(triggerAtIso);
}
