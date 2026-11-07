import React from 'react';
import { StyleSheet, View } from 'react-native';

export interface MapIconProps {
  color: string;
  accentColor?: string;
  size?: number;
}

/**
 * LiveBeaconIcon: Concentric signal rings + core dot for active live sharing.
 */
export function LiveBeaconIcon({ color, accentColor, size = 20 }: MapIconProps) {
  const outer = Math.round(size * 0.9);
  const mid = Math.round(size * 0.56);
  const core = Math.max(4, Math.round(size * 0.24));
  const dotColor = accentColor ?? color;

  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View
        style={{
          position: 'absolute',
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: mid,
          height: mid,
          borderRadius: mid / 2,
          borderWidth: 1.75,
          borderColor: dotColor,
        }}
      />
      <View
        style={{
          width: core,
          height: core,
          borderRadius: core / 2,
          backgroundColor: dotColor,
        }}
      />
    </View>
  );
}

/**
 * MomentPinIcon: KeepIt's dual-frame squircle camera mark paired with a location pin base.
 */
export function MomentPinIcon({ color, size = 20 }: MapIconProps) {
  const frameW = Math.round(size * 0.72);
  const frameH = Math.round(size * 0.72);
  const pipW = Math.max(4, Math.round(frameW * 0.38));
  const pipH = Math.max(5, Math.round(frameH * 0.44));
  const dot = Math.max(3, Math.round(size * 0.16));

  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View
        style={{
          width: frameW,
          height: frameH,
          borderRadius: Math.round(frameW * 0.3),
          borderCurve: 'continuous',
          borderWidth: 1.8,
          borderColor: color,
          padding: 2.5,
          justifyContent: 'space-between',
        }}
      >
        <View
          style={{
            width: pipW,
            height: pipH,
            borderRadius: 2,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            alignSelf: 'flex-end',
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

/**
 * GhostCloakIcon: Dashed cloaked circle with a diagonal privacy slash.
 */
export function GhostCloakIcon({ color, size = 20 }: MapIconProps) {
  const ring = Math.round(size * 0.78);
  const slash = Math.round(size * 0.92);

  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: 1.8,
          borderStyle: 'dashed',
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: slash,
          height: 2,
          borderRadius: 1,
          backgroundColor: color,
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </View>
  );
}

/**
 * StreetGridIcon: 2x2 street block map grid.
 */
export function StreetGridIcon({ color, size = 18 }: MapIconProps) {
  const outer = Math.round(size * 0.84);

  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View
        style={{
          width: outer,
          height: outer,
          borderRadius: 4,
          borderCurve: 'continuous',
          borderWidth: 1.75,
          borderColor: color,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <View style={{ position: 'absolute', width: '100%', height: 1.5, backgroundColor: color }} />
        <View style={{ position: 'absolute', width: 1.5, height: '100%', backgroundColor: color }} />
      </View>
    </View>
  );
}

/**
 * RadarRingsIcon: Concentric radar rings + center sweep dot.
 */
export function RadarRingsIcon({ color, size = 18 }: MapIconProps) {
  const outer = Math.round(size * 0.88);
  const inner = Math.round(size * 0.48);
  const core = Math.max(3, Math.round(size * 0.18));

  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View
        style={{
          position: 'absolute',
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          borderWidth: 1.6,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          borderWidth: 1.4,
          borderColor: color,
        }}
      />
      <View
        style={{
          width: core,
          height: core,
          borderRadius: core / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/**
 * FriendsClusterIcon: Overlapping dual-person silhouette for circle/friend pins.
 */
export function FriendsClusterIcon({ color, size = 18 }: MapIconProps) {
  const head = Math.max(5, Math.round(size * 0.3));
  const bodyW = Math.max(9, Math.round(size * 0.52));
  const bodyH = Math.max(5, Math.round(size * 0.28));

  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 1.5 }}>
        <View style={{ width: head, height: head, borderRadius: head / 2, borderWidth: 1.6, borderColor: color }} />
        <View style={{ width: head - 1, height: head - 1, borderRadius: head / 2, borderWidth: 1.5, borderColor: color }} />
      </View>
      <View
        style={{
          width: bodyW,
          height: bodyH,
          borderTopLeftRadius: bodyH,
          borderTopRightRadius: bodyH,
          borderWidth: 1.6,
          borderColor: color,
        }}
      />
    </View>
  );
}

/**
 * CrosshairIcon: Precision GPS / recenter target reticle.
 */
export function CrosshairIcon({ color, size = 18 }: MapIconProps) {
  const ring = Math.round(size * 0.62);
  const tick = Math.max(3, Math.round(size * 0.2));
  const core = Math.max(3, Math.round(size * 0.16));

  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: 1.75,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: core, height: core, borderRadius: core / 2, backgroundColor: color }} />
      </View>
      <View style={{ position: 'absolute', top: 0, width: 1.75, height: tick, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position: 'absolute', bottom: 0, width: 1.75, height: tick, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position: 'absolute', left: 0, width: tick, height: 1.75, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position: 'absolute', right: 0, width: tick, height: 1.75, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

/**
 * CoupleLinkIcon: Interlocking twin rings representing two partners' shared distance.
 */
export function CoupleLinkIcon({ color, size = 18 }: MapIconProps) {
  const ring = Math.round(size * 0.56);
  const offset = Math.round(size * 0.16);

  return (
    <View accessible={false} style={[styles.box, { width: size, height: size, flexDirection: 'row' }]}>
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: 1.75,
          borderColor: color,
          marginRight: -offset,
        }}
      />
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: 1.75,
          borderColor: color,
        }}
      />
    </View>
  );
}

