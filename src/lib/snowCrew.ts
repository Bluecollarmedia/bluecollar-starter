/**
 * Crew on a Snow route (update 41). A route has one or more leads (update 110) and can also have crew
 * members. Crew can view the route; only a lead can act on it. Pure helpers.
 */

export type RouteRole = 'lead' | 'crew';

export interface PersonChoice { personId: string; name: string }

/** Only the lead can mark arrival, finish stops, add photos or ask to skip. Crew view only. */
export function canWorkRoute(role: RouteRole | undefined): boolean {
  return role !== 'crew';
}

/** People the owner can still add as crew: eligible for the route's service, not the lead, not already crew. */
export function crewChoices(eligible: PersonChoice[], leadPersonId: string | undefined, crewIds: string[]): PersonChoice[] {
  const taken = new Set(crewIds);
  const seen = new Set<string>();
  return eligible
    .filter((p) => p.personId !== leadPersonId && !taken.has(p.personId))
    .filter((p) => (seen.has(p.personId) ? false : (seen.add(p.personId), true)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The crew list after adding or removing one person (no repeats, order kept). */
export function nextCrew(current: string[], personId: string, add: boolean): string[] {
  if (add) return current.includes(personId) ? current : [...current, personId];
  return current.filter((id) => id !== personId);
}

/** Which role shows for a route: the database's answer, or lead for databases without update 41 (only leads can see routes there). */
export function roleFor(roles: Map<string, RouteRole> | null, routeId: string): RouteRole {
  return roles?.get(routeId) ?? 'lead';
}

export interface TeamMember { personId: string; name: string; lead: boolean }

/** Everyone working the route: the lead (when there is one) first, then the crew. The lead is always one of the team. */
export function routeTeam(leadPersonId: string | undefined, leadName: string | undefined, crew: PersonChoice[]): TeamMember[] {
  const out: TeamMember[] = [];
  if (leadPersonId) out.push({ personId: leadPersonId, name: leadName || 'Crew lead', lead: true });
  for (const c of crew) if (c.personId !== leadPersonId) out.push({ personId: c.personId, name: c.name, lead: false });
  return out;
}

/** Everyone working the route with SEVERAL leads: the leads first (in order), then the crew. `nameOf` finds a person's name. */
export function routeTeamMulti(leadIds: string[], nameOf: (id: string) => string | undefined, crew: PersonChoice[]): TeamMember[] {
  const out: TeamMember[] = [];
  const seen = new Set<string>();
  for (const id of leadIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ personId: id, name: nameOf(id) || 'Crew lead', lead: true });
  }
  for (const c of crew) if (!seen.has(c.personId)) { seen.add(c.personId); out.push({ personId: c.personId, name: c.name, lead: false }); }
  return out;
}

/** The leads after tapping one person: a lead is taken off, anyone else is added (the leads are a list, any length). */
export function toggleLead(leadIds: string[], personId: string): string[] {
  return leadIds.includes(personId) ? leadIds.filter((id) => id !== personId) : [...leadIds, personId];
}

/** The crew list after `newLead` becomes the lead: the old lead stays on the route as crew, the new lead leaves the crew list. */
export function crewAfterLeadChange(crewIds: string[], oldLead: string | undefined, newLead: string): string[] {
  const next = crewIds.filter((id) => id !== newLead);
  if (oldLead && oldLead !== newLead && !next.includes(oldLead)) next.push(oldLead);
  return next;
}

/** What is still missing before a draft storm can go out (the database still has the final say). */
export function dispatchGaps(routes: { leadPersonId?: string; stops: number }[]): string[] {
  const gaps: string[] = [];
  if (routes.length === 0 || routes.some((r) => !r.leadPersonId)) gaps.push('Choose a crew lead');
  if (routes.length === 0 || routes.some((r) => r.stops === 0)) gaps.push('Add at least one property');
  return gaps;
}
