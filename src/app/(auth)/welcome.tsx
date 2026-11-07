import React, { useState } from 'react';

import { KeepItAuthForm } from '@/components/onboarding/KeepItAuthForm';
import { WalletOnboarding } from '@/components/onboarding/WalletOnboarding';

export default function WelcomeScreen() {
  const [authMode, setAuthMode] = useState<'signup' | 'signin' | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);

  if (authMode) {
    return <KeepItAuthForm initialMode={authMode} onBack={() => setAuthMode(null)} />;
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
