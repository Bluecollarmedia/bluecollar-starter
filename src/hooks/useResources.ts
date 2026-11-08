/**
 * Company Resources & per-worker access.
 *
 * One hook for every resource screen (owner list, resource access, worker
 * profile access, worker list/detail) so they all read and write the same
 * company_resources / resource_access rows.
 *
 * Real mode (Supabase): the database enforces everything — RLS hides
 * resources a worker wasn't granted, codes live encrypted in Vault and only
 * come back from reveal_resource_secret(), which re-checks access every
 * call. The filtering below is for display only.
 *
 * Demo mode (no Supabase): everything is in memory and the checks below are
 * the only checks. That is NOT security — it just lets the flow be tried.
 */

import { useCallback, useMemo } from 'react';
import {
  db, useDb, rowsOf, findRow, insertRow, insertRows, updateRow, deleteRow, discardLocalRow,
  rpc, refresh, flushWrites, isDemo, loadErrorOf,
} from '@/data/store';
import type { CompanyResource, ResourceAccess, ResourceAuditEntry, ResourceAuditEvent, ResourceCategory } from '@/types/resource';
import type { PersonSummary } from '@/types/company';
import { hasCardNumber, mentionsCardCredential, CARD_NUMBER_MESSAGE, CARD_PIN_MESSAGE } from '@/lib/cardSafety';

// Demo-mode stand-in for Supabase Vault. Never used when Supabase is connected.
const demoSecrets = new Map<string, string>([
  ['res1', '2580#'],
  ['res2', '4821'],
  ['res3', '1937'],
  ['res4', '0614'],
]);

export interface ResourceView extends CompanyResource {
  truckName?: string;
  cardHolderName?: string;
  /** Owner/admin only: active workers with access. Always 0 for workers. */
  accessCount: number;
}

export interface ResourceInput {
  category: ResourceCategory;
  name: string;
  description?: string;
  truckId?: string;
  itemName?: string;
  cardLastFour?: string;
  cardHolderId?: string;
}

type Result = { ok: true; id: string } | { ok: false; error: string };

const UNAVAILABLE = "This resource isn't available to you.";

function isStaff(): boolean {
  return db.role === 'owner' || db.role === 'admin';
}

function activeWorkerIds(): Set<string> {
  return new Set(db.members.filter((m) => m.role === 'worker' && m.status === 'active').map((m) => m.personId));
}

function accessRows(): ResourceAccess[] {
  const active = activeWorkerIds();
  return (rowsOf('resource_access') as ResourceAccess[]).filter((a) => active.has(a.personId));
}

/** Resources the signed-in person may see (all for owner/admin). */
function canView(resourceId: string): boolean {
  if (!findRow('company_resources', resourceId)) return false;
  if (isStaff()) return true;
  return accessRows().some((a) => a.resourceId === resourceId && a.personId === db.personId);
}

function demoAudit(eventType: ResourceAuditEvent, resourceId: string, targetPersonId?: string) {
  if (!isDemo()) return; // the database writes the real audit log
  const r = findRow('company_resources', resourceId);
  insertRow('resource_audit_log', {
    resourceId,
    resourceName: r?.name,
    actorId: db.personId || undefined,
    eventType,
    targetPersonId,
  });
}

/** Removes a person's access rows from the local copy only. The database
 * does the real revoke (trigger on company_members) when they're deactivated. */
export function dropLocalResourceAccess(personId: string) {
  for (const a of rowsOf('resource_access')) {
    if (a.personId === personId) discardLocalRow('resource_access', a.id);
  }
}

/** Same rules as the database: no card numbers, no card PINs/CVVs. */
export function validateResource(input: ResourceInput, secret?: string | null): string | null {
  if (!input.name.trim()) return 'Give the resource a name.';
  if (input.name.trim().length > 120) return 'Keep the name under 120 characters.';
  if ((input.description ?? '').length > 2000) return 'Keep the instructions under 2,000 characters.';
  if ([input.name, input.description, input.itemName, secret ?? undefined].some(hasCardNumber)) return CARD_NUMBER_MESSAGE;
  if ([input.name, input.description].some(mentionsCardCredential)) return CARD_PIN_MESSAGE;
  if (input.category === 'company_card') {
    if (input.cardLastFour && !/^\d{4}$/.test(input.cardLastFour)) return 'Enter exactly the last 4 digits of the card.';
    if (/\bpins?\b/i.test(`${input.name} ${input.description ?? ''}`)) return CARD_PIN_MESSAGE;
    if (secret) return CARD_PIN_MESSAGE;
  }
  if (secret && secret.length > 500) return 'That code is too long.';
  return null;
}

