import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchMonthMemories } from '@/api/extras';
import { DEFAULT_WARM_BLURHASH } from '@/api/moments';
import { isSupabaseConfigured, supabase } from '@/api/supabase';
import { MonthlyRecapModal } from '@/components/memories/MonthlyRecapModal';
import { TogetherCollageCard } from '@/components/memories/TogetherCollageCard';
import { DualMomentCard } from '@/components/moment/MomentCards';
import { InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { AppPressable, EmptyState, PageHeader, SectionHeader } from '@/components/ui/ScreenKit';
import { useSessionStore } from '@/store/sessionStore';
import { APP_LAYOUT, useKeepItTheme } from '@/theme/tokens';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fullDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

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
  const [recapOpen, setRecapOpen] = useState(false);
  const isPartnerPaired = Boolean(partner && couple && !couple.id.startsWith('solo_'));
  const myName = user?.display_name ?? 'You';
  const partnerName = partner?.display_name ?? 'Partner';
  const memoriesQuery = useQuery({
    queryKey: ['month-memories', couple?.id, user?.id, cursorYear, cursorMonth],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () => fetchMonthMemories({ coupleId: couple!.id, userId: user!.id, year: cursorYear, month: cursorMonth }),
  });
  useEffect(() => {
    const client = supabase;
    if (!couple?.id || !isSupabaseConfigured || !client) return;
    const channel = client.channel(`memories:${couple.id}:${Date.now().toString(36)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'moments', filter: `couple_id=eq.${couple.id}` }, () => { void queryClient.invalidateQueries({ queryKey: ['month-memories', couple.id] }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'streaks', filter: `couple_id=eq.${couple.id}` }, () => { void queryClient.invalidateQueries({ queryKey: ['month-memories', couple.id] }); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [couple?.id, queryClient]);

  const days = useMemo(() => (memoriesQuery.data?.days ?? []).filter((day) => day.mine || day.partner), [memoriesQuery.data?.days]);
  const streak = memoriesQuery.data?.streak ?? null;
  const dayMap = useMemo(() => new Map(days.map((day) => [day.prompt_date, day])), [days]);
  const effectiveDate = selectedDate && dayMap.has(selectedDate) ? selectedDate : days[0]?.prompt_date ?? null;
  const selectedRecord = effectiveDate ? dayMap.get(effectiveDate) : null;
  const monthLabel = new Date(Date.UTC(cursorYear, cursorMonth - 1, 15)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const atCurrentMonth = cursorYear > currentYear || (cursorYear === currentYear && cursorMonth >= currentMonth);
  const stepMonth = (delta: -1 | 1) => {
    if (delta === 1 && atCurrentMonth) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    const next = new Date(Date.UTC(cursorYear, cursorMonth - 1 + delta, 15));
    setSelectedDate(null); setCursorYear(next.getUTCFullYear()); setCursorMonth(next.getUTCMonth() + 1);
  };
  const calendarWeeks = useMemo(() => {
    const cells: ({ day: number; date: string } | null)[] = Array.from({ length: new Date(Date.UTC(cursorYear, cursorMonth - 1, 1)).getUTCDay() }, () => null);
    const prefix = `${cursorYear}-${String(cursorMonth).padStart(2, '0')}-`;
    for (let day = 1; day <= new Date(Date.UTC(cursorYear, cursorMonth, 0)).getUTCDate(); day += 1) cells.push({ day, date: `${prefix}${String(day).padStart(2, '0')}` });
    while (cells.length % 7) cells.push(null);
    const weeks: (typeof cells)[] = [];
    for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
    return weeks;
  }, [cursorMonth, cursorYear]);
  const togetherCount = days.filter((day) => day.mine && day.partner).length;
  const singleMoment = selectedRecord?.mine ?? selectedRecord?.partner;
  const singleName = selectedRecord?.mine ? myName : partnerName;

  return <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, { paddingBottom: APP_LAYOUT.tabBarClearance + insets.bottom }]}>
      <PageHeader title="Memories" subtitle={isPartnerPaired ? `${myName} & ${partnerName}` : `${myName} · Personal archive`} onBack={() => router.replace('/(tabs)')} backLabel="Back to Home" />
      <View style={[styles.streakRow, { backgroundColor: colors.surface, borderRadius: radii.card }]}>
        <View style={styles.streakItem}><Text style={[styles.metric, { color: colors.ink, fontFamily: type.fontSans }]}>{memoriesQuery.isLoading ? '…' : memoriesQuery.isError && !streak ? '?' : streak?.current_count ?? 0}</Text><Text style={[styles.secondary, { color: colors.inkMuted }]}>Current day streak</Text></View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.streakItem}><Text style={[styles.metric, { color: colors.ink, fontFamily: type.fontSans }]}>{memoriesQuery.isLoading ? '…' : memoriesQuery.isError && !streak ? '?' : streak?.longest_count ?? 0}</Text><Text style={[styles.secondary, { color: colors.inkMuted }]}>Best day streak</Text></View>
      </View>

      <View style={styles.monthArea}>
        <Text accessibilityRole="header" style={[styles.monthTitle, { color: colors.ink, fontFamily: type.fontSans }]}>{monthLabel}</Text>
        <View style={styles.monthControls}>
          <KeepItButton label="Previous month" variant="secondary" onPress={() => stepMonth(-1)} style={styles.monthButton} />
          <KeepItButton label="Next month" variant="secondary" disabled={atCurrentMonth} onPress={() => stepMonth(1)} style={styles.monthButton} />
        </View>
      </View>
      {memoriesQuery.isError ? <View style={styles.stack}><InlineNotice tone="error" message={memoriesQuery.error instanceof Error ? memoriesQuery.error.message : 'Could not load archived Moments for this month.'} /><KeepItButton label="Retry loading month" loading={memoriesQuery.isFetching} onPress={() => void memoriesQuery.refetch()} /></View> : null}
      {memoriesQuery.isLoading ? <View accessibilityLiveRegion="polite" style={styles.loading}><ActivityIndicator color={colors.ink} /><Text style={[styles.body, { color: colors.inkMuted }]}>Loading Moments for {monthLabel}…</Text></View> : null}

      <View style={[styles.recap, { backgroundColor: colors.surface, borderRadius: radii.card }]}>
        <SectionHeader title="Your monthly recap" subtitle={days.length ? `${days.length} archived days · ${togetherCount} Together collages` : 'A monthly story made from the Moments you post.'} />
        <KeepItButton label="Open monthly recap" variant="primary" disabled={!days.length || memoriesQuery.isLoading} onPress={() => setRecapOpen(true)} />
      </View>

      <View style={[styles.calendar, { backgroundColor: colors.surface, borderRadius: radii.card }]}>
        <SectionHeader title="Calendar" subtitle="Select an archived day. Days without Moments cannot be selected." />
        <Text style={[styles.secondary, { color: colors.inkMuted }]}>2 = both posted · 1 = one posted</Text>
        <View style={styles.calendarGrid}>
          <View style={styles.week}>{WEEKDAYS.map((day) => <View key={day} style={styles.cell}><Text style={[styles.weekday, { color: colors.inkMuted }]}>{day}</Text></View>)}</View>
            {calendarWeeks.map((week, index) => <View key={index} style={styles.week}>{week.map((cell, cellIndex) => {
              if (!cell) return <View key={`blank-${cellIndex}`} style={styles.cell} />;
              const record = dayMap.get(cell.date);
              const count = Number(Boolean(record?.mine)) + Number(Boolean(record?.partner));
              const selected = effectiveDate === cell.date;
              const thumbnail = record?.mine?.back_photo_url ?? record?.mine?.back_photo_path ?? record?.partner?.back_photo_url ?? record?.partner?.back_photo_path;
              return <AppPressable key={cell.date} accessibilityRole="button" accessibilityLabel={`${fullDate(cell.date)}, ${count ? `${count} ${count === 1 ? 'person' : 'people'} posted` : 'no archived Moment'}`} accessibilityState={{ selected, disabled: !count }} disabled={!count} onPress={() => { if (Platform.OS !== 'web') void Haptics.selectionAsync(); setSelectedDate(cell.date); }} style={[styles.cell, styles.day, { backgroundColor: selected ? colors.ink : colors.canvas, borderColor: selected ? colors.focusRing : count ? colors.controlBorder : 'transparent', borderRadius: radii.input }]}>
                {thumbnail ? <Image source={{ uri: thumbnail }} contentFit="cover" style={styles.thumbnail} accessible={false} /> : null}
                <View style={[styles.dateLabel, { backgroundColor: thumbnail ? '#0A0708' : 'transparent' }]}><Text style={[styles.dateNumber, { color: thumbnail ? '#FFFFFF' : selected ? colors.canvas : colors.inkMuted }]}>{cell.day}</Text>{count ? <Text style={[styles.dayCount, { color: thumbnail ? '#FFFFFF' : selected ? colors.canvas : colors.ink }]}>{count}</Text> : null}</View>
              </AppPressable>;
            })}</View>)}
        </View>
      </View>
      {!memoriesQuery.isLoading && !memoriesQuery.isError && !days.length ? <EmptyState title={`No Moments in ${monthLabel}`} message="Capture a daily Moment from Home to build your archive." actionLabel="Back to Home" onAction={() => router.replace('/(tabs)')} /> : null}
      {selectedRecord ? <View style={styles.stack}>
        <SectionHeader title={selectedRecord.mine && selectedRecord.partner ? 'Together collage' : 'Day archive'} subtitle={fullDate(selectedRecord.prompt_date)} />
        {selectedRecord.mine && selectedRecord.partner ? <TogetherCollageCard key={selectedRecord.prompt_id} promptDate={selectedRecord.prompt_date} myMoment={selectedRecord.mine} partnerMoment={selectedRecord.partner} myName={myName} partnerName={partnerName} /> : singleMoment ? <View style={styles.stack}>
          <InlineNotice tone="info" message={`Only ${singleName} posted on this date.${isPartnerPaired ? ' Both partners need to post on the same day for a Together collage.' : ''}`} />
          <DualMomentCard authorName={singleName} backPhotoUrl={singleMoment.back_photo_url ?? singleMoment.back_photo_path} frontPhotoUrl={singleMoment.front_photo_url ?? singleMoment.front_photo_path} blurhash={singleMoment.back_blurhash || DEFAULT_WARM_BLURHASH} caption={singleMoment.caption} postedAtIso={singleMoment.posted_at} lateBySeconds={singleMoment.late_by_seconds} isLate={singleMoment.is_late} retakeCount={singleMoment.retake_count} />
        </View> : null}
      </View> : null}
    </ScrollView>
    <MonthlyRecapModal visible={recapOpen} onClose={() => setRecapOpen(false)} monthLabel={monthLabel} days={days} streak={streak} myName={myName} partnerName={partnerName} paired={isPartnerPaired} loading={memoriesQuery.isFetching} error={memoriesQuery.isError ? 'Could not refresh this month.' : null} onRetry={() => void memoriesQuery.refetch()} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { width: '100%', maxWidth: APP_LAYOUT.maxContentWidth, alignSelf: 'center', paddingHorizontal: APP_LAYOUT.pageInset, paddingTop: 16, gap: 24 },
  stack: { gap: 12 },
  body: { fontSize: 15, lineHeight: 22 },
  secondary: { fontSize: 13, lineHeight: 20 },
  streakRow: { flexDirection: 'row', padding: 20, gap: 20 },
  streakItem: { flex: 1, gap: 4 },
  metric: { fontSize: 28, lineHeight: 34, fontWeight: '600' },
  divider: { width: 1 },
  monthArea: { gap: 12 },
  monthTitle: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  monthControls: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  monthButton: { flex: 1, minWidth: 120 },
  recap: { padding: 20, gap: 20 },
  loading: { gap: 12, padding: 20, alignItems: 'center' },
  calendar: { padding: 12, gap: 16 },
  calendarGrid: { gap: 6, minWidth: 0 },
  week: { flexDirection: 'row', gap: 4 },
  cell: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  weekday: { fontSize: 11, lineHeight: 20 },
  day: { minWidth: 0, minHeight: 54, borderWidth: 2, overflow: 'hidden' },
  thumbnail: { ...StyleSheet.absoluteFill },
  dateLabel: { borderRadius: 5, paddingHorizontal: 2, paddingVertical: 2, alignItems: 'center' },
  dateNumber: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dayCount: { fontSize: 10, fontWeight: '600' },
});
