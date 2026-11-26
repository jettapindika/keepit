import React from 'react';
import { StyleSheet, View } from 'react-native';

import {
  BentoSquircleCluster,
  BentoTile,
  BentoToggleGlyph,
} from '@/components/ui/BentoPrimitives';

export type WalletArtSlide = 'access' | 'secure' | 'smart';

const descriptions: Record<WalletArtSlide, string> = {
  access: 'Three glossy dark KeepIt app tiles arranged in an overlapping bento cluster',
  secure: 'A glowing electric-blue dual-camera frame with overlapping back and front lenses',
  smart: 'A dark glossy archive folder glowing in electric blue with status and calendar objects',
};

export function WalletHeroArt({ slide }: { slide: WalletArtSlide }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={descriptions[slide]}
      style={styles.frame}>
      {slide === 'access' ? (
        <BentoSquircleCluster />
      ) : slide === 'secure' ? (
        <BentoTile variant="heroBlue" grain radius={24} style={styles.heroCanvas}>
          <View style={styles.topRow}>
            <BentoToggleGlyph size={24} tone="blueTile" />
            <View style={styles.glassTag}>
              <View style={styles.glassTagDot} />
              <View style={styles.glassTagLine} />
            </View>
          </View>
          <View style={styles.dualStage}>
            <View style={styles.dualBackFrame}>
              <View style={styles.dualBackLens} />
            </View>
            <View style={styles.dualPipFrame}>
              <View style={styles.dualPipLens} />
            </View>
          </View>
        </BentoTile>
      ) : (
        <BentoTile variant="bottomGlow" pattern="dots" grain radius={24} style={styles.heroCanvas}>
          <View style={styles.topRow}>
            <View style={styles.glassTag}>
              <View style={styles.glassTagDot} />
              <View style={styles.glassTagLineWide} />
            </View>
            <BentoToggleGlyph size={24} tone="blueTile" />
          </View>
          <View style={styles.folderStage}>
            <View style={styles.folderTab} />
            <View style={styles.folderBody}>
              <View style={styles.folderTopHairline} />
              <BentoToggleGlyph size={32} tone="darkFolder" />
            </View>
          </View>
        </BentoTile>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 302,
    height: 256,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCanvas: {
    width: 288,
    height: 220,
    padding: 18,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  glassTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(13,13,13,0.52)',
  },
  glassTagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#8FA8FF',
  },
  glassTagLine: {
    width: 36,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  glassTagLineWide: {
    width: 52,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  dualStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingTop: 8,
  },
  dualBackFrame: {
    width: 112,
    height: 128,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateX: 16 }],
  },
  dualBackLens: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: 'rgba(143,168,255,0.65)',
  },
  dualPipFrame: {
    position: 'absolute',
    left: 56,
    top: 20,
    width: 66,
    height: 82,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#2F55FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dualPipLens: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
  },
  folderStage: {
    alignSelf: 'center',
    width: 196,
    height: 108,
    justifyContent: 'flex-end',
  },
  folderTab: {
    width: 66,
    height: 14,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: '#1C1C1E',
  },
  folderBody: {
    width: '100%',
    height: 92,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  folderTopHairline: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
});
