/**
 * ReorderableList — press the grip, drag a row anywhere in the list, and the
 * other rows slide apart live to show where it will land; let go and it
 * settles there. Built on Reanimated + Gesture Handler (already in the app).
 *
 * Rows must all have the same height (`rowHeight`). The parent keeps the
 * order: `onReorder` gets the new list of keys after a drop that changed it.
 * Pass `onDragActive` to pause an outer ScrollView while a row is held.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Icon } from './Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { haptics } from '@/lib/haptics';

interface ReorderableListProps<T> {
  items: T[];
  keyOf: (item: T) => string;
  rowHeight: number;
  /** Rows that return false have no grip and are not draggable (they can still be pushed aside). */
  canDrag?: (item: T, index: number) => boolean;
  /** Renders one row. Put `handle` (null when the row can't be dragged) wherever the grip should appear. */
  renderRow: (item: T, index: number, handle: React.ReactNode) => React.ReactNode;
  onReorder: (orderedKeys: string[]) => void;
  onDragActive?: (active: boolean) => void;
}

export function ReorderableList<T>({ items, keyOf, rowHeight, canDrag, renderRow, onReorder, onDragActive }: ReorderableListProps<T>) {
  const keys = items.map(keyOf);
  const positions = useSharedValue<Record<string, number>>(Object.fromEntries(keys.map((k, i) => [k, i])));

  // The list changed from outside (reloaded, stop added/removed): follow it.
  const signature = keys.join('|');
  useEffect(() => {
    positions.value = Object.fromEntries(keys.map((k, i) => [k, i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  function handleDrop(finalPositions: Record<string, number>) {
    const ordered = Object.entries(finalPositions)
      .filter(([k]) => keys.includes(k))
      .sort((a, b) => a[1] - b[1])
      .map(([k]) => k);
    if (ordered.length === keys.length && ordered.some((k, i) => k !== keys[i])) onReorder(ordered);
  }

  return (
    <View style={{ height: items.length * rowHeight }}>
      {items.map((item, index) => (
        <DragRow
          key={keyOf(item)}
          id={keyOf(item)}
          index={index}
          count={items.length}
          rowHeight={rowHeight}
          positions={positions}
          draggable={canDrag ? canDrag(item, index) : true}
          onDrop={handleDrop}
          onActive={(a) => onDragActive?.(a)}
          render={(handle) => renderRow(item, index, handle)}
        />
      ))}
    </View>
  );
}

interface DragRowProps {
  id: string;
  index: number;
  count: number;
  rowHeight: number;
  positions: SharedValue<Record<string, number>>;
  draggable: boolean;
  onDrop: (finalPositions: Record<string, number>) => void;
  onActive: (active: boolean) => void;
  render: (handle: React.ReactNode) => React.ReactNode;
}

function DragRow({ id, index, count, rowHeight, positions, draggable, onDrop, onActive, render }: DragRowProps) {
  const { colors } = useTheme();
  const top = useSharedValue(index * rowHeight);
  const startTop = useSharedValue(0);
  const active = useSharedValue(false);
  const lift = useSharedValue(0);

  // Slide to this row's slot whenever it changes (another row was dragged past it, or the list reloaded).
  useAnimatedReaction(
    () => positions.value[id],
    (slot, previous) => {
      if (slot !== undefined && slot !== previous && !active.value) top.value = withTiming(slot * rowHeight, { duration: 180 });
    },
  );
  useEffect(() => {
    if (!active.value) top.value = withTiming(index * rowHeight, { duration: 180 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, rowHeight]);

  const pan = Gesture.Pan()
    .minDistance(2)
    .onStart(() => {
      active.value = true;
      startTop.value = top.value;
      lift.value = withTiming(1, { duration: 120 });
      runOnJS(onActive)(true);
      runOnJS(haptics.light)();
    })
    .onUpdate((e) => {
      const y = Math.max(0, Math.min((count - 1) * rowHeight, startTop.value + e.translationY));
      top.value = y;
      const to = Math.max(0, Math.min(count - 1, Math.round(y / rowHeight)));
      const from = positions.value[id];
      if (to !== from) {
        const next = { ...positions.value };
        for (const k in next) {
          if (next[k] === to) next[k] = from;
        }
        next[id] = to;
        positions.value = next;
        runOnJS(haptics.light)();
      }
    })
    .onFinalize(() => {
      if (!active.value) return;
      active.value = false;
      top.value = withTiming(positions.value[id] * rowHeight, { duration: 160 });
      lift.value = withTiming(0, { duration: 160 });
      runOnJS(onActive)(false);
      runOnJS(onDrop)(positions.value);
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: top.value }, { scale: 1 + lift.value * 0.025 }],
    zIndex: active.value ? 10 : 0,
    shadowOpacity: lift.value * 0.18,
    elevation: lift.value * 6,
  }));

  const handle = draggable ? (
    <GestureDetector gesture={pan}>
      <View style={styles.handle} accessible accessibilityLabel="Drag to reorder" accessibilityRole="adjustable" hitSlop={8}>
        <Icon name="menu" size={20} color={colors.textTertiary} />
      </View>
    </GestureDetector>
  ) : null;

  return (
    <Animated.View
      style={[
        styles.row,
        { height: rowHeight, backgroundColor: colors.surface, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 10 },
        rowStyle,
      ]}
    >
      {render(handle)}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { position: 'absolute', left: 0, right: 0, top: 0 },
  handle: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
});
