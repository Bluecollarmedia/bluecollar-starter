import { swatches } from '@/theme/colors';
/** A named group of workers, e.g. "Paving Crew". A worker is in at most one. */
export interface Crew {
  id: string;
  companyId: string;
  name: string;
  /** Hex color for the crew's label. */
  color: string;
  createdAt: string;
  updatedAt: string;
  /** People in this crew (derived from crew_members). */
  memberIds: string[];
}

export interface CrewMember {
  id: string;
  companyId: string;
  crewId: string;
  personId: string;
  createdAt: string;
}

/** Label colors the owner picks from: the brand color plus muted charcoal tints (src/theme/colors.ts, swatches). */
export const CREW_COLORS: readonly string[] = swatches;
