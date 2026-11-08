/**
 * One route on a storm (Owner): name, lead, photo rule, and its stops in
 * order. Stops that haven't been started can be moved up/down or removed;
 * the order is saved in one database call (update 025). Working layout in
 * the existing app style; no approved mockup yet.
 */
import { crewChoices, nextCrew, routeTeamMulti, toggleLead, type TeamMember } from '@/lib/snowCrew';
import { useCrews } from '@/hooks/useCrews';
import { CrewChips } from '@/components/crews/CrewChips';
import { PhotoRuleEditor } from '@/components/maintenance/PhotoRuleEditor';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Modal, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, EmptyState, Icon, InlineNotice, Input, LoadingSpinner, PressableScale, ScreenHeader, StatusBadge, Switch } from '@/components/ui';
import { confirmAction, showMessage } from '@/components/financials/ActionSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { loadEligibleProperties, SERVICE_LABEL, type EligibleProperty } from '@/data/snowStorms';
import {
  addStops, cancelRoute, stopMinMedia, loadRouteExtraLeadIds, setRouteLeads, loadLeadLoad, loadLeadsForServices, grantSnowAccessForRoute, loadRoute, loadRouteCrew, loadSnowCrewPool, loadSnowLeads, orderWithNext, removeStop, reorderStops, saveRouteAsTemplate, setRouteCrew, stopNeedsPhotos, updateRoute, updateStop,
  type RouteCrewMember, type RouteStop,
  STOP_STATUS_LABEL, type RouteDetail, type SnowLead,
} from '@/data/snowRoutes';
import { OwnerSkipRequests } from './SkipRequests';
import { AddPropertiesSheet } from './AddPropertiesSheet';
import { flattenGroups, groupStatus, groupStops, isGroupClosed, isGroupUntouched, servicesText, servicesToAdd } from '@/lib/snowStopGroups';
import type { SnowService } from '@/types/snow';
import { typeScale } from '@/theme/typography';
import { ReorderableList } from '@/components/ui/ReorderableList';
import { spacing, radius } from '@/theme/spacing';

export const STOP_TONE = { pending: 'neutral', arrived: 'info', completed: 'success', skipped: 'warning' } as const;

/**
 * The route's settings and stops, edited right on the storm screen: crew, crew lead, ordered properties, notes, Save as template and
 * Cancel route. There is no second screen for the same route.
 */
