import { MomentRecord, StreakDayNode, StreakRecord } from '@/types/database';

export const MAX_GRACE_SHIELDS = 2;

export interface MilestoneChapter {
  days: number;
  chapterRoman: string;
  title: string;
  subtitle: string;
  stampCode: string;
  grantsShield: boolean;
}

export const STREAK_MILESTONES: readonly MilestoneChapter[] = [
  {
    days: 3,
    chapterRoman: 'I',
    title: 'Spark',
    subtitle: 'Three consecutive days in sync.',
    stampCode: 'SPARK',
    grantsShield: false,
  },
  {
    days: 7,
    chapterRoman: 'II',
    title: 'Weekly Ritual',
    subtitle: 'A full week together. Unlocks +1 Grace Shield.',
    stampCode: 'WEEKLY RITUAL',
    grantsShield: true,
  },
  {
    days: 14,
    chapterRoman: 'III',
    title: 'Fortnight',
    subtitle: 'Two weeks of shared daily Moments.',
    stampCode: 'FORTNIGHT',
    grantsShield: true,
  },
  {
    days: 30,
    chapterRoman: 'IV',
    title: 'Archive Edition',
    subtitle: 'Thirty days of two-lens memories.',
    stampCode: 'ARCHIVE EDITION',
    grantsShield: true,
  },
  {
    days: 60,
    chapterRoman: 'V',
    title: 'Two-Month Bond',
    subtitle: 'Sixty days of continuous check-ins.',
    stampCode: 'TWO-MONTH BOND',
    grantsShield: true,
  },
  {
    days: 100,
    chapterRoman: 'VI',
    title: 'Century Club',
    subtitle: 'One hundred days locked in together.',
    stampCode: 'CENTURY EDITION',
    grantsShield: true,
  },
] as const;

export interface CollageStampOption {
  id: string;
  label: string;
  watermarkText: string;
  requiredDays: number;
}

