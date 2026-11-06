import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { formatLateDuration } from '@/api/moments';
import { KeepItButton } from '@/components/ui/Primitives';
import { useKeepItTheme } from '@/theme/tokens';

interface DualMomentCardProps {
  authorName: string;
  backPhotoUrl: string;
  frontPhotoUrl: string;
  blurhash: string;
  caption: string | null;
  postedAtIso: string;
  lateBySeconds: number;
  isLate: boolean;
  retakeCount: number;
  editableCaption?: boolean;
  onSaveCaption?: (nextCaption: string) => Promise<void>;
  canRetake?: boolean;
  onRetake?: () => void;
}

export function DualMomentCard({
  authorName,
  backPhotoUrl,
  frontPhotoUrl,
  blurhash,
  caption,
  postedAtIso,
  lateBySeconds,
  isLate,
  retakeCount,
  editableCaption = false,
  onSaveCaption,
  canRetake = false,
  onRetake,
}: DualMomentCardProps) {
  const { colors, radii, spacing } = useKeepItTheme();
  const [swapped, setSwapped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingCaption, setSavingCaption] = useState(false);
  const draftCaptionRef = useRef(caption ?? '');

  const pipScale = useSharedValue(1);
  const pipStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pipScale.get() }],
  }));

  const mainSource = swapped ? frontPhotoUrl : backPhotoUrl;
  const pipSource = swapped ? backPhotoUrl : frontPhotoUrl;

  const handleSwapPip = () => {
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
    pipScale.set(0.92);
    pipScale.set(withSpring(1, { duration: 350, dampingRatio: 0.88 }));
    setSwapped((prev) => !prev);
  };

  const handleCommitCaption = async () => {
    if (!onSaveCaption) return;
    setSavingCaption(true);
    try {
      await onSaveCaption(draftCaptionRef.current);
      setEditing(false);
    } finally {
      setSavingCaption(false);
    }
  };

  const timeFormatted = new Date(postedAtIso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={{ gap: spacing.md }}>
      {/* Main 3:4 Photo Container */}
      <View
        style={[
          styles.photoFrame,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.photo,
          },
        ]}>
        <Image
          source={{ uri: mainSource }}
          contentFit="cover"
          style={styles.fullImage}
        />

        {/* Overlapping 3:4 Front/Back PIP */}
        <Animated.View style={[styles.pipAnchor, pipStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Swap ${authorName} front and back camera view`}
            onPress={handleSwapPip}
            style={[
              styles.pipFrame,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.canvas,
              },
            ]}>
            <Image
              source={{ uri: pipSource }}
              contentFit="cover"
              style={styles.fullImage}
            />
          </Pressable>
        </Animated.View>

        {/* Top-Right Status Badges (On-time / Late + Retake count) */}
        <View style={styles.badgeStack}>
          <View
            style={[
              styles.statusPill,
              {
                backgroundColor: colors.canvas,
                borderColor: isLate ? colors.warning : colors.border,
                borderRadius: radii.pill,
              },
            ]}>
            <Text
              style={[
                styles.statusPillText,
                { color: isLate ? colors.warning : colors.ink },
              ]}>
              {formatLateDuration(lateBySeconds)}
            </Text>
          </View>

          {retakeCount > 0 ? (
            <View
              style={[
                styles.statusPill,
                {
                  backgroundColor: colors.canvas,
                  borderColor: colors.border,
                  borderRadius: radii.pill,
                },
              ]}>
              <Text style={[styles.statusPillText, { color: colors.inkMuted }]}>
                {retakeCount} {retakeCount === 1 ? 'retake' : 'retakes'}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Caption + Metadata Bar */}
      <View
        style={[
          styles.metaCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.card,
            padding: spacing.lg,
          },
        ]}>
        <View style={styles.metaTopRow}>
          <Text style={[styles.authorText, { color: colors.ink }]}>{authorName}</Text>
          <Text style={[styles.timestampText, { color: colors.inkMuted }]}>{timeFormatted}</Text>
        </View>

        {editing ? (
          <View style={{ gap: 10 }}>
            <TextInput
              accessibilityLabel="Edit Moment caption"
              defaultValue={caption ?? ''}
              maxLength={100}
              placeholder="Add a short note (up to 100 chars)..."
              placeholderTextColor={colors.inkMuted}
              onChangeText={(val) => {
                draftCaptionRef.current = val;
              }}
              style={[
                styles.captionInput,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                  color: colors.ink,
                  borderRadius: radii.input,
                },
              ]}
            />
            <View style={styles.editActionsRow}>
              <KeepItButton
                label="Save Note"
                loading={savingCaption}
                onPress={() => void handleCommitCaption()}
                style={{ flex: 1 }}
              />
              <KeepItButton
                label="Cancel"
                variant="secondary"
                disabled={savingCaption}
                onPress={() => setEditing(false)}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : (
          <View style={styles.captionRow}>
            <Text style={[styles.captionText, { color: caption ? colors.ink : colors.inkMuted }]}>
              {caption ? `“${caption}”` : 'No note added.'}
            </Text>
            <View style={styles.inlineButtonRow}>
              {editableCaption ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit Moment note"
                  onPress={() => {
                    draftCaptionRef.current = caption ?? '';
                    setEditing(true);
                  }}
                  style={[
                    styles.smallActionChip,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.smallActionText, { color: colors.ink }]}>
                    {caption ? 'Edit note' : 'Add note'}
                  </Text>
                </Pressable>
              ) : null}

              {canRetake && onRetake ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retake today's Moment"
                  onPress={onRetake}
                  style={[
                    styles.smallActionChip,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                      borderRadius: radii.pill,
                    },
                  ]}>
                  <Text style={[styles.smallActionText, { color: colors.accent }]}>
                    Retake ({2 - retakeCount} left)
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

export function LockedMomentCard({
  partnerName,
  postedAtIso,
  lateBySeconds,
  isLate,
  onCaptureMine,
}: {
  partnerName: string;
  postedAtIso: string;
  lateBySeconds: number;
  isLate: boolean;
  onCaptureMine: () => void;
}) {
  const { colors, radii, spacing } = useKeepItTheme();
  const timeFormatted = new Date(postedAtIso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View
      style={[
        styles.lockedFrame,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radii.photo,
          padding: spacing.xl,
        },
      ]}>
      <View
        style={[
          styles.lockedPipSilhouette,
          {
            backgroundColor: colors.accentSoft,
            borderColor: colors.accent,
          },
        ]}
      />

      <View style={styles.lockedCenter}>
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: isLate ? colors.warning : colors.border,
              borderRadius: radii.pill,
            },
          ]}>
          <Text style={[styles.statusPillText, { color: isLate ? colors.warning : colors.ink }]}>
            {partnerName} posted at {timeFormatted} · {formatLateDuration(lateBySeconds)}
          </Text>
        </View>

        <Text style={[styles.lockedTitle, { color: colors.ink }]}>
          {partnerName}’s Moment is waiting
        </Text>
        <Text style={[styles.lockedBody, { color: colors.inkMuted }]}>
          Partners only see each other’s Moment after posting their own. Capture yours now to
          unlock both photos side by side.
        </Text>

        <KeepItButton label="Post Yours to Reveal" onPress={onCaptureMine} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  photoFrame: {
    width: '100%',
    aspectRatio: 0.75,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    borderCurve: 'continuous',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  pipAnchor: {
    position: 'absolute',
    top: 14,
    left: 14,
    zIndex: 4,
  },
  pipFrame: {
    width: 102,
    height: 136,
    borderRadius: 16,
    borderWidth: 2,
    overflow: 'hidden',
    borderCurve: 'continuous',
    boxShadow: '0px 6px 16px rgba(0, 0, 0, 0.25)',
  },
  badgeStack: {
    position: 'absolute',
    top: 14,
    right: 14,
    alignItems: 'flex-end',
    gap: 6,
    zIndex: 4,
  },
  statusPill: {
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderCurve: 'continuous',
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metaCard: {
    borderWidth: 1,
    gap: 8,
    borderCurve: 'continuous',
  },
  metaTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  authorText: {
    fontSize: 16,
    fontWeight: '700',
  },
  timestampText: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  captionRow: {
    gap: 10,
  },
  captionText: {
    fontSize: 15,
    lineHeight: 21,
  },
  inlineButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  smallActionChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 34,
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  smallActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  captionInput: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    borderCurve: 'continuous',
  },
  editActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  lockedFrame: {
    width: '100%',
    aspectRatio: 0.78,
    borderWidth: 1,
    justifyContent: 'space-between',
    position: 'relative',
    borderCurve: 'continuous',
  },
  lockedPipSilhouette: {
    width: 84,
    height: 112,
    borderRadius: 16,
    borderWidth: 1.5,
    opacity: 0.65,
    borderCurve: 'continuous',
  },
  lockedCenter: {
    gap: 14,
    alignItems: 'center',
    marginVertical: 'auto',
  },
  lockedTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  lockedBody: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});
