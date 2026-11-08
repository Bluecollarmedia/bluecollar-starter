import { useSegments } from 'expo-router';

/**
 * Our Work lives in two places: the public Weather area ("/weather/...") and, for a signed-in customer, inside their own area
 * ("/(customer)/..."), where it must stay (a screen that jumps to the public area would unmount their signed-in screens). The same screens
 * serve both, so every push asks where it is: the screens' names (work, work-post, work-video, work-story, request) are the same in both places.
 */
export function workBaseFor(firstSegment: string | undefined): string {
  return firstSegment === '(customer)' ? '/(customer)' : '/weather';
}

export function useWorkBase(): string {
  const segments = useSegments() as string[];
  return workBaseFor(segments[0]);
}
