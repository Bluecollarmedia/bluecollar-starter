/**
 * Snow routes and stops (supabase/updates/025, 026).
 *
 * Owner/admin build routes for a storm: add a route, pick its lead, add
 * stops, reorder them (one database call so positions never clash), save a
 * route as a template and add a template to another storm. Route leads work
 * their stops in order: I'm Here, completion photos/videos, Finish Stop. The
 * database checks every step (dispatched storm, order, photo minimum).
 */
import { roleFor, type RouteRole } from '@/lib/snowCrew';
import { peopleWhoDoAll } from '@/lib/snowStopGroups';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { SnowService } from '@/types/snow';
import type { SnowMediaDraft } from '@/data/snowProperties';
import { SNOW_COMPLETION_TARGET } from '@/data/snowMediaTargets';

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });
const NOT_CONNECTED = 'Routes need the live database, which isn\'t connected in this version of the app.';

function message(error: { message?: string } | null | undefined, fallback: string) {
  const m = error?.message?.trim();
  return m && !/^(permission denied|new row violates|JWT)/i.test(m) ? m : fallback;
}

export type VisitStatus = 'pending' | 'arrived' | 'completed' | 'skipped';

export interface RouteStop {
  id: string;
  propertyId: string;
  position: number;
  status: VisitStatus;
  propertyName: string;
  propertyAddress: string;
  /** Which service this visit is (a route can do several together, update 61). */
  service?: SnowService;
  arrivedAt?: string;
  completedAt?: string;
  completionNote?: string;
  mediaCount: number;
  /** The stop's saved photos (signed links), so the lead can open and delete one. */
  photos?: { id: string; url: string }[];
  /** The owner's note for this property (update 60). */
  ownerNote?: string;
  /** Photos required at this property: true / false, or undefined to follow the route's rule (update 60). */
  photosRequired?: boolean;
  /** How many photos this stop needs, or undefined to follow the route's number (update 112). */
  minMedia?: number;
}

export interface RouteDetail {
  id: string;
  companyId: string;
  stormId: string;
  stormName: string;
  stormStatus: 'draft' | 'dispatched' | 'ended';
  service: SnowService;
  /** Every service the route does together (update 61); just `service` for an ordinary route. */
  services: SnowService[];
  name: string;
  leadPersonId?: string;
  mediaRequired: boolean;
  minMedia: number;
  notes?: string;
  cancelled: boolean;
  stops: RouteStop[];
}

export interface SnowLead { personId: string; name: string }
export interface RouteTemplate { id: string; name: string; stops: number; service: SnowService }

// ── Reading ─────────────────────────────────────────────────────────────────

