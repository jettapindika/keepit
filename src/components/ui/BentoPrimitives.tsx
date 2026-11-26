import { Image } from 'expo-image';
import React from 'react';
import { Platform, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { useKeepItTheme } from '@/theme/tokens';

export type BentoTileVariant = 'dark' | 'heroBlue' | 'bottomGlow' | 'spotlight' | 'chartBlue';
export type BentoPattern = 'none' | 'dots' | 'grid';

function encodeSvgDataUri(svg: string): string {
  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(svg);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:image/svg+xml;base64,${btoa(binary)}`;
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const NOISE_SVG_URI = encodeSvgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/></filter><rect width="160" height="160" filter="url(#n)" opacity="0.55"/></svg>`
);

const HERO_BLUE_SVG_URI = encodeSvgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" preserveAspectRatio="none"><defs><radialGradient id="g" cx="50%" cy="22%" r="78%"><stop offset="0%" stop-color="#2F55FF"/><stop offset="42%" stop-color="#1B38D6"/><stop offset="76%" stop-color="#0A1650"/><stop offset="100%" stop-color="#050A24"/></radialGradient></defs><rect width="400" height="400" fill="url(#g)"/></svg>`
);

const BOTTOM_GLOW_SVG_URI = encodeSvgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" preserveAspectRatio="none"><defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0A1650"/><stop offset="100%" stop-color="#0A1A6A"/></linearGradient><radialGradient id="gl" cx="50%" cy="100%" r="65%"><stop offset="0%" stop-color="#2F55FF" stop-opacity="0.95"/><stop offset="70%" stop-color="#2F55FF" stop-opacity="0"/></radialGradient></defs><rect width="400" height="400" fill="url(#bg)"/><rect width="400" height="400" fill="url(#gl)"/></svg>`
);

const SPOTLIGHT_DARK_SVG_URI = encodeSvgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" preserveAspectRatio="none"><defs><radialGradient id="sp" cx="85%" cy="0%" r="60%"><stop offset="0%" stop-color="#7896FF" stop-opacity="0.22"/><stop offset="70%" stop-color="#7896FF" stop-opacity="0"/></radialGradient></defs><rect width="400" height="400" fill="url(#sp)"/></svg>`
);

const CHART_BLUE_SVG_URI = encodeSvgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" preserveAspectRatio="none"><defs><linearGradient id="cb" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2F55FF" stop-opacity="0.35"/><stop offset="100%" stop-color="#0A1650" stop-opacity="0.6"/></linearGradient></defs><rect width="400" height="400" fill="url(#cb)"/></svg>`
);

/**
 * Core surface from DESIGN.md: obsidian `#0D0D0D` or atmospheric electric-blue glow tile
 * with optional dot/grid texture, subtle film grain, and machined 1px top-light hairline.
 */
