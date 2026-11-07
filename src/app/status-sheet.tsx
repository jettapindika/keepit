import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { usePreventRemove, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { clearMyStatus, DURATION_OPTIONS, fetchCoupleStatuses, formatStatusRemaining, STATUS_PRESETS, upsertMyStatus } from '@/api/statuses';
import { InlineNotice, KeepItButton, SkeletonBlock } from '@/components/ui/Primitives';
import { AppPressable, AppTextInput, PageHeader, SectionHeader } from '@/components/ui/ScreenKit';
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
            {existing ? <View style={[styles.current, { backgroundColor: colors.surface, borderRadius: radii.card }]}>
              <Text style={[styles.secondary, { color: colors.inkMuted }]}>Current status</Text>
              <Text style={[styles.body, { color: colors.ink }]}>{existing.emoji} {existing.text}</Text>
              <Text style={[styles.secondary, { color: colors.inkMuted }]}>{formatStatusRemaining(existing.expires_at)}</Text>
            </View> : <Text style={[styles.body, { color: colors.inkMuted }]}>You have no active status. Choose a preset or write your own.</Text>}
            <View style={styles.section}>
              <SectionHeader title="Quick presets" />
              <View accessibilityRole="radiogroup" accessibilityLabel="Status presets" style={styles.presets}>
                {STATUS_PRESETS.map((preset) => {
                  const checked = value.emoji === preset.emoji && value.text === preset.text;
                  return <AppPressable key={preset.id} accessibilityRole="radio" accessibilityState={{ checked, disabled: Boolean(busy) }} accessibilityLabel={`${preset.emoji} ${preset.text}`} disabled={Boolean(busy)} onPress={() => update({ emoji: preset.emoji, text: preset.text, duration: preset.defaultDuration })} style={[styles.preset, { backgroundColor: checked ? colors.accent : colors.surface, borderColor: checked ? colors.accent : colors.controlBorder, borderRadius: radii.input }]}>
                    <Text style={styles.emoji}>{preset.emoji}</Text>
                    <Text style={[styles.body, styles.grow, { color: checked ? colors.onAccent : colors.ink }]}>{preset.text}</Text>
                  </AppPressable>;
                })}
              </View>
            </View>
            <View style={styles.section}>
              <SectionHeader title="Your status" />
              <View style={styles.inputRow}>
                <AppTextInput accessibilityLabel="Status emoji" editable={!busy} value={value.emoji} onChangeText={(emoji) => update({ emoji })} returnKeyType="next" onSubmitEditing={() => inputRef.current?.focus()} style={styles.emojiInput} />
                <AppTextInput ref={inputRef} accessibilityLabel="Status text, 40 characters maximum" editable={!busy} maxLength={40} value={value.text} placeholder="What are you up to?" onChangeText={(text) => update({ text })} returnKeyType="done" onSubmitEditing={() => void save()} style={styles.grow} />
              </View>
              <Text style={[styles.counter, styles.secondary, { color: colors.inkMuted }]}>{value.text.length}/40 characters</Text>
            </View>
            <View style={styles.section}>
              <SectionHeader title="Show until" subtitle="The timer starts when you save. Till tonight means the end of your local day, with at least 30 minutes of visibility. After expiry, the status clears from the app and widget." />
              <View accessibilityRole="radiogroup" accessibilityLabel="Status expiry" style={styles.durationRow}>
                {DURATION_OPTIONS.map((option) => {
                  const checked = value.duration === option.value;
                  return <AppPressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked, disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => update({ duration: option.value })} style={[styles.duration, { backgroundColor: checked ? colors.accent : colors.surface, borderColor: checked ? colors.accent : colors.controlBorder, borderRadius: radii.input }]}>
                    <Text style={[styles.action, { color: checked ? colors.onAccent : colors.ink }]}>{option.label}</Text>
                  </AppPressable>;
                })}
              </View>
            </View>
            {error ? <InlineNotice tone="error" message={error} /> : null}
            <KeepItButton label="Save status" loadingLabel="Saving status…" loading={busy === 'save'} disabled={Boolean(busy) || !value.text.trim() || !value.emoji.trim()} onPress={() => void save()} />
            {existing ? <KeepItButton label="Clear active status" variant="secondary" disabled={Boolean(busy)} onPress={() => setConfirm('clear')} /> : null}
          </> : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal visible={Boolean(confirm)} transparent animationType="fade" onRequestClose={() => { if (!busy) { pendingRemoval.current = null; setConfirm(null); } }}>
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: colors.surface, borderRadius: radii.card }]}>
            <SectionHeader title={confirm === 'discard' ? 'Discard your changes?' : 'Clear your active status?'} subtitle={confirm === 'discard' ? 'Your unsaved edits will be lost.' : 'It will be removed from the app and widget.'} />
            {error ? <InlineNotice tone="error" message={error} /> : null}
            <KeepItButton label={confirm === 'discard' ? 'Discard changes' : 'Clear status'} variant="danger" disabled={Boolean(busy)} loading={busy === 'clear'} onPress={() => confirm === 'discard' ? leave() : void clear()} />
            <KeepItButton label="Keep editing" variant="secondary" disabled={Boolean(busy)} onPress={() => { pendingRemoval.current = null; setConfirm(null); }} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', padding: 20, justifyContent: 'center', alignItems: 'center' },
  dialog: { padding: 20, gap: 16, width: '100%', maxWidth: APP_LAYOUT.modalWidth },
  content: { width: '100%', maxWidth: APP_LAYOUT.modalWidth, alignSelf: 'center', padding: APP_LAYOUT.pageInset, paddingBottom: 48, gap: 24 },
  close: { paddingHorizontal: 10, justifyContent: 'center' },
  current: { padding: 20, gap: 10 },
  section: { gap: 12 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  preset: { flexGrow: 1, flexBasis: 190, minHeight: 58, padding: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  emoji: { fontSize: 22 },
  inputRow: { flexDirection: 'row', gap: 12 },
  emojiInput: { width: 64, textAlign: 'center', fontSize: 22 },
  grow: { flex: 1, minWidth: 0 },
  counter: { textAlign: 'right' },
  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  duration: { minWidth: 90, flexGrow: 1, padding: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: 15, lineHeight: 22 },
  secondary: { fontSize: 13, lineHeight: 20 },
  action: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
});