export function getUnlockedMilestones(longestOrCurrentCount: number, existing?: number[]): number[] {
  const set = new Set<number>(existing ?? []);
  for (const m of STREAK_MILESTONES) {
    if (longestOrCurrentCount >= m.days) {
      set.add(m.days);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

export function getCurrentAndNextChapter(streakCount: number): {
  current: MilestoneChapter | null;
  next: MilestoneChapter | null;
  progressRatio: number;
  daysRemaining: number;
} {
  let current: MilestoneChapter | null = null;
  let next: MilestoneChapter | null = null;

  for (const m of STREAK_MILESTONES) {
    if (streakCount >= m.days) {
      current = m;
    } else if (!next) {
      next = m;
    }
  }

  if (!next) {
    return {
      current,
      next: null,
      progressRatio: 1,
      daysRemaining: 0,
    };
  }

  const prevDays = current ? current.days : 0;
  const span = Math.max(1, next.days - prevDays);
  const covered = Math.max(0, streakCount - prevDays);
  const progressRatio = Math.min(1, Math.max(0, covered / span));

  return {
    current,
    next,
    progressRatio,
    daysRemaining: Math.max(0, next.days - streakCount),
  };
}

export function getAvailableCollageStamps(
  streakCount: number,
  longestCount = streakCount
): CollageStampOption[] {
  const best = Math.max(streakCount, longestCount);
  const displayDay = Math.max(1, streakCount);
  const options: CollageStampOption[] = [
    {
      id: 'classic',
      label: 'Classic #keepit',
      watermarkText: streakCount > 0 ? `#keepit · DAY ${displayDay}` : '#keepit',
      requiredDays: 0,
    },
  ];

  for (const m of STREAK_MILESTONES) {
    if (best >= m.days) {
      options.push({
        id: `milestone-${m.days}`,
        label: `${m.title} (${m.days}d)`,
        watermarkText: `#keepit · ${m.stampCode} · DAY ${displayDay}`,
        requiredDays: m.days,
      });
    }
  }

  return options;
}

function addDaysIso(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = Date.UTC(y, (m || 1) - 1, (d || 1) + deltaDays);
  return new Date(utc).toISOString().slice(0, 10);
}

const WEEKDAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

function weekdayLetter(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dayIdx = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0)).getUTCDay();
  return WEEKDAY_SHORT[dayIdx] ?? 'D';
}

/**
 * Advances a couple's streak when both partners have posted on `todayDate`.
 * Automatically applies a Grace Shield if exactly 1 day was missed (`twoDaysAgo`),
 * grants +1 Grace Shield (up to MAX_GRACE_SHIELDS) on every 7th streak day,
 * and increments `golden_sync_count` when both partners posted on time.
 */
export function advanceStreakOnDualPost(params: {
  previous: StreakRecord | null | undefined;
  coupleId: string;
  todayDate: string;
  bothOnTime: boolean;
  nowIso?: string;
}): StreakRecord {
  const prev: StreakRecord = params.previous ?? {
    couple_id: params.coupleId,
    current_count: 0,
    longest_count: 0,
    last_completed_date: null,
    grace_shields: 1,
    shield_used_dates: [],
    golden_sync_count: 0,
    unlocked_milestones: [],
  };

  if (prev.last_completed_date === params.todayDate) {
    const unlocked = getUnlockedMilestones(
      Math.max(prev.current_count, prev.longest_count),
      prev.unlocked_milestones
    );
    return {
      ...prev,
      unlocked_milestones: unlocked,
    };
  }

  const yesterday = addDaysIso(params.todayDate, -1);
  const twoDaysAgo = addDaysIso(params.todayDate, -2);
  let shields = typeof prev.grace_shields === 'number' ? prev.grace_shields : 1;
  const usedDates = Array.from(new Set(prev.shield_used_dates ?? []));

  let nextCount = 1;
  if (prev.last_completed_date === yesterday) {
    nextCount = prev.current_count + 1;
  } else if (prev.last_completed_date === twoDaysAgo && shields > 0 && prev.current_count > 0) {
    shields = Math.max(0, shields - 1);
    if (!usedDates.includes(yesterday)) {
      usedDates.push(yesterday);
    }
    nextCount = prev.current_count + 1;
  } else {
    nextCount = 1;
  }

  // Every 7th consecutive day awards +1 Grace Shield up to MAX_GRACE_SHIELDS
  if (nextCount > 0 && nextCount % 7 === 0) {
    shields = Math.min(MAX_GRACE_SHIELDS, shields + 1);
  }

  const nextLongest = Math.max(prev.longest_count ?? 0, nextCount);
  const nextGolden = (prev.golden_sync_count ?? 0) + (params.bothOnTime ? 1 : 0);
  const unlocked = getUnlockedMilestones(nextLongest, prev.unlocked_milestones);

  return {
    couple_id: params.coupleId,
    current_count: nextCount,
    longest_count: nextLongest,
    last_completed_date: params.todayDate,
    updated_at: params.nowIso ?? new Date().toISOString(),
    grace_shields: shields,
    shield_used_dates: usedDates.slice(-14),
    golden_sync_count: nextGolden,
    unlocked_milestones: unlocked,
  };
}

/**
 * Normalizes a StreakRecord and builds the 7-day visual chain ending at `todayDate`.
 * Also handles automatic Grace Shield bridging if yesterday was missed and the couple has a shield ready.
 */
export function enrichStreakWithRecentChain(params: {
  streak: StreakRecord | null | undefined;
  coupleId: string;
  userId: string;
  todayDate: string;
  moments: Iterable<MomentRecord>;
}): StreakRecord {
  const base: StreakRecord = params.streak ?? {
    couple_id: params.coupleId,
    current_count: 0,
    longest_count: 0,
    last_completed_date: null,
  };

  const yesterday = addDaysIso(params.todayDate, -1);
  const twoDaysAgo = addDaysIso(params.todayDate, -2);
  const shieldSet = new Set<string>(base.shield_used_dates ?? []);

  // Group couple moments by local date (YYYY-MM-DD)
  const byDate = new Map<
    string,
    { mine: MomentRecord | null; partner: MomentRecord | null }
  >();

  let computedGoldenTotal = 0;
  for (const m of params.moments) {
    if (!m || m.couple_id !== params.coupleId || m.user_id.startsWith('friend_')) continue;
    const rawDate = (m.posted_at || m.captured_at || '').slice(0, 10);
    if (!rawDate) continue;
    const entry = byDate.get(rawDate) ?? { mine: null, partner: null };
    if (m.user_id === params.userId) {
      if (!entry.mine || m.posted_at > entry.mine.posted_at) entry.mine = m;
    } else {
      if (!entry.partner || m.posted_at > entry.partner.posted_at) entry.partner = m;
    }
    byDate.set(rawDate, entry);
  }

  for (const [, pair] of byDate.entries()) {
    if (pair.mine && pair.partner && !pair.mine.is_late && !pair.partner.is_late) {
      computedGoldenTotal += 1;
    }
  }

  let effectiveCount = base.current_count ?? 0;
  let effectiveShields =
    typeof base.grace_shields === 'number'
      ? base.grace_shields
      : effectiveCount >= 3
        ? 1
        : 0;

  // If yesterday was missed (last_completed_date === twoDaysAgo) and shield available, preview bridge on yesterday
  if (
    base.last_completed_date === twoDaysAgo &&
    effectiveCount > 0 &&
    effectiveShields > 0 &&
    !shieldSet.has(yesterday)
  ) {
    shieldSet.add(yesterday);
  }

  const recentChain: StreakDayNode[] = [];
  for (let offset = -6; offset <= 0; offset += 1) {
    const dateStr = addDaysIso(params.todayDate, offset);
    const pair = byDate.get(dateStr);
    const myPosted = Boolean(pair?.mine);
    const partnerPosted = Boolean(pair?.partner);
    const bothPosted = myPosted && partnerPosted;
    const goldenSync = Boolean(
      bothPosted && pair?.mine && !pair.mine.is_late && pair?.partner && !pair.partner.is_late
    );

    // Also synthesize historic streak days when local moments were seeded or server-only
    const withinRun =
      effectiveCount > 0 &&
      base.last_completed_date &&
      dateStr <= base.last_completed_date &&
      dateStr > addDaysIso(base.last_completed_date, -effectiveCount);

    let state: StreakDayNode['state'] = 'missed';
    if (shieldSet.has(dateStr)) {
      state = 'shield';
    } else if (goldenSync) {
      state = 'golden';
    } else if (bothPosted || withinRun) {
      state = 'synced';
    } else if (myPosted || partnerPosted) {
      state = 'half';
    }

    recentChain.push({
      date: dateStr,
      dayLabel: weekdayLetter(dateStr),
      state,
      myPosted: myPosted || Boolean(withinRun),
      partnerPosted: partnerPosted || Boolean(withinRun),
      goldenSync,
    });
  }

  const longest = Math.max(base.longest_count ?? 0, effectiveCount);
  const goldenCount = Math.max(base.golden_sync_count ?? 0, computedGoldenTotal);

  return {
    ...base,
    couple_id: params.coupleId,
    current_count: effectiveCount,
    longest_count: longest,
    grace_shields: effectiveShields,
    shield_used_dates: Array.from(shieldSet),
    golden_sync_count: goldenCount,
    unlocked_milestones: getUnlockedMilestones(longest, base.unlocked_milestones),
    recent_chain: recentChain,
  };
}
