// The route map on Android and web: the drawn card. The iPhone has its own RouteMap.ios.tsx (Apple Maps with numbered pins). That file imports
// RouteMapPins for its fallback and must NOT import this one.
export { RouteMapPins as RouteMap } from './RouteMapPins';
export type { RouteMapProps, RouteMapStop } from './RouteMapPins';
