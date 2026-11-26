import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BentoTile, BentoToggleGlyph } from '@/components/ui/BentoPrimitives';
import { InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { AppPressable, AppTextInput, AppTextInputProps, PageHeader } from '@/components/ui/ScreenKit';
import { useSessionStore } from '@/store/sessionStore';
import { APP_LAYOUT, useKeepItTheme } from '@/theme/tokens';
import { announcePolite } from '@/utils/a11y';

export function KeepItAuthForm({
  initialMode,
  initialNotice = null,
  onBack,
}: {
  initialMode: 'signup' | 'signin';
  initialNotice?: string | null;
  onBack: () => void;
}) {
  const { colors, radii, isDark } = useKeepItTheme();
  const signUpWithPassword = useSessionStore((s) => s.signUpWithPassword);
  const signInWithPassword = useSessionStore((s) => s.signInWithPassword);
  const resendConfirmationEmail = useSessionStore((s) => s.resendConfirmationEmail);
  const mode = initialMode;
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [canResendConfirmation, setCanResendConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<'name' | 'email' | 'password' | 'confirm' | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const nameInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  const emailInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  const passwordInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  const confirmInput = useRef<React.ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleBack = useCallback(() => {
    if (submitting.current) return;
    Keyboard.dismiss();
    onBack();
  }, [onBack]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        handleBack();
        return true;
      });
      return () => subscription.remove();
    }
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        handleBack();
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleBack]);

  const statusMessage = loading
    ? mode === 'signup' ? 'Creating your KeepIt account…' : 'Signing in to KeepIt…'
    : '';

  useEffect(() => {
    const announcement = error ?? notice ?? statusMessage;
    if (Platform.OS === 'ios' && announcement) {
      AccessibilityInfo.announceForAccessibility(announcement);
    }
  }, [error, notice, statusMessage]);


  const handleResendConfirmation = async () => {
    if (submitting.current || resending) return;
    submitting.current = true;
    setResending(true);
    setError(null);
    setNotice(null);
    Keyboard.dismiss();
    try {
      const message = await resendConfirmationEmail(email);
      if (mounted.current) {
        setNotice(message);
      }
    } catch (err) {
      if (mounted.current) {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not resend confirmation email. Try again in a moment.'
        );
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setResending(false);
    }
  };

  const handleSubmit = async () => {
    if (submitting.current) return;
    const trimmedEmail = email.trim();
    if (mode === 'signup' && !displayName.trim()) {
      const msg = 'Enter your first name.';
      setInvalidField('name');
      setError(msg);
      announcePolite(msg);
      nameInput.current?.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      const msg = 'Enter a valid email address.';
      setInvalidField('email');
      setError(msg);
      announcePolite(msg);
      emailInput.current?.focus();
      return;
    }
    if (password.length < 6) {
      const msg = 'Use at least 6 characters for your password.';
      setInvalidField('password');
      setError(msg);
      announcePolite(msg);
      passwordInput.current?.focus();
      return;
    }
    if (mode === 'signup' && password !== confirmPassword) {
      const msg = 'Passwords do not match.';
      setInvalidField('confirm');
      setError(msg);
      announcePolite(msg);
      confirmInput.current?.focus();
      return;
    }
    submitting.current = true;
    setInvalidField(null);
    setError(null);
    setNotice(null);
    setLoading(true);
    Keyboard.dismiss();
    try {
      if (mode === 'signup') {
        await signUpWithPassword({ displayName, email, password, confirmPassword });
      } else {
        await signInWithPassword({ email, password });
      }
      // NavigationGuard owns routing after the session store authenticates the user.
    } catch (err) {
      if (mounted.current) {
        const msg = err instanceof Error ? err.message : 'Authentication failed. Please try again.';
        if (mode === 'signup' && /Check your inbox to confirm your email/i.test(msg)) {
          setCanResendConfirmation(true);
          setNotice(msg);
        } else {
          if (/Confirm your email first|Email confirmation rate limit/i.test(msg)) {
            setCanResendConfirmation(true);
          }
          setError(msg);
        }
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}
        style={styles.flex}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.scrollContent}>
          <AppPressable
            accessibilityRole="button"
            accessibilityLabel="Back to introduction"
            accessibilityState={{ disabled: loading }}
            disabled={loading}
            onPress={handleBack}
            style={styles.backButton}>
            <Text style={[styles.modeText, { color: colors.ink }]}>Back to intro</Text>
          </AppPressable>
          <View style={styles.headerBlock}>
            <BentoToggleGlyph size={28} tone="auto" />
            <PageHeader
              title={mode === 'signup' ? 'Create your account' : 'Welcome back'}
              subtitle="Keep every moment, together."
            />
          </View>
          <BentoTile variant="spotlight" pattern="dots" grain radius={radii.card} style={styles.card}>
            {mode === 'signup' ? (
              <AuthField
                key="input-first-name"
                inputRef={nameInput}
                labelId="auth-label-name"
                invalid={invalidField === 'name'}
                errorId={error && invalidField === 'name' ? 'auth-form-error' : undefined}
                label="Your first name"
                accessibilityLabel="Your first name"
                value={displayName}
                placeholder="Your name"
                autoCapitalize="words"
                autoComplete="given-name"
                maxLength={40}
                editable={!loading}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => emailInput.current?.focus()}
                onChangeText={(value) => { setError(null); setInvalidField(null); setDisplayName(value); }}
              />
            ) : null}
            <AuthField
              key="input-email"
              inputRef={emailInput}
              labelId="auth-label-email"
              invalid={invalidField === 'email'}
              errorId={error && invalidField === 'email' ? 'auth-form-error' : undefined}
              label="Email"
              accessibilityLabel="Email address"
              value={email}
              placeholder="email@example.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              editable={!loading}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordInput.current?.focus()}
              onChangeText={(value) => { setError(null); setInvalidField(null); setEmail(value); }}
            />
            <AuthField
              key="input-password"
              inputRef={passwordInput}
              labelId="auth-label-password"
              invalid={invalidField === 'password'}
              errorId={error && invalidField === 'password' ? 'auth-form-error' : undefined}
              label="Password"
              accessibilityLabel="Password"
              value={password}
              placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
              autoCapitalize="none"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              secureTextEntry={!showPassword}
              editable={!loading}
              returnKeyType={mode === 'signup' ? 'next' : 'go'}
              submitBehavior={mode === 'signup' ? 'submit' : 'blurAndSubmit'}
              onChangeText={(value) => { setError(null); setInvalidField(null); setPassword(value); }}
              onSubmitEditing={() => {
                if (mode === 'signup') confirmInput.current?.focus();
                else void handleSubmit();
              }}
              rightAccessory={
                <AppPressable
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  accessibilityState={{ checked: showPassword, disabled: loading }}
                  disabled={loading}
                  onPress={() => setShowPassword((prev) => !prev)}
                  style={[
                    styles.visibilityBtn,
                    { backgroundColor: colors.surfaceObject, borderColor: colors.controlBorder, borderRadius: radii.buttonSm },
                  ]}>
                  <Text style={[styles.visibilityText, { color: colors.ink }]}>
                    {showPassword ? 'Hide' : 'Show'}
                  </Text>
                </AppPressable>
              }
            />
            {mode === 'signup' ? (
              <AuthField
                key="input-confirm-password"
                inputRef={confirmInput}
                labelId="auth-label-confirm"
                invalid={invalidField === 'confirm'}
                errorId={error && invalidField === 'confirm' ? 'auth-form-error' : undefined}
                label="Confirm password"
                accessibilityLabel="Confirm password"
                value={confirmPassword}
                placeholder="Re-enter password"
                autoCapitalize="none"
                autoComplete="new-password"
                secureTextEntry={!showConfirmPassword}
                editable={!loading}
                returnKeyType="go"
                onChangeText={(value) => { setError(null); setInvalidField(null); setConfirmPassword(value); }}
                onSubmitEditing={() => void handleSubmit()}
                rightAccessory={
                  <AppPressable
                    accessibilityRole="button"
                    accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    accessibilityState={{ checked: showConfirmPassword, disabled: loading }}
                    disabled={loading}
                    onPress={() => setShowConfirmPassword((prev) => !prev)}
                    style={[
                      styles.visibilityBtn,
                      { backgroundColor: colors.surfaceObject, borderColor: colors.controlBorder, borderRadius: radii.buttonSm },
                    ]}>
                    <Text style={[styles.visibilityText, { color: colors.ink }]}>
                      {showConfirmPassword ? 'Hide' : 'Show'}
                    </Text>
                  </AppPressable>
                }
              />
            ) : null}
            {notice ? <InlineNotice message={notice} tone="success" /> : null}
            {error ? (
              <View nativeID="auth-form-error">
                <InlineNotice message={error} tone="error" />
              </View>
            ) : null}
            <KeepItButton
              label={mode === 'signup' ? 'Create account' : 'Sign in'}
              loading={loading}
              loadingLabel={mode === 'signup' ? 'Creating account…' : 'Signing in…'}
              disabled={loading}
              onPress={() => void handleSubmit()}
            />
            {canResendConfirmation ? (
              <KeepItButton
                label="Resend Confirmation Email"
                variant="secondary"
                loading={resending}
                loadingLabel="Sending Link…"
                disabled={loading || resending}
                onPress={() => void handleResendConfirmation()}
              />
            ) : null}
            {statusMessage ? (
              <Text accessibilityLiveRegion="polite" style={[styles.status, { color: colors.inkMuted }]}>{statusMessage}</Text>
            ) : null}
          </BentoTile>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AuthField({
  label,
  labelId,
  inputRef,
  rightAccessory,
  ...inputProps
}: AppTextInputProps & {
  label: string;
  inputRef?: React.Ref<React.ComponentRef<typeof TextInput>>;
  rightAccessory?: React.ReactNode;
}) {
  const { colors } = useKeepItTheme();
  return (
    <View style={styles.fieldGroup}>
      <Text nativeID={labelId} style={[styles.label, { color: colors.ink }]}>
        {label}
      </Text>
      <View style={styles.inputRow}>
        <AppTextInput
          ref={inputRef}
          labelId={labelId}
          {...inputProps}
          autoCorrect={false}
          style={[styles.input, rightAccessory ? styles.inputWithAccessory : null]}
        />
        {rightAccessory}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    maxWidth: APP_LAYOUT.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: APP_LAYOUT.pageInset,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 28,
  },
  backButton: { alignSelf: 'flex-start', justifyContent: 'center', paddingRight: 16 },
  headerBlock: { gap: 12 },
  card: { paddingTop: 32, paddingHorizontal: 24, paddingBottom: 28, gap: 20 },
  modeText: { fontSize: 14, lineHeight: 18, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  fieldGroup: { gap: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  input: { flex: 1, minHeight: 50, fontSize: 16, lineHeight: 22 },
  inputWithAccessory: { paddingRight: 12 },
  visibilityBtn: {
    minWidth: 56,
    minHeight: 50,
    paddingHorizontal: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visibilityText: { fontSize: 13, fontWeight: '600' },
  status: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
