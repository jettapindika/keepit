import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { formatStatusRemaining } from '@/api/statuses';
import { AppPressable, SectionHeader } from '@/components/ui/ScreenKit';
import { useKeepItTheme } from '@/theme/tokens';
import { CoupleEventRecord, StatusRecord } from '@/types/database';

interface StatusHeaderCardProps {
  partnerName: string;
  partnerStatus: StatusRecord | null;
  myStatus: StatusRecord | null;
  isPartnerPaired?: boolean;
  latestNudge?: CoupleEventRecord | null;
  currentUserId?: string;
  nudging?: boolean;
  nudgeFeedback?: string | null;
  loading?: boolean;
  statusError?: string | null;
  nudgeError?: string | null;
  onRetryStatus?: () => void;
  onRetryNudges?: () => void;
  onSendNudge?: () => void;
  onPressPair?: () => void;
  onOpenStatusSheet: () => void;
}

export function StatusHeaderCard({ partnerName, partnerStatus, myStatus, isPartnerPaired = true, latestNudge, currentUserId, nudging = false, nudgeFeedback, loading = false, statusError, nudgeError, onRetryStatus, onRetryNudges, onSendNudge, onPressPair, onOpenStatusSheet }: StatusHeaderCardProps) {
  const { colors, radii } = useKeepItTheme();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const partnerActive = partnerStatus && new Date(partnerStatus.expires_at).getTime() > now ? partnerStatus : null;
  const mine = myStatus && new Date(myStatus.expires_at).getTime() > now ? myStatus : null;
  const incomingNudge = latestNudge && latestNudge.actor_id !== currentUserId ? latestNudge : null;
  const actionStyle = [styles.action, { backgroundColor: colors.surfaceElevated, borderRadius: radii.input }];
  return <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: radii.group }]}>
    <SectionHeader title={isPartnerPaired ? 'Between you two' : 'Your status'} />
    {loading ? <Text accessibilityLiveRegion="polite" style={[styles.secondary, { color: colors.inkMuted }]}>Loading statuses…</Text> : statusError ? <View style={styles.stack}>
      <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>{statusError}</Text>
      <AppPressable accessibilityRole="button" onPress={onRetryStatus} style={actionStyle}><Text style={[styles.actionText, { color: colors.ink }]}>Retry statuses</Text></AppPressable>
    </View> : isPartnerPaired ? <View style={styles.partnerRow}>
      <View style={styles.grow}>
        <Text style={[styles.secondary, { color: colors.inkMuted }]}>{partnerName}</Text>
        <Text style={[styles.body, { color: colors.ink }]}>{partnerActive ? `${partnerActive.emoji} ${partnerActive.text}` : 'No active status'}</Text>
        {partnerActive ? <Text style={[styles.secondary, { color: colors.inkMuted }]}>{formatStatusRemaining(partnerActive.expires_at)}</Text> : null}
      </View>
      {onSendNudge ? <AppPressable accessibilityRole="button" accessibilityLabel={`Nudge ${partnerName}`} accessibilityState={{ busy: nudging, disabled: nudging }} disabled={nudging} onPress={() => { if (Platform.OS !== 'web') void Haptics.selectionAsync(); onSendNudge(); }} style={actionStyle}>
        <Text style={[styles.actionText, { color: colors.ink }]}>{nudging ? 'Sending…' : 'Nudge'}</Text>
      </AppPressable> : null}
    </View> : <View style={styles.stack}>
      <Text style={[styles.body, { color: colors.inkMuted }]}>Pair with your partner to share statuses and send nudges. Your own status is still yours to set.</Text>
      {onPressPair ? <AppPressable accessibilityRole="button" onPress={onPressPair} style={actionStyle}><Text style={[styles.actionText, { color: colors.ink }]}>Pair with partner</Text></AppPressable> : null}
    </View>}
    {incomingNudge ? <Text style={[styles.nudge, styles.body, { color: colors.ink, backgroundColor: colors.surfaceElevated, borderRadius: radii.input }]}>{partnerName} nudged you: “{incomingNudge.payload?.note ?? 'Thinking of you'}”</Text> : null}
    {nudgeError ? <View style={styles.stack}><Text accessibilityRole="alert" style={[styles.secondary, { color: colors.danger }]}>{nudgeError}</Text><AppPressable accessibilityRole="button" onPress={onRetryNudges} style={actionStyle}><Text style={[styles.actionText, { color: colors.ink }]}>Retry nudges</Text></AppPressable></View> : null}
    {nudgeFeedback ? <Text accessibilityLiveRegion="polite" style={[styles.secondary, { color: colors.ink }]}>{nudgeFeedback}</Text> : null}
    <AppPressable accessibilityRole="button" accessibilityLabel={mine ? `Edit your status: ${mine.emoji} ${mine.text}` : 'Set your status'} onPress={onOpenStatusSheet} style={[styles.myRow, { backgroundColor: colors.surfaceElevated, borderRadius: radii.input }]}>
      <View style={styles.grow}><Text style={[styles.secondary, { color: colors.inkMuted }]}>Your status</Text><Text style={[styles.body, { color: colors.ink }]}>{mine ? `${mine.emoji} ${mine.text}` : statusError ? 'Open status editor to retry' : 'What are you up to?'}</Text>{mine ? <Text style={[styles.secondary, { color: colors.inkMuted }]}>{formatStatusRemaining(mine.expires_at)}</Text> : null}</View>
      <Text style={[styles.actionText, { color: colors.ink }]}>{mine ? 'Edit' : 'Set status'}</Text>
    </AppPressable>
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 20, gap: 16 },
  partnerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 120, gap: 3 },
  stack: { gap: 8 },
  action: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, alignSelf: 'flex-start', justifyContent: 'center', alignItems: 'center' },
  actionText: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
  secondary: { fontSize: 13, lineHeight: 20 },
  nudge: { padding: 12 },
  myRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: 14 },
});
