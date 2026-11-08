/**
 * FadeInItem — eases a list item up into place when a screen opens,
 * staggered by its index so cards arrive one after another.
 */

import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

const STEP_MS = 45;
const MAX_STAGGER = 8;

export function FadeInItem({
  index = 0,
  style,
  children,
}: {
  index?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <Animated.View
      style={style}
      entering={FadeInDown.duration(340).delay(Math.min(index, MAX_STAGGER) * STEP_MS).springify().damping(18)}
    >
      {children}
    </Animated.View>
  );
}