/** One route with its storm and stops in order. Works for owner/admin and the route's lead. */
export async function loadRoute(routeId: string): Promise<Result<RouteDetail>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const routeCols = 'id, company_id, storm_id, service, name, lead_person_id, media_required, min_media, notes, cancelled_at, snow_storms(name, status)';
  let { data: r, error } = await supabase.from('snow_routes').select(`${routeCols}, services`).eq('id', routeId).maybeSingle();
  // A database without update 61 has no `services` column yet: an ordinary single-service route.
  if (error && /services/i.test(error.message)) {
    ({ data: r, error } = await supabase.from('snow_routes').select(routeCols).eq('id', routeId).maybeSingle());
  }
  if (error) return fail(message(error, 'Couldn\'t load the route.'));
  if (!r) return fail('This route isn\'t available.');
  const visitCols = 'id, property_id, position, status, service, property_name, property_address, arrived_at, completed_at, completion_note';
  const [withCount, media] = await Promise.all([
    supabase.from('snow_visits').select(`${visitCols}, owner_note, photos_required, min_media`).eq('route_id', routeId).order('position'),
    supabase.from('snow_completion_media').select('id, visit_id, kind, file_key').eq('route_id', routeId),
  ]);
  // A database without update 112 has no per-stop photo count yet: load the stops without it. Without update 60, without the notes and photo columns too.
  const first = withCount.error && /min_media/i.test(withCount.error.message)
    ? await supabase.from('snow_visits').select(`${visitCols}, owner_note, photos_required`).eq('route_id', routeId).order('position')
    : withCount;
  const visits = first.error && /owner_note|photos_required/i.test(first.error.message)
    ? await supabase.from('snow_visits').select(visitCols).eq('route_id', routeId).order('position')
    : first;
  if (visits.error) return fail(message(visits.error, 'Couldn\'t load the stops.'));
  const counts = new Map<string, number>();
  for (const m of media.data ?? []) counts.set(m.visit_id, (counts.get(m.visit_id) ?? 0) + 1);
  let signed: Record<string, string> = {};
  try {
    const { signedSnowMediaUrls } = require('@/lib/snowMedia') as typeof import('@/lib/snowMedia');
    signed = await signedSnowMediaUrls((media.data ?? []).filter((m) => m.kind === 'photo').map((m) => m.file_key as string));
  } catch { /* thumbnails are optional */ }
  const photosOf = (visitId: string) => (media.data ?? []).filter((m) => m.visit_id === visitId && m.kind === 'photo' && signed[m.file_key as string]).map((m) => ({ id: m.id as string, url: signed[m.file_key as string] }));
  const storm = (Array.isArray(r.snow_storms) ? r.snow_storms[0] : r.snow_storms) as { name: string; status: RouteDetail['stormStatus'] } | null;
  return ok({
    id: r.id,
    companyId: r.company_id,
    stormId: r.storm_id,
    stormName: storm?.name ?? 'Storm',
    stormStatus: storm?.status ?? 'draft',
    service: r.service,
    services: Array.isArray((r as { services?: unknown }).services) && (r as { services: string[] }).services.length ? (r as { services: SnowService[] }).services : [r.service],
    name: r.name,
    leadPersonId: r.lead_person_id ?? undefined,
    mediaRequired: !!r.media_required,
    minMedia: r.min_media ?? 1,
    notes: r.notes ?? undefined,
    cancelled: !!r.cancelled_at,
    stops: (visits.data ?? []).map((v) => ({
      id: v.id,
      propertyId: v.property_id,
      position: v.position,
      status: v.status,
      propertyName: v.property_name ?? 'Property',
      propertyAddress: v.property_address ?? '',
      service: (v.service as SnowService | undefined) ?? undefined,
      arrivedAt: v.arrived_at ?? undefined,
      completedAt: v.completed_at ?? undefined,
      completionNote: v.completion_note ?? undefined,
      mediaCount: counts.get(v.id) ?? 0,
      photos: photosOf(v.id),
      ownerNote: (v as { owner_note?: string | null }).owner_note?.trim() || undefined,
      photosRequired: typeof (v as { photos_required?: boolean | null }).photos_required === 'boolean' ? (v as unknown as { photos_required: boolean }).photos_required : undefined,
      minMedia: typeof (v as { min_media?: number | null }).min_media === 'number' ? (v as unknown as { min_media: number }).min_media : undefined,
    })),
  });
}

/** Whether photos are required at this stop: its own setting, else the route's rule. */
export const stopNeedsPhotos = (stop: Pick<RouteStop, 'photosRequired'>, route: Pick<RouteDetail, 'mediaRequired'>): boolean =>
  stop.photosRequired ?? route.mediaRequired;

/** How many photos this stop needs: its own number, else the route's. */
export const stopMinMedia = (stop: Pick<RouteStop, 'minMedia'>, route: Pick<RouteDetail, 'minMedia'>): number =>
  stop.minMedia ?? route.minMedia;

/** The owner's settings for one property on a route (update 60): a note, and whether photos are required there. */
export async function updateStop(visitId: string, patch: { ownerNote?: string; photosRequired?: boolean | null; minMedia?: number | null }): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const row: Record<string, unknown> = {};
  if (patch.ownerNote !== undefined) row.owner_note = patch.ownerNote.trim() || null;
  if (patch.photosRequired !== undefined) row.photos_required = patch.photosRequired;
  if (patch.minMedia !== undefined) row.min_media = patch.minMedia;
  const { error } = await supabase.from('snow_visits').update(row).eq('id', visitId);
  if (error) {
    return fail(/min_media/i.test(error.message)
      ? 'How many photos a property needs requires database update 112, which has not been installed yet.'
      : /owner_note|photos_required/i.test(error.message)
      ? 'Notes and photo settings for a property need database update 60, which has not been installed yet.'
      : message(error, "Couldn't save the property settings."));
  }
  return ok(undefined);
}

