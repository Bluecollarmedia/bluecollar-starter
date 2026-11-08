// The check-in zone preview on Android and web: the drawn circle around a pin.
// The iPhone has its own RadiusMap.ios.tsx (Apple Maps). That file must NOT import this one for its fallback: on iPhone,
// './RadiusMap' resolves to RadiusMap.ios.tsx itself, so it would render itself forever (frozen screen, then out of memory).
// It imports RadiusMapDrawn instead, which has no platform twin.
export { RadiusMapDrawn as RadiusMap } from './RadiusMapDrawn';
export type { RadiusMapProps } from './RadiusMapDrawn';
