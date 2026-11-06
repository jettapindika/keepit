import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  clearMyStatus,
  DURATION_OPTIONS,
  fetchCoupleStatuses,
  formatStatusRemaining,
  STATUS_PRESETS,
  upsertMyStatus,
} from '@/api/statuses';
import { InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';
import { StatusDurationPreset } from '@/types/database';

export default function StatusSheetScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors, radii, spacing } = useKeepItTheme();

  const user = useSessionStore((s) => s.user);
  const partner = useSessionStore((s) => s.partner);
  const couple = useSessionStore((s) => s.couple);

  const statusQuery = useQuery({
    queryKey: ['couple-statuses', couple?.id, user?.id],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () =>
      fetchCoupleStatuses({
        coupleId: couple!.id,
        userId: user!.id,
      }),
  });

  const existingMine = statusQuery.data?.mine ?? null;

  const [emoji, setEmoji] = useState('📚');
  const [text, setText] = useState('');
  const [duration, setDuration] = useState<StatusDurationPreset>('1h');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!existingMine) return;
    setEmoji(existingMine.emoji);
    setText(existingMine.text);
    setDuration(existingMine.duration_preset);
  }, [existingMine?.updated_at]);

  const handleSelectPreset = (preset: (typeof STATUS_PRESETS)[number]) => {
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
    setError(null);
    setEmoji(preset.emoji);
    setText(preset.text);
    setDuration(preset.defaultDuration);
  };

  const handleSaveStatus = async () => {
    if (!user || !couple) return;
    setError(null);
    setSaving(true);
    try {
      await upsertMyStatus({
        coupleId: couple.id,
        userId: user.id,
        emoji,
        text,
        durationPreset: duration,
      });

      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      await queryClient.invalidateQueries({ queryKey: ['couple-statuses', couple.id] });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status.');
    } finally {
      setSaving(false);
    }
  };

  const handleClearStatus = async () => {
    if (!user || !couple) return;
    setError(null);
    setClearing(true);
    try {
      await clearMyStatus(user.id);
      if (Platform.OS !== 'web') {
        void Haptics.selectionAsync();
      }
      await queryClient.invalidateQueries({ queryKey: ['couple-statuses', couple.id] });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear status.');
    } finally {
      setClearing(false);
    }
  };

  const partnerName = partner?.display_name ?? 'your partner';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.sheetSurface }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            { paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
          ]}>
          {/* Top Header */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.title, { color: colors.ink }]}>Share your status</Text>
              <Text style={[styles.subtitle, { color: colors.inkMuted }]}>
                Visible to {partnerName} and synced to your Home widget.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close status sheet"
              onPress={() => router.back()}
              style={styles.closeBtn}>
              <Text style={[styles.closeText, { color: colors.inkMuted }]}>Close</Text>
            </Pressable>
          </View>

          {existingMine ? (
            <View
              style={[
                styles.activeBanner,
                {
                  backgroundColor: colors.accentSoft,
                  borderColor: colors.accent,
                  borderRadius: radii.input,
                },
              ]}>
              <Text style={[styles.activeBannerText, { color: colors.ink }]}>
                Current: {existingMine.emoji} {existingMine.text} ·{' '}
                {formatStatusRemaining(existingMine.expires_at)}
              </Text>
            </View>
          ) : null}

          {/* Quick Presets Grid */}
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionLabel, { color: colors.ink }]}>Quick presets</Text>
            <View style={styles.presetGrid}>
              {STATUS_PRESETS.map((preset) => {
                const selected = emoji === preset.emoji && text === preset.text;
                return (
                  <Pressable
                    key={preset.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Preset ${preset.emoji} ${preset.text}`}
                    accessibilityState={{ selected }}
                    onPress={() => handleSelectPreset(preset)}
                    style={[
                      styles.presetChip,
                      {
                        backgroundColor: selected
                          ? colors.accentSoft
                          : colors.surface,
                        borderColor: selected ? colors.accent : colors.border,
                        borderRadius: radii.input,
                      },
                    ]}>
                    <Text style={styles.presetEmoji}>{preset.emoji}</Text>
                    <View style={styles.flex}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.presetText,
                          { color: colors.ink, fontWeight: selected ? '700' : '600' },
                        ]}>
                        {preset.text}
                      </Text>
                      <Text style={[styles.presetDurationHint, { color: colors.inkMuted }]}>
                        {preset.defaultDuration === 'tonight'
                          ? 'Till tonight'
                          : preset.defaultDuration}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Custom Emoji + Short Text */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.card,
                padding: spacing.lg,
                gap: spacing.md,
              },
            ]}>
            <Text style={[styles.sectionLabel, { color: colors.ink }]}>Custom status</Text>
            <View style={styles.customInputRow}>
              <TextInput
                accessibilityLabel="Status emoji"
                maxLength={4}
                value={emoji}
                placeholder="☕"
                placeholderTextColor={colors.inkMuted}
                onChangeText={(val) => {
                  setError(null);
                  setEmoji(val);
                }}
                style={[
                  styles.emojiInput,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                    color: colors.ink,
                    borderRadius: radii.input,
                  },
                ]}
              />

              <TextInput
                accessibilityLabel="Status short text"
                maxLength={40}
                value={text}
                placeholder="What are you up to?"
                placeholderTextColor={colors.inkMuted}
                onChangeText={(val) => {
                  setError(null);
                  setText(val);
                }}
                onSubmitEditing={() => void handleSaveStatus()}
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                    color: colors.ink,
                    borderRadius: radii.input,
                  },
                ]}
              />
            </View>
          </View>

          {/* Auto-Expiry Duration Selector */}
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionLabel, { color: colors.ink }]}>Auto-expires after</Text>
            <View
              accessibilityRole="radiogroup"
              style={[
                styles.durationTrack,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.input,
                },
              ]}>
              {DURATION_OPTIONS.map((opt) => {
                const selected = duration === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    accessibilityRole="radio"
                    accessibilityLabel={`Expire after ${opt.label}`}
                    accessibilityState={{ selected }}
                    onPress={() => setDuration(opt.value)}
                    style={[
                      styles.durationSegment,
                      {
                        backgroundColor: selected ? colors.surfaceElevated : 'transparent',
                        borderColor: selected ? colors.accent : 'transparent',
                        borderRadius: radii.input - 2,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.durationLabel,
                        {
                          color: selected ? colors.ink : colors.inkMuted,
                          fontWeight: selected ? '700' : '500',
                        },
                      ]}>
                      {opt.label}
                    </Text>
                    <Text style={[styles.durationSub, { color: colors.inkMuted }]}>
                      {opt.description}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {error ? <InlineNotice message={error} tone="error" /> : null}

          <KeepItButton
            label="Save Status"
            loading={saving}
            disabled={clearing}
            onPress={() => void handleSaveStatus()}
          />

          {existingMine ? (
            <KeepItButton
              label="Clear Active Status"
              variant="secondary"
              loading={clearing}
              disabled={saving}
              onPress={() => void handleClearStatus()}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
    gap: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  closeBtn: {
    minHeight: 36,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  activeBanner: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderCurve: 'continuous',
  },
  activeBannerText: {
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  presetChip: {
    width: '48%',
    flexGrow: 1,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 54,
    borderCurve: 'continuous',
  },
  presetEmoji: {
    fontSize: 20,
  },
  presetText: {
    fontSize: 14,
  },
  presetDurationHint: {
    fontSize: 11,
    marginTop: 1,
  },
  card: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  customInputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  emojiInput: {
    width: 60,
    minHeight: 48,
    borderWidth: 1,
    textAlign: 'center',
    fontSize: 22,
    borderCurve: 'continuous',
  },
  textInput: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    borderCurve: 'continuous',
  },
  durationTrack: {
    flexDirection: 'row',
    borderWidth: 1,
    padding: 4,
    gap: 6,
    borderCurve: 'continuous',
  },
  durationSegment: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderCurve: 'continuous',
  },
  durationLabel: {
    fontSize: 13,
  },
  durationSub: {
    fontSize: 10,
    textAlign: 'center',
  },
});
