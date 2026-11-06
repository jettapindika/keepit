import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isSupabaseConfigured } from '@/api/supabase';
import { DualFrameMark, InlineNotice, KeepItButton } from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';

export default function WelcomeScreen() {
  const router = useRouter();
  const { colors, radii, spacing } = useKeepItTheme();
  const sendEmailOtp = useSessionStore((s) => s.sendEmailOtp);
  const verifyEmailOtpAndProfile = useSessionStore((s) => s.verifyEmailOtpAndProfile);

  const [step, setStep] = useState<'email' | 'verify'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayNameRef = useRef('');
  const emailRef = useRef('');
  const otpRef = useRef('');
  const [submittedEmail, setSubmittedEmail] = useState('');

  const handleRequestCode = async () => {
    setError(null);
    const trimmedName = displayNameRef.current.trim();
    if (trimmedName.length < 1 || trimmedName.length > 40) {
      setError('Enter the first name your partner calls you (1–40 characters).');
      return;
    }

    setLoading(true);
    try {
      await sendEmailOtp(emailRef.current);
      setSubmittedEmail(emailRef.current.trim().toLowerCase());
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setError(null);
    setLoading(true);
    try {
      await verifyEmailOtpAndProfile({
        email: submittedEmail,
        otp: otpRef.current,
        displayName: displayNameRef.current,
      });
      router.replace('/(auth)/pair');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.scrollContent,
            { paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl },
          ]}>
          <View style={styles.heroBlock}>
            <DualFrameMark size={60} />
            <Text style={[styles.wordmark, { color: colors.ink }]}>KeepIt</Text>
            <Text style={[styles.tagline, { color: colors.inkMuted }]}>
              Keep every moment, together.
            </Text>
          </View>

          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.card,
                padding: spacing.xl,
                gap: spacing.lg,
              },
            ]}>
            {step === 'email' ? (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.ink }]}>Your first name</Text>
                  <TextInput
                    accessibilityLabel="Your first name"
                    autoCapitalize="words"
                    autoCorrect={false}
                    maxLength={40}
                    placeholder="Your Name"
                    placeholderTextColor={colors.inkMuted}
                    onChangeText={(val) => {
                      displayNameRef.current = val;
                    }}
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                        color: colors.ink,
                        borderRadius: radii.input,
                      },
                    ]}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.ink }]}>Email address</Text>
                  <TextInput
                    accessibilityLabel="Email address"
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    keyboardType="email-address"
                    placeholder="email@example.com"
                    placeholderTextColor={colors.inkMuted}
                    onChangeText={(val) => {
                      emailRef.current = val;
                    }}
                    onSubmitEditing={() => void handleRequestCode()}
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                        color: colors.ink,
                        borderRadius: radii.input,
                      },
                    ]}
                  />
                </View>

                {error ? <InlineNotice message={error} tone="error" /> : null}

                <KeepItButton
                  label="Send 6-Digit Sign-In Code"
                  loading={loading}
                  onPress={() => void handleRequestCode()}
                />
              </>
            ) : (
              <>
                <View style={{ gap: 4 }}>
                  <Text style={[styles.stepTitle, { color: colors.ink }]}>Check your email</Text>
                  <Text style={[styles.stepBody, { color: colors.inkMuted }]}>
                    We sent a 6-digit code to {submittedEmail}.
                    {!isSupabaseConfigured
                      ? ' (Local sandbox mode: enter any 6 digits such as 123456.)'
                      : ''}
                  </Text>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.ink }]}>6-digit code</Text>
                  <TextInput
                    accessibilityLabel="6-digit verification code"
                    autoFocus
                    keyboardType="number-pad"
                    maxLength={6}
                    placeholder="000000"
                    placeholderTextColor={colors.inkMuted}
                    onChangeText={(val) => {
                      otpRef.current = val;
                    }}
                    onSubmitEditing={() => void handleVerify()}
                    style={[
                      styles.input,
                      styles.codeInput,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                        color: colors.ink,
                        borderRadius: radii.input,
                      },
                    ]}
                  />
                </View>

                {error ? <InlineNotice message={error} tone="error" /> : null}

                <KeepItButton
                  label="Verify & Continue to Pairing"
                  loading={loading}
                  onPress={() => void handleVerify()}
                />

                <KeepItButton
                  label="Use a Different Email"
                  variant="ghost"
                  disabled={loading}
                  onPress={() => {
                    otpRef.current = '';
                    setError(null);
                    setStep('email');
                  }}
                />
              </>
            )}
          </View>

          <Text style={[styles.footerNote, { color: colors.inkMuted }]}>
            Made strictly for two. No public feed, no follower counts, no contact scraping.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
    gap: 28,
  },
  heroBlock: {
    alignItems: 'center',
    gap: 10,
  },
  wordmark: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.8,
    marginTop: 4,
  },
  tagline: {
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
  },
  card: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    borderCurve: 'continuous',
  },
  codeInput: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 6,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  stepBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  footerNote: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
});