/**
 * ZoomPlusIcon: Crisp geometric plus mark.
 */
export function ZoomPlusIcon({ color, size = 18 }: MapIconProps) {
  const bar = Math.round(size * 0.68);
  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View style={{ position: 'absolute', width: bar, height: 2, borderRadius: 1, backgroundColor: color }} />
      <View style={{ position: 'absolute', width: 2, height: bar, borderRadius: 1, backgroundColor: color }} />
    </View>
  );
}

/**
 * ZoomMinusIcon: Crisp geometric minus mark.
 */
export function ZoomMinusIcon({ color, size = 18 }: MapIconProps) {
  const bar = Math.round(size * 0.68);
  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View style={{ width: bar, height: 2, borderRadius: 1, backgroundColor: color }} />
    </View>
  );
}

/**
 * PanMoveIcon: 4-way directional axis cross for map pan mode.
 */
export function PanMoveIcon({ color, size = 18 }: MapIconProps) {
  const bar = Math.round(size * 0.78);
  const tip = 4;
  const inset = Math.round((size - bar) / 2);
  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View style={{ position: 'absolute', width: bar, height: 1.5, borderRadius: 1, backgroundColor: color }} />
      <View style={{ position: 'absolute', width: 1.5, height: bar, borderRadius: 1, backgroundColor: color }} />
      <View
        style={{
          position: 'absolute',
          top: inset,
          width: tip,
          height: tip,
          borderTopWidth: 1.6,
          borderLeftWidth: 1.6,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: inset,
          width: tip,
          height: tip,
          borderBottomWidth: 1.6,
          borderRightWidth: 1.6,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: inset,
          width: tip,
          height: tip,
          borderBottomWidth: 1.6,
          borderLeftWidth: 1.6,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: inset,
          width: tip,
          height: tip,
          borderTopWidth: 1.6,
          borderRightWidth: 1.6,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

/**
 * DirectionChevronIcon: Directional chevron for N/S/E/W map panning and disclosure toggles.
 */
export function DirectionChevronIcon({
  color,
  size = 16,
  direction = 'up',
}: MapIconProps & { direction?: 'up' | 'down' | 'left' | 'right' }) {
  const arm = Math.max(6, Math.round(size * 0.44));
  const rotation =
    direction === 'up'
      ? '45deg'
      : direction === 'right'
        ? '135deg'
        : direction === 'down'
          ? '225deg'
          : '-45deg';

  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View
        style={{
          width: arm,
          height: arm,
          borderTopWidth: 2,
          borderLeftWidth: 2,
          borderColor: color,
          transform: [{ rotate: rotation }],
        }}
      />
    </View>
  );
}

/**
 * CafeCupIcon: Minimalist espresso cup glyph for coffee spot check-in.
 */
export function CafeCupIcon({ color, size = 18 }: MapIconProps) {
  const cupW = Math.round(size * 0.58);
  const cupH = Math.round(size * 0.48);
  const saucerW = Math.round(size * 0.72);

  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: cupW,
            height: cupH,
            borderBottomLeftRadius: 4,
            borderBottomRightRadius: 4,
            borderWidth: 1.75,
            borderColor: color,
          }}
        />
        <View
          style={{
            width: 4,
            height: Math.max(5, cupH - 3),
            borderTopRightRadius: 3,
            borderBottomRightRadius: 3,
            borderTopWidth: 1.6,
            borderRightWidth: 1.6,
            borderBottomWidth: 1.6,
            borderColor: color,
            marginLeft: -1,
          }}
        />
      </View>
      <View
        style={{
          width: saucerW,
          height: 1.75,
          borderRadius: 1,
          backgroundColor: color,
          marginTop: 2,
        }}
      />
    </View>
  );
}

