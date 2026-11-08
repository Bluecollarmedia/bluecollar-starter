// The map preview for a job's address on Android and web: the drawn pin card.
// The iPhone has its own JobMap.ios.tsx (Apple Maps). That file must NOT import this one for its fallback: on iPhone,
// './JobMap' resolves to JobMap.ios.tsx itself, so it would render itself forever (frozen screen, then out of memory).
// It imports JobMapPin instead, which has no platform twin.
export { JobMapPin as JobMap } from './JobMapPin';
export type { JobMapProps } from './JobMapPin';
