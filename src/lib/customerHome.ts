import { properName } from './names';

// What the customer's home (Projects) screen lists, built only from what the customer is actually linked to: their projects.
// Pure, no network. Nothing is invented: no placeholder rows, no made-up percentages, and a property is only "a property" when an
// address says so.

export type HomeKind = 'project';

export interface HomeItem {
  key: string;
  kind: HomeKind;
  /** The label on the card: "Project". */
  typeLabel: string;
  name: string;
  /** Street and town as saved, for telling properties apart. May be empty. */
  address: string;
  /** Same address written the same way, so two projects at one property group together. Empty when unknown. */
  propertyKey: string;
  status: 'active' | 'on_hold' | 'completed';
  /** A real completion value (the project's own progress field). */
  progress?: number;
  completedAt?: string;
  /** The latest real update for a project (title and when), if there is one. */
  latestUpdate?: { title: string; at: string };
}

export interface ProjectLike {
  id: string; name: string; address?: string; city?: string; state?: string; zip?: string;
  status: string; progress: number; completedAt?: string;
}
const TYPE_LABEL: Record<HomeKind, string> = { project: 'Job' };

/** "123 Main St, Your Town ST" for display. */
export function addressLine(p: { address?: string; city?: string; state?: string }): string {
  const street = (p.address ?? '').trim();
  const town = [p.city?.trim(), p.state?.trim()].filter(Boolean).join(' ');
  return [street, town].filter(Boolean).join(', ');
}

/** The same property written differently ("123 Main St." / "123 main street") gets the same key; no address, no key. */
export function propertyKeyOf(address?: string): string {
  // Street only (before any comma), so the same street written with or without the town matches.
  const street = (address ?? '').split(',')[0].toLowerCase().replace(/[.,#]/g, ' ').replace(/\b(street)\b/g, 'st').replace(/\b(avenue)\b/g, 'ave').replace(/\b(road)\b/g, 'rd').replace(/\b(drive)\b/g, 'dr').replace(/\b(lane)\b/g, 'ln').replace(/\s+/g, ' ').trim();
  return street;
}

export function buildHomeItems(input: {
  projects: ProjectLike[];
  latestUpdateFor?: (projectId: string) => { title: string; at: string } | undefined;
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
  return 'In progress';
}
