import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { InlineNotice, KeepItButton, KeepItWatermarkLogo } from '@/components/ui/Primitives';
import { AppPressable, SectionHeader } from '@/components/ui/ScreenKit';
import { useKeepItTheme } from '@/theme/tokens';
import { WidgetLayoutMode, WidgetSnapshotPayload } from '@/types/database';
import { formatMomentWatermarkTimestamp } from '@/utils/momentExport';
import { isKeepItWidgetPinned, requestPinKeepItWidgetDetailed } from '../../../modules/keepit-widget-bridge';

export type WidgetSizePreset = 'small' | 'medium';

export interface WidgetPreviewCardProps {
  snapshot: WidgetSnapshotPayload | null;
  lastSyncedAt?: string | null;
  widgetLayout?: WidgetLayoutMode;
  onChangeWidgetLayout?: (layout: WidgetLayoutMode) => void | Promise<void>;
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

export function WidgetPreviewCard({
  snapshot,
  lastSyncedAt,
  widgetLayout,
  onChangeWidgetLayout,
  onPressOpenApp,
  onPressCaptureLocked,
  onPressSyncNow,
  loading = false,
  syncError,
}: WidgetPreviewCardProps) {
  const { colors, radii } = useKeepItTheme();
  const [localLayout, setLocalLayout] = useState<WidgetLayoutMode>(
    widgetLayout ?? snapshot?.widgetLayout ?? 'side_by_side'
  );
  const effectiveLayout = widgetLayout ?? localLayout;
  const [now, setNow] = useState(() => Date.now());
  const [syncing, setSyncing] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedPhotoUri, setFailedPhotoUri] = useState<string | null>(null);
  const [failedMyPhotoUri, setFailedMyPhotoUri] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    void isKeepItWidgetPinned()
      .then((value) => {
        if (active) setPinned(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const busy = syncing || pinning;

  const handleSelectLayout = (next: WidgetLayoutMode) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setLocalLayout(next);
    void onChangeWidgetLayout?.(next);
  };

  const runSync = async () => {
    if (!onPressSyncNow || busy) return;
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      await onPressSyncNow();
      setFailedPhotoUri(null);
      setFailedMyPhotoUri(null);
      setNow(Date.now());
      setMessage('Widget synced.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sync the widget. Try again.');
    } finally {
      setSyncing(false);
    }
  };

  const pin = async () => {
    if (busy) return;
    setPinning(true);
    setError(null);
    setMessage(null);
    try {
      await onPressSyncNow?.();
      const result = await requestPinKeepItWidgetDetailed();
      setPinned(result.pinned);
      setMessage(result.pinned ? 'Widget pinned to your Home Screen.' : result.message);
      if (result.pinned && Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the widget. Try again.');
    } finally {
      setPinning(false);
    }
  };

  const locked = Boolean(snapshot?.momentLocked);
  const rawPartnerPhoto = !locked ? snapshot?.momentPhotoUri : null;
  const partnerPhoto =
    rawPartnerPhoto &&
    !rawPartnerPhoto.startsWith('data:image/svg+xml') &&
    rawPartnerPhoto !== failedPhotoUri
      ? rawPartnerPhoto
      : null;

  const rawMyPhoto = snapshot?.myPhotoUri ?? null;
  const myPhoto =
    rawMyPhoto && !rawMyPhoto.startsWith('data:image/svg+xml') && rawMyPhoto !== failedMyPhotoUri
      ? rawMyPhoto
      : null;

  const status =
    snapshot?.statusText &&
    (!snapshot.statusExpiresAt || new Date(snapshot.statusExpiresAt).getTime() > now)
      ? snapshot.statusText
      : null;

  const open = locked ? onPressCaptureLocked : onPressOpenApp;
  const partnerName = snapshot?.partnerName ?? 'Partner';
  const myName = snapshot?.myName ?? 'You';
  const watermarkTimestamp = formatMomentWatermarkTimestamp(
    snapshot?.momentPostedAt ?? snapshot?.updatedAt
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.group }]}>
      <SectionHeader
        title="Home Screen widget"
        subtitle={
          lastSyncedAt
            ? `Synced ${formatRelativeWidgetTime(lastSyncedAt, now).toLowerCase()}`
            : 'Choose side-by-side or single-photo layout.'
        }
      />

      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Widget photo layout"
        style={[
          styles.segmentedTrack,
          {
            backgroundColor: colors.canvas,
            borderColor: colors.controlBorder,
            borderRadius: radii.input,
          },
        ]}
      >
        {(
          [
            { value: 'side_by_side', label: 'Side by Side' },
            { value: 'partner_only', label: 'Single Photo' },
          ] as const
        ).map((opt) => {
          const selected = effectiveLayout === opt.value;
          return (
            <AppPressable
              key={opt.value}
              accessibilityRole="radio"
              accessibilityLabel={`${opt.label} widget layout`}
              accessibilityState={{ checked: selected }}
              onPress={() => handleSelectLayout(opt.value)}
              style={[
                styles.segmentedOption,
                {
                  backgroundColor: selected ? colors.ink : 'transparent',
                  borderRadius: radii.input - 2,
                },
              ]}
            >
              <Text
                style={[
                  styles.segmentedText,
                  { color: selected ? colors.canvas : colors.inkMuted },
                ]}
              >
                {opt.label}
              </Text>
            </AppPressable>
          );
        })}
      </View>

