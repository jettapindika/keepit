import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchMonthMemories } from '@/api/extras';
import { DEFAULT_WARM_BLURHASH } from '@/api/moments';
import { requestRealtimeCatchUpSync } from '@/api/realtimeSync';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { MonthlyRecapModal } from '@/components/memories/MonthlyRecapModal';
import { TogetherCollageCard } from '@/components/memories/TogetherCollageCard';
import { DualMomentCard } from '@/components/moment/MomentCards';
import { StreakMilestoneShelf } from '@/components/streak/SharedPulseCard';
import { BentoTile } from '@/components/ui/BentoPrimitives';
import { InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { AppPressable, AppTextInput, EmptyState, PageHeader } from '@/components/ui/ScreenKit';
import { useSessionStore } from '@/store/sessionStore';
import { APP_LAYOUT, useKeepItTheme } from '@/theme/tokens';
import { announcePolite } from '@/utils/a11y';

const WEEKDAYS = [
  { key: 'Sun', short: 'S' },
  { key: 'Mon', short: 'M' },
  { key: 'Tue', short: 'T' },
  { key: 'Wed', short: 'W' },
  { key: 'Thu', short: 'T' },
  { key: 'Fri', short: 'F' },
  { key: 'Sat', short: 'S' },
] as const;

const fullDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

export default function MemoriesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors, radii, type } = useKeepItTheme();
  const insets = useSafeAreaInsets();
  const user = useSessionStore((s) => s.user);
  const partner = useSessionStore((s) => s.partner);
  const couple = useSessionStore((s) => s.couple);
  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const [cursorYear, setCursorYear] = useState(currentYear);
  const [cursorMonth, setCursorMonth] = useState(currentMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [memoryFilter, setMemoryFilter] = useState<'all' | 'together'>('all');
  const [memoryQuery, setMemoryQuery] = useState('');
  const [recapOpen, setRecapOpen] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const calendarCellRefs = useRef<Record<string, View | null>>({});
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const isPartnerPaired = Boolean(partner && couple && !couple.id.startsWith('solo_'));
  const myName = user?.display_name ?? 'You';
  const partnerName = partner?.display_name ?? 'Partner';

  const memoriesQuery = useQuery({
    queryKey: ['month-memories', couple?.id, user?.id, cursorYear, cursorMonth],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () =>
      fetchMonthMemories({
        coupleId: couple!.id,
        userId: user!.id,
        year: cursorYear,
        month: cursorMonth,
      }),
  });

  useEffect(() => {
    const client = supabase;
    if (!couple?.id || !isSupabaseConfigured || !client) return;
    const channel = client
      .channel(`memories:${couple.id}:${Date.now().toString(36)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'moments', filter: `couple_id=eq.${couple.id}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['month-memories', couple.id] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'streaks', filter: `couple_id=eq.${couple.id}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['month-memories', couple.id] });
        }
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [couple?.id, queryClient]);

  const days = useMemo(
    () => (memoriesQuery.data?.days ?? []).filter((day) => day.mine || day.partner),
    [memoriesQuery.data?.days]
  );
  const normalizedMemoryQuery = memoryQuery.trim().toLowerCase();
  const filteredDays = useMemo(() => {
    return days.filter((day) => {
      if (memoryFilter === 'together' && !(day.mine && day.partner)) return false;
      if (!normalizedMemoryQuery) return true;
      return [day.mine, day.partner].some((m) => {
        if (!m) return false;
        if ((m.caption ?? '').toLowerCase().includes(normalizedMemoryQuery)) return true;
        if ((m.location_label ?? '').toLowerCase().includes(normalizedMemoryQuery)) return true;
        if ((m.music_track?.title ?? '').toLowerCase().includes(normalizedMemoryQuery)) return true;
        if ((m.music_track?.artist ?? '').toLowerCase().includes(normalizedMemoryQuery)) return true;
        return (m.tagged_users ?? []).some(
          (u) =>
            u.displayName.toLowerCase().includes(normalizedMemoryQuery) ||
            u.username.toLowerCase().includes(normalizedMemoryQuery)
        );
      });
    });
  }, [days, memoryFilter, normalizedMemoryQuery]);
  const streak = memoriesQuery.data?.streak ?? null;
  const dayMap = useMemo(
    () => new Map(filteredDays.map((day) => [day.prompt_date, day])),
    [filteredDays]
  );
  const effectiveDate =
    selectedDate && dayMap.has(selectedDate) ? selectedDate : filteredDays[0]?.prompt_date ?? null;
  const selectedRecord = effectiveDate ? dayMap.get(effectiveDate) : null;
  const activeDayIdx = effectiveDate
    ? filteredDays.findIndex((day) => day.prompt_date === effectiveDate)
    : -1;
  const stepSelectedDay = (delta: -1 | 1) => {
    if (activeDayIdx < 0) return;
    const next = filteredDays[activeDayIdx + delta];
    if (!next) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setSelectedDate(next.prompt_date);
    announcePolite(`Selected ${fullDate(next.prompt_date)}.`);
  };
  const monthLabel = new Date(Date.UTC(cursorYear, cursorMonth - 1, 15)).toLocaleDateString(
    undefined,
    { month: 'long', year: 'numeric', timeZone: 'UTC' }
  );
  const atCurrentMonth =
    cursorYear > currentYear || (cursorYear === currentYear && cursorMonth >= currentMonth);

  const stepMonth = (delta: -1 | 1) => {
    if (delta === 1 && atCurrentMonth) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    const next = new Date(Date.UTC(cursorYear, cursorMonth - 1 + delta, 15));
    setSelectedDate(null);
    setCursorYear(next.getUTCFullYear());
    setCursorMonth(next.getUTCMonth() + 1);
  };

  const jumpToCurrentMonth = () => {
    if (atCurrentMonth) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setSelectedDate(null);
    setCursorYear(currentYear);
    setCursorMonth(currentMonth);
  };

  const calendarWeeks = useMemo(() => {
    const cells: ({ day: number; date: string } | null)[] = Array.from(
      { length: new Date(Date.UTC(cursorYear, cursorMonth - 1, 1)).getUTCDay() },
      () => null
    );
    const prefix = `${cursorYear}-${String(cursorMonth).padStart(2, '0')}-`;
    for (
      let day = 1;
      day <= new Date(Date.UTC(cursorYear, cursorMonth, 0)).getUTCDate();
      day += 1
    ) {
      cells.push({ day, date: `${prefix}${String(day).padStart(2, '0')}` });
    }
    while (cells.length % 7) cells.push(null);
    const weeks: (typeof cells)[] = [];
    for (let index = 0; index < cells.length; index += 7) {
      weeks.push(cells.slice(index, index + 7));
    }
    return weeks;
  }, [cursorMonth, cursorYear]);

  const togetherCount = days.filter((day) => day.mine && day.partner).length;
  const singleMoment = selectedRecord?.mine ?? selectedRecord?.partner;
  const singleName = selectedRecord?.mine ? myName : partnerName;
  const currentStreakValue = memoriesQuery.isLoading
    ? '…'
    : memoriesQuery.isError && !streak
      ? '?'
      : streak?.current_count ?? 0;
  const bestStreakValue = memoriesQuery.isLoading
    ? '…'
    : memoriesQuery.isError && !streak
      ? '?'
      : streak?.longest_count ?? 0;
  const handlePullRefresh = async () => {
    if (pullRefreshing) return;
    setPullRefreshing(true);
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync().catch(() => {});
    }
    try {
      await Promise.all([
        useSessionStore.getState().refreshPairing(),
        requestRealtimeCatchUpSync({ userId: user?.id, coupleId: couple?.id }),
      ]);
      const { promise: delayPromise, resolve: resolveDelay } = Promise.withResolvers<void>();
      setTimeout(resolveDelay, 200);
      await delayPromise;
      await Promise.all([
        memoriesQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['today-moment', couple?.id] }),
      ]);
    } finally {
      if (isMountedRef.current) setPullRefreshing(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        alwaysBounceVertical
        overScrollMode="always"
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => void handlePullRefresh()}
            tintColor={colors.ink}
            colors={[colors.ink]}
            progressBackgroundColor={colors.surfaceElevated}
          />
        }
        contentContainerStyle={[
          styles.content,
          { paddingBottom: APP_LAYOUT.tabBarClearance + insets.bottom },
        ]}>
        <PageHeader
          title="Memories"
          subtitle={isPartnerPaired ? `${myName} & ${partnerName}` : myName}
          action={
            <View style={styles.headerBadges}>
              <View
                accessible
                accessibilityLabel={`Current streak: ${currentStreakValue} days`}
                style={[
                  styles.statPill,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.pill,
                  },
                ]}>
                <SymbolView
                  name={{
                    ios: 'flame.fill',
                    android: 'local_fire_department',
                    web: 'local_fire_department',
                  }}
                  tintColor={colors.ink}
                  size={16}
                />
                <Text style={[styles.statNumber, { color: colors.ink, fontFamily: type.fontSans }]}>
                  {currentStreakValue}
                </Text>
                <Text style={[styles.statLabel, { color: colors.inkMuted }]}>Streak</Text>
              </View>
              <View
                accessible
                accessibilityLabel={`Best streak: ${bestStreakValue} days`}
                style={[
                  styles.statPill,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.pill,
                  },
                ]}>
                <SymbolView
                  name={{ ios: 'trophy.fill', android: 'emoji_events', web: 'emoji_events' }}
                  tintColor={colors.inkMuted}
                  size={16}
                />
                <Text
                  style={[styles.statNumber, { color: colors.inkMuted, fontFamily: type.fontSans }]}>
                  {bestStreakValue}
                </Text>
                <Text style={[styles.statLabel, { color: colors.inkMuted }]}>Best</Text>
              </View>
              <AppPressable
                accessibilityRole="button"
                accessibilityLabel={`Open monthly recap (${togetherCount} Together collages)`}
                accessibilityShowsLargeContentViewer
                accessibilityLargeContentTitle="Monthly Recap"
                disabled={!togetherCount || memoriesQuery.isLoading}
                onPress={() => setRecapOpen(true)}
                style={[
                  styles.recapIconBtn,
                  {
                    backgroundColor: colors.accent,
                    borderRadius: radii.pill,
                  },
                ]}>
                <SymbolView
                  name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
                  tintColor={colors.onAccent}
                  size={18}
                />
                <Text style={[styles.recapCountText, { color: colors.onAccent }]}>
                  Recap{togetherCount > 0 ? ` (${togetherCount})` : ''}
                </Text>
              </AppPressable>
            </View>
          }
        />
        <StreakMilestoneShelf streak={streak} />

        <View
          style={[
            styles.monthBar,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.card,
            },
          ]}>
          <AppPressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            accessibilityShowsLargeContentViewer
            accessibilityLargeContentTitle="Previous month"
            onPress={() => stepMonth(-1)}
            style={[
              styles.iconNavBtn,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.controlBorder,
                borderRadius: radii.input,
              },
            ]}>
            <SymbolView
              name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
              tintColor={colors.ink}
              size={20}
            />
          </AppPressable>

          <View style={styles.monthTitleWrap}>
            <SymbolView
              name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }}
              tintColor={colors.inkMuted}
              size={17}
            />
            <Text
              accessibilityRole="header"
              style={[styles.monthTitle, { color: colors.ink, fontFamily: type.fontSans }]}>
              {monthLabel}
            </Text>
          </View>

          <View style={styles.monthRightActions}>
            {!atCurrentMonth ? (
              <AppPressable
                accessibilityRole="button"
                accessibilityLabel="Jump to current month"
                accessibilityShowsLargeContentViewer
                accessibilityLargeContentTitle="Today"
                onPress={jumpToCurrentMonth}
                style={[
                  styles.iconNavBtn,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.controlBorder,
                    borderRadius: radii.input,
                  },
                ]}>
                <SymbolView
                  name={{ ios: 'clock.arrow.circlepath', android: 'today', web: 'today' }}
                  tintColor={colors.ink}
                  size={18}
                />
              </AppPressable>
            ) : null}
            <AppPressable
              accessibilityRole="button"
              accessibilityLabel="Next month"
              accessibilityShowsLargeContentViewer
              accessibilityLargeContentTitle="Next month"
              disabled={atCurrentMonth}
              onPress={() => stepMonth(1)}
              style={[
                styles.iconNavBtn,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.controlBorder,
                  borderRadius: radii.input,
                },
              ]}>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                tintColor={colors.ink}
                size={20}
              />
            </AppPressable>
          </View>
        </View>

        {memoriesQuery.isError ? (
          <View style={styles.stack}>
            <InlineNotice
              tone="error"
              message={
                memoriesQuery.error instanceof Error
                  ? memoriesQuery.error.message
                  : 'Could not load archived Moments for this month.'
              }
            />
            <KeepItButton
              label="Retry loading month"
              loading={memoriesQuery.isFetching}
              onPress={() => void memoriesQuery.refetch()}
            />
          </View>
        ) : null}

        {memoriesQuery.isLoading ? (
          <View accessibilityLiveRegion="polite" style={styles.loading}>
            <ActivityIndicator color={colors.ink} />
            <Text style={[styles.body, { color: colors.inkMuted }]}>
              Loading Moments for {monthLabel}…
            </Text>
          </View>
        ) : null}

        <BentoTile
          variant="spotlight"
          pattern="dots"
          radius={radii.card}
          style={styles.calendar}>
          <View style={styles.calendarGrid}>
            <View style={styles.week}>
              {WEEKDAYS.map((day) => (
                <View key={day.key} style={styles.cell}>
                  <Text
                    accessibilityLabel={day.key}
                    style={[styles.weekday, { color: colors.inkMuted }]}>
                    {day.short}
                  </Text>
                </View>
              ))}
            </View>
            {calendarWeeks.map((week, index) => (
              <View key={index} style={styles.week}>
                {week.map((cell, cellIndex) => {
                  if (!cell) return <View key={`blank-${cellIndex}`} style={styles.cell} />;
                  const record = dayMap.get(cell.date);
                  const count =
                    Number(Boolean(record?.mine)) + Number(Boolean(record?.partner));
                  const selected = effectiveDate === cell.date;
                  const thumbnail =
                    record?.mine?.back_photo_url ??
                    record?.mine?.back_photo_path ??
                    record?.partner?.back_photo_url ??
                    record?.partner?.back_photo_path;
                  const dotColor = thumbnail
                    ? '#FFFFFF'
                    : selected
                      ? '#FFFFFF'
                      : colors.blue400;

                  if (!count) {
                    return (
                      <View
                        key={cell.date}
                        style={[
                          styles.cell,
                          styles.day,
                          { backgroundColor: colors.canvas, borderColor: colors.border, borderRadius: 12 },
                        ]}>
                        <View style={styles.dateBadge}>
                          <Text style={[styles.dateNumber, { color: colors.inkMuted }]}>
                            {cell.day}
                          </Text>
                        </View>
                      </View>
                    );
                  }

                  return (
                    <AppPressable
                      key={cell.date}
                      ref={(el) => {
                        calendarCellRefs.current[cell.date] = el as View | null;
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${fullDate(cell.date)}, ${count} ${count === 1 ? 'person' : 'people'} posted`}
                      accessibilityState={{ selected }}
                      onPress={() => {
                        if (Platform.OS !== 'web') void Haptics.selectionAsync();
                        setSelectedDate(cell.date);
                        announcePolite(`Selected ${fullDate(cell.date)}.`);
                      }}
                      {...(Platform.OS === 'web'
                        ? ({
                            onKeyDown: (event: { key?: string; preventDefault?: () => void }) => {
                              const activeDates = filteredDays.map((d) => d.prompt_date).sort();
                              const pos = activeDates.indexOf(cell.date);
                              if (pos < 0) return;
                              let targetDate: string | undefined;
                              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                                targetDate = activeDates[Math.min(activeDates.length - 1, pos + 1)];
                              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                                targetDate = activeDates[Math.max(0, pos - 1)];
                              } else if (event.key === 'Home') {
                                targetDate = activeDates[0];
                              } else if (event.key === 'End') {
                                targetDate = activeDates[activeDates.length - 1];
                              }
                              if (targetDate && targetDate !== cell.date) {
                                event.preventDefault?.();
                                setSelectedDate(targetDate);
                                announcePolite(`Selected ${fullDate(targetDate)}.`);
                                (calendarCellRefs.current[targetDate] as unknown as { focus?: () => void } | null)?.focus?.();
                              }
                            },
                          } as Record<string, unknown>)
                        : {})}
                      style={[
                        styles.cell,
                        styles.day,
                        {
                          backgroundColor: selected ? colors.primary : colors.surfaceElevated,
                          borderColor: selected ? colors.blue300 : colors.controlBorder,
                          borderRadius: 12,
                        },
                      ]}>
                      {thumbnail ? (
                        <Image
                          source={{ uri: thumbnail }}
                          contentFit="cover"
                          style={styles.thumbnail}
                          accessible={false}
                        />
                      ) : null}
                      <View
                        style={[
                          styles.dateBadge,
                          thumbnail ? styles.dateBadgeOverPhoto : null,
                        ]}>
                        <Text
                          style={[
                            styles.dateNumber,
                            {
                              color: thumbnail || selected
                                ? '#FFFFFF'
                                : colors.ink,
                            },
                          ]}>
                          {cell.day}
                        </Text>
                        <View style={styles.dotsIndicatorRow}>
                          <View style={[styles.postDot, { backgroundColor: dotColor }]} />
                          {count > 1 ? (
                            <View style={[styles.postDot, { backgroundColor: dotColor }]} />
                          ) : null}
                        </View>
                      </View>
                    </AppPressable>
                  );
                })}
              </View>
            ))}
          </View>

          <View style={[styles.legendBar, { borderTopColor: colors.border }]}>
            <View
              accessible
              accessibilityLabel="Single dot means one person posted"
              style={styles.legendItem}>
              <View style={styles.dotsIndicatorRow}>
                <View style={[styles.legendDot, { backgroundColor: colors.inkMuted }]} />
              </View>
              <SymbolView
                name={{ ios: 'person.fill', android: 'person', web: 'person' }}
                tintColor={colors.inkMuted}
                size={14}
              />
              <Text style={[styles.legendText, { color: colors.inkMuted }]}>One posted</Text>
            </View>
            <View
              accessible
              accessibilityLabel="Two dots means both posted a Together collage"
              style={styles.legendItem}>
              <View style={styles.dotsIndicatorRow}>
                <View style={[styles.legendDot, { backgroundColor: colors.ink }]} />
                <View style={[styles.legendDot, { backgroundColor: colors.ink }]} />
              </View>
              <SymbolView
                name={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
                tintColor={colors.ink}
                size={15}
              />
              <Text style={[styles.legendText, { color: colors.ink }]}>
                Both posted ({togetherCount})
              </Text>
            </View>
          </View>
        </BentoTile>

        {!memoriesQuery.isLoading && !memoriesQuery.isError && days.length > 0 ? (
          <View style={styles.filterSearchWrap}>
            <View accessibilityRole="tablist" style={styles.filterPillsRow}>
              {(
                [
                  { key: 'all', label: `All (${days.length})` },
                  { key: 'together', label: `Together (${togetherCount})` },
                ] as const
              ).map((opt) => {
                const selected = memoryFilter === opt.key;
                return (
                  <AppPressable
                    key={opt.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Filter memories: ${opt.label}`}
                    onPress={() => {
                      setMemoryFilter(opt.key);
                      announcePolite(`Filtered to ${opt.label}.`);
                    }}
                    style={[
                      styles.filterChipBtn,
                      {
                        backgroundColor: selected ? colors.primary : colors.surface,
                        borderColor: selected ? colors.primary : colors.border,
                        borderRadius: radii.pill,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.filterChipText,
                        { color: selected ? colors.onAccent : colors.ink },
                      ]}>
                      {opt.label}
                    </Text>
                  </AppPressable>
                );
              })}
            </View>
            <View style={styles.searchBarRow}>
              <AppTextInput
                accessibilityLabel="Search archived Moments by caption, place, song, or friend tag"
                value={memoryQuery}
                onChangeText={setMemoryQuery}
                placeholder="Search captions, places, songs, tags…"
                placeholderTextColor={colors.placeholder}
                returnKeyType="search"
                style={[
                  styles.searchInput,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.controlBorder,
                    color: colors.ink,
                    borderRadius: radii.input,
                  },
                ]}
              />
              {memoryQuery.trim().length > 0 ? (
                <AppPressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear memory search"
                  onPress={() => {
                    setMemoryQuery('');
                    announcePolite('Cleared memory search.');
                  }}
                  style={[
                    styles.iconNavBtn,
                    {
                      width: 68,
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.controlBorder,
                      borderRadius: radii.input,
                    },
                  ]}>
                  <Text style={[styles.filterChipText, { color: colors.ink }]}>Clear</Text>
                </AppPressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {!memoriesQuery.isLoading && !memoriesQuery.isError && !days.length ? (
          <EmptyState
            title={`No Moments in ${monthLabel}`}
            message="Tap Capture in the dock to record today's dual-camera Moment."
            actionLabel="Open Dual Camera"
            onAction={() => router.push('/camera')}
          />
        ) : !memoriesQuery.isLoading && !memoriesQuery.isError && days.length > 0 && !filteredDays.length ? (
          <EmptyState
            title="No matching Moments"
            message="Try clearing your search text or switching back to All."
            actionLabel="Reset filters"
            onAction={() => {
              setMemoryFilter('all');
              setMemoryQuery('');
              announcePolite('Reset memory filters.');
            }}
          />
        ) : null}

        {selectedRecord ? (
          <View style={styles.stack}>
            <View style={styles.selectedHeaderRow}>
              <View style={styles.selectedTitleGroup}>
                <SymbolView
                  name={
                    selectedRecord.mine && selectedRecord.partner
                      ? { ios: 'person.2.fill', android: 'group', web: 'group' }
                      : { ios: 'person.fill', android: 'person', web: 'person' }
                  }
                  tintColor={colors.ink}
                  size={18}
                />
                <Text
                  accessibilityRole="header"
                  style={[
                    styles.selectedDateTitle,
                    { color: colors.ink, fontFamily: type.fontSans },
                  ]}>
                  {shortDate(selectedRecord.prompt_date)}
                </Text>
              </View>
              <View style={styles.monthRightActions}>
                <AppPressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous archived day"
                  disabled={activeDayIdx <= 0}
                  onPress={() => stepSelectedDay(-1)}
                  style={[
                    styles.iconNavBtn,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.controlBorder,
                      borderRadius: radii.input,
                      opacity: activeDayIdx <= 0 ? 0.4 : 1,
                    },
                  ]}>
                  <SymbolView
                    name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
                    tintColor={colors.ink}
                    size={18}
                  />
                </AppPressable>
                <AppPressable
                  accessibilityRole="button"
                  accessibilityLabel="Next archived day"
                  disabled={activeDayIdx < 0 || activeDayIdx >= filteredDays.length - 1}
                  onPress={() => stepSelectedDay(1)}
                  style={[
                    styles.iconNavBtn,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.controlBorder,
                      borderRadius: radii.input,
                      opacity: activeDayIdx < 0 || activeDayIdx >= filteredDays.length - 1 ? 0.4 : 1,
                    },
                  ]}>
                  <SymbolView
                    name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                    tintColor={colors.ink}
                    size={18}
                  />
                </AppPressable>
                <View
                  style={[
                    styles.modeTagPill,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.modeTagText, { color: colors.inkMuted }]}>
                    {selectedRecord.mine && selectedRecord.partner
                      ? 'Together'
                      : `${singleName} only`}
                  </Text>
                </View>
              </View>
            </View>

            {selectedRecord.mine && selectedRecord.partner ? (
              <TogetherCollageCard
                key={selectedRecord.prompt_id}
                promptDate={selectedRecord.prompt_date}
                myMoment={selectedRecord.mine}
                partnerMoment={selectedRecord.partner}
                myName={myName}
                partnerName={partnerName}
                streakCount={streak?.current_count}
                longestStreakCount={streak?.longest_count}
              />
            ) : singleMoment ? (
              <DualMomentCard
                moment={singleMoment}
                authorName={singleName}
                backPhotoUrl={singleMoment.back_photo_url ?? singleMoment.back_photo_path}
                frontPhotoUrl={singleMoment.front_photo_url ?? singleMoment.front_photo_path}
                blurhash={singleMoment.back_blurhash || DEFAULT_WARM_BLURHASH}
                caption={singleMoment.caption}
                postedAtIso={singleMoment.posted_at}
                lateBySeconds={singleMoment.late_by_seconds}
                isLate={singleMoment.is_late}
                retakeCount={singleMoment.retake_count}
                currentUserId={user?.id}
                coupleId={couple?.id}
                isOwner={singleMoment.user_id === user?.id}
                onUpdated={() => void memoriesQuery.refetch()}
                onDeleted={() => void memoriesQuery.refetch()}
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <MonthlyRecapModal
        visible={recapOpen}
        onClose={() => setRecapOpen(false)}
        monthLabel={monthLabel}
        days={days}
        streak={streak}
        myName={myName}
        partnerName={partnerName}
        paired={isPartnerPaired}
        loading={memoriesQuery.isFetching}
        error={memoriesQuery.isError ? 'Could not refresh this month.' : null}
        onRetry={() => void memoriesQuery.refetch()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: APP_LAYOUT.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: APP_LAYOUT.pageInset,
    paddingTop: 16,
    gap: 16,
  },
  stack: { gap: 12 },
  body: { fontSize: 15, lineHeight: 22 },
  headerBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 38,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  statNumber: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  recapIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    borderCurve: 'continuous',
  },
  recapCountText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderWidth: 1,
    gap: 8,
    borderCurve: 'continuous',
  },
  iconNavBtn: {
    width: 44,
    height: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  monthTitleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minWidth: 0,
  },
  monthTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  monthRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  loading: { gap: 12, padding: 20, alignItems: 'center' },
  calendar: {
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  calendarGrid: { gap: 6, minWidth: 0 },
  week: { flexDirection: 'row', gap: 5 },
  cell: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  weekday: { fontSize: 11, lineHeight: 18, fontWeight: '600' },
  day: {
    minWidth: 0,
    minHeight: 52,
    borderWidth: 1,
    overflow: 'hidden',
  },
  thumbnail: { ...StyleSheet.absoluteFill },
  dateBadge: {
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    alignItems: 'center',
    gap: 2,
  },
  dateBadgeOverPhoto: {
    backgroundColor: 'rgba(10, 7, 8, 0.78)',
  },
  dateNumber: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dotsIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  postDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.5,
  },
  legendBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  legendText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  selectedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  selectedTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  selectedDateTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  modeTagPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  modeTagText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  filterSearchWrap: {
    gap: 10,
  },
  filterPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChipBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: 14,
    fontSize: 14,
    fontWeight: '500',
  },
});