export function RouteEditor({ routeId: id, embedded = true, onDragActive, refreshToken, onRouteCancelled }: {
  routeId?: string; embedded?: boolean; onDragActive?: (active: boolean) => void;
  /** Bumped by the storm screen when realtime changes arrive, so the embedded editor never goes stale. */
  refreshToken?: number;
  /** The route was cancelled: the storm screen reloads its list. */
  onRouteCancelled?: () => void;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [leads, setLeads] = useState<SnowLead[]>([]);
  // Everyone on the team can be added to the crew; those not on the snow team yet get Snow access when they are added.
  const [pool, setPool] = useState<SnowLead[]>([]);
  const [eligible, setEligible] = useState<EligibleProperty[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [pickLead, setPickLead] = useState(false);
  const [pickStops, setPickStops] = useState(false);
  const [doNext, setDoNext] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [leadLoad, setLeadLoad] = useState<Record<string, string[]>>({});
  const [crew, setCrew] = useState<RouteCrewMember[]>([]);
  // The route's other crew leads (the first lead is route.leadPersonId); together they are the leads, any number.
  const [extraLeadIds, setExtraLeadIds] = useState<string[]>([]);
  const [pickCrew, setPickCrew] = useState(false);
  const { crews } = useCrews();
  // The property whose notes and photo setting are being edited.
  const [detailStop, setDetailStop] = useState<RouteStop[] | null>(null);
  const [stopNote, setStopNote] = useState('');
  const [stopPhotos, setStopPhotos] = useState(false);
  const [stopCount, setStopCount] = useState(1);
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState('');

  const reload = useCallback(async () => {
    if (!id) return;
    const r = await loadRoute(id);
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setRoute(r.data);
    setName(r.data.name);
    const [l, e, load] = await Promise.all([
      r.data.services.length > 1 ? loadLeadsForServices(r.data.services) : loadSnowLeads(r.data.service),
      loadEligibleProperties(r.data.stormId, r.data.services.length > 1 ? undefined : r.data.service),
      loadLeadLoad(r.data.id),
    ]);
    const c = await loadRouteCrew(r.data.id);
    if (c.ok) setCrew(c.data);
    const xl = await loadRouteExtraLeadIds(r.data.id);
    if (xl.ok) setExtraLeadIds(xl.data);
    const everyone = await loadSnowCrewPool();
    if (everyone.ok) setPool(everyone.data);
    if (l.ok) setLeads(l.data);
    if (e.ok) setEligible(e.data);
    if (load.ok) setLeadLoad(load.data);
  }, [id]);

  useEffect(() => { reload(); }, [reload]);
  const firstToken = useRef(true);
  useEffect(() => {
    if (firstToken.current) { firstToken.current = false; return; }
    if (refreshToken !== undefined && !dragging) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  async function save(patch: Parameters<typeof updateRoute>[1]) {
    if (!route) return;
    setBusy(true);
    const res = await updateRoute(route.id, patch);
    setBusy(false);
    if (!res.ok) return showMessage('Couldn\'t save', res.error);
    reload();
  }

  /** Saves a new order (from a drag). A whole stop moves together: the visits for every service at a property stay side by side. */
  async function applyOrder(keys: string[]) {
    if (!route) return;
    const byKey = new Map(groupStops(route.stops).map((g) => [g[0].id, g]));
    await saveOrder(flattenGroups(keys.map((k) => byKey.get(k)).filter((g): g is RouteStop[] => !!g)));
  }

  /** Shows the new order right away, then lets the database have the final word. */
  async function saveOrder(stops: RouteStop[]) {
    if (!route) return;
    setRoute({ ...route, stops });
    const res = await reorderStops(route.id, stops.map((x) => x.id));
    if (!res.ok) showMessage("Couldn't reorder", res.error);
    reload();
  }

  /** Adds or removes one crew member. The database gets the whole new list, so a double tap changes nothing. */
  async function changeCrew(personId: string, add: boolean) {
    if (!route) return;
    setBusy(true);
    if (add && !leads.some((l) => l.personId === personId)) {
      const granted = await grantSnowAccessForRoute(personId);
      if (!granted.ok) { setBusy(false); return showMessage("Couldn't add them", granted.error); }
    }
    const res = await setRouteCrew(route.id, nextCrew(crew.map((c) => c.personId), personId, add));
    setBusy(false);
    if (!res.ok) return showMessage("Couldn't change the crew", res.error);
    setPickCrew(false);
    reload();
  }

  /** Taps one of the team: a lead is taken off the leads, anyone else becomes a lead too. Any number can lead. The database takes new leads off the crew. */
  async function chooseLead(personId: string) {
    if (!route) return;
    setBusy(true);
    const res = await setRouteLeads(route.id, toggleLead(leadIds, personId));
    setBusy(false);
    if (!res.ok) showMessage("Couldn't save", res.error);
    reload();
  }

  /** A whole crew tapped on or off: the database gets the new full list; anyone not on the Snow team yet gets Snow access first. */
  async function changeCrewMany(next: string[]) {
    if (!route) return;
    setBusy(true);
    for (const pid of next) {
      if (crew.some((c) => c.personId === pid) || leads.some((l) => l.personId === pid)) continue;
      const granted = await grantSnowAccessForRoute(pid);
      if (!granted.ok) { setBusy(false); return showMessage("Couldn't add them", granted.error); }
    }
    const res = await setRouteCrew(route.id, next);
    setBusy(false);
    if (!res.ok) return showMessage("Couldn't change the crew", res.error);
    reload();
  }

  /** Takes one person off the route: a crew member leaves the crew; a lead stops leading (and leaves the route). */
  async function removeMember(m: TeamMember) {
    if (!route) return;
    if (!m.lead) return changeCrew(m.personId, false);
    setBusy(true);
    const res = await setRouteLeads(route.id, leadIds.filter((id) => id !== m.personId));
    setBusy(false);
    if (!res.ok) showMessage("Couldn't remove them", res.error);
    reload();
  }

  async function move(index: number, delta: -1 | 1) {
    if (!route) return;
    const groups = groupStops(route.stops);
    const j = index + delta;
    if (j < 0 || j >= groups.length) return;
    [groups[index], groups[j]] = [groups[j], groups[index]];
    await saveOrder(flattenGroups(groups));
  }

  /** Puts a stop that hasn't started right after the stops already worked or in progress. */
  async function moveToNext(index: number) {
    if (!route) return;
    const groups = groupStops(route.stops);
    let lastWorked = -1;
    groups.forEach((g, i) => { if (!isGroupUntouched(g)) lastWorked = i; });
    const [g] = groups.splice(index, 1);
    groups.splice(lastWorked + 1, 0, g);
    await saveOrder(flattenGroups(groups));
  }

  function onRemove(group: RouteStop[]) {
    confirmAction(`Remove ${group[0].propertyName}?`, "This stop hasn't been started, so nothing is lost.", 'Remove', async () => {
      for (const v of group) {
        const res = await removeStop(v.id);
        if (!res.ok) { showMessage("Couldn't remove the stop", res.error); break; }
      }
      reload();
    }, true);
  }

  async function onAddStops(ids: string[]) {
    if (!route || !ids.length) return;
    setBusy(true);
    // A route that does several services makes one visit per service the property offers.
    const items = ids.map((pid) => ({
      propertyId: pid,
      services: route.services.length > 1 ? (servicesToAdd(route.services, eligible.find((e) => e.propertyId === pid)?.services, route.service) as SnowService[]) : undefined,
    }));
    const res = await addStops(route.id, items);
    if (res.ok && doNext) {
      const re = await reorderStops(route.id, orderWithNext(route.stops, res.data));
      if (!re.ok) showMessage('Added, but couldn\'t put them next', re.error);
    }
    setBusy(false);
    if (!res.ok) showMessage('Couldn\'t add every stop', res.error);
    setDoNext(false);
    reload();
  }

  async function onSaveTemplate() {
    if (!route) return;
    setBusy(true);
    const res = await saveRouteAsTemplate(route.id, route.name);
    setBusy(false);
    showMessage(res.ok ? 'Template saved' : 'Couldn\'t save the template',
      res.ok ? `"${route.name}" can be added to the next ${SERVICE_LABEL[route.service].toLowerCase()} storm.` : res.error);
  }

  function onCancelRoute() {
    if (!route) return;
    confirmAction(`Cancel ${route.name}?`, 'Its lead stops seeing it. Work already done stays recorded.', 'Cancel route', async () => {
      const res = await cancelRoute(route.id);
      if (!res.ok) return showMessage('Couldn\'t cancel the route', res.error);
      onRouteCancelled?.();
    }, true);
  }

  function openStop(group: RouteStop[]) {
    setDetailStop(group);
    setStopNote(group[0].ownerNote ?? '');
    setStopPhotos(route ? stopNeedsPhotos(group[0], route) : false);
    setStopCount(route ? stopMinMedia(group[0], route) : 1);
  }

  async function saveStop() {
    if (!detailStop || !route) return;
    Keyboard.dismiss();
    setBusy(true);
    let failure: string | null = null;
    for (const [i, v] of detailStop.entries()) {
      const patch: Parameters<typeof updateStop>[1] = {};
      if (stopNote.trim() !== (v.ownerNote ?? '')) patch.ownerNote = stopNote;
      // The crew adds one set of photos for the whole stop, on its first visit, so only that visit can require photos.
      const wantPhotos = i === 0 ? stopPhotos : false;
      if (wantPhotos !== stopNeedsPhotos(v, route)) patch.photosRequired = wantPhotos;
      if (wantPhotos && stopCount !== stopMinMedia(v, route)) patch.minMedia = stopCount;
      if (!Object.keys(patch).length) continue;
      const res = await updateStop(v.id, patch);
      if (!res.ok) { failure = res.error; break; }
    }
    setBusy(false);
    if (failure) return showMessage("Couldn't save", failure);
    setDetailStop(null);
    reload();
  }

  if (loading) return <LoadingSpinner />;
  if (!route) return <InlineNotice icon="alert-circle" tone="error" text={error ?? 'This route is not available.'} />;

  const editable = !route.cancelled && route.stormStatus !== 'ended';
  const leadName = leads.find((l) => l.personId === route.leadPersonId)?.name;
  const leadIds = [route.leadPersonId, ...extraLeadIds].filter((id): id is string => !!id);
  const nameOf = (id: string) => leads.find((l) => l.personId === id)?.name ?? pool.find((l) => l.personId === id)?.name;
  const team = routeTeamMulti(leadIds, nameOf, crew);
  const crewPeople = crewChoices(pool.length ? pool : leads, route.leadPersonId, [...crew.map((c) => c.personId), ...extraLeadIds]);
  const onSnowTeam = new Set(leads.map((l) => l.personId));
  // Who a crew tap may put on this route: anyone not already leading it (crew members are included so a second tap takes them off).
  const crewable = new Set([...crewPeople.map((l) => l.personId), ...crew.map((c) => c.personId)]);
  // A property can be on a route more than once (repeat passes), so every
  // eligible property stays pickable; we just show how many visits it has.
  const visitsOn = new Map<string, number>();
  route.stops.forEach((s) => visitsOn.set(s.propertyId, (visitsOn.get(s.propertyId) ?? 0) + 1));
  const groups = groupStops(route.stops);
  const firstPending = groups.findIndex(isGroupUntouched);
  const several = route.services.length > 1;
  const svcLabel = (x: string) => SERVICE_LABEL[x as SnowService];
  const addable = several ? eligible.filter((e) => !e.services || e.services.some((x) => route.services.includes(x))) : eligible;
  const sep = { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight };

  const openCount = groups.filter((g) => !isGroupClosed(g)).length;

  const body = (
    <>
        {embedded ? (
          <Pressable onPress={() => { setRenameText(route.name); setRenaming(true); }} style={[styles.inline, { marginBottom: spacing.sm }]} accessibilityRole="button" accessibilityLabel="Rename route">
            <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]} numberOfLines={1}>{route.name}</Text>
            <Icon name="edit-2" size={13} color={colors.textTertiary} />
          </Pressable>
        ) : null}

        {error ? <InlineNotice icon="alert-circle" tone="error" text={error} style={{ marginBottom: spacing.md }} /> : null}
        {route.cancelled ? <InlineNotice icon="slash" tone="warning" text="This route was cancelled." style={{ marginBottom: spacing.md }} /> : null}

        {route.stormStatus === 'dispatched' ? (
          <View style={{ marginBottom: spacing.md }}>
            <OwnerSkipRequests routeId={route.id} stops={route.stops} leadName={leadName} onDecided={reload} />
          </View>
        ) : null}

        <SetupCard
          n={1}
          icon="users"
          title="Crew"
          sub="Select the crew for this route."
          pill={team.length ? `${team.length} ${team.length === 1 ? 'member' : 'members'}` : 'None yet'}
          onPress={editable ? () => setPickCrew(!pickCrew) : undefined}
          open={pickCrew}
        >
          {team.length ? (
            <View style={styles.avatarWrap}>
              {team.map((m) => {
                const [first, ...rest] = m.name.split(' ');
                const short = rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first;
                return (
                  <View key={m.personId} style={styles.avatarCell}>
                    <View>
                      <Avatar firstName={first} lastName={rest.join(' ')} size={48} />
                      {editable ? (
                        <Pressable
                          onPress={() => removeMember(m)}
                          disabled={busy}
                          hitSlop={8}
                          style={[styles.avatarX, { backgroundColor: colors.surface, borderColor: colors.border }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${m.name}`}
                        >
                          <Icon name="x" size={11} color={colors.textSecondary} />
                        </Pressable>
                      ) : null}
                    </View>
                    <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 4 }]} numberOfLines={1}>{short}</Text>
                    {m.lead ? <Text style={[typeScale.caption, { color: colors.primary, fontWeight: '700' }]}>Lead</Text> : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.md }]}>No crew selected. Tap Add Crew.</Text>
          )}
          {pickCrew ? (
            <>
              {crews.length ? (
                <View style={{ marginTop: spacing.md }}>
                  <CrewChips crews={crews} picked={crew.map((c) => c.personId)} onChange={changeCrewMany} check={(pid) => (crewable.has(pid) ? { ok: true } : { ok: false })} />
                </View>
              ) : null}
            {crewPeople.length ? (
              <View style={[styles.group, { borderColor: colors.borderLight, marginTop: spacing.md }]}>
                {crewPeople.map((l, i) => (
                  <Pressable key={l.personId} style={[styles.row, i > 0 && sep]} onPress={() => changeCrew(l.personId, true)} accessibilityRole="button">
                    <View style={{ flex: 1 }}>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{l.name}</Text>
                      {onSnowTeam.has(l.personId) ? null : <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Gets Snow access when added</Text>}
                    </View>
                    <Icon name="plus" size={18} color={colors.primary} />
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.md }]}>
                No one else to add. Everyone on your team is already on this route.
              </Text>
            )}
            </>
          ) : null}
          {editable && !pickCrew ? <Button title="Add Crew" icon="plus" variant="secondary" size="sm" disabled={busy} onPress={() => setPickCrew(true)} style={{ marginTop: spacing.md, alignSelf: 'flex-start' }} /> : null}
        </SetupCard>

        <SetupCard
          n={2}
          icon="user"
          title="Crew Leads"
          sub="Select one or more crew leads for this route."
          pill={leadIds.length ? `${leadIds.length} ${leadIds.length === 1 ? 'lead' : 'leads'}` : team.length ? `${team.length} available` : undefined}
          onPress={editable && team.length > 0 ? () => setPickLead(!pickLead) : undefined}
          open={pickLead}
        >
          {team.length === 0 ? (
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.md }]}>Add crew members first.</Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {(leadIds.length ? leadIds : [null]).map((leadId, i) => {
                const nm = leadId ? nameOf(leadId) ?? 'Crew lead' : undefined;
                return (
                  <Pressable
                    key={leadId ?? 'none'}
                    onPress={() => editable && setPickLead(!pickLead)}
                    style={[styles.leadRow, { backgroundColor: colors.primarySurface }]}
                    accessibilityRole="button"
                    accessibilityLabel={leadId ? `Crew lead ${nm}` : 'Select crew leads'}
                  >
                    {leadId ? (
                      <Avatar firstName={(nm ?? 'Crew').split(' ')[0]} lastName={(nm ?? '').split(' ').slice(1).join(' ')} size={44} />
                    ) : (
                      <View style={[styles.leadEmpty, { borderColor: colors.border }]}><Icon name="user" size={20} color={colors.textTertiary} /></View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={[typeScale.bodyLarge, { color: leadId ? colors.textPrimary : colors.textTertiary, fontWeight: '700' }]} numberOfLines={1}>
                        {leadId ? nm : 'Select crew leads'}
                      </Text>
                      {leadId ? <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Crew Lead</Text> : null}
                      {leadId && leadLoad[leadId] ? (
                        <Text style={[typeScale.caption, { color: colors.warning }]}>Also leads {leadLoad[leadId].join(', ')}. That's allowed; check the timing.</Text>
                      ) : null}
                    </View>
                    {editable && i === 0 ? <Icon name={pickLead ? 'chevron-up' : 'chevron-right'} size={18} color={colors.textTertiary} /> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
          {pickLead ? (
            <View style={[styles.group, { borderColor: colors.borderLight, marginTop: spacing.md }]}>
              <Text style={[typeScale.caption, { color: colors.textTertiary, paddingHorizontal: spacing.md, paddingTop: spacing.sm }]}>Tap a name to add or remove a crew lead. Any number can lead.</Text>
              {team.map((m, i) => (
                <Pressable key={m.personId} style={[styles.row, i > 0 && sep]} onPress={() => chooseLead(m.personId)} accessibilityRole="button">
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{m.name}</Text>
                    {leadLoad[m.personId] && !m.lead ? (
                      <Text style={[typeScale.caption, { color: colors.warning }]}>Already leads {leadLoad[m.personId].join(', ')}</Text>
                    ) : null}
                  </View>
                  {m.lead ? <Icon name="check" size={18} color={colors.primary} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </SetupCard>

        {editable ? (
          <View style={[styles.group, { borderColor: colors.borderLight, marginBottom: spacing.md, paddingVertical: spacing.xs }]}>
            <PhotoRuleEditor
              label="Photos required at every stop"
              on={route.mediaRequired}
              count={route.minMedia}
              onChange={async (on, n) => {
                setBusy(true);
                const res = await updateRoute(route.id, { mediaRequired: on, minMedia: n });
                // The whole route is set: every stop follows it again (a property can still be changed on its own afterwards).
                if (res.ok) for (const v of route.stops) if (v.photosRequired !== undefined || v.minMedia !== undefined) await updateStop(v.id, { photosRequired: null, ...(v.minMedia !== undefined ? { minMedia: null } : {}) });
                setBusy(false);
                if (!res.ok) showMessage("Couldn't save", res.error);
                reload();
              }}
              hint="Applies to the whole route, every property. Tap a property below to change just that one."
            />
          </View>
        ) : null}

        <SetupCard
          n={3}
          icon="map-pin"
          title="Properties"
          sub="Add properties to this route."
          pill={`${groups.length} ${groups.length === 1 ? 'property' : 'properties'}`}
          onPress={editable ? () => setPickStops(true) : undefined}
        >
          {groups.length && route.stormStatus !== 'draft' ? (
            <View style={[styles.inline, { marginTop: spacing.md }]}>
              <StatusBadge label={`Open ${openCount}`} status="info" />
              <StatusBadge label={`Closed ${groups.length - openCount}`} status="success" />
            </View>
          ) : null}
          {groups.length ? (
            <View style={[styles.group, { borderColor: colors.borderLight, marginTop: spacing.md }]}>
              <ReorderableList
                items={groups}
                keyOf={(g) => g[0].id}
                rowHeight={STOP_ROW_HEIGHT}
                canDrag={(g) => editable && isGroupUntouched(g)}
                onReorder={applyOrder}
                onDragActive={(a) => { setDragging(a); onDragActive?.(a); }}
                renderRow={(g, i, handle) => {
                  const s = g[0];
                  const movable = editable && isGroupUntouched(g);
                  const status = groupStatus(g);
                  const live = route.stormStatus === 'dispatched';
                  // The address is the second line. The service is only named when the route does several (one service is already the
                  // route's title); a camera shows only when photos ARE required and a note icon when one is set, and nothing is written out when photos are not needed.
                  const where = [s.propertyAddress, several ? servicesText(g.map((x) => x.service ?? route.service), svcLabel) : null].filter(Boolean).join(' · ');
                  const needsPhotos = stopNeedsPhotos(s, route);
                  return (
                    <View style={[styles.stopRow, i > 0 && sep]}>
                      <View style={[styles.stopNo, { borderColor: colors.border }]}>
                        <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{i + 1}</Text>
                      </View>
                      <View style={[styles.stopThumb, { backgroundColor: colors.primarySurface }]}>
                        <Icon name="home" size={20} color={colors.primary} />
                      </View>
                      <Pressable
                        style={{ flex: 1, gap: 2 }}
                        onPress={() => openStop(g)}
                        accessibilityRole="button"
                        accessibilityLabel={`${s.propertyName}: photos and notes`}
                      >
                        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={1}>{s.propertyName}</Text>
                        <View style={styles.inline}>
                          <Text style={[typeScale.caption, { color: colors.textSecondary, flexShrink: 1 }]} numberOfLines={1}>{where}</Text>
                          {needsPhotos ? <Icon name="camera" size={12} color={colors.primary} /> : null}
                          {s.ownerNote ? <Icon name="file-text" size={12} color={colors.primary} /> : null}
                        </View>
                      </Pressable>
                      {movable ? (
                        <View style={styles.inline}>
                          {live ? <IconTap icon="chevrons-up" label="Move to next" disabled={i === firstPending} onPress={() => moveToNext(i)} color={colors.textSecondary} /> : null}
                          <IconTap icon="x" label="Remove stop" onPress={() => onRemove(g)} color={colors.textTertiary} />
                          {handle ?? null}
                        </View>
                      ) : (
                        <StatusBadge label={STOP_STATUS_LABEL[status]} status={STOP_TONE[status]} />
                      )}
                    </View>
                  );
                }}
              />
            </View>
          ) : (
            <View style={styles.empty}>
              <View>
                <Icon name="home" size={44} color={colors.textTertiary} />
                <View style={styles.snowBadge}><Icon name="cloud-snow" size={20} color={colors.textTertiary} /></View>
              </View>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginTop: spacing.md }]}>No properties added yet</Text>
              {editable ? <Button title="Add Property" icon="plus" onPress={() => setPickStops(true)} style={{ marginTop: spacing.lg }} /> : null}
            </View>
          )}

          {editable && groups.length ? (
            <Button title="Add Property" icon="plus" variant="secondary" size="sm" onPress={() => setPickStops(true)} style={{ marginTop: spacing.md, alignSelf: 'flex-start' }} />
          ) : null}
        </SetupCard>

        {editable ? (
          <View style={[styles.inline, { marginTop: spacing.md, justifyContent: 'center', gap: spacing.lg }]}>
            {route.stops.length && !several ? (
              <Pressable onPress={onSaveTemplate} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Save this route as a template">
                <Text style={[typeScale.labelSmall, { color: colors.primary }]}>Save as template</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onCancelRoute} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel this route">
              <Text style={[typeScale.labelSmall, { color: colors.textTertiary }]}>Cancel route</Text>
            </Pressable>
          </View>
        ) : null}

        {embedded && route.stops.length ? (
          <Text style={[typeScale.caption, styles.help, { color: colors.textTertiary, marginTop: spacing.xs }]}>Tap a property to set photos and add a note for it.</Text>
        ) : null}

        {editable ? (
          <AddPropertiesSheet
            visible={pickStops}
            onClose={() => setPickStops(false)}
            properties={addable}
            services={route.services}
            serviceLabel={svcLabel}
            visitsOn={visitsOn}
            busy={busy}
            showDoNext={route.stormStatus === 'dispatched' && route.stops.length > 0}
            doNext={doNext}
            onDoNext={setDoNext}
            onAdd={onAddStops}
          />
        ) : null}

        <Modal visible={renaming} transparent animationType="fade" onRequestClose={() => setRenaming(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
              <Input label="Route name" value={renameText} onChangeText={setRenameText} autoFocus />
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                <Button title="Cancel" variant="ghost" onPress={() => setRenaming(false)} />
                <Button title="Save" icon="check" disabled={!renameText.trim()} onPress={() => { Keyboard.dismiss(); setRenaming(false); if (renameText.trim() && renameText.trim() !== route.name) save({ name: renameText }); }} />
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={!!detailStop} transparent animationType="fade" onRequestClose={() => setDetailStop(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{detailStop?.[0].propertyName}</Text>
              {detailStop?.[0].propertyAddress ? <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{detailStop[0].propertyAddress}</Text> : null}
              <View style={{ marginTop: spacing.lg }}>
                <PhotoRuleEditor
                  label="Photos required here"
                  on={stopPhotos}
                  count={stopCount}
                  onChange={(on, n) => { setStopPhotos(on); setStopCount(n); }}
                  hint="Just this property. The crew must add this many photos before finishing it."
                />
              </View>
              <Input label="Notes for this property" value={stopNote} onChangeText={setStopNote} editable={editable} multiline numberOfLines={4} placeholder="Gate code, where to pile snow, what to watch for" containerStyle={{ marginTop: spacing.lg }} />
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                <Button title="Cancel" variant="ghost" onPress={() => setDetailStop(null)} />
                {editable ? <Button title="Save" icon="check" loading={busy} onPress={saveStop} /> : null}
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
    </>
  );

  return <View>{body}</View>;
}

function IconTap({ icon, label, onPress, disabled, color }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; onPress: () => void; disabled?: boolean; color: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={{ padding: 6, opacity: disabled ? 0.3 : 1 }}>
      <Icon name={icon} size={18} color={color} />
    </Pressable>
  );
}

/** One numbered setup card: number, icon, title and a count pill; tapping the header opens that section's selection. */
function SetupCard({ n, icon, title, sub, pill, onPress, open, children }: {
  n: number; icon: React.ComponentProps<typeof Icon>['name']; title: string; sub: string; pill?: string; onPress?: () => void; open?: boolean; children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, styles.setupCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
      <Pressable onPress={onPress} disabled={!onPress} style={styles.setupHead} accessibilityRole="button" accessibilityLabel={`${title}: ${sub}`}>
        <View style={[styles.sectionNo, { backgroundColor: colors.primarySurface }]}>
          <Text style={[typeScale.labelLarge, { color: colors.textSecondary }]}>{n}</Text>
        </View>
        <Icon name={icon} size={26} color={colors.textTertiary} />
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '800' }]}>{title}</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={2}>{sub}</Text>
        </View>
        {pill ? (
          <View style={[styles.pill, { backgroundColor: colors.primarySurface }]}>
            <Text style={[typeScale.labelSmall, { color: colors.primary, fontWeight: '700' }]}>{pill}</Text>
          </View>
        ) : null}
        {onPress ? <Icon name={open ? 'chevron-up' : 'chevron-right'} size={18} color={colors.textTertiary} /> : null}
      </Pressable>
      {children}
    </View>
  );
}

/** Every stop row is this tall so a dragged row can slide between its neighbours. */
const STOP_ROW_HEIGHT = 68;

const styles = StyleSheet.create({
  done: { height: 44, paddingHorizontal: spacing.lg, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1 },
  card: { borderRadius: radius.lg, padding: spacing.lg },
  help: { marginHorizontal: spacing.sm },
  group: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 52 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  setupCard: { borderWidth: StyleSheet.hairlineWidth, marginTop: spacing.md },
  setupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full },
  avatarWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  avatarCell: { width: 64, alignItems: 'center' },
  avatarX: { position: 'absolute', top: -4, right: -4, width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  leadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, marginTop: spacing.md },
  leadEmpty: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  stopRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md },
  stopNo: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stopThumb: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  sectionNo: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: spacing.xl },
  snowBadge: { position: 'absolute', right: -14, top: -10 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCard: { width: '100%', maxWidth: 420, borderRadius: radius.xl, padding: spacing.xl },
});
