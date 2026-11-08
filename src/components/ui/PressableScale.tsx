/**
 * PressableScale — a Pressable that physically reacts to touch.
 *
 * Shrinks slightly while held and springs back on release, with an
 * optional haptic tick on press. Use it for anything the owner taps
 * that should feel like a real button (menu rows, tiles, + buttons)
 * instead of a flat opacity flash.
 */

import React from 'react';
import { Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { haptics } from '@/lib/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PRESS_SPRING = { damping: 18, stiffness: 420, mass: 0.6 };
const RELEASE_SPRING = { damping: 12, stiffness: 260, mass: 0.6 };

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** How far to shrink while held (1 = no shrink). */
  scaleTo?: number;
  /** Haptic fired on press. Defaults to a light selection tick. */
  haptic?: 'select' | 'light' | false;
  children?: React.ReactNode;
}

export function PressableScale({
  style,
  scaleTo = 0.96,
  haptic = 'select',
  onPressIn,
  onPressOut,
  onPress,
  children,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      style={[style, animatedStyle]}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, PRESS_SPRING);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, RELEASE_SPRING);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) haptics[haptic]();
        onPress?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
