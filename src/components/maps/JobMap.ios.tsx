import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useTheme } from '@/providers/ThemeProvider';
import { findCoords, cachedCoords } from '@/lib/maps';
import { formatAddress } from '@/lib/address';
import { JobMapPin as PinCard, type JobMapProps } from './JobMapPin';

type Coords = { latitude: number; longitude: number };

/** Apple Maps preview of the job site. Taps fall through to the parent (which opens directions). */
export function JobMap(props: JobMapProps) {
  const { place, height = 140, style } = props;
  const { colors } = useTheme();
  const key = formatAddress(place);
  const [coords, setCoords] = useState<Coords | null | undefined>(() => cachedCoords(place));

  useEffect(() => {
    let live = true;
    findCoords(place).then((c) => { if (live) setCoords(c); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, place.latitude, place.longitude]);

  if (!coords) return <PinCard {...props} />;

  return (
    <View style={[{ height }, style]} pointerEvents="none">
      <MapView
        style={StyleSheet.absoluteFill}
        region={{ ...coords, latitudeDelta: 0.006, longitudeDelta: 0.006 }}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsPointsOfInterests={false}
      >
        <Marker coordinate={coords} pinColor={colors.primary} />
      </MapView>
    </View>
  );
}
