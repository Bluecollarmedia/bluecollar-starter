import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { SCRUB_BAR_HEIGHT, formatDuration, fractionOf, timeAtFraction } from '@/lib/portfolio';

/**
 * The seek bar under a full-screen video. Thin at rest; the moment a finger touches it the bar grows and a handle and the time appear, so it is
 * easy to aim (like Instagram). Drag to scrub; lifting the finger jumps the video to that time. The touch area is much taller than the bar.
 */
/** The strip along the left edge where iOS's swipe-back lives (about 5% of the screen). */
export const EDGE_ZONE = 24;

export function ScrubBar({ currentS, durationS, onSeek, onScrubChange }: {
  currentS: number;
  durationS: number;
  onSeek: (timeS: number) => void;
  /** Tells the screen a scrub started or ended (it dims the rest of the picture while scrubbing). */
  onScrubChange?: (scrubbing: boolean) => void;
}) {
  const [scrubbing, setScrubbing] = useState(false);
  const [dragFraction, setDragFraction] = useState(0);
  const area = useRef<View>(null);
  const left = useRef(0);
  const width = useRef(1);

  const pan = useMemo(() => {
    const fractionAt = (pageX: number) => Math.min(1, Math.max(0, (pageX - left.current) / Math.max(1, width.current)));
    // A touch that starts within the phone's left-edge zone is left alone: that swipe closes the screen (iOS's own back gesture). Everywhere else
    // on the bar, the drag is a scrub and nothing else.
    const notAtEdge = (e: { nativeEvent: { pageX: number } }) => e.nativeEvent.pageX > EDGE_ZONE;
    return PanResponder.create({
      onStartShouldSetPanResponder: notAtEdge,
      onMoveShouldSetPanResponder: notAtEdge,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        area.current?.measureInWindow((x, _y, w) => {
          left.current = x; width.current = w;
          setDragFraction(fractionAt(e.nativeEvent.pageX));
        });
        setScrubbing(true);
        onScrubChange?.(true);
      },
      onPanResponderMove: (e) => setDragFraction(fractionAt(e.nativeEvent.pageX)),
      onPanResponderRelease: (e) => {
        const f = fractionAt(e.nativeEvent.pageX);
        setDragFraction(f);
        setScrubbing(false);
        onScrubChange?.(false);
        onSeek(timeAtFraction(f, durationS));
      },
      onPanResponderTerminate: () => { setScrubbing(false); onScrubChange?.(false); },
    });
  }, [durationS, onSeek, onScrubChange]);

  const fraction = scrubbing ? dragFraction : fractionOf(currentS, durationS);
  const shownS = scrubbing ? timeAtFraction(dragFraction, durationS) : currentS;
  const bar = useAnimatedStyle(() => ({ height: withTiming(scrubbing ? SCRUB_BAR_HEIGHT.scrubbing : SCRUB_BAR_HEIGHT.resting, { duration: 140 }), borderRadius: 6 }), [scrubbing]);
  const handle = useAnimatedStyle(() => ({ opacity: withTiming(scrubbing ? 1 : 0, { duration: 140 }), transform: [{ scale: withTiming(scrubbing ? 1 : 0.4, { duration: 140 }) }] }), [scrubbing]);

  return (
    <View style={styles.wrap}>
      {scrubbing ? (
        <View style={styles.bubbleRow} pointerEvents="none">
          <View style={styles.bubble}><Text style={styles.bubbleText}>{formatDuration(shownS)}</Text></View>
        </View>
      ) : null}
      <View ref={area} style={styles.touch} accessibilityRole="adjustable" accessibilityLabel="Seek bar" {...pan.panHandlers}>
        <Animated.View style={[styles.track, bar]}>
          <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
          <Animated.View style={[styles.handle, handle, { left: `${fraction * 100}%` }]} />
        </Animated.View>
      </View>
      <View style={styles.times} pointerEvents="none">
        <Text style={[styles.time, scrubbing && styles.timeBig]}>{formatDuration(shownS)}</Text>
        <Text style={[styles.time, scrubbing && styles.timeBig]}>{formatDuration(durationS)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  touch: { height: 48, justifyContent: 'center', paddingHorizontal: 16 },
  track: { width: '100%', backgroundColor: 'rgba(255,255,255,0.32)', justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#FFFFFF', borderRadius: 6 },
  handle: { position: 'absolute', width: 26, height: 26, borderRadius: 13, marginLeft: -13, backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  times: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  time: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', opacity: 0.9 },
  timeBig: { fontSize: 14, fontWeight: '700', opacity: 1 },
  bubbleRow: { alignItems: 'center', marginBottom: 6 },
  bubble: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 99, backgroundColor: '#FFFFFF' },
  bubbleText: { color: '#0F2A17', fontSize: 22, fontWeight: '800' },
});
