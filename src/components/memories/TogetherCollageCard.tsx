import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { formatLateDuration, isMomentPromptCheckIn } from '@/api/moments';
import { InlineNotice, KeepItButton, RevealOnAppear } from '@/components/ui/Primitives';
import { AppPressable } from '@/components/ui/ScreenKit';
import { useKeepItTheme } from '@/theme/tokens';
import { MomentRecord } from '@/types/database';
import { exportAndShareCompositeMoment, formatMomentWatermarkTimestamp } from '@/utils/momentExport';
import { getAvailableCollageStamps } from '@/utils/streakEngine';

export interface TogetherCollageCardProps {
  promptDate: string;
  myMoment: MomentRecord;
  partnerMoment: MomentRecord;
  myName: string;
  partnerName: string;
  streakCount?: number;
  longestStreakCount?: number;
  revealKey?: string;
}

function CollageHalfPane({ moment, authorName }: { moment: MomentRecord; authorName: string }) {
  const { colors, radii } = useKeepItTheme();
  const [swapped, setSwapped] = useState(false);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const back = moment.back_photo_url || moment.back_photo_path;
  const front = moment.front_photo_url || moment.front_photo_path;
  const main = swapped ? front : back;
  const pip = swapped ? back : front;
  const canSwap = Boolean(back && front);
  const missing = !main || failed[main];
  return <View style={styles.pane}>
    <View style={styles.paneHeading}>
      <Text style={[styles.author, { color: colors.ink }]}>{authorName}</Text>
      <Text style={[styles.secondary, { color: colors.inkMuted }]}>{new Date(moment.posted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{isMomentPromptCheckIn(moment) ? ` · ${formatLateDuration(moment.late_by_seconds)}` : ''}</Text>
    </View>
    <AppPressable accessibilityRole="button" accessibilityLabel={`Swap ${authorName} front and back lens in Together collage`} accessibilityHint={`Currently showing ${swapped ? 'front' : 'back'} camera as the main photo.`} accessibilityState={{ disabled: !canSwap }} disabled={!canSwap} onPress={() => { if (Platform.OS !== 'web') void Haptics.selectionAsync(); setLoading(true); setSwapped((value) => !value); }} style={[styles.photo, { backgroundColor: colors.canvas, borderRadius: radii.input, borderColor: colors.controlBorder }]}>
      {missing ? <View style={styles.imageState}><Text style={[styles.secondary, { color: colors.inkMuted, textAlign: 'center' }]}>Photo unavailable</Text></View> : <>
        <Image key={main} source={{ uri: main }} contentFit="cover" transition={0} style={StyleSheet.absoluteFill} onLoadStart={() => setLoading(true)} onLoad={() => setLoading(false)} onError={() => { setFailed((value) => ({ ...value, [main]: true })); setLoading(false); }} />
        {loading ? <View style={[styles.imageState, { backgroundColor: colors.canvas }]}><ActivityIndicator color={colors.ink} /><Text style={[styles.secondary, { color: colors.inkMuted }]}>Loading photo…</Text></View> : null}
        {pip && !failed[pip] ? <View style={[styles.pip, { borderColor: colors.canvas, borderRadius: radii.input }]}><Image source={{ uri: pip }} contentFit="cover" style={StyleSheet.absoluteFill} onError={() => setFailed((value) => ({ ...value, [pip]: true }))} /></View> : null}
      </>}
      <View pointerEvents="none" style={styles.lensLabel}><Text style={styles.lensText}>{swapped ? 'Front camera' : 'Back camera'}</Text></View>
    </AppPressable>
    {missing && main ? <KeepItButton label="Retry photo" variant="secondary" onPress={() => { setFailed({}); setLoading(true); }} /> : null}
    <Text style={[styles.secondary, { color: colors.inkMuted }]}>{canSwap ? 'Tap the photo to swap cameras.' : 'The second camera photo is unavailable.'}</Text>
    <Text style={[styles.caption, { color: moment.caption ? colors.ink : colors.inkMuted }]}>{moment.caption || 'No note left.'}</Text>
  </View>;
}

export function TogetherCollageCard({ promptDate, myMoment, partnerMoment, myName, partnerName, streakCount = 0, longestStreakCount, revealKey }: TogetherCollageCardProps) {
  const { colors, radii, type } = useKeepItTheme();
  const [saving, setSaving] = useState<'mine' | 'partner' | null>(null);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const availableStamps = getAvailableCollageStamps(streakCount, longestStreakCount ?? streakCount);
  const [stampIndex, setStampIndex] = useState(() => Math.max(0, availableStamps.length - 1));
  const activeStamp = availableStamps[stampIndex % availableStamps.length] ?? availableStamps[0];
  const isGoldenSync = !myMoment.is_late && !partnerMoment.is_late;
  const canCycleStamp = availableStamps.length > 1;
  const saveMoment = async (moment: MomentRecord, name: string, side: 'mine' | 'partner') => {
    const backUri = moment.back_photo_url || moment.back_photo_path;
    const frontUri = moment.front_photo_url || moment.front_photo_path;
    if (!backUri || !frontUri) { setNotice({ message: 'Both camera photos must be available to save this Moment.', error: true }); return; }
    setSaving(side); setNotice(null);
    try {
      const message = await exportAndShareCompositeMoment({ backUri, frontUri, authorName: name, postedAtIso: moment.posted_at, caption: moment.caption, filterPreset: moment.filter_preset, locationLabel: moment.location_label, musicTitle: moment.music_track?.title, taggedUsers: moment.tagged_users, overlays: moment.overlays, aspect: '3:4', baseFilename: `keepit-${promptDate}-${side}`, title: `${name}'s KeepIt Moment` });
      setNotice({ message, error: false });
    } catch (error) { setNotice({ message: error instanceof Error ? error.message : 'Could not save this Moment. Try again.', error: true }); }
    finally { setSaving(null); }
  };
  const formattedDate = new Date(`${promptDate}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return <RevealOnAppear revealKey={revealKey ?? `together:${promptDate}`}>
    <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: radii.card }]}>
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={[styles.title, { color: colors.ink, fontFamily: type.fontSans }]}>{formattedDate}</Text>
          {isGoldenSync ? (
            <View style={[styles.goldenPill, { backgroundColor: colors.canvas, borderColor: colors.success, borderRadius: radii.input }]}>
              <Text style={[styles.goldenText, { color: colors.success }]}>Golden Sync · On time</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.secondary, { color: colors.inkMuted }]}>
          {isMomentPromptCheckIn(myMoment) && isMomentPromptCheckIn(partnerMoment) && isGoldenSync ? 'Both checked in on time' : 'Both Moments archived'}
          {streakCount > 0 ? ` · ${streakCount}-day pulse` : ''}
        </Text>
      </View>
      <View style={styles.panes}><CollageHalfPane key={partnerMoment.id} moment={partnerMoment} authorName={partnerName} /><CollageHalfPane key={myMoment.id} moment={myMoment} authorName={myName} /></View>
      <View style={styles.watermarkRow}>
        <View style={styles.watermark}>
          <Text style={[styles.author, { color: colors.ink, fontFamily: type.fontMono }]}>{activeStamp.watermarkText}</Text>
          <Text style={[styles.secondary, { color: colors.inkMuted }]}>{formatMomentWatermarkTimestamp(myMoment.posted_at || partnerMoment.posted_at)}</Text>
        </View>
        {canCycleStamp ? (
          <AppPressable
            accessibilityRole="button"
            accessibilityLabel={`Cycle collage milestone stamp. Current stamp: ${activeStamp.label}`}
            onPress={() => {
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              setStampIndex((prev) => (prev + 1) % availableStamps.length);
            }}
            style={[styles.stampSwitch, { backgroundColor: colors.canvas, borderColor: colors.controlBorder, borderRadius: radii.input }]}>
            <Text style={[styles.stampSwitchText, { color: colors.ink }]}>
              Stamp ({(stampIndex % availableStamps.length) + 1}/{availableStamps.length})
            </Text>
          </AppPressable>
        ) : null}
      </View>
      {notice ? <InlineNotice tone={notice.error ? 'error' : 'info'} message={notice.message} /> : null}
      <View style={styles.saveActions}><KeepItButton label={`Save ${partnerName}'s Moment`} variant="secondary" loading={saving === 'partner'} disabled={saving !== null} onPress={() => void saveMoment(partnerMoment, partnerName, 'partner')} style={styles.saveButton} /><KeepItButton label="Save your Moment" variant="secondary" loading={saving === 'mine'} disabled={saving !== null} onPress={() => void saveMoment(myMoment, myName, 'mine')} style={styles.saveButton} /></View>
    </View>
  </RevealOnAppear>;
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 20 },
  header: { gap: 4 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  goldenPill: { paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  goldenText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  panes: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  pane: { flex: 1, minWidth: 0, gap: 8 },
  paneHeading: { minHeight: 64, gap: 3 },
  author: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  secondary: { fontSize: 13, lineHeight: 20 },
  caption: { fontSize: 15, lineHeight: 22 },
  photo: { width: '100%', aspectRatio: 0.65, minWidth: 0, borderWidth: 1, overflow: 'hidden' },
  imageState: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 8 },
  pip: { position: 'absolute', width: '36%', aspectRatio: 0.75, right: 8, bottom: 38, overflow: 'hidden', borderWidth: 2 },
  lensLabel: { position: 'absolute', bottom: 8, left: 6, right: 6, backgroundColor: '#0A0708', borderRadius: 5, paddingHorizontal: 4, paddingVertical: 3, alignItems: 'center' },
  lensText: { color: '#FFFFFF', fontSize: 11, lineHeight: 16, fontWeight: '600' },
  watermarkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  watermark: { flex: 1, minWidth: 160, gap: 2 },
  stampSwitch: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  stampSwitchText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  saveActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  saveButton: { flex: 1, minWidth: 120 },
});
