import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { usePreventRemove, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { clearMyStatus, DURATION_OPTIONS, fetchCoupleStatuses, formatStatusRemaining, STATUS_PRESETS, upsertMyStatus } from '@/api/statuses';
import { InlineNotice, KeepItButton, SkeletonBlock } from '@/components/ui/Primitives';
import { AppPressable, AppTextInput, ConfirmModal, PageHeader, SectionHeader } from '@/components/ui/ScreenKit';
import { useSessionStore } from '@/store/sessionStore';
import { APP_LAYOUT, useKeepItTheme } from '@/theme/tokens';
import { StatusDurationPreset } from '@/types/database';

export default function StatusSheetScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors, radii } = useKeepItTheme();
  const user = useSessionStore((s) => s.user);
  const couple = useSessionStore((s) => s.couple);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [draft, setDraft] = useState<{ emoji: string; text: string; duration: StatusDurationPreset } | null>(null);
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);
  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'discard' | 'clear' | null>(null);
  const [allowLeave, setAllowLeave] = useState(false);
  const pendingRemoval = useRef<(() => void) | null>(null);
  const statusQuery = useQuery({
    queryKey: ['couple-statuses', couple?.id, user?.id],
    enabled: Boolean(couple?.id && user?.id),
    queryFn: () => fetchCoupleStatuses({ coupleId: couple!.id, userId: user!.id }),
  });
  const existing = statusQuery.data?.mine ?? null;
  const value = draft ?? { emoji: existing?.emoji ?? '📚', text: existing?.text ?? '', duration: existing?.duration_preset ?? '1h' };
  const dirty = Boolean(draft && (draft.emoji !== (existing?.emoji ?? '📚') || draft.text !== (existing?.text ?? '') || draft.duration !== (existing?.duration_preset ?? '1h')));
  const ready = Boolean(user && couple && statusQuery.isSuccess);
  const disablePrevention = usePreventRemove(!allowLeave && (dirty || Boolean(busy)), ({ repeat }) => {
    if (busy) return;
    pendingRemoval.current = repeat;
    setConfirm('discard');
  });
  const leave = () => {
    setAllowLeave(true);
    disablePrevention();
    setTimeout(() => {
      if (pendingRemoval.current) pendingRemoval.current();
      else if (router.canGoBack()) router.back();
      else router.replace('/(tabs)');
    }, 0);
  };
  const close = () => {
    if (busy) return;
    if (dirty) setConfirm('discard');
    else if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };
  const update = (next: Partial<typeof value>) => {
    if (!ready || busy) return;
    setError(null);
    setDraft({ ...value, ...next });
  };
  const save = async () => {
    if (!user || !couple || !ready || busy || !value.text.trim() || !value.emoji.trim()) return;
    setBusy('save');
    setError(null);
    try {
      await upsertMyStatus({ coupleId: couple.id, userId: user.id, emoji: value.emoji, text: value.text, durationPreset: value.duration });
      await queryClient.invalidateQueries({ queryKey: ['couple-statuses', couple.id] });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      leave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your status. Try again.');
    } finally { setBusy(null); }
  };
  const clear = async () => {
    if (!user || !couple || !ready || busy || !existing) return;
    setBusy('clear');
    setError(null);
    try {
      await clearMyStatus(user.id);
      await queryClient.invalidateQueries({ queryKey: ['couple-statuses', couple.id] });
      leave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear your status. Try again.');
    } finally { setBusy(null); }
  };
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
        <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
          <PageHeader title="Share status" subtitle="A little context for your partner, for as long as you choose." action={
            <AppPressable accessibilityRole="button" accessibilityLabel="Close status sheet" disabled={Boolean(busy)} onPress={close} style={styles.close}>
              <Text style={[styles.action, { color: colors.ink }]}>Close</Text>
            </AppPressable>
          } />
          {statusQuery.isLoading ? <SkeletonBlock height={100} label="Loading your current status…" /> : null}
          {statusQuery.isError ? <View style={styles.section}>
            <InlineNotice tone="error" message={statusQuery.error instanceof Error ? statusQuery.error.message : 'Could not load your current status.'} />
            <KeepItButton label="Retry loading status" variant="secondary" loading={statusQuery.isFetching} onPress={() => void statusQuery.refetch()} />
          </View> : null}
          {!user || !couple ? <InlineNotice tone="error" message="Sign in to load and edit your status." /> : null}
          {ready ? <>
            {existing ? <View style={[styles.current, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
              <Text style={[styles.secondary, { color: colors.inkMuted }]}>Current status</Text>
              <Text style={[styles.body, { color: colors.ink, fontWeight: '600' }]}>{existing.text}</Text>
              <Text style={[styles.secondary, { color: colors.inkMuted }]}>{formatStatusRemaining(existing.expires_at)}</Text>
            </View> : null}
            <View style={styles.section}>
              <SectionHeader title="Quick preset" />
              <AppPressable
                accessibilityRole="button"
                accessibilityLabel="Choose status preset"
                accessibilityState={{ expanded: presetDropdownOpen, disabled: Boolean(busy) }}
                disabled={Boolean(busy)}
                onPress={() => setPresetDropdownOpen((open) => !open)}
                style={[styles.dropdownTrigger, { backgroundColor: colors.surface, borderColor: colors.controlBorder, borderRadius: radii.input }]}
              >
                <Text style={[styles.body, styles.grow, { color: value.text ? colors.ink : colors.inkMuted }]}>
                  {STATUS_PRESETS.find((p) => p.text === value.text)?.text ?? 'Select a preset…'}
                </Text>
                <SymbolView
                  name={presetDropdownOpen ? { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' } : { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
                  tintColor={colors.inkMuted}
                  size={16}
                />
              </AppPressable>
              {presetDropdownOpen ? (
                <View accessibilityRole="radiogroup" accessibilityLabel="Status presets" style={[styles.dropdownMenu, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.input }]}>
                  {STATUS_PRESETS.map((preset) => {
                    const checked = value.text === preset.text;
                    return (
                      <AppPressable
                        key={preset.id}
                        accessibilityRole="radio"
                        accessibilityState={{ checked, disabled: Boolean(busy) }}
                        accessibilityLabel={preset.text}
                        disabled={Boolean(busy)}
                        onPress={() => {
                          update({ emoji: preset.emoji, text: preset.text, duration: preset.defaultDuration });
                          setPresetDropdownOpen(false);
                        }}
                        style={[styles.dropdownOption, { backgroundColor: checked ? colors.surfaceElevated : 'transparent', borderRadius: radii.input - 2 }]}
                      >
                        <Text style={[styles.body, styles.grow, { color: colors.ink, fontWeight: checked ? '700' : '400' }]}>{preset.text}</Text>
                        {checked ? <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} tintColor={colors.ink} size={15} /> : null}
                      </AppPressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
            <View style={styles.section}>
              <SectionHeader title="Your status" />
              <AppTextInput
                ref={inputRef}
                accessibilityLabel="Status text, 40 characters maximum"
                editable={!busy}
                maxLength={40}
                value={value.text}
                placeholder="What are you up to?"
                onChangeText={(text) => update({ text, emoji: value.emoji || '•' })}
                returnKeyType="done"
                onSubmitEditing={() => void save()}
              />
              <Text style={[styles.counter, styles.secondary, { color: colors.inkMuted }]}>{value.text.length}/40 characters</Text>
            </View>
            <View style={styles.section}>
              <SectionHeader title="Show until" />
              <View accessibilityRole="radiogroup" accessibilityLabel="Status expiry" style={styles.durationRow}>
                {DURATION_OPTIONS.map((option) => {
                  const checked = value.duration === option.value;
                  return <AppPressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked, disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => update({ duration: option.value })} style={[styles.duration, { backgroundColor: checked ? colors.ink : colors.surface, borderColor: checked ? colors.ink : colors.controlBorder, borderRadius: radii.input }]}>
                    <Text style={[styles.action, { color: checked ? colors.canvas : colors.ink }]}>{option.label}</Text>
                  </AppPressable>;
                })}
              </View>
            </View>
            {error ? <InlineNotice tone="error" message={error} /> : null}
            <KeepItButton label="Save status" loadingLabel="Saving status…" loading={busy === 'save'} disabled={Boolean(busy) || !value.text.trim()} onPress={() => void save()} />
            {existing ? <KeepItButton label="Clear active status" variant="secondary" disabled={Boolean(busy)} onPress={() => setConfirm('clear')} /> : null}
          </> : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <ConfirmModal
        visible={Boolean(confirm)}
        title={confirm === 'discard' ? 'Discard your changes?' : 'Clear your active status?'}
        message={confirm === 'discard' ? 'Your unsaved edits will be lost.' : 'It will be removed from the app and widget.'}
        confirmLabel={confirm === 'discard' ? 'Discard changes' : 'Clear status'}
        cancelLabel="Keep editing"
        loading={busy === 'clear'}
        onCancel={() => {
          pendingRemoval.current = null;
          setConfirm(null);
        }}
        onConfirm={() => (confirm === 'discard' ? leave() : void clear())}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { width: '100%', maxWidth: APP_LAYOUT.modalWidth, alignSelf: 'center', padding: APP_LAYOUT.pageInset, paddingBottom: 48, gap: 20 },
  close: { paddingHorizontal: 10, justifyContent: 'center' },
  current: { padding: 16, gap: 6, borderWidth: 1 },
  section: { gap: 10 },
  dropdownTrigger: { minHeight: 50, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  dropdownMenu: { borderWidth: 1, padding: 6, gap: 2 },
  dropdownOption: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  counter: { textAlign: 'right' },
  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  duration: { minWidth: 90, flexGrow: 1, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: 15, lineHeight: 22 },
  secondary: { fontSize: 13, lineHeight: 20 },
  action: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
});
