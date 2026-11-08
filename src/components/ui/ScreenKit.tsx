import React, { forwardRef, useState } from 'react';
import {
  Platform,
  Pressable,
  PressableProps,
  StyleSheet,
  Switch,
  SwitchProps,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';

import { KeepItButton } from '@/components/ui/Primitives';
import { APP_LAYOUT, useKeepItTheme } from '@/theme/tokens';

/** Shared interaction treatment, with caller layout and native events preserved. */
export const AppPressable = forwardRef<React.ComponentRef<typeof Pressable>, PressableProps>(function AppPressable(
  { style, onFocus, onBlur, disabled, ...props },
  ref,
) {
  const { colors } = useKeepItTheme();
  const [focused, setFocused] = useState(false);
  const isDisabled = Boolean(disabled || props.accessibilityState?.disabled);
  return (
    <Pressable
      {...props}
      ref={ref}
      disabled={isDisabled}
      accessibilityState={{ ...props.accessibilityState, disabled: isDisabled }}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={(state) => [
        styles.target,
        { opacity: isDisabled ? 0.45 : state.pressed ? 0.72 : 1 },
        typeof style === 'function' ? style(state) : style,
        focused && {
          outlineColor: colors.focusRing,
          outlineStyle: 'solid',
          outlineWidth: 2,
          outlineOffset: 2,
        },
      ]}
    />
  );
});

export const AppTextInput = forwardRef<React.ComponentRef<typeof TextInput>, TextInputProps>(function AppTextInput(
  { style, onFocus, onBlur, placeholderTextColor, ...props },
  ref,
) {
  const { colors, radii, type } = useKeepItTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      {...props}
      ref={ref}
      placeholderTextColor={placeholderTextColor ?? colors.placeholder}
      selectionColor={colors.primary}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[
        styles.input,
        {
          fontFamily: type.fontSans,
          color: colors.ink,
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.controlBorder,
          borderRadius: radii.input,
        },
        style,
        { borderColor: colors.controlBorder },
        focused && {
          borderColor: colors.focusRing,
          outlineColor: colors.focusRing,
          outlineWidth: 2,
          outlineStyle: 'solid',
          outlineOffset: 2,
        },
      ]}
    />
  );
});

export function AppSwitch({ style, onFocus, onBlur, value = false, disabled = false, ...props }: Omit<SwitchProps, 'thumbColor' | 'trackColor' | 'ios_backgroundColor'>) {
  const { colors } = useKeepItTheme();
  const [focused, setFocused] = useState(false);
  const thumb = '#FFFFFF';
  const track = { false: colors.controlBorder, true: colors.primary };
  const browserColors = Platform.OS === 'web'
    ? { activeThumbColor: '#FFFFFF', activeTrackColor: colors.primary }
    : {};
  const control = (
    <Switch
      {...props}
      {...browserColors}
      disabled={disabled}
      value={value}
      thumbColor={thumb}
      trackColor={track}
      ios_backgroundColor={colors.controlBorder}
      hitSlop={10}
      onFocus={(event) => { setFocused(true); onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); onBlur?.(event); }}
      style={Platform.OS === 'web' ? styles.webSwitch : undefined}
    />
  );
  return (
    <View style={[styles.switchTarget, disabled && { opacity: 0.55 }, style, focused && { outlineColor: colors.focusRing, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 2 }]}>
      {Platform.OS === 'web' ? React.createElement('label', {
        style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 44 },
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
      }, control) : control}
    </View>
  );
}

export function PageHeader({
  title,
  subtitle,
  onBack,
  backLabel = 'Back',
  backDisabled = false,
  action,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  backDisabled?: boolean;
  action?: React.ReactNode;
}) {
  const { colors, type } = useKeepItTheme();
  return (
    <View style={styles.header}>
      {onBack ? (
        <AppPressable
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          disabled={backDisabled}
          accessibilityState={{ disabled: backDisabled }}
          onPress={onBack}
          style={styles.back}
        >
          <Text style={[styles.backLabel, { color: colors.ink, fontFamily: type.fontSans }]}>
            {backLabel}
          </Text>
        </AppPressable>
      ) : null}
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink, fontFamily: type.fontSans }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: colors.inkMuted, fontFamily: type.fontSans }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action ? <View style={styles.headerAction}>{action}</View> : null}
      </View>
    </View>
  );
}

export function SectionHeader({ title, subtitle, action }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  const { colors, type } = useKeepItTheme();
  return (
    <View style={styles.headingRow}>
      <View style={styles.headingCopy}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.ink, fontFamily: type.fontSans }]}>
          {title}
        </Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.inkMuted }]}>{subtitle}</Text> : null}
      </View>
      {action ? <View style={styles.headerAction}>{action}</View> : null}
    </View>
  );
}

export function EmptyState({ title, message, actionLabel, onAction }: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors, radii, type } = useKeepItTheme();
  return (
    <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.ink, fontFamily: type.fontSans }]}>
        {title}
      </Text>
      <Text style={[styles.emptyBody, { color: colors.inkMuted, fontFamily: type.fontSans }]}>{message}</Text>
      {actionLabel && onAction ? <KeepItButton label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  target: { minHeight: APP_LAYOUT.minimumTarget, minWidth: APP_LAYOUT.minimumTarget, borderCurve: 'continuous' },
  input: { minHeight: 50, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, lineHeight: 22, borderWidth: 1, borderCurve: 'continuous' },
  header: { gap: 6, paddingBottom: 4 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  headingCopy: { flex: 1, minWidth: 160, gap: 6 },
  headerAction: { flexShrink: 1, maxWidth: '100%' },
  title: { fontSize: 24, lineHeight: 28, fontWeight: '600', letterSpacing: 0 },
  subtitle: { fontSize: 15, lineHeight: 21, letterSpacing: 0 },
  sectionTitle: { fontSize: 18, lineHeight: 22, fontWeight: '600', letterSpacing: 0 },
  back: { alignSelf: 'flex-start', justifyContent: 'center', paddingRight: 16 },
  backLabel: { fontSize: 14, lineHeight: 18, fontWeight: '600', letterSpacing: 0 },
  empty: { paddingTop: 32, paddingHorizontal: 24, paddingBottom: 28, gap: 16, borderWidth: 1, borderCurve: 'continuous' },
  emptyBody: { fontSize: 15, lineHeight: 22 },
  switchTarget: { minWidth: 56, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  webSwitch: { width: 48, height: 24 },
});