/** Snow team members (plus owners/admins) who can lead a route for this service. */
export async function loadSnowLeads(service: SnowService): Promise<Result<SnowLead[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase
    .from('snow_staff_services')
    .select('person_id, snow_staff!inner(status)')
    .eq('service', service)
    .eq('snow_staff.status', 'active');
  if (error) return fail(message(error, 'Couldn\'t load the snow team.'));
  // Owners and admins can always lead.
  const { data: staff } = await supabase.from('company_members').select('person_id')
    .in('role', ['owner', 'admin']).eq('status', 'active');
  const ids = [...new Set([...(data ?? []), ...(staff ?? [])].map((d) => d.person_id as string))];
  if (!ids.length) return ok([]);
  const { data: people, error: pe } = await supabase.from('people').select('id, first_name, last_name').in('id', ids);
  if (pe) return fail(message(pe, 'Couldn\'t load the snow team.'));
  return ok((people ?? [])
    .map((p) => ({ personId: p.id, name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unnamed' }))
    .sort((a, b) => a.name.localeCompare(b.name)));
}

/** Every active worker, admin and owner: anyone can be put on a Snow route crew (someone not on the snow team yet is given Snow access first). */
export async function loadSnowCrewPool(): Promise<Result<SnowLead[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data: members, error } = await supabase.from('company_members').select('person_id')
    .in('role', ['worker', 'admin', 'owner']).eq('status', 'active');
  if (error) return fail(message(error, 'Couldn\'t load your team.'));
  const ids = [...new Set((members ?? []).map((m) => m.person_id as string))];
  if (!ids.length) return ok([]);
  const { data: people, error: pe } = await supabase.from('people').select('id, first_name, last_name').in('id', ids);
  if (pe) return fail(message(pe, 'Couldn\'t load your team.'));
  return ok((people ?? [])
    .map((p) => ({ personId: p.id, name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unnamed' }))
    .sort((a, b) => a.name.localeCompare(b.name)));
}

/** Gives someone Snow access (every snow service) so they can be put on a route. The owner chose that putting a worker on a route does this. */
export async function grantSnowAccessForRoute(personId: string): Promise<Result<undefined>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.rpc('snow_grant_access', { p_person_id: personId, p_services: ['plowing', 'shoveling', 'salting'] });
  return error ? fail(message(error, 'Couldn\'t give them Snow access.')) : ok(undefined);
}

/** People who can lead (or crew) a route that does all of these services together. */
export async function loadLeadsForServices(services: SnowService[]): Promise<Result<SnowLead[]>> {
  const lists: SnowLead[][] = [];
  for (const sv of services) {
    const res = await loadSnowLeads(sv);
    if (!res.ok) return res;
    lists.push(res.data);
  }
  return ok(peopleWhoDoAll(lists));
}

export async function loadRouteTemplates(service: SnowService | SnowService[]): Promise<Result<RouteTemplate[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase
    .from('snow_route_templates')
    .select('id, name, service, snow_route_template_stops(count)')
    .in('service', Array.isArray(service) ? service : [service])
    .order('name');
  if (error) return fail(message(error, 'Couldn\'t load templates.'));
  return ok((data ?? []).map((t) => {
    const c = t.snow_route_template_stops as unknown as { count: number }[] | undefined;
    return { id: t.id, name: t.name, stops: c?.[0]?.count ?? 0, service: t.service as SnowService };
  }));
}

/**
 * Routes the signed-in lead works, newest storm first. The database only
 * shows a lead their own live routes on dispatched or ended storms.
 */
export interface MyRoute { id: string; name: string; stormName: string; stormStatus: RouteDetail['stormStatus']; service: SnowService; /** Every service it does (update 61). */ services?: SnowService[]; role: RouteRole }
export async function loadMyRoutes(): Promise<Result<MyRoute[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  // Update 41: the routes I lead AND the routes I'm on the crew of, with my role in each.
  // Before update 41 the function isn't there and only a lead can see a route, so every route is mine as lead.
  const mine = await supabase.rpc('snow_my_routes');
  let roles: Map<string, RouteRole> | null = null;
  if (!mine.error) {
    roles = new Map(((mine.data ?? []) as { route_id: string; role: RouteRole }[]).map((r) => [r.route_id, r.role]));
    if (roles.size === 0) return ok([]);
  } else if (!OLD_DATABASE.test(mine.error.message)) {
    return fail(message(mine.error, 'Couldn\'t load your routes.'));
  }
  const build = (cols: string) => {
    let q = supabase
      .from('snow_routes')
      .select(cols)
      .is('cancelled_at', null)
      .neq('snow_storms.status', 'draft')
      .order('created_at', { ascending: false });
    if (roles) q = q.in('id', [...roles.keys()]);
    return q;
  };
  const base = 'id, name, service, created_at, snow_storms!inner(name, status)';
  let { data, error } = await build(`${base}, services`);
  // A database without update 61 has no `services` column: ordinary single-service routes.
  if (error && /services/i.test(error.message)) ({ data, error } = await build(base));
  if (error) return fail(message(error, 'Couldn\'t load your routes.'));
  return ok(((data ?? []) as unknown as Record<string, any>[]).map((r) => {
    const s = (Array.isArray(r.snow_storms) ? r.snow_storms[0] : r.snow_storms) as { name: string; status: RouteDetail['stormStatus'] };
    return { id: r.id, name: r.name, service: r.service, services: Array.isArray(r.services) && r.services.length ? r.services : undefined, stormName: s.name, stormStatus: s.status, role: roleFor(roles, r.id) };
  }));
}

// ── Crew (update 41) ────────────────────────────────────────────────────────

/** The database doesn't have update 41 yet (a function or table isn't there). */
const OLD_DATABASE = /could not find the function|schema cache|does not exist/i;
const NEEDS_UPDATE_41 = 'Crew members need database update 41, which has not been installed yet.';

export interface RouteCrewMember { personId: string; name: string }

/** The crew on one route. Owners/admins see everyone's; a lead sees their own crew. */
export async function loadRouteCrew(routeId: string): Promise<Result<RouteCrewMember[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.from('snow_route_crew').select('person_id, created_at').eq('route_id', routeId).order('created_at');
  if (error) return OLD_DATABASE.test(error.message) ? ok([]) : fail(message(error, 'Couldn\'t load the crew.'));
  const ids = (data ?? []).map((c) => c.person_id as string);
  if (!ids.length) return ok([]);
  const { data: people } = await supabase.from('people').select('id, first_name, last_name').in('id', ids);
  const names = new Map((people ?? []).map((p) => [p.id as string, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unnamed']));
  return ok(ids.map((id) => ({ personId: id, name: names.get(id) ?? 'Unnamed' })));
}

const NEEDS_UPDATE_110 = 'More than one crew lead needs database update 110, which has not been installed yet.';

/** The route's other crew leads (beyond its first lead), oldest first. Empty before database update 110. */
export async function loadRouteExtraLeadIds(routeId: string): Promise<Result<string[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.from('snow_route_extra_leads').select('person_id, created_at').eq('route_id', routeId).order('created_at');
  if (error) return OLD_DATABASE.test(error.message) ? ok([]) : fail(message(error, 'Couldn\'t load the crew leads.'));
  return ok((data ?? []).map((r) => r.person_id as string));
}

/** Makes this exactly the route's crew leads, any number (owner/admin). The first stays first if still listed. Repeating it changes nothing. */
export async function setRouteLeads(routeId: string, personIds: string[]): Promise<Result<string[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.rpc('snow_set_route_leads', { p_route_id: routeId, p_person_ids: personIds });
  if (error) return fail(OLD_DATABASE.test(error.message) ? NEEDS_UPDATE_110 : message(error, 'Couldn\'t change the crew leads.'));
  return ok(((data as { leads?: string[] } | null)?.leads ?? []) as string[]);
}

/** Makes this exactly the route's crew (owner/admin). Repeating it changes nothing. */
export async function setRouteCrew(routeId: string, personIds: string[]): Promise<Result<string[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.rpc('snow_set_route_crew', { p_route_id: routeId, p_person_ids: personIds });
  if (error) return fail(OLD_DATABASE.test(error.message) ? NEEDS_UPDATE_41 : message(error, 'Couldn\'t change the crew.'));
  return ok(((data as { crew?: string[] } | null)?.crew ?? []) as string[]);
}

// ── Owner: building routes ──────────────────────────────────────────────────

export async function createRoute(stormId: string, input: { name: string; service?: SnowService; services?: SnowService[]; leadPersonId?: string; mediaRequired: boolean; minMedia: number }): Promise<Result<string>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data: last } = await supabase.from('snow_routes').select('position').eq('storm_id', stormId)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabase.from('snow_routes').insert({
    storm_id: stormId,
    ...(input.service ? { service: input.service } : {}),
    // Only sent for a route that does several services, so a database without update 61 still takes ordinary routes.
    ...(input.services && input.services.length > 1 ? { services: input.services } : {}),
    name: input.name.trim(),
    lead_person_id: input.leadPersonId ?? null,
    media_required: input.mediaRequired,
    min_media: input.minMedia,
    position: (last?.position ?? 0) + 1,
  }).select('id').single();
  if (error || !data) return fail(message(error, 'Couldn\'t add the route.'));
  return ok(data.id as string);
}

export async function updateRoute(routeId: string, patch: { name?: string; leadPersonId?: string | null; mediaRequired?: boolean; minMedia?: number }): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.leadPersonId !== undefined) row.lead_person_id = patch.leadPersonId;
  if (patch.mediaRequired !== undefined) row.media_required = patch.mediaRequired;
  if (patch.minMedia !== undefined) row.min_media = patch.minMedia;
  const { error } = await supabase.from('snow_routes').update(row).eq('id', routeId);
  return error ? fail(message(error, 'Couldn\'t save the route.')) : ok(undefined);
}

export async function cancelRoute(routeId: string): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.from('snow_routes').update({ cancelled_at: new Date().toISOString() }).eq('id', routeId);
  return error ? fail(message(error, 'Couldn\'t cancel the route.')) : ok(undefined);
}

/**
 * Adds one visit per entry, in the order given; the database numbers each new
 * stop last. The same property can be listed again (or already be on the
 * route): every visit is its own record. Returns the new visit ids.
 */
export async function addStops(routeId: string, items: (string | { propertyId: string; services?: SnowService[] })[]): Promise<Result<string[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const ids: string[] = [];
  for (const item of items) {
    const propertyId = typeof item === 'string' ? item : item.propertyId;
    // A route that does several services makes one visit per service at the property (update 61); otherwise one visit.
    const services = typeof item === 'string' || !item.services?.length ? [undefined] : item.services;
    for (const service of services) {
      const { data, error } = await supabase.from('snow_visits')
        .insert({ route_id: routeId, property_id: propertyId, ...(service ? { service } : {}) }).select('id').single();
      if (error || !data) return fail(message(error, 'Couldn\'t add the stop.'));
      ids.push(data.id as string);
    }
  }
  return ok(ids);
}

/**
 * The order that puts new visits right after the stops already worked or in
 * progress, ahead of everything not yet started ("do these next"). Worked
 * stops keep their places.
 */
export function orderWithNext(stops: { id: string; status: string }[], newIds: string[]): string[] {
  let lastWorked = -1;
  stops.forEach((s, i) => { if (s.status !== 'pending') lastWorked = i; });
  const ids = stops.map((s) => s.id);
  return [...ids.slice(0, lastWorked + 1), ...newIds, ...ids.slice(lastWorked + 1)];
}

/**
 * Other live routes each person leads, on storms that haven't ended, so the
 * owner can see a possible scheduling clash. Information only: the owner can
 * still give one person several routes.
 */
export async function loadLeadLoad(excludeRouteId: string): Promise<Result<Record<string, string[]>>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase
    .from('snow_routes')
    .select('id, name, lead_person_id, snow_storms!inner(name, status)')
    .is('cancelled_at', null)
    .not('lead_person_id', 'is', null)
    .neq('snow_storms.status', 'ended')
    .neq('id', excludeRouteId);
  if (error) return fail(message(error, 'Couldn\'t check the other routes.'));
  const out: Record<string, string[]> = {};
  for (const r of data ?? []) {
    const s = (Array.isArray(r.snow_storms) ? r.snow_storms[0] : r.snow_storms) as { name: string } | null;
    (out[r.lead_person_id as string] ??= []).push(s?.name ? `${r.name} (${s.name})` : r.name);
  }
  return ok(out);
}

/** Removes a stop nobody has started. Worked stops are kept by the database. */
export async function removeStop(visitId: string): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.from('snow_visits').delete().eq('id', visitId).eq('status', 'pending');
  return error ? fail(message(error, 'Couldn\'t remove the stop.')) : ok(undefined);
}

