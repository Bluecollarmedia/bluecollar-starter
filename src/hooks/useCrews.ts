import { useCallback, useMemo } from 'react';
import { db, useDb, insertRow, updateRow, deleteRow, rowsOf } from '@/data/store';
import type { Crew, CrewMember } from '@/types/crew';
import { isMaintenanceWorker } from '@/hooks/useMaintenanceCrew';

/** Crews: named groups of workers (e.g. "Maintenance Crew", "Snow Crew"). A worker can be in
 * several crews. Owner/admin can change them; everyone in the company can see. */
export function useCrews() {
  const v = useDb();
  const crews = useMemo(() => db.crews, [v]);
  const crewsByPerson = useMemo(() => db.crewsByPerson, [v]);

  /** Every crew this person is in (empty when none). */
  const crewsOf = useCallback((personId?: string): Crew[] =>
    (personId ? crewsByPerson[personId] ?? [] : []), [crewsByPerson]);

  /** Puts `personId` in the crew (`member` true) or takes them out of it. Their other crews are left alone.
   * Landscaping workers can't join the Maintenance Crew (returns false). */
  const setWorkerInCrew = useCallback((personId: string, crewId: string, member: boolean): boolean => {
    const rows = rowsOf('crew_members') as CrewMember[];
    const current = rows.find(r => r.personId === personId && r.crewId === crewId);
    if (!member) {
      if (current) deleteRow('crew_members', current.id);
      return true;
    }
    if (db.crews.find(c => c.id === crewId)?.isMaintenance && !isMaintenanceWorker(personId)) return false;
    if (!current) insertRow('crew_members', { crewId, personId });
    return true;
  }, []);

  /** Makes `personIds` exactly the crew's members. Anyone's other crews are left alone. */
  const setCrewMembers = useCallback((crewId: string, personIds: string[]) => {
    const rows = rowsOf('crew_members') as CrewMember[];
    for (const r of rows) {
      if (r.crewId === crewId && !personIds.includes(r.personId)) deleteRow('crew_members', r.id);
    }
    for (const pid of personIds) setWorkerInCrew(pid, crewId, true);
  }, [setWorkerInCrew]);

  /** False when another crew already has this name (names are unique, ignoring case). */
  const isNameFree = useCallback((name: string, exceptId?: string) => {
    const key = name.trim().toLowerCase();
    return !db.crews.some(c => c.id !== exceptId && c.name.trim().toLowerCase() === key);
  }, []);

  const createCrew = useCallback((name: string, color: string, personIds: string[]): Crew => {
    const row = insertRow('crews', { name: name.trim(), color });
    setCrewMembers(row.id, personIds);
    return { ...(row as unknown as Crew), memberIds: personIds };
  }, [setCrewMembers]);

  const updateCrew = useCallback((crewId: string, patch: { name?: string; color?: string }) => {
    updateRow('crews', crewId, { ...patch, ...(patch.name ? { name: patch.name.trim() } : {}) });
  }, []);

  /** Deletes the crew; its workers stay on the team, just without a crew. */
  const deleteCrew = useCallback((crewId: string) => {
    // The database removes the members with the crew; mirror that locally.
    for (const r of rowsOf('crew_members') as CrewMember[]) {
      if (r.crewId === crewId) deleteRow('crew_members', r.id);
    }
    deleteRow('crews', crewId);
  }, []);

  return { crews, crewsOf, setWorkerInCrew, setCrewMembers, isNameFree, createCrew, updateCrew, deleteCrew };
}
