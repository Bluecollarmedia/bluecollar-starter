import { properName } from './names';

// What the customer's home (Projects) screen lists, built only from what the customer is actually linked to: their landscaping
// projects, maintenance properties and snow properties. Pure, no network. Nothing is invented: no placeholder rows, no made-up
// percentages, and a property is only "a property" when an address says so.

export type HomeKind = 'project' | 'maintenance' | 'snow';

export interface HomeItem {
  key: string;
  kind: HomeKind;
  /** The label on the card: "Project", "Maintenance" or "Snow". */
  typeLabel: string;
  name: string;
  /** Street and town as saved, for telling properties apart. May be empty. */
  address: string;
  /** Same address written the same way, so two projects at one property group together. Empty when unknown. */
  propertyKey: string;
  status: 'active' | 'on_hold' | 'completed';
  /** A real completion value, only for landscaping projects (the app's own progress field). */
  progress?: number;
  completedAt?: string;
  /** The latest real update for a project (title and when), if there is one. */
  latestUpdate?: { title: string; at: string };
  /** A plain line for services that have no status of their own. */
  note?: string;
}

export interface ProjectLike {
  id: string; name: string; address?: string; city?: string; state?: string; zip?: string;
  status: string; progress: number; completedAt?: string;
}
export interface PropertyLike { id: string; name: string; address?: string }

const TYPE_LABEL: Record<HomeKind, string> = { project: 'Project', maintenance: 'Maintenance', snow: 'Snow' };

/** "111 Spruce St, Lakewood NJ" for display. */
export function addressLine(p: { address?: string; city?: string; state?: string }): string {
  const street = (p.address ?? '').trim();
  const town = [p.city?.trim(), p.state?.trim()].filter(Boolean).join(' ');
  return [street, town].filter(Boolean).join(', ');
}

/** The same property written differently ("111 Spruce St." / "111 spruce street") gets the same key; no address, no key. */
export function propertyKeyOf(address?: string): string {
  // Street only (before any comma): maintenance and snow addresses carry no separate zip, so a project at the same street matches.
  const street = (address ?? '').split(',')[0].toLowerCase().replace(/[.,#]/g, ' ').replace(/\b(street)\b/g, 'st').replace(/\b(avenue)\b/g, 'ave').replace(/\b(road)\b/g, 'rd').replace(/\b(drive)\b/g, 'dr').replace(/\b(lane)\b/g, 'ln').replace(/\s+/g, ' ').trim();
  return street;
}

export function buildHomeItems(input: {
  projects: ProjectLike[];
  maintenance: PropertyLike[];
  snow: PropertyLike[];
  latestUpdateFor?: (projectId: string) => { title: string; at: string } | undefined;
  maintenanceNote?: string;
  snowNote?: (address?: string) => string;
}): HomeItem[] {
  const out: HomeItem[] = [];
  for (const p of input.projects) {
    if (p.status !== 'active' && p.status !== 'on_hold' && p.status !== 'completed') continue; // quotes/archived aren't shown
    out.push({
      key: `project:${p.id}`, kind: 'project', typeLabel: TYPE_LABEL.project, name: properName(p.name),
      address: addressLine(p), propertyKey: propertyKeyOf(p.address),
      status: p.status === 'completed' ? 'completed' : p.status === 'on_hold' ? 'on_hold' : 'active',
      progress: p.status === 'active' ? p.progress : undefined,
      completedAt: p.completedAt,
      latestUpdate: input.latestUpdateFor?.(p.id),
    });
  }
  for (const m of input.maintenance) {
    out.push({
      key: `maintenance:${m.id}`, kind: 'maintenance', typeLabel: TYPE_LABEL.maintenance, name: properName(m.name),
      address: (m.address ?? '').trim(), propertyKey: propertyKeyOf(m.address), status: 'active', note: input.maintenanceNote ?? 'Visits and photos',
    });
  }
  for (const s of input.snow) {
    out.push({
      key: `snow:${s.id}`, kind: 'snow', typeLabel: TYPE_LABEL.snow, name: properName(s.name),
      address: (s.address ?? '').trim(), propertyKey: propertyKeyOf(s.address), status: 'active', note: input.snowNote?.(s.address) ?? 'Plowing, shoveling and salting updates',
    });
  }
  return out;
}

/** One entry per distinct property that has an address, for the filter. Empty (so no filter shown) with fewer than two. */
export function propertyOptions(items: HomeItem[]): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const i of items) if (i.propertyKey && !seen.has(i.propertyKey)) seen.set(i.propertyKey, i.address.split(',')[0] || i.address);
  return seen.size >= 2 ? [...seen].map(([key, label]) => ({ key, label })) : [];
}

export function filterByProperty(items: HomeItem[], propertyKey: string | null): HomeItem[] {
  return propertyKey ? items.filter((i) => i.propertyKey === propertyKey) : items;
}

export function splitHome(items: HomeItem[]): { active: HomeItem[]; completed: HomeItem[] } {
  const active = items.filter((i) => i.status !== 'completed');
  const completed = items.filter((i) => i.status === 'completed')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  return { active, completed };
}

/** How many completed projects show before "View all". */
export const COMPLETED_PREVIEW = 3;
export function completedToShow(completed: HomeItem[], showAll: boolean): HomeItem[] {
  return showAll ? completed : completed.slice(0, COMPLETED_PREVIEW);
}

/** The status words on an active card. */
export function statusLabel(i: HomeItem): string {
  if (i.status === 'on_hold') return 'On hold';
  if (i.status === 'completed') return 'Completed';
  return i.kind === 'project' ? 'In progress' : 'Active';
}