      <AppPressable
        accessibilityRole="button"
        accessibilityLabel="Widget preview"
        disabled={!open}
        onPress={open}
        style={[
          styles.widgetPreviewBox,
          {
            backgroundColor: colors.canvas,
            borderColor: colors.border,
            borderRadius: radii.card,
          },
        ]}
      >
        {effectiveLayout === 'side_by_side' ? (
          <View style={styles.sideBySideRow}>
            {/* My Photo Tile */}
            <View
              style={[
                styles.photoTile,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.border, borderRadius: radii.input },
              ]}
            >
              {myPhoto ? (
                <Image
                  source={{ uri: myPhoto }}
                  contentFit="cover"
                  style={StyleSheet.absoluteFill}
                  onError={() => setFailedMyPhotoUri(myPhoto)}
                />
              ) : (
                <Text style={[styles.tilePlaceholder, { color: colors.inkMuted }]}>No post yet</Text>
              )}
              <View style={styles.tileLabelPill}>
                <Text numberOfLines={1} style={styles.tileLabelText}>
                  {myName}
                </Text>
              </View>
            </View>

            {/* Partner Photo Tile */}
            <View
              style={[
                styles.photoTile,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.border, borderRadius: radii.input },
              ]}
            >
              {partnerPhoto ? (
                <Image
                  source={{ uri: partnerPhoto }}
                  contentFit="cover"
                  style={StyleSheet.absoluteFill}
                  onError={() => setFailedPhotoUri(partnerPhoto)}
                />
              ) : (
                <Text style={[styles.tilePlaceholder, { color: colors.inkMuted }]}>
                  {locked ? 'Locked' : 'Waiting'}
                </Text>
              )}
              <View style={styles.tileLabelPill}>
                <Text numberOfLines={1} style={styles.tileLabelText}>
                  {partnerName}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.singlePhotoTile,
              { backgroundColor: colors.surfaceElevated, borderColor: colors.border, borderRadius: radii.input },
            ]}
          >
            {partnerPhoto ? (
              <Image
                source={{ uri: partnerPhoto }}
                contentFit="cover"
                style={StyleSheet.absoluteFill}
                onError={() => setFailedPhotoUri(partnerPhoto)}
              />
            ) : (
              <Text style={[styles.tilePlaceholder, { color: colors.inkMuted }]}>
                {locked ? 'Post yours to unlock' : 'No Moment posted yet'}
              </Text>
            )}
            <View pointerEvents="none" style={styles.photoWatermark}>
              <KeepItWatermarkLogo width={44} color="#FFFFFF" />
              <Text numberOfLines={1} style={styles.photoWatermarkTime}>
                {watermarkTimestamp}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.widgetMetaFooter}>
          <Text numberOfLines={1} style={[styles.footerPrimary, { color: colors.ink }]}>
            {locked
              ? 'Post your Moment to unlock both photos'
              : status ?? snapshot?.momentCaption ?? `${myName} & ${partnerName}`}
          </Text>
          {snapshot?.streakCount ? (
            <Text style={[styles.footerSecondary, { color: colors.inkMuted }]}>
              {snapshot.streakCount}d
            </Text>
          ) : null}
        </View>
      </AppPressable>

      {error || syncError ? <InlineNotice tone="error" message={error ?? syncError!} /> : null}
      {message ? <InlineNotice tone="info" message={message} /> : null}

      <View style={styles.actionRow}>
        <KeepItButton
          label={pinned ? 'Add Widget' : 'Add to Home Screen'}
          loadingLabel="Adding…"
          variant="secondary"
          loading={pinning}
          disabled={busy || loading}
          onPress={() => void pin()}
          style={styles.flexBtn}
        />
        {onPressSyncNow ? (
          <KeepItButton
            label="Sync"
            loadingLabel="Syncing…"
            variant="ghost"
            loading={syncing}
            disabled={busy || loading}
            onPress={() => void runSync()}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  segmentedTrack: {
    flexDirection: 'row',
    borderWidth: 1,
    padding: 3,
    gap: 4,
  },
  segmentedOption: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  segmentedText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  widgetPreviewBox: {
    padding: 12,
    gap: 10,
    borderWidth: 1,
  },
  sideBySideRow: {
    flexDirection: 'row',
    gap: 8,
  },
  photoTile: {
    flex: 1,
    aspectRatio: 3 / 4,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  singlePhotoTile: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  tilePlaceholder: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  tileLabelPill: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(14, 14, 16, 0.78)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
    maxWidth: '85%',
  },
  tileLabelText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  photoWatermark: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    alignItems: 'flex-start',
    gap: 2,
  },
  photoWatermarkTime: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  widgetMetaFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 2,
  },
  footerPrimary: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  footerSecondary: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  flexBtn: {
    flex: 1,
  },
});
