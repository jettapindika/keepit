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
  TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { AppPressable, AppTextInput, PageHeader } from '@/components/ui/ScreenKit';
import { useSessionStore } from '@/store/sessionStore';
import { APP_LAYOUT, useKeepItTheme } from '@/theme/tokens';

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
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const submitting = useRef(false);
  const mounted = useRef(true);
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
      setError('Enter your first name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Use at least 6 characters for your password.');
      return;
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    submitting.current = true;
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
            <Text style={[styles.modeText, { color: colors.inkMuted }]}>Back to intro</Text>
          </AppPressable>
          <PageHeader
            title={mode === 'signup' ? 'Create your account' : 'Welcome back'}
            subtitle="Keep every moment, together."
          />
          <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: radii.group }]}>
            {mode === 'signup' ? (
              <AuthField
                key="input-first-name"
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
                onChangeText={(value) => { setError(null); setDisplayName(value); }}
              />
            ) : null}
            <AuthField
              key="input-email"
              inputRef={emailInput}
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
              onChangeText={(value) => { setError(null); setEmail(value); }}
            />
            <AuthField
              key="input-password"
              inputRef={passwordInput}
              label="Password"
              accessibilityLabel="Password"
              value={password}
              placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
              autoCapitalize="none"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              secureTextEntry
              editable={!loading}
              returnKeyType={mode === 'signup' ? 'next' : 'go'}
              submitBehavior={mode === 'signup' ? 'submit' : 'blurAndSubmit'}
              onChangeText={(value) => { setError(null); setPassword(value); }}
              onSubmitEditing={() => {
                if (mode === 'signup') confirmInput.current?.focus();
                else void handleSubmit();
              }}
            />
            {mode === 'signup' ? (
              <AuthField
                key="input-confirm-password"
                inputRef={confirmInput}
                label="Confirm password"
                accessibilityLabel="Confirm password"
                value={confirmPassword}
                placeholder="Re-enter password"
                autoCapitalize="none"
                autoComplete="new-password"
                secureTextEntry
                editable={!loading}
                returnKeyType="go"
                onChangeText={(value) => { setError(null); setConfirmPassword(value); }}
                onSubmitEditing={() => void handleSubmit()}
              />
            ) : null}
            {notice ? <InlineNotice message={notice} tone="success" /> : null}
            {error ? <InlineNotice message={error} tone="error" /> : null}
            <KeepItButton
              label={mode === 'signup' ? 'Create Account' : 'Sign In'}
              loading={loading}
              loadingLabel={mode === 'signup' ? 'Creating Account…' : 'Signing In…'}
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
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AuthField({ label, inputRef, ...inputProps }: TextInputProps & { label: string; inputRef?: React.Ref<React.ComponentRef<typeof TextInput>> }) {
  const { colors } = useKeepItTheme();
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <AppTextInput ref={inputRef} {...inputProps} autoCorrect={false} style={styles.input} />
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
  card: { padding: APP_LAYOUT.cardPadding, gap: 20, borderCurve: 'continuous' },
  modeText: { fontSize: 15, lineHeight: 22, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  fieldGroup: { gap: 8 },
  label: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  input: { minHeight: 52, fontSize: 16, lineHeight: 22 },
  status: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
