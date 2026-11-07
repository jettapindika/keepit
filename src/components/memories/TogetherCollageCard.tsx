import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import React, { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { formatLateDuration } from '@/api/moments';
import { InlineNotice, KeepItButton, RevealOnAppear } from '@/components/ui/Primitives';
import { AppPressable } from '@/components/ui/ScreenKit';
import { useKeepItTheme } from '@/theme/tokens';
import { MomentRecord } from '@/types/database';
import { exportAndShareCompositeMoment, formatMomentWatermarkTimestamp } from '@/utils/momentExport';

export interface TogetherCollageCardProps {
  promptDate: string;
  myMoment: MomentRecord;
  partnerMoment: MomentRecord;
  myName: string;
  partnerName: string;
  streakCount?: number;
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

  return (
    <View style={styles.pane}>
      <View style={styles.paneHeading}>
        <Text numberOfLines={1} style={[styles.author, { color: colors.ink }]}>
          {authorName}
        </Text>
        <Text numberOfLines={1} style={[styles.secondary, { color: colors.inkMuted }]}>
          {new Date(moment.posted_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
          {moment.is_late ? ` · ${formatLateDuration(moment.late_by_seconds)}` : ''}
        </Text>
      </View>
      <AppPressable
        accessibilityRole="button"
        accessibilityLabel={`Swap ${authorName} front and back lens in Together collage`}
        accessibilityHint={`Currently showing ${swapped ? 'front' : 'back'} camera as the main photo.`}
        accessibilityState={{ disabled: !canSwap }}
        disabled={!canSwap}
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          setLoading(true);
          setSwapped((value) => !value);
        }}
        style={[
          styles.photo,
          {
            backgroundColor: colors.canvas,
            borderRadius: radii.input,
            borderColor: colors.controlBorder,
          },
        ]}>
        {missing ? (
          <View style={styles.imageState}>
            <Text style={[styles.secondary, { color: colors.inkMuted, textAlign: 'center' }]}>
              Photo unavailable
            </Text>
          </View>
        ) : (
          <>
            <Image
              key={main}
              source={{ uri: main }}
              contentFit="cover"
              transition={0}
              style={StyleSheet.absoluteFill}
              onLoadStart={() => setLoading(true)}
              onLoad={() => setLoading(false)}
              onError={() => {
                setFailed((value) => ({ ...value, [main]: true }));
                setLoading(false);
              }}
            />
            {loading ? (
              <View style={[styles.imageState, { backgroundColor: colors.canvas }]}>
                <ActivityIndicator color={colors.ink} />
              </View>
            ) : null}
            {pip && !failed[pip] ? (
              <View
                style={[
                  styles.pip,
                  { borderColor: colors.canvas, borderRadius: radii.input },
                ]}>
                <Image
                  source={{ uri: pip }}
                  contentFit="cover"
                  style={StyleSheet.absoluteFill}
                  onError={() => setFailed((value) => ({ ...value, [pip]: true }))}
                />
              </View>
            ) : null}
          </>
        )}
        <View pointerEvents="none" style={styles.lensBadge}>
          <SymbolView
            name={{
              ios: 'arrow.triangle.2.circlepath.camera',
              android: 'flip_camera_android',
              web: 'flip_camera_android',
            }}
            tintColor="#FFFFFF"
            size={13}
          />
          <Text style={styles.lensText}>{swapped ? 'Front' : 'Back'}</Text>
        </View>
      </AppPressable>
      {missing && main ? (
        <KeepItButton
          label="Retry photo"
          variant="secondary"
          onPress={() => {
            setFailed({});
            setLoading(true);
          }}
        />
      ) : null}
      {moment.caption ? (
        <Text numberOfLines={2} style={[styles.caption, { color: colors.ink }]}>
          {moment.caption}
        </Text>
      ) : null}
    </View>
  );
}

export function TogetherCollageCard({
  promptDate,
  myMoment,
  partnerMoment,
  myName,
  partnerName,
  streakCount,
  revealKey,
}: TogetherCollageCardProps) {
  const { colors, radii, type } = useKeepItTheme();
  const [saving, setSaving] = useState<'mine' | 'partner' | null>(null);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);

  const saveMoment = async (
    moment: MomentRecord,
    name: string,
    side: 'mine' | 'partner'
  ) => {
    const backUri = moment.back_photo_url || moment.back_photo_path;
    const frontUri = moment.front_photo_url || moment.front_photo_path;
    if (!backUri || !frontUri) {
      setNotice({
        message: 'Both camera photos must be available to save this Moment.',
        error: true,
      });
      return;
    }
    setSaving(side);
    setNotice(null);
    try {
      const message = await exportAndShareCompositeMoment({
        backUri,
        frontUri,
        authorName: name,
        postedAtIso: moment.posted_at,
        caption: moment.caption,
        filterPreset: moment.filter_preset,
        locationLabel: moment.location_label,
        musicTitle: moment.music_track?.title,
        taggedUsers: moment.tagged_users,
        overlays: moment.overlays,
        aspect: '3:4',
        baseFilename: `keepit-${promptDate}-${side}`,
        title: `${name}'s KeepIt Moment`,
      });
      setNotice({ message, error: false });
    } catch (error) {
      setNotice({
        message:
          error instanceof Error ? error.message : 'Could not save this Moment. Try again.',
        error: true,
      });
    } finally {
      setSaving(null);
    }
  };

  const formattedDate = new Date(`${promptDate}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <RevealOnAppear revealKey={revealKey ?? `together:${promptDate}`}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.card,
          },
        ]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.ink, fontFamily: type.fontSans }]}>
            {formattedDate}
          </Text>
          {typeof streakCount === 'number' && streakCount > 0 ? (
            <View style={styles.streakBadge}>
              <SymbolView
                name={{
                  ios: 'flame.fill',
                  android: 'local_fire_department',
                  web: 'local_fire_department',
                }}
                tintColor={colors.inkMuted}
                size={14}
              />
              <Text style={[styles.secondary, { color: colors.inkMuted }]}>
                {streakCount}d
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.panes}>
          <CollageHalfPane
            key={partnerMoment.id}
            moment={partnerMoment}
            authorName={partnerName}
          />
          <CollageHalfPane key={myMoment.id} moment={myMoment} authorName={myName} />
        </View>

        <View style={styles.footerBar}>
          <View style={styles.watermark}>
            <Text style={[styles.author, { color: colors.ink }]}>#keepit</Text>
            <Text style={[styles.secondary, { color: colors.inkMuted }]}>
              {formatMomentWatermarkTimestamp(myMoment.posted_at || partnerMoment.posted_at)}
            </Text>
          </View>

          <View style={styles.saveActions}>
            <AppPressable
              accessibilityRole="button"
              accessibilityLabel={`Save ${partnerName}'s Moment`}
              accessibilityShowsLargeContentViewer
              accessibilityLargeContentTitle={`Save ${partnerName}`}
              disabled={saving !== null}
              onPress={() => void saveMoment(partnerMoment, partnerName, 'partner')}
              style={[
                styles.saveIconBtn,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.controlBorder,
                  borderRadius: radii.input,
                },
              ]}>
              {saving === 'partner' ? (
                <ActivityIndicator size="small" color={colors.ink} />
              ) : (
                <SymbolView
                  name={{
                    ios: 'square.and.arrow.down',
                    android: 'download',
                    web: 'download',
                  }}
                  tintColor={colors.ink}
                  size={16}
                />
              )}
              <Text numberOfLines={1} style={[styles.saveBtnLabel, { color: colors.ink }]}>
                {partnerName}
              </Text>
            </AppPressable>

            <AppPressable
              accessibilityRole="button"
              accessibilityLabel="Save your Moment"
              accessibilityShowsLargeContentViewer
              accessibilityLargeContentTitle="Save Yours"
              disabled={saving !== null}
              onPress={() => void saveMoment(myMoment, myName, 'mine')}
              style={[
                styles.saveIconBtn,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.controlBorder,
                  borderRadius: radii.input,
                },
              ]}>
              {saving === 'mine' ? (
                <ActivityIndicator size="small" color={colors.ink} />
              ) : (
                <SymbolView
                  name={{
                    ios: 'square.and.arrow.down',
                    android: 'download',
                    web: 'download',
                  }}
                  tintColor={colors.ink}
                  size={16}
                />
              )}
              <Text numberOfLines={1} style={[styles.saveBtnLabel, { color: colors.ink }]}>
                Yours
              </Text>
            </AppPressable>
          </View>
        </View>

        {notice ? (
          <InlineNotice tone={notice.error ? 'error' : 'info'} message={notice.message} />
        ) : null}
      </View>
    </RevealOnAppear>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 14, borderWidth: 1, borderCurve: 'continuous' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  panes: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  pane: { flex: 1, minWidth: 0, gap: 6 },
  paneHeading: { gap: 2 },
  author: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  secondary: { fontSize: 12, lineHeight: 17 },
  caption: { fontSize: 13, lineHeight: 18 },
  photo: {
    width: '100%',
    aspectRatio: 0.68,
    minWidth: 0,
    borderWidth: 1,
    overflow: 'hidden',
  },
  imageState: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    gap: 8,
  },
  pip: {
    position: 'absolute',
    width: '36%',
    aspectRatio: 0.75,
    right: 8,
    bottom: 36,
    overflow: 'hidden',
    borderWidth: 2,
  },
  lensBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(10, 7, 8, 0.78)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lensText: { color: '#FFFFFF', fontSize: 11, lineHeight: 14, fontWeight: '600' },
  footerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  watermark: { gap: 1 },
  saveActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  saveIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  saveBtnLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    maxWidth: 90,
  },
});
