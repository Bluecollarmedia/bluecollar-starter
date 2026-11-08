import React, { useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

/**
 * The touch layer for every Weather chart. Sliding a finger sideways across it picks the nearest of `count` points in real time (onPick runs on
 * every move); a quick tap picks too (unless `tap` is false). It claims a touch only once the finger has moved sideways, and lets go of it the
 * moment the finger moves up or down, so nothing here ever holds up the page's scrolling or the sheet's own swipe-down. No vibration, no work at
 * touch-down. It needs a GestureHandlerRootView above it (the app root has one; the details sheet adds its own inside its Modal).
 */
export function ScrubArea({ width, count, onPick, onEnd, tap = true, style, children }: {
  width: number; count: number; onPick: (index: number) => void; onEnd?: () => void; tap?: boolean; style?: StyleProp<ViewStyle>; children?: React.ReactNode;
}) {
  const gesture = useMemo(() => {
    const pick = (x: number) => {
      if (count < 1 || width <= 0) return;
      onPick(Math.max(0, Math.min(count - 1, Math.round((x / width) * (count - 1)))));
    };
    const pan = Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-8, 8])
      .failOffsetY([-6, 6])
      .onStart((e) => pick(e.x))
      .onUpdate((e) => pick(e.x))
      .onFinalize(() => onEnd?.());
    if (!tap) return pan;
    const tapGesture = Gesture.Tap().runOnJS(true).maxDuration(220).onEnd((e, ok) => { if (ok) pick(e.x); });
    return Gesture.Race(pan, tapGesture);
  }, [width, count, onPick, onEnd, tap]);
  return (
    <GestureDetector gesture={gesture}>
      <View style={style} collapsable={false}>{children}</View>
    </GestureDetector>
  );
}