export function BentoTile({
  variant = 'dark',
  pattern = 'none',
  grain,
  radius,
  style,
  children,
}: {
  variant?: BentoTileVariant;
  pattern?: BentoPattern;
  grain?: boolean;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const { colors, isDark, radii } = useKeepItTheme();
  const isBlueSurface = variant === 'heroBlue' || variant === 'bottomGlow';
  const resolvedGrain = grain ?? isBlueSurface;
  const resolvedRadius = radius ?? radii.card;

  const baseBg = isBlueSurface
    ? '#0A1650'
    : variant === 'chartBlue'
      ? isDark
        ? '#0D1333'
        : '#E8EEFF'
      : colors.surface;

  const borderColor = isBlueSurface
    ? 'rgba(255,255,255,0.14)'
    : variant === 'chartBlue'
      ? 'rgba(75,115,255,0.28)'
      : colors.border;

  const webGradientStyle =
    Platform.OS === 'web'
      ? ({
          backgroundImage:
            variant === 'heroBlue'
              ? 'radial-gradient(120% 90% at 50% 25%, #2F55FF 0%, #1B38D6 40%, #0A1650 75%, #050A24 100%)'
              : variant === 'bottomGlow'
                ? 'radial-gradient(90% 60% at 50% 100%, #2F55FF 0%, rgba(47,85,255,0) 70%), linear-gradient(180deg, #0A1650 0%, #0A1A6A 100%)'
                : variant === 'spotlight'
                  ? isDark
                    ? 'radial-gradient(60% 50% at 85% 0%, rgba(120,150,255,0.22), transparent 70%)'
                    : 'radial-gradient(60% 50% at 85% 0%, rgba(47,85,255,0.10), transparent 70%)'
                  : variant === 'chartBlue'
                    ? isDark
                      ? 'linear-gradient(180deg, rgba(47,85,255,0.35) 0%, rgba(10,22,80,0.6) 100%)'
                      : 'linear-gradient(180deg, rgba(47,85,255,0.14) 0%, rgba(232,238,255,0.92) 100%)'
                    : undefined,
        } as unknown as ViewStyle)
      : undefined;

  const nativeGradientUri =
    variant === 'heroBlue'
      ? HERO_BLUE_SVG_URI
      : variant === 'bottomGlow'
        ? BOTTOM_GLOW_SVG_URI
        : variant === 'spotlight' && isDark
          ? SPOTLIGHT_DARK_SVG_URI
          : variant === 'chartBlue' && isDark
            ? CHART_BLUE_SVG_URI
            : null;

  const webPatternStyle =
    Platform.OS === 'web' && pattern !== 'none'
      ? ({
          backgroundImage:
            pattern === 'dots'
              ? `radial-gradient(${colors.gridLine} 1px, transparent 1px)`
              : `linear-gradient(to right, ${colors.gridLine} 1px, transparent 1px), linear-gradient(to bottom, ${colors.gridLine} 1px, transparent 1px)`,
          backgroundSize: pattern === 'dots' ? '14px 14px' : '48px 48px',
        } as unknown as ViewStyle)
      : undefined;

  return (
    <View
      style={[
        styles.tile,
        {
          backgroundColor: baseBg,
          borderColor,
          borderRadius: resolvedRadius,
        },
        webGradientStyle,
        style,
      ]}>
      {Platform.OS !== 'web' && nativeGradientUri ? (
        <Image
          pointerEvents="none"
          source={{ uri: nativeGradientUri }}
          contentFit="cover"
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {pattern !== 'none' && webPatternStyle ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, webPatternStyle]} />
      ) : null}

      {resolvedGrain ? (
        Platform.OS === 'web' ? (
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                opacity: isBlueSurface ? 0.14 : isDark ? 0.06 : 0.025,
                backgroundImage: `url("${NOISE_SVG_URI}")`,
                backgroundRepeat: 'repeat',
                backgroundSize: '160px 160px',
                mixBlendMode: 'overlay',
              } as unknown as ViewStyle,
            ]}
          />
        ) : (
          <Image
            pointerEvents="none"
            source={{ uri: NOISE_SVG_URI }}
            contentFit="cover"
            style={[StyleSheet.absoluteFill, { opacity: isBlueSurface ? 0.1 : 0.04 }]}
          />
        )
      ) : null}

      <View
        pointerEvents="none"
        style={[styles.topHairline, { backgroundColor: isBlueSurface ? 'rgba(255,255,255,0.22)' : colors.topHighlight }]}
      />
      {children}
    </View>
  );
}

/** Signature two-circle overlapping toggle motif from DESIGN.md §6.4/6.5. */
export function BentoToggleGlyph({
  size = 28,
  tone = 'blueTile',
}: {
  size?: number;
  tone?: 'blueTile' | 'darkFolder' | 'auto';
}) {
  const { isDark } = useKeepItTheme();
  const circle = Math.round(size * 0.62);
  const offset = Math.round(circle * 0.56);
  const resolvedTone = tone === 'auto' ? (isDark ? 'darkFolder' : 'darkFolder') : tone;

  const filledColor =
    resolvedTone === 'blueTile'
      ? '#E8EDFF'
      : isDark
        ? 'rgba(255,255,255,0.30)'
        : 'rgba(10,16,40,0.22)';
  const strokeColor =
    resolvedTone === 'blueTile'
      ? 'rgba(255,255,255,0.72)'
      : isDark
        ? 'rgba(255,255,255,0.34)'
        : 'rgba(10,16,40,0.28)';

  return (
    <View
      accessible={false}
      style={{
        width: circle + offset,
        height: circle,
        position: 'relative',
        justifyContent: 'center',
      }}>
      <View
        style={{
          width: circle,
          height: circle,
          borderRadius: circle / 2,
          backgroundColor: filledColor,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: offset,
          width: circle,
          height: circle,
          borderRadius: circle / 2,
          borderWidth: 1.5,
          borderColor: strokeColor,
          backgroundColor: 'transparent',
        }}
      />
    </View>
  );
}

