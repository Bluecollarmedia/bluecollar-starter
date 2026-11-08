import { useMemo, useCallback } from 'react';
import type { CompanyMember, PersonSummary } from '@/types/company';
import type { Project } from '@/types/project';
import type { MaintenanceProperty } from '@/types/maintenance';
import { db, useDb, insertRow, rowsOf, rpc, refresh } from '@/data/store';

export interface CustomerWithProjects {
  member: CompanyMember;
  person: PersonSummary;
  projects: Project[];
  /** Maintenance properties linked to this customer (maintenance_properties.customer_id), the same link Maintenance uses. */
  maintenanceProperties: MaintenanceProperty[];
  activeProjectCount: number;
  totalProjectCount: number;
}

interface UseCustomersOptions {
  search?: string;
}

export function useCustomers(options: UseCustomersOptions = {}) {
  const { search = '' } = options;
  const v = useDb();

  const customers = useMemo<CustomerWithProjects[]>(() => {
    return db.members
      .filter((m) => m.role === 'customer' && m.status !== 'inactive' && m.person)
      .map((m) => {
        const person = m.person!;
        const customerProjects = db.projects.filter((p) => p.customerId === m.personId);
        const maintenanceProperties = db.maintenance.properties.filter((p) => p.customerId === m.personId);
        return {
          member: m,
          person,
          projects: customerProjects,
          maintenanceProperties,
          activeProjectCount: customerProjects.filter((p) => p.status === 'active').length,
          totalProjectCount: customerProjects.length,
        };
      });
  }, [v]);

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase();
    return customers.filter(
      (c) =>
        c.person.firstName.toLowerCase().includes(q) ||
        c.person.lastName.toLowerCase().includes(q) ||
        c.person.email.toLowerCase().includes(q) ||
        c.person.phone?.includes(q) ||
        c.projects.some((p) => p.name.toLowerCase().includes(q)) ||
        c.maintenanceProperties.some((p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q)),
    );
  }, [customers, search]);

  /**
   * Adds a customer to the company and returns their person id. The database decides (add_customer, update 72), so a customer who
   * already has an account, or is already in this company, is reused and never duplicated; matching is by email only, never by name.
   * Throws a sentence the screen can show (for example when the email belongs to a team member).
   * Demo mode (no database) keeps the old local behaviour.
   */
  const addCustomer = useCallback(async (input: { firstName: string; lastName: string; email?: string; phone?: string }): Promise<string> => {
    if (!db.demo) {
      const { data, error } = await rpc('add_customer', {
        p_first: input.firstName, p_last: input.lastName, p_email: input.email ?? '', p_phone: input.phone ?? null,
      });
      if (error) throw new Error(error.message);
      await refresh('people', 'company_members');
      return (data as { person_id: string }).person_id;
    }
    const email = (input.email ?? '').trim().toLowerCase();
    // Reuse an existing person with this email (e.g. already a customer elsewhere).
    const existing = email
      ? rowsOf('people').find((p) => (p.email ?? '').toLowerCase() === email)
      : undefined;
    const personId: string = existing?.id ?? insertRow('people', {
      email,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phone: input.phone?.trim() || undefined,
    }).id;
    const alreadyMember = db.members.find((m) => m.personId === personId);
    if (!alreadyMember) {
      insertRow('company_members', {
        personId,
        role: 'customer',
        status: existing?.userId ? 'active' : 'invited',
        joinMethod: 'email_invitation',
        approvedBy: db.personId || undefined,
        approvedAt: new Date().toISOString(),
      });
    }
    return personId;
  }, []);

  const getCustomer = useCallback(
    (personId: string) => customers.find((c) => c.person.id === personId),
    [customers],
  );

  return { customers: filtered, allCustomers: customers, addCustomer, getCustomer };
}