export async function reorderStops(routeId: string, visitIds: string[]): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.rpc('snow_reorder_route', { p_route_id: routeId, p_visit_ids: visitIds });
  return error ? fail(message(error, 'Couldn\'t reorder the stops.')) : ok(undefined);
}

export async function saveRouteAsTemplate(routeId: string, name: string): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.rpc('snow_save_route_template', { p_route_id: routeId, p_name: name });
  return error ? fail(message(error, 'Couldn\'t save the template.')) : ok(undefined);
}

export async function addRouteFromTemplate(stormId: string, templateId: string): Promise<Result<string>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.rpc('snow_apply_route_template', { p_storm_id: stormId, p_template_id: templateId });
  if (error || !data) return fail(message(error, 'Couldn\'t add the route.'));
  return ok(data as string);
}

// ── Lead: working the route ─────────────────────────────────────────────────

export async function arriveAtStop(visitId: string): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.rpc('snow_arrive_visit', { p_visit_id: visitId });
  return error ? fail(message(error, 'Couldn\'t record your arrival.')) : ok(undefined);
}

export async function finishStop(visitId: string, note?: string): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.rpc('snow_complete_visit', { p_visit_id: visitId, p_note: note ?? null });
  return error ? fail(message(error, 'Couldn\'t finish the stop.')) : ok(undefined);
}

