import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchMonthMemories } from '@/api/extras';
import { DEFAULT_WARM_BLURHASH } from '@/api/moments';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { MonthlyRecapModal } from '@/components/memories/MonthlyRecapModal';
import { TogetherCollageCard } from '@/components/memories/TogetherCollageCard';
import { DualMomentCard } from '@/components/moment/MomentCards';
import {
  DualFrameMark,
  InlineNotice,
  KeepItButton,
  MochyCard,
  RevealOnAppear,
} from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';
import { MemoryDayRecord } from '@/types/database';

const WEEKDAY_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export default function MemoriesScreen() {
  const queryClient = useQueryClient();
  const { colors, radii, spacing, type } = useKeepItTheme();

  const user = useSessionStore((s) => s.user);
  const partner = useSessionStore((s) => s.partner);
  const couple = useSessionStore((s) => s.couple);

  const now = useMemo(() => new Date(), []);
  const currentUtcYear = now.getUTCFullYear();
  const currentUtcMonth = now.getUTCMonth() + 1;

  const [cursorYear, setCursorYear] = useState(currentUtcYear);
  const [cursorMonth, setCursorMonth] = useState(currentUtcMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [recapOpen, setRecapOpen] = useState(false);

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

  // Realtime sync on moments & streaks when Supabase is active
  useEffect(() => {
    const client = supabase;
    if (!couple?.id || !isSupabaseConfigured || !client) return;

    const channel = client
      .channel(`memories:${couple.id}:${Date.now().toString(36)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'moments',
          filter: `couple_id=eq.${couple.id}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['month-memories', couple.id] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'streaks',
          filter: `couple_id=eq.${couple.id}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['month-memories', couple.id] });
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [couple?.id, queryClient]);

  const days = useMemo(() => memoriesQuery.data?.days ?? [], [memoriesQuery.data?.days]);
  const streak = memoriesQuery.data?.streak ?? null;
  const currentStreak = streak?.current_count ?? 0;
  const longestStreak = streak?.longest_count ?? 0;

  const dayMap = useMemo(() => {
    const map = new Map<string, MemoryDayRecord>();
    for (const day of days) {
      map.set(day.prompt_date, day);
    }
    return map;
  }, [days]);

  const effectiveSelectedDate =
    days.length === 0
      ? null
      : selectedDate && dayMap.has(selectedDate)
        ? selectedDate
        : days[0].prompt_date;

  const monthLabel = useMemo(() => {
    const refDate = new Date(Date.UTC(cursorYear, cursorMonth - 1, 15));
    return refDate.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }, [cursorYear, cursorMonth]);

  const isAtCurrentMonth =
    cursorYear > currentUtcYear ||
    (cursorYear === currentUtcYear && cursorMonth >= currentUtcMonth);

  const stepMonth = (delta: -1 | 1) => {
    if (delta === 1 && isAtCurrentMonth) return;
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
    let nextMonth = cursorMonth + delta;
    let nextYear = cursorYear;
    if (nextMonth < 1) {
      nextMonth = 12;
      nextYear -= 1;
    } else if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    setSelectedDate(null);
    setCursorYear(nextYear);
    setCursorMonth(nextMonth);
  };

  // Build 7-column calendar cells for cursorYear / cursorMonth
  const calendarWeeks = useMemo(() => {
    const firstWeekday = new Date(Date.UTC(cursorYear, cursorMonth - 1, 1)).getUTCDay();
    const totalDaysInMonth = new Date(Date.UTC(cursorYear, cursorMonth, 0)).getUTCDate();
    const prefix = `${String(cursorYear).padStart(4, '0')}-${String(cursorMonth).padStart(2, '0')}-`;

    const cells: ({ dayNum: number; dateStr: string } | null)[] = [];
    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push(null);
    }
    for (let d = 1; d <= totalDaysInMonth; d += 1) {
      cells.push({
        dayNum: d,
        dateStr: `${prefix}${String(d).padStart(2, '0')}`,
      });
    }
    while (cells.length % 7 !== 0) {
      cells.push(null);
    }

    const weeks: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return weeks;
  }, [cursorYear, cursorMonth]);

  // Real summary stats for the Monthly Recap hero card
  const recapPreview = useMemo(() => {
    let togetherCount = 0;
    let totalPosts = 0;
    let onTimePosts = 0;

    for (const d of days) {
      if (d.mine && d.partner) togetherCount += 1;
      if (d.mine) {
        totalPosts += 1;
        if (!d.mine.is_late) onTimePosts += 1;
      }
      if (d.partner) {
        totalPosts += 1;
        if (!d.partner.is_late) onTimePosts += 1;
      }
    }

    const onTimePct = totalPosts > 0 ? Math.round((onTimePosts / totalPosts) * 100) : 0;
    return { togetherCount, totalPosts, onTimePct };
  }, [days]);


  const selectedRecord = effectiveSelectedDate ? dayMap.get(effectiveSelectedDate) ?? null : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.xl,
            paddingBottom: 148,
          },
        ]}>
        {/* Top Title + Streak Summary Pill */}
        <RevealOnAppear revealKey="memories-header">
          <View style={styles.titleRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                style={[
                  styles.screenTitle,
                  { color: colors.ink, letterSpacing: type.titleTracking },
                ]}>
                Memories
              </Text>
              <Text style={[styles.screenSub, { color: colors.inkMuted }]}>
                {isPartnerPaired ? `${myName} & ${partnerName}` : `${myName} · Personal Archive`}
              </Text>
            </View>

            <View
              style={[
                styles.streakSummaryPill,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.pill,
                },
              ]}>
              <Text style={[styles.streakCurrentText, { color: colors.ink }]}>
                Current {currentStreak}d
              </Text>
              <Text style={[styles.streakDivider, { color: colors.inkMuted }]}>·</Text>
              <Text style={[styles.streakLongestText, { color: colors.inkMuted }]}>
                Best {longestStreak}d
              </Text>
            </View>
          </View>
        </RevealOnAppear>

        {/* Month Switcher Bar (< Prev | November 2026 | Next >) */}
        <RevealOnAppear revealKey="memories-month-switcher">
          <View
            style={[
              styles.monthSwitcher,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.pill,
              },
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              onPress={() => stepMonth(-1)}
              style={[
                styles.monthNavBtn,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderRadius: radii.pill,
                },
              ]}>
              <Text pointerEvents="none" style={[styles.monthNavText, { color: colors.ink }]}>{'< Prev'}</Text>
            </Pressable>

            <Text
              numberOfLines={1}
              style={[
                styles.monthLabelText,
                { color: colors.ink, letterSpacing: type.bodyTracking },
              ]}>
              {monthLabel}
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next month"
              accessibilityState={{ disabled: isAtCurrentMonth }}
              disabled={isAtCurrentMonth}
              onPress={() => stepMonth(1)}
              style={[
                styles.monthNavBtn,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderRadius: radii.pill,
                  opacity: isAtCurrentMonth ? 0.36 : 1,
                },
              ]}>
              <Text pointerEvents="none" style={[styles.monthNavText, { color: colors.ink }]}>{'Next >'}</Text>
            </Pressable>
          </View>
        </RevealOnAppear>



        {memoriesQuery.isError ? (
          <View style={{ gap: spacing.sm }}>
            <InlineNotice
              message={
                memoriesQuery.error instanceof Error
                  ? memoriesQuery.error.message
                  : 'Could not load archived Moments for this month.'
              }
              tone="error"
            />
            <KeepItButton
              label="Retry Loading Month"
              variant="secondary"
              onPress={() => void memoriesQuery.refetch()}
            />
          </View>
        ) : null}

        {/* Monthly Memory Recap Hero Card */}
        <RevealOnAppear revealKey={`memories-recap-hero-${cursorYear}-${cursorMonth}`}>
          <MochyCard
            onPress={days.length > 0 ? () => setRecapOpen(true) : undefined}
            accessibilityLabel={
              days.length > 0
                ? `Open ${monthLabel} Monthly Memory Recap`
                : `${monthLabel} Monthly Memory Recap unavailable until Moments are archived`
            }
            style={{
              borderRadius: radii.photo,
              padding: spacing.xl,
              backgroundColor: days.length > 0 ? colors.surfaceElevated : colors.surface,
              gap: spacing.md,
            }}>
            <View style={styles.recapHeroTop}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.recapEyebrow, { color: colors.inkMuted }]}>
                  Monthly Memory Recap · {monthLabel}
                </Text>
                <Text
                  style={[
                    styles.recapHeroTitle,
                    { color: colors.ink, letterSpacing: type.titleTracking },
                  ]}>
                  {days.length > 0
                    ? `${recapPreview.togetherCount} Together ${
                        recapPreview.togetherCount === 1 ? 'Moment' : 'Moments'
                      } · ${recapPreview.onTimePct}% on time`
                    : 'Your monthly story builds as you post'}
                </Text>
              </View>
              <DualFrameMark size={44} />
            </View>

            <View style={styles.recapFooterRow}>

              {days.length > 0 ? (
                <View
                  style={[
                    styles.openRecapPill,
                    {
                      backgroundColor: colors.accent,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.openRecapPillText, { color: colors.onAccent }]}>
                    Open Recap
                  </Text>
                </View>
              ) : null}
            </View>
          </MochyCard>
        </RevealOnAppear>

        {/* Interactive Month Calendar Grid */}
        <RevealOnAppear revealKey={`memories-calendar-${cursorYear}-${cursorMonth}`}>
          <View
            style={[
              styles.calendarCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.group,
                padding: spacing.lg,
                gap: spacing.md,
              },
            ]}>
            <View style={styles.calendarLegendRow}>
              <Text style={[styles.sectionTitle, { color: colors.ink }]}>Calendar</Text>
              <View style={styles.legendPills}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendSplitIcon, { borderColor: colors.border }]}>
                    <View style={{ flex: 1, backgroundColor: colors.ink }} />
                    <View style={{ flex: 1, backgroundColor: colors.inkMuted }} />
                  </View>
                  <Text style={[styles.legendLabel, { color: colors.inkMuted }]}>Together</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendSingleDot, { backgroundColor: colors.warning }]} />
                  <Text style={[styles.legendLabel, { color: colors.inkMuted }]}>1 posted</Text>
                </View>
              </View>
            </View>

            {/* Weekday Header Row */}
            <View style={styles.weekRow}>
              {WEEKDAY_HEADERS.map((dayLetter, idx) => (
                <View key={`wk-hdr-${idx}`} style={styles.dayCellWrapper}>
                  <Text style={[styles.weekdayText, { color: colors.inkMuted }]}>
                    {dayLetter}
                  </Text>
                </View>
              ))}
            </View>

            {/* Weeks Grid */}
            <View style={{ gap: 6 }}>
              {calendarWeeks.map((week, wIdx) => (
                <View key={`wk-${wIdx}`} style={styles.weekRow}>
                  {week.map((cell, cIdx) => {
                    if (!cell) {
                      return <View key={`empty-${wIdx}-${cIdx}`} style={styles.dayCellWrapper} />;
                    }

                    const record = dayMap.get(cell.dateStr);
                    const hasBoth = Boolean(record?.mine && record?.partner);
                    const hasSingle = Boolean(record && !hasBoth && (record.mine || record.partner));
                    const isSelected = selectedDate === cell.dateStr;

                    const leftThumb =
                      record?.partner?.back_photo_url ?? record?.partner?.back_photo_path ?? null;
                    const rightThumb =
                      record?.mine?.back_photo_url ?? record?.mine?.back_photo_path ?? null;
                    const singleThumb = leftThumb ?? rightThumb;

                    return (
                      <View key={cell.dateStr} style={styles.dayCellWrapper}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${cell.dateStr}${
                            hasBoth
                              ? ', both partners posted'
                              : hasSingle
                                ? ', one partner posted'
                                : ', no archived Moment'
                          }`}
                          accessibilityState={{ selected: isSelected, disabled: !record }}
                          disabled={!record}
                          onPress={() => {
                            if (Platform.OS !== 'web') {
                              void Haptics.selectionAsync();
                            }
                            setSelectedDate(cell.dateStr);
                          }}
                          style={[
                            styles.dayTile,
                            {
                              backgroundColor: record ? colors.surfaceElevated : colors.canvas,
                              borderColor: isSelected
                                ? colors.accent
                                : record
                                  ? colors.border
                                  : colors.chromeOutline,
                              borderWidth: isSelected ? 2 : 1,
                              borderRadius: radii.input,
                            },
                          ]}>
                          {hasBoth && leftThumb && rightThumb ? (
                            <View style={styles.splitThumbContainer}>
                              <Image
                                source={{ uri: leftThumb }}
                                contentFit="cover"
                                style={styles.halfThumb}
                              />
                              <View
                                style={[styles.thumbDivider, { backgroundColor: colors.canvas }]}
                              />
                              <Image
                                source={{ uri: rightThumb }}
                                contentFit="cover"
                                style={styles.halfThumb}
                              />
                              <View style={styles.dayNumberScrim}>
                                <Text style={styles.dayNumberOverPhoto}>{cell.dayNum}</Text>
                              </View>
                            </View>
                          ) : hasSingle && singleThumb ? (
                            <View style={styles.splitThumbContainer}>
                              <Image
                                source={{ uri: singleThumb }}
                                contentFit="cover"
                                style={[styles.halfThumb, { opacity: 0.85 }]}
                              />
                              <View
                                style={[
                                  styles.halfPendingPane,
                                  { backgroundColor: colors.surface },
                                ]}>
                                <View
                                  style={[
                                    styles.partialIndicatorDot,
                                    { backgroundColor: colors.warning },
                                  ]}
                                />
                              </View>
                              <View style={styles.dayNumberScrim}>
                                <Text style={styles.dayNumberOverPhoto}>{cell.dayNum}</Text>
                              </View>
                            </View>
                          ) : (
                            <Text
                              style={[
                                styles.dayNumberPlain,
                                { color: colors.placeholder },
                              ]}>
                              {cell.dayNum}
                            </Text>
                          )}
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        </RevealOnAppear>

        {/* Loading / Empty / Selected Day Detail */}
        {memoriesQuery.isLoading ? (
          <View
            style={[
              styles.stateCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.card,
                padding: spacing.xl,
              },
            ]}>
            <ActivityIndicator size="small" color={colors.ink} />
            <Text style={[styles.stateBody, { color: colors.inkMuted }]}>
              Loading archived Moments for {monthLabel}...
            </Text>
          </View>
        ) : days.length === 0 ? (
          <RevealOnAppear revealKey="memories-empty-state">
            <View
              style={[
                styles.stateCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.card,
                  padding: spacing.xl,
                  gap: spacing.md,
                },
              ]}>
              <Text style={[styles.stateTitle, { color: colors.ink }]}>
                No Moments in {monthLabel}
              </Text>
              <Text style={[styles.stateBody, { color: colors.inkMuted }]}>
                Capture daily Moments from the Home tab to build your monthly calendar archive and story recap.
              </Text>
            </View>
          </RevealOnAppear>
        ) : selectedRecord ? (
          <View style={{ gap: spacing.md }}>
            <View style={styles.detailHeaderRow}>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.ink, letterSpacing: type.titleTracking },
                ]}>
                {selectedRecord.mine && selectedRecord.partner
                  ? 'Together Collage'
                  : 'Partial Day Archive'}
              </Text>
              <Text style={[styles.detailDateCode, { color: colors.inkMuted }]}>
                {selectedRecord.prompt_date}
              </Text>
            </View>

            {selectedRecord.mine && selectedRecord.partner ? (
              <TogetherCollageCard
                key={`day-detail-${selectedRecord.prompt_id}`}
                revealKey={`day-detail-${selectedRecord.prompt_id}`}
                promptDate={selectedRecord.prompt_date}
                myMoment={selectedRecord.mine}
                partnerMoment={selectedRecord.partner}
                myName={myName}
                partnerName={partnerName}
                streakCount={currentStreak}
              />
            ) : selectedRecord.mine ? (
              <View style={{ gap: spacing.sm }}>
                <InlineNotice
                  tone="info"
                  message={`Only ${myName} posted on ${selectedRecord.prompt_date}. Both partners need to post on the same day to merge a Together collage.`}
                />
                <DualMomentCard
                  authorName={myName}
                  backPhotoUrl={
                    selectedRecord.mine.back_photo_url ?? selectedRecord.mine.back_photo_path
                  }
                  frontPhotoUrl={
                    selectedRecord.mine.front_photo_url ?? selectedRecord.mine.front_photo_path
                  }
                  blurhash={selectedRecord.mine.back_blurhash || DEFAULT_WARM_BLURHASH}
                  caption={selectedRecord.mine.caption}
                  postedAtIso={selectedRecord.mine.posted_at}
                  lateBySeconds={selectedRecord.mine.late_by_seconds}
                  isLate={selectedRecord.mine.is_late}
                  retakeCount={selectedRecord.mine.retake_count}
                />
              </View>
            ) : selectedRecord.partner ? (
              <View style={{ gap: spacing.sm }}>
                <InlineNotice
                  tone="info"
                  message={`Only ${partnerName} posted on ${selectedRecord.prompt_date}.`}
                />
                <DualMomentCard
                  authorName={partnerName}
                  backPhotoUrl={
                    selectedRecord.partner.back_photo_url ?? selectedRecord.partner.back_photo_path
                  }
                  frontPhotoUrl={
                    selectedRecord.partner.front_photo_url ??
                    selectedRecord.partner.front_photo_path
                  }
                  blurhash={selectedRecord.partner.back_blurhash || DEFAULT_WARM_BLURHASH}
                  caption={selectedRecord.partner.caption}
                  postedAtIso={selectedRecord.partner.posted_at}
                  lateBySeconds={selectedRecord.partner.late_by_seconds}
                  isLate={selectedRecord.partner.is_late}
                  retakeCount={selectedRecord.partner.retake_count}
                />
              </View>
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
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    gap: 18,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '700',
  },
  screenSub: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  streakSummaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderCurve: 'continuous',
  },
  streakCurrentText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
  streakDivider: {
    fontSize: 12,
    fontWeight: '700',
  },
  streakLongestText: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
  monthSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    padding: 6,
    gap: 8,
    borderCurve: 'continuous',
  },
  monthNavBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  monthNavText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  monthLabelText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  recapHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  recapEyebrow: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  recapHeroTitle: {
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 24,
  },
  recapFooterRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  recapHeroBody: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  openRecapPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderCurve: 'continuous',
  },
  openRecapPillText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  calendarCard: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  calendarLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  legendPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendSplitIcon: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  legendSingleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  weekRow: {
    flexDirection: 'row',
    gap: 6,
  },
  dayCellWrapper: {
    flex: 1,
    alignItems: 'center',
  },
  weekdayText: {
    fontSize: 11,
    fontWeight: '700',
    paddingBottom: 2,
  },
  dayTile: {
    width: '100%',
    aspectRatio: 0.86,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  splitThumbContainer: {
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    position: 'relative',
  },
  halfThumb: {
    flex: 1,
    height: '100%',
  },
  thumbDivider: {
    width: 1,
    height: '100%',
  },
  halfPendingPane: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  partialIndicatorDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dayNumberScrim: {
    position: 'absolute',
    bottom: 3,
    right: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.66)',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  dayNumberOverPhoto: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dayNumberPlain: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  stateCard: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  stateBody: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
  },
  sandboxFootnote: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  detailHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  detailDateCode: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
