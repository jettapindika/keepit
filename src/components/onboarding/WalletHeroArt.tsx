import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet } from 'react-native';

export type WalletArtSlide = 'access' | 'secure' | 'smart';

const artwork = {
  access: {
    source: require('../../../assets/images/onboarding/access.svg'),
    description: 'A camera, two photo prints, and a hand presenting a daily moment',
  },
  secure: {
    source: require('../../../assets/images/onboarding/secure.svg'),
    description: 'Two hands sharing a pair of daily moment photo prints',
  },
  smart: {
    source: require('../../../assets/images/onboarding/smart.svg'),
    description: 'A calendar, saved photo memories, and a status balloon held by a hand',
  },
};

export function WalletHeroArt({ slide }: { slide: WalletArtSlide }) {
  const art = artwork[slide];

  return (
    <Image
      accessible
      accessibilityRole="image"
      accessibilityLabel={art.description}
      source={art.source}
      contentFit="contain"
      style={styles.frame}
    />
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 302,
    height: 278,
  },
});
