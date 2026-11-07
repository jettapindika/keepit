import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TogetherCollageCard } from '@/components/memories/TogetherCollageCard';
import { InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { AppPressable, EmptyState, SectionHeader } from '@/components/ui/ScreenKit';
import { APP_LAYOUT, useKeepItTheme } from '@/theme/tokens';
import { MemoryDayRecord, StreakRecord } from '@/types/database';

export interface MonthlyRecapModalProps {
  visible: boolean;
  onClose: () => void;
  monthLabel: string;
  days: MemoryDayRecord[];
  streak: StreakRecord | null;
  myName: string;
  partnerName: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  paired?: boolean;
}

function RecapDeck({ onClose, monthLabel, days, streak, myName, partnerName, loading, error, onRetry, paired = true }: Omit<MonthlyRecapModalProps, 'visible'>) {
  const { colors, radii, type } = useKeepItTheme();
  const [stepIndex, setStepIndex] = useState(0);
  const metrics = useMemo(() => {
    const highlights = days.filter((day): day is MemoryDayRecord & { mine: NonNullable<MemoryDayRecord['mine']>; partner: NonNullable<MemoryDayRecord['partner']> } => Boolean(day.mine && day.partner)).sort((a, b) => a.prompt_date.localeCompare(b.prompt_date));
    let total = 0; let onTime = 0; let monthBest = 0; let run = 0; let previous: number | null = null; let goldenDays = 0;
    for (const day of days) for (const moment of [day.mine, day.partner]) if (moment) { total += 1; if (!moment.is_late) onTime += 1; }
    for (const day of highlights) {
      if (!day.mine.is_late && !day.partner.is_late) goldenDays += 1;
      const epoch = new Date(`${day.prompt_date}T00:00:00Z`).getTime() / 86_400_000;
      run = previous !== null && epoch - previous === 1 ? run + 1 : 1;
      monthBest = Math.max(monthBest, run); previous = epoch;
    }
    return { highlights: highlights.reverse(), total, onTimePct: total ? Math.round(onTime / total * 100) : null, monthBest, goldenDays };
  }, [days]);
  const totalSlides = 1 + metrics.highlights.length;
  const step = Math.min(stepIndex, totalSlides - 1);
  const active = step > 0 ? metrics.highlights[step - 1] : null;
  const changeSlide = (next: number) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setStepIndex(Math.max(0, Math.min(totalSlides - 1, next)));
  };
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
    <View accessibilityViewIsModal style={styles.shell}>
      <View style={styles.header}>
        <View style={styles.headingCopy}><Text style={[styles.secondary, { color: colors.inkMuted }]}>Monthly recap · {step + 1} of {totalSlides}</Text><Text accessibilityRole="header" style={[styles.title, { color: colors.ink, fontFamily: type.fontSans }]}>{monthLabel}</Text></View>
        <AppPressable accessibilityRole="button" accessibilityLabel="Close Monthly Recap" onPress={onClose} style={[styles.close, { backgroundColor: colors.surface, borderColor: colors.controlBorder, borderRadius: radii.input }]}><Text style={[styles.actionText, { color: colors.ink }]}>Close</Text></AppPressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.jumpControls} style={styles.jumpScroll}>
        <AppPressable accessibilityRole="button" accessibilityLabel="Jump to recap summary" accessibilityState={{ selected: step === 0 }} onPress={() => changeSlide(0)} style={[styles.jump, { backgroundColor: step === 0 ? colors.ink : colors.surface, borderColor: colors.controlBorder, borderRadius: radii.input }]}><Text style={[styles.actionText, { color: step === 0 ? colors.canvas : colors.ink }]}>Summary</Text></AppPressable>
        {metrics.highlights.map((day, index) => {
          const date = new Date(`${day.prompt_date}T12:00:00Z`);
          const selected = step === index + 1;
          return <AppPressable key={day.prompt_id} accessibilityRole="button" accessibilityLabel={`Jump to ${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} highlight`} accessibilityState={{ selected }} onPress={() => changeSlide(index + 1)} style={[styles.jump, { backgroundColor: selected ? colors.ink : colors.surface, borderColor: colors.controlBorder, borderRadius: radii.input }]}><Text style={[styles.actionText, { color: selected ? colors.canvas : colors.ink }]}>{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}</Text></AppPressable>;
        })}
      </ScrollView>
      <View accessibilityRole="progressbar" accessibilityLabel="Recap progress" accessibilityValue={{ min: 1, max: totalSlides, now: step + 1 }} style={[styles.progress, { backgroundColor: colors.surfaceElevated }]}><View style={[styles.progressFill, { backgroundColor: colors.ink, width: `${((step + 1) / totalSlides) * 100}%` }]} /></View>
      <ScrollView key={step} style={styles.scroll} contentContainerStyle={styles.stage}>
        {loading ? <View accessibilityLiveRegion="polite" style={styles.loading}><ActivityIndicator color={colors.ink} /><Text style={[styles.body, { color: colors.inkMuted }]}>Refreshing archived Moments…</Text></View> : null}
        {error ? <View style={styles.stack}><InlineNotice tone="error" message={error} />{onRetry ? <KeepItButton label="Retry loading recap" variant="secondary" loading={loading} onPress={onRetry} /> : null}</View> : null}
        {!days.length ? (!loading ? <EmptyState title="No Moments in this recap" message="Post a daily Moment to build this month's archive." actionLabel="Back to memories" onAction={onClose} /> : null) : step === 0 ? <View style={[styles.overview, { backgroundColor: colors.surface, borderRadius: radii.card }]}>
          <SectionHeader title={paired ? `${myName} & ${partnerName}` : `${myName}'s archive`} subtitle={`${days.length} archived ${days.length === 1 ? 'day' : 'days'} in ${monthLabel}.`} />
          <View style={styles.heroMetric}><Text style={[styles.bigNumber, { color: colors.ink, fontFamily: type.fontSans }]}>{metrics.highlights.length}</Text><Text style={[styles.sectionTitle, { color: colors.ink }]}>Together collages</Text><Text style={[styles.body, { color: colors.inkMuted }]}>{metrics.total} total {metrics.total === 1 ? 'post' : 'posts'} in your monthly archive.</Text></View>
          <View style={[styles.metricList, { borderTopColor: colors.border }]}>
            <View style={styles.metricRow}><Text style={[styles.body, { color: colors.inkMuted }]}>Best Together streak this month</Text><Text style={[styles.metricValue, { color: colors.ink }]}>{metrics.monthBest} {metrics.monthBest === 1 ? 'day' : 'days'}</Text></View>
            <View style={styles.metricRow}><Text style={[styles.body, { color: colors.inkMuted }]}>All-time best streak</Text><Text style={[styles.metricValue, { color: colors.ink }]}>{streak?.longest_count ?? 0} {(streak?.longest_count ?? 0) === 1 ? 'day' : 'days'}</Text></View>
            <View style={styles.metricRow}><Text style={[styles.body, { color: colors.inkMuted }]}>Golden Sync days (both on time)</Text><Text style={[styles.metricValue, { color: colors.success }]}>{Math.max(metrics.goldenDays, streak?.golden_sync_count ?? 0)}</Text></View>
            <View style={styles.metricRow}><Text style={[styles.body, { color: colors.inkMuted }]}>Grace Shields ready</Text><Text style={[styles.metricValue, { color: colors.ink }]}>{streak?.grace_shields ?? 0}</Text></View>
            <View style={styles.metricRow}><Text style={[styles.body, { color: colors.inkMuted }]}>Posted on time</Text><Text style={[styles.metricValue, { color: colors.ink }]}>{metrics.onTimePct === null ? 'No posts' : `${metrics.onTimePct}%`}</Text></View>
          </View>
          <Text style={[styles.body, { color: colors.inkMuted }]}>{metrics.highlights.length ? 'Revisit your Together days. Each highlight lets you swap cameras, cycle unlocked Milestone Stamps, and save the original Moments.' : 'Post on the same day together to make a Together collage. Individual Moments remain in your calendar.'}</Text>
        </View> : active ? <TogetherCollageCard key={active.prompt_id} promptDate={active.prompt_date} myMoment={active.mine} partnerMoment={active.partner} myName={myName} partnerName={partnerName} streakCount={streak?.current_count ?? metrics.monthBest} longestStreakCount={streak?.longest_count ?? metrics.monthBest} /> : null}
      </ScrollView>
      <View style={styles.footer}>
        <KeepItButton label="Previous" variant="secondary" disabled={step === 0} onPress={() => changeSlide(step - 1)} style={styles.footerButton} />
        {step < totalSlides - 1 ? <KeepItButton label={step === 0 ? 'View highlights' : 'Next memory'} onPress={() => changeSlide(step + 1)} style={styles.footerButton} /> : <KeepItButton label="Finish recap" onPress={onClose} style={styles.footerButton} />}
      </View>
    </View>
  </SafeAreaView>;
}

