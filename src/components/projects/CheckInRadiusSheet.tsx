import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder, Platform, LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/providers/ThemeProvider';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { Switch } from '@/components/ui';
import { RadiusMap } from '@/components/maps/RadiusMap';
import { CHECKIN_RADIUS_STOPS_FT, feetToMeters, nearestRadiusStop, describeRadius, formatDistance, findCoords, type Place } from '@/lib/maps';
import { validCoords, type LatLng } from '@/lib/checkInRadius';
import { haptics } from '@/lib/haptics';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

interface CheckInRadiusSheetProps {
  visible: boolean;
  place: Place;
  radiusMeters: number;
  onClose: () => void;
  /** Called once with the chosen distance (0 = Anywhere) and the place's resolved coordinates (null when Anywhere and none were found). */
  onSave: (meters: number, coords: LatLng | null) => void;
}

const LAST = CHECKIN_RADIUS_STOPS_FT.length - 1;
const THUMB = 28;

/** "500" + "ft", or "¼" + "mi" — the big number and its unit, shown separately. */
function splitDistance(meters: number): [string, string] {
  const label = formatDistance(meters);
  const at = label.lastIndexOf(' ');
  return [label.slice(0, at), label.slice(at + 1)];
}

/**
 * Bottom sheet for a project's check-in distance: a map with the zone drawn on
 * it, and a slider that snaps through CHECKIN_RADIUS_STOPS_FT.
 */
