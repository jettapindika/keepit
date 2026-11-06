import { useRouter } from 'expo-router';
import React, { useState } from 'react';
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
  DualFrameMark,
  InlineNotice,
  KeepItButton,
  RevealOnAppear,
} from '@/components/ui/Primitives';
import { useSessionStore } from '@/store/sessionStore';
import { useKeepItTheme } from '@/theme/tokens';

export default function WelcomeScreen() {
  const router = useRouter();
  const { colors, radii, spacing } = useKeepItTheme();

  const signUpWithPassword = useSessionStore((s) => s.signUpWithPassword);
  const signInWithPassword = useSessionStore((s) => s.signInWithPassword);

  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      if (mode === 'signup') {
        await signUpWithPassword({
          displayName,
          email,
          password,
          confirmPassword,
        });
      } else {
        await signInWithPassword({
          email,
          password,
        });
      }

      const nextCouple = useSessionStore.getState().couple;
      if (nextCouple?.state === 'active') {
        router.replace('/(tabs)');
      } else {
        router.replace('/(auth)/pair');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
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
          <RevealOnAppear revealKey="welcome-hero">
            <View style={styles.heroBlock}>
              <DualFrameMark size={62} />
              <Text style={[styles.wordmark, { color: colors.ink }]}>KeepIt</Text>
              <Text style={[styles.tagline, { color: colors.inkMuted }]}>
                Keep every moment, together.
              </Text>
            </View>
          </RevealOnAppear>

          <RevealOnAppear revealKey="welcome-card">
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.group,
                  padding: spacing.xl,
                  gap: spacing.lg,
                },
              ]}>
              {/* Mode Switcher: Create Account | Sign In */}
              <View
                accessibilityRole="tablist"
                style={[
                  styles.modeTrack,
                  {
                    backgroundColor: colors.canvas,
                    borderColor: colors.border,
                    borderRadius: radii.input,
                  },
                ]}>
                <Pressable
                  accessibilityRole="tab"
                  accessibilityLabel="Create Account tab"
                  accessibilityState={{ selected: mode === 'signup' }}
                  onPress={() => {
                    setError(null);
                    setMode('signup');
                  }}
                  style={[
                    styles.modeSegment,
                    {
                      backgroundColor:
                        mode === 'signup' ? colors.surfaceElevated : 'transparent',
                      borderRadius: radii.input - 2,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.modeText,
                      {
                        color: mode === 'signup' ? colors.ink : colors.inkMuted,
                        fontWeight: mode === 'signup' ? '700' : '600',
                      },
                    ]}>
                    Create Account
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="tab"
                  accessibilityLabel="Sign In tab"
                  accessibilityState={{ selected: mode === 'signin' }}
                  onPress={() => {
                    setError(null);
                    setMode('signin');
                  }}
                  style={[
                    styles.modeSegment,
                    {
                      backgroundColor:
                        mode === 'signin' ? colors.surfaceElevated : 'transparent',
                      borderRadius: radii.input - 2,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.modeText,
                      {
                        color: mode === 'signin' ? colors.ink : colors.inkMuted,
                        fontWeight: mode === 'signin' ? '700' : '600',
                      },
                    ]}>
                    Sign In
                  </Text>
                </Pressable>
              </View>

              {mode === 'signup' ? (
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.ink }]}>Your first name</Text>
                  <TextInput
                    key="input-first-name"
                    accessibilityLabel="Your first name"
                    autoCapitalize="words"
                    autoCorrect={false}
                    maxLength={40}
                    value={displayName}
                    placeholder="Your Name"
                    placeholderTextColor={colors.placeholder}
                    onChangeText={(val) => {
                      setError(null);
                      setDisplayName(val);
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
              ) : null}

              <View style={styles.fieldGroup}>
                <Text style={[styles.label, { color: colors.ink }]}>Email</Text>
                <TextInput
                  key="input-email"
                  accessibilityLabel="Email address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  keyboardType="email-address"
                  value={email}
                  placeholder="email@example.com"
                  placeholderTextColor={colors.placeholder}
                  onChangeText={(val) => {
                    setError(null);
                    setEmail(val);
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
                <Text style={[styles.label, { color: colors.ink }]}>Password</Text>
                <TextInput
                  key="input-password"
                  accessibilityLabel="Password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  value={password}
                  placeholder="At least 6 characters"
                  placeholderTextColor={colors.placeholder}
                  onChangeText={(val) => {
                    setError(null);
                    setPassword(val);
                  }}
                  onSubmitEditing={() => {
                    if (mode === 'signin') void handleSubmit();
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

              {mode === 'signup' ? (
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.ink }]}>Confirm password</Text>
                  <TextInput
                    key="input-confirm-password"
                    accessibilityLabel="Confirm password"
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    value={confirmPassword}
                    placeholder="Re-enter password"
                    placeholderTextColor={colors.placeholder}
                    onChangeText={(val) => {
                      setError(null);
                      setConfirmPassword(val);
                    }}
                    onSubmitEditing={() => void handleSubmit()}
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
              ) : null}

              {error ? <InlineNotice message={error} tone="error" /> : null}

              <KeepItButton
                label={mode === 'signup' ? 'Create Account' : 'Sign In'}
                loading={loading}
                onPress={() => void handleSubmit()}
              />
            </View>
          </RevealOnAppear>
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
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: -1.1,
    marginTop: 4,
  },
  tagline: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.4,
    lineHeight: 23,
    textAlign: 'center',
  },
  card: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  modeTrack: {
    flexDirection: 'row',
    borderWidth: 1,
    padding: 3,
    gap: 4,
    borderCurve: 'continuous',
  },
  modeSegment: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  modeText: {
    fontSize: 14,
    letterSpacing: -0.2,
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
});