/** Uploads completion photos/videos for a stop. A file only counts once its database row is saved. */
export async function addCompletionMedia(companyId: string, visitId: string, drafts: SnowMediaDraft[]): Promise<Result<number>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  // The photos join the shared background queue (compress -> upload -> save the record), so this returns at once and the screen can
  // say "added" while they finish uploading. Failures stay in the queue as Failed with Retry (see MyRouteScreen).
  const { queueMedia } = require('@/lib/mediaQueueRuntime') as typeof import('@/lib/mediaQueueRuntime');
  for (const d of drafts) {
    queueMedia({
      kind: d.mediaType === 'video' ? 'video' : 'image', sourceUri: d.uri, mimeType: d.mimeType, bytesIn: d.sizeBytes,
      folder: `${companyId}/completion/${visitId}`, target: { type: SNOW_COMPLETION_TARGET, payload: { visitId } },
    });
  }
  return ok(drafts.length);
}

export { SNOW_COMPLETION_TARGET };

/** Last step of a queued Snow photo: the file is stored, so save its record on the stop. Safe to repeat (the database ignores a file it already has). */
export async function saveCompletionRecord(job: { kind: string; bytesIn?: number; bytesOut?: number; target: { payload: Record<string, unknown> } }, key: string): Promise<void> {
  const { error } = await supabase.rpc('snow_add_completion_media', {
    p_visit_id: String(job.target.payload.visitId),
    p_kind: job.kind === 'video' ? 'video' : 'photo',
    p_file_key: key,
    p_size_bytes: job.bytesOut ?? job.bytesIn ?? null,
  });
  if (error) throw new Error(message(error, "Couldn't save the photo."));
}

export const STOP_STATUS_LABEL: Record<VisitStatus, string> = {
  pending: 'Not started',
  arrived: 'On site',
  completed: 'Done',
  skipped: 'Skipped',
};
