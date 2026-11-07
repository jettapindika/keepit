import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { InlineNotice, KeepItButton, KeepItWatermarkLogo } from '@/components/ui/Primitives';
import { AppPressable, SectionHeader } from '@/components/ui/ScreenKit';
import { useKeepItTheme } from '@/theme/tokens';
import { WidgetSnapshotPayload } from '@/types/database';
import { formatMomentWatermarkTimestamp } from '@/utils/momentExport';
import { isKeepItWidgetPinned, requestPinKeepItWidgetDetailed } from '../../../modules/keepit-widget-bridge';

export type WidgetSizePreset = 'small' | 'medium';
export interface WidgetPreviewCardProps {
  snapshot: WidgetSnapshotPayload | null;
  lastSyncedAt?: string | null;
  onPressOpenApp?: () => void;
  onPressCaptureLocked?: () => void;
  onPressSyncNow?: () => void | Promise<void>;
  initialSize?: WidgetSizePreset;
  loading?: boolean;
  syncError?: string | null;
}
export function formatRelativeWidgetTime(isoString: string | null | undefined, nowMs = Date.now()): string {
  if (!isoString) return 'Not synced yet';
  const parsed = new Date(isoString).getTime();
  if (!Number.isFinite(parsed)) return 'Time unavailable';
  const seconds = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
export function WidgetPreviewCard({ snapshot, lastSyncedAt, onPressOpenApp, onPressCaptureLocked, onPressSyncNow, initialSize = 'medium', loading = false, syncError }: WidgetPreviewCardProps) {
  const { colors, radii } = useKeepItTheme();
  const [size, setSize] = useState(initialSize);
  const [now, setNow] = useState(() => Date.now());
  const [syncing, setSyncing] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedPhotoUri, setFailedPhotoUri] = useState<string | null>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let active = true;
    void isKeepItWidgetPinned().then((value) => { if (active) setPinned(value); }).catch(() => { if (active) setError('Could not check whether your widget is pinned. You can try adding it again.'); });
    return () => { active = false; };
  }, []);
  const busy = syncing || pinning;
  const runSync = async () => {
    if (!onPressSyncNow || busy) return;
    setSyncing(true); setError(null); setMessage(null);
    try { await onPressSyncNow(); setFailedPhotoUri(null); setNow(Date.now()); setMessage('Widget sync completed.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not sync the widget. Try again.'); }
    finally { setSyncing(false); }
  };
  const pin = async () => {
    if (busy) return;
    setPinning(true); setError(null); setMessage(null);
    try {
      await onPressSyncNow?.();
      const result = await requestPinKeepItWidgetDetailed();
      setPinned(result.pinned);
      setMessage(result.pinned ? 'Widget pinned to your Home Screen.' : result.message);
      if (result.pinned && Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not add the widget. Try again.'); }
    finally { setPinning(false); }
  };
  const locked = Boolean(snapshot?.momentLocked);
  const rawPhoto = !locked ? snapshot?.momentPhotoUri : null;
  const photo = rawPhoto && !rawPhoto.startsWith('data:image/svg+xml') && rawPhoto !== failedPhotoUri ? rawPhoto : null;
  const status = snapshot?.statusText && (!snapshot.statusExpiresAt || new Date(snapshot.statusExpiresAt).getTime() > now) ? `${snapshot.statusEmoji ? `${snapshot.statusEmoji} ` : ''}${snapshot.statusText}` : null;
  const open = locked ? onPressCaptureLocked : onPressOpenApp;
  const partnerName = snapshot?.partnerName ?? 'Your partner';
  const ownerPossessive = partnerName === 'You' ? 'your' : `${partnerName}’s`;
  const watermarkTimestamp = formatMomentWatermarkTimestamp(snapshot?.momentPostedAt ?? snapshot?.updatedAt);
  const photoBlock = <View style={[styles.photo, size === 'small' ? styles.smallPhoto : styles.mediumPhoto, { backgroundColor: colors.surfaceElevated, borderRadius: radii.input }]}>
    {photo ? <><Image accessibilityLabel={`${ownerPossessive} widget photo`} source={{ uri: photo }} contentFit="cover" style={StyleSheet.absoluteFill} onError={() => setFailedPhotoUri(photo)} />{snapshot?.momentFrontPhotoUri && !snapshot.momentFrontPhotoUri.startsWith('data:image/svg+xml') ? <Image accessibilityLabel="Other camera view" source={{ uri: snapshot.momentFrontPhotoUri }} contentFit="cover" style={[styles.pip, { borderColor: colors.canvas }]} /> : null}<View pointerEvents="none" style={styles.photoWatermark}><KeepItWatermarkLogo width={46} color="#FFFFFF" /><Text numberOfLines={1} style={styles.photoWatermarkTime}>{watermarkTimestamp}</Text></View></> : <Text style={[styles.secondary, { color: colors.inkMuted, textAlign: 'center' }]}>{locked ? 'Moment locked' : rawPhoto ? 'Photo unavailable' : 'No Moment photo'}</Text>}
  </View>;
  return <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: radii.group }]}>
    <SectionHeader title="Your Home Screen widget" subtitle={lastSyncedAt ? `Last synced ${formatRelativeWidgetTime(lastSyncedAt, now).toLowerCase()}` : 'Preview only. No successful sync recorded yet.'} />
    <View accessibilityRole="tablist" accessibilityLabel="Widget preview size" style={styles.tabs}>
      {(['small', 'medium'] as const).map((option) => <AppPressable key={option} accessibilityRole="tab" accessibilityState={{ selected: size === option }} onPress={() => { setSize(option); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }} style={[styles.tab, { backgroundColor: size === option ? colors.accent : colors.surfaceElevated, borderRadius: radii.input }]}><Text style={[styles.actionText, { color: size === option ? colors.onAccent : colors.ink }]}>{option === 'small' ? 'Small · 2×2' : 'Medium · 4×2'}</Text></AppPressable>)}
    </View>
    <View style={[styles.stage, { backgroundColor: colors.canvas, borderRadius: radii.card }]}>
      {loading && !snapshot ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.inkMuted }]}>Loading widget content…</Text> : !snapshot ? <View style={styles.empty}>
        <Text style={[styles.title, { color: colors.ink }]}>No widget content yet</Text><Text style={[styles.body, { color: colors.inkMuted }]}>Sync to load the Moment and status currently available to your account. A preview is not proof that a widget is installed.</Text>
      </View> : <AppPressable accessibilityRole="button" accessibilityLabel={locked ? `Capture your Moment to unlock ${ownerPossessive} widget photo` : `Open ${ownerPossessive} Moment from widget preview`} disabled={!open} onPress={open} style={[styles.preview, size === 'small' ? styles.small : styles.medium, { backgroundColor: colors.surface, borderRadius: radii.card }]}>
        {photoBlock}
        <View style={styles.copy}>
          <Text numberOfLines={2} style={[styles.title, { color: colors.ink }]}>{partnerName}</Text>
          <Text numberOfLines={3} style={[styles.body, { color: colors.ink }]}>{locked ? 'Post yours to unlock this Moment.' : status ?? snapshot.momentCaption ?? 'No active status or Moment caption.'}</Text>
          <Text style={[styles.secondary, { color: colors.inkMuted }]}>{snapshot.momentPostedAt ? formatRelativeWidgetTime(snapshot.momentPostedAt, now) : 'No Moment posted yet'}</Text>
          {snapshot.streakCount > 0 ? <Text style={[styles.secondary, { color: colors.inkMuted }]}>{snapshot.streakCount}-day streak</Text> : null}
        </View>
      </AppPressable>}
    </View>
    <Text style={[styles.secondary, { color: colors.inkMuted }]}>Preview size does not change the size installed on your device. Resize it on your Home Screen.</Text>
    {error || syncError ? <InlineNotice tone="error" message={error ?? syncError!} /> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.ink }]}>{message}</Text> : null}
    {pinned ? <Text style={[styles.secondary, { color: colors.ink }]}>Widget pin confirmed on this device.</Text> : null}
    <KeepItButton label={pinned ? 'Add another widget' : 'Add to Home Screen'} loadingLabel="Requesting widget…" variant="secondary" loading={pinning} disabled={busy || loading} onPress={() => void pin()} />
    {onPressSyncNow ? <KeepItButton label={error || syncError ? 'Retry widget sync' : 'Sync widget now'} loadingLabel="Syncing widget…" variant="secondary" loading={syncing} disabled={busy || loading} onPress={() => void runSync()} /> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 20, gap: 16 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  stage: { padding: 12, alignItems: 'center' },
  preview: { padding: 12, gap: 14, maxWidth: '100%' },
  small: { width: 220 },
  medium: { width: '100%', flexDirection: 'row', flexWrap: 'wrap' },
  photo: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', padding: 12 },
  smallPhoto: { width: '100%', aspectRatio: 1.4 },
  mediumPhoto: { flexBasis: 110, flexGrow: 1, aspectRatio: 1 },
  pip: { position: 'absolute', top: 8, left: 8, width: 34, height: 46, borderWidth: 2, borderRadius: 8 },
  photoWatermark: { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(10, 7, 8, 0.78)', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 4, alignItems: 'flex-start', gap: 1.5 },
  photoWatermarkTime: { color: '#FFFFFF', fontSize: 9.5, lineHeight: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  copy: { flexGrow: 1, flexBasis: 120, gap: 6, minWidth: 0 },
  empty: { padding: 8, gap: 10 },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
  secondary: { fontSize: 13, lineHeight: 20 },
  actionText: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
});
