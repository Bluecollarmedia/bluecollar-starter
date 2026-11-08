import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useTheme } from '@/providers/ThemeProvider';
import { findCoords, cachedCoords, type Place } from '@/lib/maps';
import { formatAddress } from '@/lib/address';
import { RouteMapPins, type RouteMapProps } from './RouteMapPins';

type Coords = { latitude: number; longitude: number };

/** Apple Maps with one numbered pin per stop, fitted to show them all. Stops with no findable address are left off the map. */
export function RouteMap(props: RouteMapProps) {
  const { stops, height = 300, style } = props;
  const { colors } = useTheme();
  const ref = useRef<MapView>(null);
  const keys = stops.map((s) => `${s.id}:${formatAddress(s.place)}`).join('|');
  const [coords, setCoords] = useState<Record<string, Coords>>(() => {
    const first: Record<string, Coords> = {};
    for (const s of stops) { const c = cachedCoords(s.place as Place); if (c) first[s.id] = c; }
    return first;
  });

  useEffect(() => {
    let live = true;
    (async () => {
      const found: Record<string, Coords> = {};
      for (const s of stops) {
        const c = await findCoords(s.place as Place);
        if (c) found[s.id] = c;
      }
      if (live) setCoords(found);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  const placed = stops.filter((s) => coords[s.id]);
  useEffect(() => {
    if (placed.length === 0) return;
    const t = setTimeout(() => ref.current?.fitToCoordinates(placed.map((s) => coords[s.id]), { edgePadding: { top: 48, right: 48, bottom: 48, left: 48 }, animated: false }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed.length]);

  if (placed.length === 0) return <RouteMapPins {...props} />;
  return (
    <View style={[{ height, borderRadius: 16, overflow: 'hidden' }, style]}>
      <MapView ref={ref} style={StyleSheet.absoluteFill} rotateEnabled={false} pitchEnabled={false} toolbarEnabled={false} showsPointsOfInterests={false}>
        {placed.map((s) => (
          <Marker key={s.id} coordinate={coords[s.id]} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={[styles.pin, { backgroundColor: s.done ? colors.success : colors.primaryDark }]}>
              <Text style={styles.pinText}>{s.number}</Text>
            </View>
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  pinText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
});