/**
 * ParkOverlookIcon: Twin peak / canopy silhouette for park & scenic spot check-ins.
 */
export function ParkOverlookIcon({ color, size = 18 }: MapIconProps) {
  const mainCanopy = Math.round(size * 0.48);
  const sideCanopy = Math.round(size * 0.36);
  const baseW = Math.round(size * 0.72);

  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 1 }}>
        <View
          style={{
            width: mainCanopy,
            height: mainCanopy,
            borderRadius: mainCanopy / 2,
            borderWidth: 1.75,
            borderColor: color,
            marginRight: -3,
          }}
        />
        <View
          style={{
            width: sideCanopy,
            height: sideCanopy,
            borderRadius: sideCanopy / 2,
            borderWidth: 1.6,
            borderColor: color,
          }}
        />
      </View>
      <View
        style={{
          width: baseW,
          height: 1.75,
          borderRadius: 1,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/**
 * ChatBubbleIcon: Crisp message bubble with tail for direct circle messaging.
 */
export function ChatBubbleIcon({ color, size = 18 }: MapIconProps) {
  const bubbleW = Math.round(size * 0.78);
  const bubbleH = Math.round(size * 0.64);

  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View
        style={{
          width: bubbleW,
          height: bubbleH,
          borderRadius: 5,
          borderBottomLeftRadius: 1,
          borderCurve: 'continuous',
          borderWidth: 1.75,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 2.5,
        }}
      >
        <View style={{ width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: color }} />
        <View style={{ width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: color }} />
      </View>
    </View>
  );
}

/**
 * HistoryClockIcon: Minimal clock dial for sharing activity log.
 */
export function HistoryClockIcon({ color, size = 18 }: MapIconProps) {
  const dial = Math.round(size * 0.82);
  const hand = Math.max(4, Math.round(size * 0.24));

  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View
        style={{
          width: dial,
          height: dial,
          borderRadius: dial / 2,
          borderWidth: 1.75,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 1.75,
            height: hand,
            backgroundColor: color,
            borderRadius: 1,
            transform: [{ translateY: -hand / 2 + 1 }],
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: hand - 1,
            height: 1.75,
            backgroundColor: color,
            borderRadius: 1,
            transform: [{ translateX: (hand - 1) / 2 }],
          }}
        />
      </View>
    </View>
  );
}

/**
 * CloseCrossIcon: Clean X icon for dismissing sheets or inspector panels.
 */
export function CloseCrossIcon({ color, size = 16 }: MapIconProps) {
  const bar = Math.round(size * 0.74);
  return (
    <View accessible={false} style={[styles.box, { width: size, height: size }]}>
      <View
        style={{
          position: 'absolute',
          width: bar,
          height: 1.8,
          borderRadius: 1,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: bar,
          height: 1.8,
          borderRadius: 1,
          backgroundColor: color,
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </View>
  );
}

/**
 * PauseCloakIcon / PlayResumeIcon: Quick toggle icon for pausing or resuming sharing.
 */
export function PauseResumeIcon({
  color,
  paused,
  size = 16,
}: MapIconProps & { paused: boolean }) {
  if (paused) {
    // Play / Resume triangle-like chevron + dot
    return <LiveBeaconIcon color={color} size={size} />;
  }
  const barH = Math.round(size * 0.62);
  return (
    <View accessible={false} style={[styles.box, { width: size, height: size, flexDirection: 'row', gap: 3 }]}>
      <View style={{ width: 2.2, height: barH, borderRadius: 1, backgroundColor: color }} />
      <View style={{ width: 2.2, height: barH, borderRadius: 1, backgroundColor: color }} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