export function CheckInRadiusSheet({ visible, place, radiusMeters, onClose, onSave }: CheckInRadiusSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(() => nearestRadiusStop(radiusMeters));
  // A saved distance of 0 is "Anywhere": workers can tap I'm here from any distance.
  const [anywhere, setAnywhere] = useState(radiusMeters <= 0);
  const [trackWidth, setTrackWidth] = useState(0);

  // Start from the saved distance each time the sheet opens.
  useEffect(() => {
    if (visible) { setIndex(nearestRadiusStop(radiusMeters)); setAnywhere(radiusMeters <= 0); }
  }, [visible, radiusMeters]);

  // The project's real location (saved coordinates, else its address looked up on the map). undefined = still looking,
  // null = can't be found. Never the phone's own location, and never a guessed default.
  const [coords, setCoords] = useState<LatLng | null | undefined>(undefined);
  const [mapReady, setMapReady] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => {
    if (!visible) { setMapReady(false); setCoords(undefined); savingRef.current = false; return; }
    let live = true;
    findCoords(place)
      .then((c) => { if (live) setCoords(validCoords(c) ? c : null); })
      .catch(() => { if (live) setCoords(null); });
    // Create the native map only once the sheet has finished sliding in.
    const t = setTimeout(() => { if (live) setMapReady(true); }, 450);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, place.latitude, place.longitude, place.address, place.city, place.state, place.zip]);

  const canSave = anywhere || !!coords;
  function save() {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    haptics.success();
    onSave(anywhere ? 0 : meters, coords ?? null);
  }

  const feet = CHECKIN_RADIUS_STOPS_FT[index];
  const meters = feetToMeters(feet);
  const [value, unit] = splitDistance(meters);

  // PanResponder callbacks are created once, so read the latest values through refs.
  const live = useRef({ trackWidth, index });
  live.current = { trackWidth, index };
  const startX = useRef(0);

  function moveTo(x: number) {
    const w = live.current.trackWidth;
    if (!w) return;
    const next = Math.max(0, Math.min(LAST, Math.round((x / w) * LAST)));
    if (next !== live.current.index) {
      live.current.index = next;
      setIndex(next);
      haptics.select();
    }
  }

  // In a browser, pressing the slider moves focus off the sheet, and losing focus cancels
  // the drag. Stopping the mousedown default keeps focus where it is.
  const sliderRef = useCallback((node: View | null) => {
    if (Platform.OS !== 'web' || !node) return;
    (node as unknown as HTMLElement).addEventListener('mousedown', (e) => e.preventDefault());
  }, []);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        startX.current = e.nativeEvent.locationX - THUMB / 2;
        moveTo(startX.current);
      },
      onPanResponderMove: (_, g) => moveTo(startX.current + g.dx),
    }),
  ).current;

  const thumbLeft = trackWidth ? (index / LAST) * trackWidth : 0;

  return (
    <BottomSheetModal visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
          <View style={[styles.handle, { backgroundColor: colors.borderLight }]} />
          <View style={styles.header}>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>Check-in distance</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, fontWeight: '600' }]}>Cancel</Text>
            </Pressable>
          </View>

          {coords === null ? (
            <View style={[styles.map, styles.mapError, { backgroundColor: colors.backgroundTertiary }]}>
              <Text style={[typeScale.bodySmall, { color: colors.error, textAlign: 'center', fontWeight: '700' }]}>This project's location can't be found</Text>
              <Text style={[typeScale.caption, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs }]}>
                Fix the project's address, then set the check-in distance. A distance can't be saved without a location.
              </Text>
            </View>
          ) : (
            <RadiusMap place={place} coords={coords} ready={mapReady} radiusMeters={meters} fraction={index / LAST} height={190} style={styles.map} />
          )}

          <View style={styles.readout}>
            <Text style={[styles.value, { color: colors.textPrimary }]}>{anywhere ? 'Anywhere' : value}</Text>
            {anywhere ? null : <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, fontWeight: '700', marginLeft: spacing.xs }]}>{unit}</Text>}
          </View>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{anywhere ? 'No limit: workers do not have to be at the property.' : describeRadius(feet)}</Text>

          {/* Slider. The outer view is the touch area; positions are measured on the inner track. */}
          <View ref={sliderRef} style={[styles.sliderTouch, anywhere && { opacity: 0.35 }]} pointerEvents={anywhere ? 'none' : 'auto'} {...pan.panHandlers}>
            <View
              style={[styles.track, { backgroundColor: colors.borderLight }]}
              onLayout={(e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width)}
              pointerEvents="none"
            >
              <View style={[styles.trackFill, { width: thumbLeft, backgroundColor: colors.primary }]} />
              {CHECKIN_RADIUS_STOPS_FT.map((ft, i) => (
                <View
                  key={ft}
                  style={[styles.tick, { left: (i / LAST) * trackWidth - 2, backgroundColor: i <= index ? '#FFFFFF' : colors.textTertiary }]}
                />
              ))}
              <View style={[styles.thumb, { left: thumbLeft - THUMB / 2, backgroundColor: '#FFFFFF', borderColor: colors.primary }]} />
            </View>
          </View>
          <View style={styles.ends}>
            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{formatDistance(feetToMeters(CHECKIN_RADIUS_STOPS_FT[0]))}</Text>
            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{formatDistance(feetToMeters(CHECKIN_RADIUS_STOPS_FT[LAST]))}</Text>
          </View>

          <View style={styles.anywhereRow}>
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, fontWeight: '600' }]}>Anywhere (no limit)</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                {anywhere ? 'Workers can tap I\'m here from any distance.' : 'Workers can only tap I\'m here inside the circle.'}
              </Text>
            </View>
            <Switch value={anywhere} onValueChange={setAnywhere} accessibilityLabel="Anywhere, no check-in distance limit" />
          </View>

          <Pressable
            onPress={save}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
            style={({ pressed }) => [styles.save, { backgroundColor: colors.primary, opacity: !canSave ? 0.4 : pressed ? 0.85 : 1 }]}
          >
            <Text style={[typeScale.labelLarge, { color: '#FFFFFF' }]}>Save distance</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  map: { borderRadius: radius.lg, overflow: 'hidden' },
  mapError: { height: 190, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  readout: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.lg },
  value: { fontSize: 36, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  sliderTouch: { paddingVertical: spacing.lg, paddingHorizontal: THUMB / 2, marginHorizontal: -THUMB / 2, marginTop: spacing.xs },
  track: { height: 6, borderRadius: 3, justifyContent: 'center' },
  trackFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3 },
  tick: { position: 'absolute', width: 4, height: 4, borderRadius: 2 },
  thumb: { position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 3 },
  ends: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -spacing.sm },
  anywhereRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  save: { height: 52, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
});
