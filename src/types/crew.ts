/** A named group of workers, e.g. "Maintenance Crew". A worker is in at most one. */
export interface Crew {
  id: string;
  companyId: string;
  name: string;
  /** Hex color for the crew's label. */
  color: string;
  /** The company's maintenance crew (at most one). Its maintenance-type
   * workers are who "Assign Maintenance Crew" puts on a route. */
  isMaintenance?: boolean;
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

/** Label colors the owner picks from. The first is Brighton green. */
export const CREW_COLORS = ['#7CB342', '#1E88E5', '#F4511E', '#8E24AA', '#00897B', '#F9A825', '#6D4C41', '#E91E63'];