/** Glossy watch-face counter object with side lugs and electric-blue tabular figure. */
export function BentoWatchStat({
  value,
  label,
  caption,
}: {
  value: string | number;
  label?: string;
  caption?: string;
}) {
  const { colors, isDark, type } = useKeepItTheme();
  return (
    <View style={styles.watchWrap}>
      {label ? (
        <Text numberOfLines={1} style={[styles.watchTopLabel, { color: colors.inkMuted, fontFamily: type.fontSans }]}>
          {label}
        </Text>
      ) : null}
      <View style={styles.watchCaseOuter}>
        <View
          pointerEvents="none"
          style={[
            styles.watchLugLeft,
            { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(10,16,40,0.08)' },
          ]}
        />
        <View
          style={[
            styles.watchFace,
            {
              backgroundColor: colors.surfaceObject,
              borderColor: isDark ? 'rgba(255,255,255,0.10)' : colors.border,
            },
          ]}>
          <View
            pointerEvents="none"
            style={[styles.topHairline, { backgroundColor: colors.topHighlight }]}
          />
          <Text
            numberOfLines={1}
            style={[
              styles.watchValue,
              { color: isDark ? '#6C8BFF' : colors.primary, fontFamily: type.fontSans },
            ]}>
            {value}
          </Text>
        </View>
        <View
          pointerEvents="none"
          style={[
            styles.watchLugRight,
            { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(10,16,40,0.08)' },
          ]}
        />
      </View>
      {caption ? (
        <Text numberOfLines={2} style={[styles.watchCaption, { color: colors.ink, fontFamily: type.fontSans }]}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

/** Hero electric-blue tile with giant display figure partially tucked behind a glossy dark folder object. */
export function BentoHeroFolderStat({
  value,
  caption,
  style,
}: {
  value: string;
  caption: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { type } = useKeepItTheme();
  return (
    <BentoTile variant="heroBlue" grain radius={16} style={[styles.heroFolderTile, style]}>
      <Text style={[styles.heroFolderCaption, { fontFamily: type.fontSans }]}>{caption}</Text>
      <View style={styles.heroFolderStage}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[styles.heroDisplayStat, { fontFamily: type.fontSans }]}>
          {value}
        </Text>
        <View style={styles.folderObjectWrap}>
          <View style={styles.folderTab} />
          <View style={styles.folderBody}>
            <View pointerEvents="none" style={[styles.topHairline, { backgroundColor: 'rgba(255,255,255,0.18)' }]} />
            <BentoToggleGlyph size={34} tone="darkFolder" />
          </View>
        </View>
      </View>
    </BentoTile>
  );
}

/** Overlapping tilted glossy squircle object tiles used on onboarding & feature highlights. */
export function BentoSquircleCluster() {
  return (
    <BentoTile variant="spotlight" pattern="grid" grain radius={24} style={styles.clusterTile}>
      <View style={styles.clusterRow}>
        <View style={[styles.squircle, styles.squircleLeft]}>
          <View style={[styles.topHairline, { backgroundColor: 'rgba(255,255,255,0.16)' }]} />
          <View style={styles.miniApertureRing}>
            <View style={styles.miniApertureInner} />
          </View>
        </View>

        <View style={[styles.squircle, styles.squircleCenter]}>
          <View style={[styles.topHairline, { backgroundColor: 'rgba(255,255,255,0.30)' }]} />
          <View style={styles.centerDualBack}>
            <View style={styles.centerDualFront} />
          </View>
        </View>

        <View style={[styles.squircle, styles.squircleRight]}>
          <View style={[styles.topHairline, { backgroundColor: 'rgba(255,255,255,0.16)' }]} />
          <BentoToggleGlyph size={30} tone="blueTile" />
        </View>
      </View>
    </BentoTile>
  );
}

/** Smooth electric-blue sparkline curve plotted strictly from real numeric series. */
export function BentoSparklineCard({
  title,
  valueLabel,
  subtitle,
  points,
}: {
  title: string;
  valueLabel: string;
  subtitle?: string;
  points: number[];
}) {
  const { colors, isDark, type } = useKeepItTheme();
  const safePoints = points.length >= 2 ? points : [0, points[0] ?? 0];
  const maxVal = Math.max(1, ...safePoints);
  const w = 260;
  const h = 72;
  const padX = 12;
  const padY = 12;
  const stepX = (w - padX * 2) / Math.max(1, safePoints.length - 1);

  const coords = safePoints.map((v, idx) => ({
    x: Math.round((padX + idx * stepX) * 10) / 10,
    y: Math.round((h - padY - (v / maxVal) * (h - padY * 2)) * 10) / 10,
  }));

  let pathD = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 1; i < coords.length; i += 1) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const cx = Math.round(((prev.x + curr.x) / 2) * 10) / 10;
    pathD += ` C ${cx} ${prev.y}, ${cx} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  const last = coords[coords.length - 1];
  const strokeBlue = isDark ? '#4B73FF' : '#2F55FF';
  const statColor = isDark ? '#6C8BFF' : '#2F55FF';
  const sparkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none"><line x1="${last.x}" y1="4" x2="${last.x}" y2="${h - 4}" stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="3 3"/><path d="${pathD}" stroke="${strokeBlue}" stroke-width="2.2" stroke-linecap="round"/><circle cx="${last.x}" cy="${last.y}" r="4.5" fill="${isDark ? '#0D1333' : '#FFFFFF'}" stroke="#FFFFFF" stroke-width="2"/></svg>`;

  return (
    <BentoTile variant="chartBlue" grain radius={16} style={styles.sparkCard}>
      <View style={styles.sparkHeader}>
        <Text style={[styles.sparkTitle, { color: colors.ink, fontFamily: type.fontSans }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.sparkSub, { color: colors.inkMuted, fontFamily: type.fontSans }]}>{subtitle}</Text>
        ) : null}
      </View>

      <View style={styles.sparkChartWrap}>
        {Platform.OS === 'web' ? (
          React.createElement(
            'svg',
            {
              width: '100%',
              height: h,
              viewBox: `0 0 ${w} ${h}`,
              preserveAspectRatio: 'none',
              fill: 'none',
              'aria-hidden': 'true',
              style: { display: 'block' },
            },
            React.createElement('line', {
              x1: last.x,
              y1: 4,
              x2: last.x,
              y2: h - 4,
              stroke: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(10,16,40,0.20)',
              strokeWidth: 1,
              strokeDasharray: '3 3',
            }),
            React.createElement('path', {
              d: pathD,
              stroke: strokeBlue,
              strokeWidth: 2.2,
              strokeLinecap: 'round',
            }),
            React.createElement('circle', {
              cx: last.x,
              cy: last.y,
              r: 4.5,
              fill: isDark ? '#0D1333' : '#FFFFFF',
              stroke: isDark ? '#FFFFFF' : '#2F55FF',
              strokeWidth: 2,
            })
          )
        ) : (
          <Image
            accessible={false}
            source={{ uri: encodeSvgDataUri(sparkSvg) }}
            contentFit="fill"
            style={{ width: '100%', height: h }}
          />
        )}
      </View>

      <Text style={[styles.sparkValue, { color: statColor, fontFamily: type.fontSans }]}>{valueLabel}</Text>
    </BentoTile>
  );
}

const styles = StyleSheet.create({
  tile: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  topHairline: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    zIndex: 2,
  },
  watchWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  watchTopLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  watchCaseOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchLugLeft: {
    width: 5,
    height: 44,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
    marginRight: 2,
  },
  watchLugRight: {
    width: 5,
    height: 44,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
    marginLeft: 2,
  },
  watchFace: {
    minWidth: 96,
    height: 76,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  watchValue: {
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '600',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  watchCaption: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '500',
    textAlign: 'center',
  },
  heroFolderTile: {
    paddingTop: 22,
    paddingHorizontal: 20,
    paddingBottom: 0,
    alignItems: 'center',
    gap: 10,
  },
  heroFolderCaption: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    textAlign: 'center',
  },
  heroFolderStage: {
    width: '100%',
    height: 152,
    alignItems: 'center',
    justifyContent: 'flex-end',
    position: 'relative',
  },
  heroDisplayStat: {
    position: 'absolute',
    top: 0,
    color: '#050814',
    fontSize: 82,
    lineHeight: 82,
    fontWeight: '700',
    letterSpacing: -3,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(143,168,255,0.45)',
    textShadowOffset: { width: 0, height: -1 },
    textShadowRadius: 4,
  },
  folderObjectWrap: {
    width: 196,
    height: 98,
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
  },
  folderTab: {
    width: 68,
    height: 14,
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  folderBody: {
    width: '100%',
    height: 86,
    backgroundColor: '#1C1C1E',
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  clusterTile: {
    width: 288,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  clusterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  squircle: {
    width: 82,
    height: 82,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  squircleLeft: {
    backgroundColor: '#1C1C1E',
    borderColor: 'rgba(255,255,255,0.12)',
    transform: [{ rotate: '-12deg' }, { translateX: 14 }, { translateY: 6 }],
    zIndex: 1,
  },
  squircleCenter: {
    width: 92,
    height: 92,
    borderRadius: 26,
    backgroundColor: '#2F55FF',
    borderColor: 'rgba(143,168,255,0.55)',
    zIndex: 3,
  },
  squircleRight: {
    backgroundColor: '#1C1C1E',
    borderColor: 'rgba(255,255,255,0.12)',
    transform: [{ rotate: '12deg' }, { translateX: -14 }, { translateY: 6 }],
    zIndex: 2,
  },
  miniApertureRing: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniApertureInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4B73FF',
  },
  centerDualBack: {
    width: 34,
    height: 40,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    padding: 4,
  },
  centerDualFront: {
    width: 13,
    height: 16,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  sparkCard: {
    padding: 18,
    gap: 10,
  },
  sparkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sparkTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  sparkSub: {
    fontSize: 12,
    lineHeight: 16,
  },
  sparkChartWrap: {
    width: '100%',
    height: 72,
  },
  sparkValue: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '600',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
});
