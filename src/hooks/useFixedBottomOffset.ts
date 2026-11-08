import { useCallback, useRef, useState } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Where to put a button that must sit right above the tab bar and never move, whatever the screen's height.
 * Native tabs sometimes end the screen above the tab bar and sometimes run it underneath, so a fixed "bottom: N" lands in a
 * different place each time (it floated in the middle of the page). This measures how far the screen's bottom edge is above the
 * bottom of the window and subtracts it, so the offset is always measured from the window's bottom.
 *
 * Usage: const { ref, onLayout, bottom } = useFixedBottomOffset();
 *        <View ref={ref} onLayout={onLayout} style={{ flex: 1 }}> ... <View style={{ position: 'absolute', bottom }} /> </View>
 */
/** Approximate height of the floating tab bar above the bottom safe area, plus a small gap. */
const ABOVE_TAB_BAR = 66;

export function useFixedBottomOffset(extra = 0) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const ref = useRef<View>(null);
  const [gap, setGap] = useState(0);

  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((_x, y, _w, h) => {
      if (!h) return;
      const next = Math.max(0, Math.round(windowHeight - (y + h)));
      setGap((prev) => (prev === next ? prev : next));
    });
  }, [windowHeight]);

  const fromWindowBottom = (Platform.OS === 'ios' ? insets.bottom + ABOVE_TAB_BAR : 16) + extra;
  return { ref, onLayout, bottom: Math.max(fromWindowBottom - gap, 12), gap, fromWindowBottom };
}
