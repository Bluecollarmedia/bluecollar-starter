/**
 * Switch — the one on/off toggle used everywhere in the app.
 *
 * iPhone: the system switch, untinted except for the green "on" track, so iOS
 * draws its Liquid Glass thumb and stretch animation. Setting thumbColor (or
 * other tints) on the native switch turns that off, so this component doesn't
 * accept them.
 *
 * Web and Android: a drawn copy of the iOS switch. The pill thumb swells into
 * a see-through glass lens while pressed and springs across the track.
 */

import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Switch as NativeSwitch, ViewStyle } from 'react-native';
import Animated, { interpolate, interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/providers/ThemeProvider';
import { haptics } from '@/lib/haptics';

export interface SwitchProps {
  value: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

const TRACK_W = 64;
const TRACK_H = 28;
const THUMB_W = 38;
const THUMB_H = 24;
const INSET = 2;
const TRAVEL = TRACK_W - THUMB_W - INSET * 2;
const SPRING = { damping: 16, stiffness: 220, mass: 0.7 };

export function Switch(props: SwitchProps) {
  if (Platform.OS === 'ios') return <IOSSwitch {...props} />;
  return <GlassSwitch {...props} />;
}

function IOSSwitch({ value, onValueChange, disabled, style, accessibilityLabel }: SwitchProps) {
  const { colors } = useTheme();
  return (
    <NativeSwitch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      style={style}
      accessibilityLabel={accessibilityLabel}
      trackColor={{ true: colors.primary }}
    />
  );
}

function GlassSwitch({ value, onValueChange, disabled, style, accessibilityLabel }: SwitchProps) {
  const { colors } = useTheme();
  const on = useSharedValue(value ? 1 : 0);
  const pressed = useSharedValue(0);

  useEffect(() => {
    on.value = withSpring(value ? 1 : 0, SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const offTrack = colors.border;
  const onTrack = colors.primary;

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [offTrack, onTrack]),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: on.value * TRAVEL },
      // Pressed, the thumb swells into a lens that overhangs the track.
      { scaleX: interpolate(pressed.value, [0, 1], [1, 1.32]) },
      { scaleY: interpolate(pressed.value, [0, 1], [1, 1.5]) },
    ],
    backgroundColor: `rgba(255, 255, 255, ${interpolate(pressed.value, [0, 1], [1, 0.35])})`,
    borderColor: `rgba(255, 255, 255, ${interpolate(pressed.value, [0, 1], [0, 0.9])})`,
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={8}
      onPressIn={() => { pressed.value = withTiming(1, { duration: 140 }); }}
      onPressOut={() => { pressed.value = withSpring(0, SPRING); }}
      onPress={() => { haptics.select(); onValueChange?.(!value); }}
      style={[{ opacity: disabled ? 0.45 : 1 }, style]}
    >
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.thumb, thumbStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    justifyContent: 'center',
    paddingHorizontal: INSET,
  },
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: THUMB_H / 2,
    borderWidth: StyleSheet.hairlineWidth * 2,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