function cleanInput(input: ResourceInput): Record<string, unknown> {
  const t = (s?: string) => (s && s.trim() ? s.trim() : undefined);
  return {
    category: input.category,
    name: input.name.trim(),
    description: t(input.description),
    truckId: input.category === 'vehicle' ? input.truckId : undefined,
    itemName: input.category === 'equipment' ? t(input.itemName) : undefined,
    cardLastFour: input.category === 'company_card' ? t(input.cardLastFour) : undefined,
    cardHolderId: input.category === 'company_card' ? input.cardHolderId : undefined,
  };
}

async function saveSecret(resourceId: string, secret: string | null): Promise<string | null> {
  if (isDemo()) {
    if (secret) demoSecrets.set(resourceId, secret);
    else demoSecrets.delete(resourceId);
    demoAudit(secret ? 'code_changed' : 'code_removed', resourceId);
  } else {
    // The row must exist on the server before its code can be attached.
    await flushWrites();
    const { error } = await rpc('set_resource_secret', { p_resource_id: resourceId, p_secret: secret });
    if (error) return error.message;
  }
  // Local flag only (not a writable column): the server sets the real one.
  updateRow('company_resources', resourceId, { hasSecret: !!secret });
  return null;
}

export function useResources() {
  const v = useDb();
  const staff = isStaff();

  const { resources, access } = useMemo(() => {
    const acc = accessRows();
    const counts: Record<string, number> = {};
    for (const a of acc) counts[a.resourceId] = (counts[a.resourceId] ?? 0) + 1;
    const mine = new Set(acc.filter((a) => a.personId === db.personId).map((a) => a.resourceId));
    const truckNames: Record<string, string> = {};
    for (const t of db.trucks) truckNames[t.id] = t.name;

    let rows = rowsOf('company_resources') as CompanyResource[];
    if (!staff) rows = rows.filter((r) => mine.has(r.id));
    const list: ResourceView[] = rows
      .map((r) => {
        const holder = r.cardHolderId ? db.people[r.cardHolderId] : undefined;
        return {
          ...r,
          truckName: r.truckId ? truckNames[r.truckId] : undefined,
          cardHolderName: holder ? `${holder.firstName} ${holder.lastName}`.trim() : undefined,
          accessCount: staff ? counts[r.id] ?? 0 : 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { resources: list, access: staff ? acc : acc.filter((a) => a.personId === db.personId) };
  }, [v, staff]);

  const activeWorkers = useMemo<PersonSummary[]>(() => {
    return db.members
      .filter((m) => m.role === 'worker' && m.status === 'active' && m.person)
      .map((m) => m.person!)
      .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
  }, [v]);

  const getResource = useCallback((id: string) => resources.find((r) => r.id === id), [resources]);

  const accessFor = useCallback(
    (resourceId: string) => access.filter((a) => a.resourceId === resourceId).map((a) => a.personId),
    [access],
  );

  const resourcesFor = useCallback(
    (personId: string) => access.filter((a) => a.personId === personId).map((a) => a.resourceId),
    [access],
  );

  const auditFor = useCallback(
    (resourceId: string): ResourceAuditEntry[] => {
      if (!staff) return [];
      return (rowsOf('resource_audit_log') as ResourceAuditEntry[])
        .filter((e) => e.resourceId === resourceId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    [v, staff],
  );

  const createResource = useCallback(async (input: ResourceInput, secret?: string): Promise<Result> => {
    const problem = validateResource(input, secret);
    if (problem) return { ok: false, error: problem };
    const row = insertRow('company_resources', cleanInput(input));
    demoAudit('created', row.id);
    if (secret && secret.trim()) {
      const err = await saveSecret(row.id, secret.trim());
      if (err) return { ok: false, error: `The resource was saved, but its code wasn't: ${err}` };
    }
    return { ok: true, id: row.id };
  }, []);

  /** `secret`: undefined keeps the current code, null removes it, a string replaces it. */
  const updateResource = useCallback(async (id: string, input: ResourceInput, secret?: string | null): Promise<Result> => {
    const problem = validateResource(input, secret);
    if (problem) return { ok: false, error: problem };
    updateRow('company_resources', id, cleanInput(input));
    demoAudit('updated', id);
    const switchingToCard = input.category === 'company_card' && findRow('company_resources', id)?.hasSecret;
    if (secret !== undefined || switchingToCard) {
      const err = await saveSecret(id, switchingToCard ? null : secret?.trim() || null);
      if (err) return { ok: false, error: err };
    }
    return { ok: true, id };
  }, []);

  const deleteResource = useCallback((id: string) => {
    demoAudit('deleted', id);
    // The database deletes access rows and the Vault code with it.
    for (const a of rowsOf('resource_access')) {
      if (a.resourceId === id) discardLocalRow('resource_access', a.id);
    }
    demoSecrets.delete(id);
    deleteRow('company_resources', id);
  }, []);

  function applyAccessChanges(grants: { resourceId: string; personId: string }[], revokes: ResourceAccess[]) {
    const active = activeWorkerIds();
    const allowed = grants.filter((g) => active.has(g.personId));
    if (allowed.length > 0) {
      insertRows('resource_access', allowed);
      for (const g of allowed) demoAudit('access_granted', g.resourceId, g.personId);
    }
    for (const a of revokes) {
      demoAudit('access_revoked', a.resourceId, a.personId);
      deleteRow('resource_access', a.id);
    }
  }

  /** Makes `personIds` exactly the workers with access to one resource. */
  const setResourceAccess = useCallback((resourceId: string, personIds: string[]) => {
    const want = new Set(personIds);
    const current = (rowsOf('resource_access') as ResourceAccess[]).filter((a) => a.resourceId === resourceId);
    const have = new Set(current.map((a) => a.personId));
    applyAccessChanges(
      personIds.filter((p) => !have.has(p)).map((personId) => ({ resourceId, personId })),
      current.filter((a) => !want.has(a.personId)),
    );
  }, []);

  /** Makes `resourceIds` exactly the resources one worker can open. */
  const setWorkerAccess = useCallback((personId: string, resourceIds: string[]) => {
    const want = new Set(resourceIds);
    const current = (rowsOf('resource_access') as ResourceAccess[]).filter((a) => a.personId === personId);
    const have = new Set(current.map((a) => a.resourceId));
    applyAccessChanges(
      resourceIds.filter((r) => !have.has(r)).map((resourceId) => ({ resourceId, personId })),
      current.filter((a) => !want.has(a.resourceId)),
    );
  }, []);

  /** Fetches the code for one resource. The server checks access each time. */
  const revealSecret = useCallback(async (id: string): Promise<{ code: string | null } | { error: string }> => {
    if (isDemo()) {
      if (!canView(id)) return { error: UNAVAILABLE };
      const code = demoSecrets.get(id) ?? null;
      if (code) demoAudit('code_revealed', id);
      return { code };
    }
    const { data, error } = await rpc<string>('reveal_resource_secret', { p_resource_id: id });
    if (error) {
      // Access may have just been removed; pull the current list.
      refresh('company_resources', 'resource_access');
      return { error: UNAVAILABLE };
    }
    return { code: data };
  }, []);

  const refreshResources = useCallback(async () => {
    await refresh('company_resources', 'resource_access', ...(isStaff() ? (['resource_audit_log'] as const) : []));
  }, []);

  return {
    ready: db.ready,
    loadError: loadErrorOf('company_resources'),
    isStaff: staff,
    resources,
    activeWorkers,
    getResource,
    accessFor,
    resourcesFor,
    auditFor,
    createResource,
    updateResource,
    deleteResource,
    setResourceAccess,
    setWorkerAccess,
    revealSecret,
    refreshResources,
  };
}