export function MonthlyRecapModal({ visible, ...props }: MonthlyRecapModalProps) {
  return <Modal visible={visible} animationType="none" transparent={false} onRequestClose={props.onClose}>{visible ? <RecapDeck {...props} /> : null}</Modal>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  shell: { flex: 1, width: '100%', maxWidth: APP_LAYOUT.modalWidth, alignSelf: 'center', paddingHorizontal: APP_LAYOUT.pageInset, paddingTop: 16, paddingBottom: 16, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headingCopy: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '600' },
  secondary: { fontSize: 13, lineHeight: 20 },
  body: { fontSize: 15, lineHeight: 22 },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  close: { paddingHorizontal: 14, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  jumpScroll: { flexGrow: 0, flexShrink: 0 },
  jumpControls: { gap: 8, paddingVertical: 3, paddingHorizontal: 2 },
  jump: { borderWidth: 1, minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  progress: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%' },
  scroll: { flex: 1 },
  stage: { paddingTop: 4, paddingBottom: 20, gap: 16 },
  loading: { padding: 16, gap: 12, alignItems: 'center' },
  stack: { gap: 12 },
  overview: { padding: 20, gap: 24 },
  heroMetric: { gap: 4 },
  bigNumber: { fontSize: 52, lineHeight: 60, fontWeight: '600', fontVariant: ['tabular-nums'] },
  metricList: { borderTopWidth: 1, paddingTop: 16, gap: 16 },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  metricValue: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  footerButton: { flex: 1, minWidth: 120 },
});
