import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { useTheme } from '@/providers/ThemeProvider';
import { findCoords, cachedCoords } from '@/lib/maps';
import { validCoords } from '@/lib/checkInRadius';
import { formatAddress } from '@/lib/address';
import { RadiusMapDrawn as DrawnRadius, type RadiusMapProps } from './RadiusMapDrawn';

type Coords = { latitude: number; longitude: number };

/** Keeps a native map failure from taking the whole screen down: falls back to the drawn circle. */
class MapGuard extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.warn('[RadiusMap] the map failed, showing the drawn circle', error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/**
 * Apple Maps view of the job site with the check-in zone drawn on it, zoomed to fit the circle. The circle is a real geographic
 * circle (radius in meters around the project's coordinates), so it is exactly the distance shown. The map is only created once the
 * sheet has finished opening (creating a native map inside a sheet that is still sliding in is unreliable) and only for valid coordinates.
 */
export function RadiusMap(props: RadiusMapProps) {
  const { place, radiusMeters, height = 180, style, ready = true } = props;
  const { colors } = useTheme();
  const key = formatAddress(place);
  const [found, setFound] = useState<Coords | null | undefined>(() => props.coords ?? cachedCoords(place));
  const coords = props.coords ?? found;

  useEffect(() => {
    if (props.coords !== undefined) return;
    let live = true;
    findCoords(place).then((c) => { if (live) setFound(c); }).catch(() => { if (live) setFound(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, place.latitude, place.longitude, props.coords]);

  const drawn = <DrawnRadius {...props} />;
  if (!ready || !validCoords(coords)) return drawn;

  // About 1.4x the circle's width, so its edge sits inside the map; kept within what a map can show.
  const latitudeDelta = Math.min(20, Math.max(0.002, (radiusMeters * 2.8) / 111_000));

  return (
    <View style={[{ height }, style]} pointerEvents="none">
      <MapGuard fallback={drawn}>
        <MapView
          style={StyleSheet.absoluteFill}
          region={{ latitude: coords.latitude, longitude: coords.longitude, latitudeDelta, longitudeDelta: latitudeDelta }}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
        >
          <Circle
            center={coords}
            radius={radiusMeters}
            strokeColor={colors.primary}
            strokeWidth={2}
            fillColor="rgba(76, 175, 80, 0.18)"
          />
          <Marker coordinate={coords} pinColor={colors.primary} />
        </MapView>
      </MapGuard>
    </View>
  );
}
