import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';

import { KeepItAuthForm } from '@/components/onboarding/KeepItAuthForm';
import { WalletOnboarding } from '@/components/onboarding/WalletOnboarding';

export default function WelcomeScreen() {
  const params = useLocalSearchParams<{ confirmed?: string; mode?: string }>();
  const isEmailConfirmedRedirect = params.confirmed === '1' || params.confirmed === 'true';
  const [authMode, setAuthMode] = useState<'signup' | 'signin' | null | 'dismissed'>(() =>
    isEmailConfirmedRedirect || params.mode === 'signin'
      ? 'signin'
      : params.mode === 'signup'
        ? 'signup'
        : null
  );
  const [slideIndex, setSlideIndex] = useState(0);

  const effectiveAuthMode: 'signup' | 'signin' | null =
    authMode === 'dismissed'
      ? null
      : authMode ?? (isEmailConfirmedRedirect ? 'signin' : null);

  if (effectiveAuthMode) {
    return (
      <KeepItAuthForm
        initialMode={effectiveAuthMode}
        initialNotice={
          isEmailConfirmedRedirect
            ? 'Email confirmed! Sign in with your email and password.'
            : null
        }
        onBack={() => setAuthMode('dismissed')}
      />
    );
  }
  return (
    <WalletOnboarding
      initialSlideIndex={slideIndex}
      onSlideChange={setSlideIndex}
      onCreateAccount={() => setAuthMode('signup')}
      onSignIn={() => setAuthMode('signin')}
    />
  );
}
