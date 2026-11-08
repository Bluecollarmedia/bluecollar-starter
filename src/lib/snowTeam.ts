/**
 * Snow Team helpers (pure). The Snow Team screen is one list of EVERY worker with what each one works in snow:
 * all services, some, or none. Workers come from the landscaping team; people who only have snow access are listed too.
 */

export interface TeamMemberLike {
  personId: string;
  role: string;
  status: string;
  person?: { firstName: string; lastName: string; email?: string; phone?: string; avatarUrl?: string };
}

export interface SnowMemberLike {
  personId: string;
  status: 'active' | 'revoked' | string;
  services: string[];
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
}

export interface SnowTeamRow {
  personId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  /** Snow services this person works now (empty = no snow). */
  services: string[];
  /** Also on the landscaping team. */
  landscaping: boolean;
}

/** Every active worker plus every person with snow access, one row each, sorted by name. */
export function snowTeamRows(members: TeamMemberLike[], snowMembers: SnowMemberLike[]): SnowTeamRow[] {
  const snow = new Map(snowMembers.map((m) => [m.personId, m]));
  const rows = new Map<string, SnowTeamRow>();
  for (const m of members) {
    if (m.role !== 'worker' || m.status !== 'active' || !m.person || rows.has(m.personId)) continue;
    const s = snow.get(m.personId);
    rows.set(m.personId, {
      personId: m.personId, firstName: m.person.firstName, lastName: m.person.lastName, email: m.person.email ?? '',
      phone: m.person.phone, avatarUrl: m.person.avatarUrl, services: s && s.status === 'active' ? s.services : [], landscaping: true,
    });
  }
  for (const s of snowMembers) {
    if (rows.has(s.personId)) continue;
    rows.set(s.personId, {
      personId: s.personId, firstName: s.firstName ?? '', lastName: s.lastName ?? '', email: s.email ?? '', phone: s.phone,
      avatarUrl: s.avatarUrl, services: s.status === 'active' ? s.services : [], landscaping: false,
    });
  }
  return [...rows.values()].sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
}

export type SnowTeamFilter = 'all' | 'snow' | 'none';

export function filterSnowTeam(rows: SnowTeamRow[], query: string, filter: SnowTeamFilter): SnowTeamRow[] {
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
  return rows.filter((r) => {
    if (filter === 'snow' && r.services.length === 0) return false;
    if (filter === 'none' && r.services.length > 0) return false;
    if (!q) return true;
    return `${r.firstName} ${r.lastName} ${r.email} ${r.phone ?? ''}`.toLowerCase().includes(q);
  });
}

/** "All services", "Plowing, Salting" or "No snow". */
export function servicesSummary(services: string[], all: string[], label: (s: string) => string): string {
  if (services.length === 0) return 'No snow';
  if (all.every((s) => services.includes(s))) return 'All services';
  return all.filter((s) => services.includes(s)).map(label).join(', ');
}
