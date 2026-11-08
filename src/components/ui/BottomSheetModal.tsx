/**
 * BottomSheetModal — a drop-in for <Modal transparent animationType="slide"> bottom sheets.
 *
 * With the plain slide animation the dimmed backdrop slides up together with
 * the sheet, showing as a dark block moving up the screen. Here the backdrop
 * fades in over the whole screen while only the sheet content slides up.
 *
 * The direct child (usually a full-screen Pressable that closes the sheet) has
 * its own background made transparent; the dimming comes from this component.
 *
 * Swipe down on a sheet to close it (a phone only). The drag follows the finger; a long enough pull, or a quick flick, closes it, otherwise
 * it springs back. Scrolling a long list inside the sheet is left to the list.
 *
 * A sheet that holds a scrolling page can pass `scrollOffset` (the page's scroll position, updated on the UI thread). The swipe then starts the
 * moment a finger moves down while the page is at the top, however slightly, and `closeDistance` / `closeVelocity` can be made smaller.
 *
 * One sheet at a time: a sheet that opens while another is still sliding away waits for it to finish. Two native modals presenting and
 * dismissing at once leave iOS stuck with an invisible layer that swallows every touch (the app looked frozen).
 */

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView, type GestureType } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';

interface BottomSheetModalProps {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactElement<{ style?: any }>;
  scrollOffset?: SharedValue<number>;
  closeDistance?: number;
  closeVelocity?: number;
  /** An extra downward offset the page drives (how far it is pulled past its top): the WHOLE sheet moves with it, live, under the finger. */
  pull?: SharedValue<number>;
}

const IN_MS = 300;
const OUT_MS = 220;
/** Pulled this far (or flicked this fast) it closes. */
const CLOSE_DISTANCE = 110;
const CLOSE_VELOCITY = 900;
/** Never wait longer than this for another sheet to finish closing. */
const WAIT_LIMIT_MS = 700;

// Sheets that are sliding away right now.
const closing = new Set<symbol>();
const waiting = new Set<() => void>();
const notify = () => { for (const w of Array.from(waiting)) w(); };

const SheetPanContext = createContext<React.MutableRefObject<GestureType | undefined> | null>(null);
/**
 * For a page inside a sheet that passes `scrollOffset`: give its gesture-handler ScrollView `simultaneousHandlers={useSheetPanRef()}`, so the
 * page's scrolling and the sheet's swipe-down are recognised together and the swipe works from the top of the page.
 */
export function useSheetPanRef(): React.MutableRefObject<GestureType | undefined> {
  const r = useContext(SheetPanContext);
  const fallback = useRef<GestureType | undefined>(undefined);
  return r ?? fallback;
}

export function BottomSheetModal({ visible, onRequestClose, children, scrollOffset, closeDistance = CLOSE_DISTANCE, closeVelocity = CLOSE_VELOCITY, pull }: BottomSheetModalProps) {
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const id = useRef(Symbol('sheet')).current;
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let kick: ReturnType<typeof setTimeout> | undefined;
    let listener: (() => void) | undefined;
    const others = () => Array.from(closing).some((s) => s !== id);

    const open = () => {
      if (cancelled) return;
      drag.value = 0;
      setMounted(true);
      progress.value = withTiming(1, { duration: IN_MS, easing: Easing.out(Easing.cubic) });
    };

    if (visible) {
      // Checked on the next tick, so a sheet that is closing in this same update has already said so (whatever order they render in).
      kick = setTimeout(() => {
        if (cancelled) return;
        if (!others()) { open(); return; }
        // Another sheet is still sliding away: open when it is gone (or after a short limit, so this can never get stuck).
        listener = () => { if (!others()) { cleanup(); open(); } };
        waiting.add(listener);
        timer = setTimeout(() => { cleanup(); open(); }, WAIT_LIMIT_MS);
      }, 0);
    } else if (mounted) {
      closing.add(id);
      progress.value = withTiming(0, { duration: OUT_MS, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(finishClosing)();
      });
    }

    function cleanup() {
      if (kick) clearTimeout(kick);
      if (timer) clearTimeout(timer);
      if (listener) waiting.delete(listener);
    }
    function finishClosing() {
      closing.delete(id);
      setMounted(false);
      notify();
    }
    return () => { cancelled = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // A sheet unmounted while closing must not hold others back.
  useEffect(() => () => { closing.delete(id); notify(); }, [id]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value * Math.max(0, 1 - (drag.value + (pull?.value ?? 0)) / (height * 0.8)) }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * height + drag.value + (pull?.value ?? 0) }] }));

  // The page's own scroll view (a gesture-handler ScrollView with simultaneousHandlers={useSheetPanRef()}) is recognised AT THE SAME TIME as the
  // swipe-down, so iOS never hands the touch to the scroll view alone (which left the sheet unable to close by a swipe).
  const panRef = useRef<GestureType | undefined>(undefined);
  const base = Gesture.Pan().enabled(Platform.OS !== 'web').withRef(panRef);
  const pan = (scrollOffset
    ? base
      .manualActivation(true)
      .onTouchesDown((e) => { const t = e.changedTouches[0]; if (t) { startX.value = t.absoluteX; startY.value = t.absoluteY; } })
      .onTouchesMove((e, state) => {
        const t = e.changedTouches[0];
        if (!t) return;
        const dy = t.absoluteY - startY.value;
        const dx = Math.abs(t.absoluteX - startX.value);
        if (dy < -6 || (dx > 8 && dx > Math.abs(dy))) { state.fail(); return; }
        // Takes over the instant the finger moves down while the page is at the top.
        if (dy > 4 && scrollOffset.value <= 1) state.activate();
      })
    : base
      .activeOffsetY(14)
      .failOffsetY(-14)
      .failOffsetX([-28, 28])
  )
    .onUpdate((e) => { drag.value = Math.max(0, e.translationY); })
    .onEnd((e) => {
      if (drag.value > closeDistance || e.velocityY > closeVelocity) runOnJS(onRequestClose)();
      else drag.value = withSpring(0, { damping: 22, stiffness: 260 });
    });

  const child = React.cloneElement(children, {
    style: [children.props.style, { backgroundColor: 'transparent' }],
  });

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onRequestClose}>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.fill, sheetStyle]}><SheetPanContext.Provider value={panRef}>{child}</SheetPanContext.Provider></Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.32)' },
  fill: { flex: 1 },
});
