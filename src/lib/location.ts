import * as Location from 'expo-location';
import type { GPSCoordinates } from '@/types';

export type GpsResult =
  | { status: 'ok'; gps: GPSCoordinates }
  | { status: 'denied' }
  | { status: 'unavailable' };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** The phone's current position, asking for permission the first time. */
export async function getCurrentGps(): Promise<GpsResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { status: 'denied' };
    const pos = (await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 12000))
      ?? (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60000 }));
    if (!pos) return { status: 'unavailable' };
    return {
      status: 'ok',
      gps: { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy ?? 0) },
    };
  } catch {
    return { status: 'unavailable' };
  }
}
