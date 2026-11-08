import type { Company, CompanyMember, PersonSummary } from '@/types/company';
import type {
  Project,
  ProjectTask,
  ProjectTeamMember,
  ProjectSettings,
  ProjectHistoryEntry,
  ProjectUpdate,
  ProjectRequest,
  ProjectPhoto,
  CustomerTimelineEvent,
} from '@/types/project';
import type { Assignment, ScheduleChange } from '@/types/schedule';
import type { Truck } from '@/types/truck';
import type { Announcement, AnnouncementRead } from '@/types/announcement';
import type { WorkerActivity, CheckIn, CheckOut, WorkerSettings } from '@/types/worker';
import type { CompanyResource, ResourceAccess } from '@/types/resource';

// ── People ──────────────────────────────────────────────────────

export const mockPeople: Record<string, PersonSummary> = {
  owner1: {
    id: 'owner1',
    firstName: 'Joey',
    lastName: 'Angeloco',
    email: 'joey@brightonlawn.com',
    phone: '(216) 555-0100',
    avatarUrl: 'https://ui-avatars.com/api/?name=Joey+Angeloco&background=7CB342&color=fff&size=128',
  },
  worker1: {
    id: 'worker1',
    firstName: 'Marcus',
    lastName: 'Rivera',
    email: 'marcus@brightonlawn.com',
    phone: '(216) 555-0201',
    avatarUrl: 'https://ui-avatars.com/api/?name=Marcus+Rivera&background=1976D2&color=fff&size=128',
  },
  worker2: {
    id: 'worker2',
    firstName: 'Tyler',
    lastName: 'Brooks',
    email: 'tyler@brightonlawn.com',
    phone: '(216) 555-0202',
    avatarUrl: 'https://ui-avatars.com/api/?name=Tyler+Brooks&background=E64A19&color=fff&size=128',
  },
  worker3: {
    id: 'worker3',
    firstName: 'Deshawn',
    lastName: 'Williams',
    email: 'deshawn@brightonlawn.com',
    phone: '(216) 555-0203',
    avatarUrl: 'https://ui-avatars.com/api/?name=Deshawn+Williams&background=00897B&color=fff&size=128',
  },
  worker4: {
    id: 'worker4',
    firstName: 'Carlos',
    lastName: 'Mendez',
    email: 'carlos@brightonlawn.com',
    phone: '(216) 555-0204',
    avatarUrl: 'https://ui-avatars.com/api/?name=Carlos+Mendez&background=5E35B1&color=fff&size=128',
  },
  worker5: {
    id: 'worker5',
    firstName: 'Jake',
    lastName: 'Patterson',
    email: 'jake@brightonlawn.com',
    phone: '(216) 555-0205',
    avatarUrl: 'https://ui-avatars.com/api/?name=Jake+Patterson&background=C62828&color=fff&size=128',
  },
  customer1: {
    id: 'customer1',
    firstName: 'Sarah',
    lastName: 'Mitchell',
    email: 'sarah.mitchell@email.com',
    phone: '(216) 555-0301',
  },
  customer2: {
    id: 'customer2',
    firstName: 'David',
    lastName: 'Chen',
    email: 'david.chen@email.com',
    phone: '(216) 555-0302',
  },
  customer3: {
    id: 'customer3',
    firstName: 'Amanda',
    lastName: 'Kowalski',
    email: 'amanda.k@email.com',
    phone: '(216) 555-0303',
  },
  customer4: {
    id: 'customer4',
    firstName: 'Robert',
    lastName: 'Thompson',
    email: 'rthompson@email.com',
    phone: '(216) 555-0304',
  },
  customer5: {
    id: 'customer5',
    firstName: 'Jennifer',
    lastName: 'Park',
    email: 'jpark@email.com',
    phone: '(216) 555-0305',
  },
};

// ── Company ─────────────────────────────────────────────────────

export const mockCompany: Company = {
  id: 'company1',
  name: 'Brighton Lawn + Landscape',
  phone: '(216) 555-0100',
  email: 'info@brightonlawn.com',
  address: '4521 Ridge Rd',
  city: 'Cleveland',
  state: 'OH',
  zip: '44144',
  yardAddress: '4521 Ridge Rd',
  yardCity: 'Cleveland',
  yardState: 'OH',
  yardZip: '44144',
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: '2026-09-01T08:00:00Z',
};

// ── Company Members ─────────────────────────────────────────────

export const mockMembers: CompanyMember[] = [
  { id: 'cm1', companyId: 'company1', personId: 'owner1', role: 'owner', status: 'active', createdAt: '2024-01-15T10:00:00Z', updatedAt: '2024-01-15T10:00:00Z', person: mockPeople.owner1 },
  { id: 'cm2', companyId: 'company1', personId: 'worker1', role: 'worker', status: 'active', createdAt: '2025-03-01T08:00:00Z', updatedAt: '2025-03-01T08:00:00Z', person: mockPeople.worker1 },
  { id: 'cm3', companyId: 'company1', personId: 'worker2', role: 'worker', status: 'active', createdAt: '2025-04-15T08:00:00Z', updatedAt: '2025-04-15T08:00:00Z', person: mockPeople.worker2 },
  { id: 'cm4', companyId: 'company1', personId: 'worker3', role: 'worker', status: 'active', createdAt: '2025-06-01T08:00:00Z', updatedAt: '2025-06-01T08:00:00Z', person: mockPeople.worker3 },
  { id: 'cm5', companyId: 'company1', personId: 'worker4', role: 'worker', status: 'active', createdAt: '2026-02-01T08:00:00Z', updatedAt: '2026-02-01T08:00:00Z', person: mockPeople.worker4 },
  { id: 'cm6', companyId: 'company1', personId: 'worker5', role: 'worker', status: 'inactive', createdAt: '2025-05-01T08:00:00Z', updatedAt: '2026-08-15T08:00:00Z', person: mockPeople.worker5 },
  { id: 'cm7', companyId: 'company1', personId: 'customer1', role: 'customer', status: 'active', createdAt: '2026-02-15T10:00:00Z', updatedAt: '2026-02-15T10:00:00Z', person: mockPeople.customer1 },
  { id: 'cm8', companyId: 'company1', personId: 'customer2', role: 'customer', status: 'active', createdAt: '2026-07-25T09:00:00Z', updatedAt: '2026-07-25T09:00:00Z', person: mockPeople.customer2 },
  { id: 'cm9', companyId: 'company1', personId: 'customer3', role: 'customer', status: 'active', createdAt: '2026-05-20T13:00:00Z', updatedAt: '2026-05-20T13:00:00Z', person: mockPeople.customer3 },
  { id: 'cm10', companyId: 'company1', personId: 'customer4', role: 'customer', status: 'active', createdAt: '2026-03-28T10:00:00Z', updatedAt: '2026-03-28T10:00:00Z', person: mockPeople.customer4 },
  { id: 'cm11', companyId: 'company1', personId: 'customer5', role: 'customer', status: 'invited', createdAt: '2026-08-01T14:00:00Z', updatedAt: '2026-08-01T14:00:00Z', person: mockPeople.customer5 },
];

// ── Trucks ──────────────────────────────────────────────────────

export const mockTrucks: Truck[] = [
  { id: 'truck1', companyId: 'company1', name: 'Truck #1', make: 'Ford', model: 'F-250', year: 2022, licensePlate: 'OH-BLL-101', color: 'White', photoUrl: 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=400&q=80', status: 'assigned', notes: 'Primary crew truck', createdAt: '2024-02-01T10:00:00Z', updatedAt: '2026-09-07T06:00:00Z', assignedTo: 'worker1', assigneeName: 'Marcus Rivera' },
  { id: 'truck2', companyId: 'company1', name: 'Truck #2', make: 'Chevrolet', model: 'Silverado 1500', year: 2021, licensePlate: 'OH-BLL-102', color: 'Silver', photoUrl: 'https://images.unsplash.com/photo-1601362840469-51e4d8d58785?w=400&q=80', status: 'assigned', createdAt: '2024-02-01T10:00:00Z', updatedAt: '2026-09-07T06:00:00Z', assignedTo: 'worker3', assigneeName: 'Deshawn Williams' },
  { id: 'truck3', companyId: 'company1', name: 'Truck #3', make: 'Ram', model: '1500', year: 2023, licensePlate: 'OH-BLL-103', color: 'Black', photoUrl: 'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=400&q=80', status: 'available', createdAt: '2025-01-15T10:00:00Z', updatedAt: '2026-09-06T08:00:00Z' },
  { id: 'truck4', companyId: 'company1', name: 'Trailer', make: 'Big Tex', model: '70PI-18', year: 2020, licensePlate: 'OH-BLL-T01', status: 'maintenance', notes: 'Axle repair — ETA back 9/10', createdAt: '2024-06-01T10:00:00Z', updatedAt: '2026-09-05T08:00:00Z' },
];

// ── Assignments (daily work schedule) ───────────────────────────

const today = new Date().toISOString().split('T')[0];

function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export const mockAssignments: Assignment[] = [
  // ── Today ──
  {
    id: 'a1', companyId: 'company1', projectId: 'proj1', personId: 'worker1',
    scheduledDate: today, startTime: '07:00', endTime: '15:00',
    isFullDay: false, sortOrder: 1, status: 'scheduled', confirmationState: 'confirmed',
    truckId: 'truck1',
    createdAt: '2026-09-06T18:00:00Z', updatedAt: '2026-09-06T18:00:00Z',
    person: mockPeople.worker1,
    project: { id: 'proj1', name: 'Beachwood Residence', address: '142 Beachwood Dr' },
    truck: { id: 'truck1', name: 'Truck #1' },
  },
  {
    id: 'a2', companyId: 'company1', projectId: 'proj1', personId: 'worker2',
    scheduledDate: today, startTime: '07:00', endTime: '12:00',
    isFullDay: false, sortOrder: 1, status: 'scheduled', confirmationState: 'awaiting',
    createdAt: '2026-09-06T18:00:00Z', updatedAt: '2026-09-06T18:00:00Z',
    person: mockPeople.worker2,
    project: { id: 'proj1', name: 'Beachwood Residence', address: '142 Beachwood Dr' },
  },
  {
    id: 'a3', companyId: 'company1', projectId: 'proj3', personId: 'worker2',
    scheduledDate: today, startTime: '13:00', endTime: '17:00',
    isFullDay: false, sortOrder: 2, status: 'scheduled', confirmationState: 'awaiting',
    createdAt: '2026-09-06T18:30:00Z', updatedAt: '2026-09-06T18:30:00Z',
    person: mockPeople.worker2,
    project: { id: 'proj3', name: 'Greenwood Estate', address: '2100 Greenwood Ave' },
  },
  {
    id: 'a4', companyId: 'company1', projectId: 'proj2', personId: 'worker3',
    scheduledDate: today, startTime: '07:30', endTime: '16:00',
    isFullDay: false, sortOrder: 1, status: 'scheduled', confirmationState: 'confirmed',
    truckId: 'truck2',
    createdAt: '2026-09-06T18:00:00Z', updatedAt: '2026-09-06T18:00:00Z',
    person: mockPeople.worker3,
    project: { id: 'proj2', name: 'Chen Property', address: '890 Overlook Rd' },
    truck: { id: 'truck2', name: 'Truck #2' },
  },
  {
    id: 'a5', companyId: 'company1', projectId: 'proj3', personId: 'worker4',
    scheduledDate: today, isFullDay: true, sortOrder: 1,
    status: 'scheduled', confirmationState: 'confirmed',
    notes: 'Finish fire pit stone work',
    createdAt: '2026-09-06T18:00:00Z', updatedAt: '2026-09-06T19:00:00Z',
    person: mockPeople.worker4,
    project: { id: 'proj3', name: 'Greenwood Estate', address: '2100 Greenwood Ave' },
  },

  // ── Tomorrow ──
  {
    id: 'a6', companyId: 'company1', projectId: 'proj2', personId: 'worker1',
    scheduledDate: offsetDate(1), startTime: '08:00', endTime: '16:00',
    isFullDay: false, sortOrder: 1, status: 'scheduled', confirmationState: 'not_sent',
    truckId: 'truck1',
    createdAt: '2026-09-06T20:00:00Z', updatedAt: '2026-09-06T20:00:00Z',
    person: mockPeople.worker1,
    project: { id: 'proj2', name: 'Chen Property', address: '890 Overlook Rd' },
    truck: { id: 'truck1', name: 'Truck #1' },
  },
  {
    id: 'a7', companyId: 'company1', projectId: 'proj1', personId: 'worker3',
    scheduledDate: offsetDate(1), startTime: '07:00', endTime: '15:00',
    isFullDay: false, sortOrder: 1, status: 'scheduled', confirmationState: 'not_sent',
    truckId: 'truck2',
    createdAt: '2026-09-06T20:00:00Z', updatedAt: '2026-09-06T20:00:00Z',
    person: mockPeople.worker3,
    project: { id: 'proj1', name: 'Beachwood Residence', address: '142 Beachwood Dr' },
    truck: { id: 'truck2', name: 'Truck #2' },
  },
  {
    id: 'a8', companyId: 'company1', projectId: 'proj3', personId: 'worker2',
    scheduledDate: offsetDate(1), isFullDay: true, sortOrder: 1,
    status: 'scheduled', confirmationState: 'not_sent',
    createdAt: '2026-09-06T20:00:00Z', updatedAt: '2026-09-06T20:00:00Z',
    person: mockPeople.worker2,
    project: { id: 'proj3', name: 'Greenwood Estate', address: '2100 Greenwood Ave' },
  },

  // ── Day after tomorrow ──
  {
    id: 'a9', companyId: 'company1', projectId: 'proj3', personId: 'worker1',
    scheduledDate: offsetDate(2), startTime: '08:00', endTime: '14:00',
    isFullDay: false, sortOrder: 1, status: 'scheduled', confirmationState: 'not_sent',
    truckId: 'truck1',
    createdAt: '2026-09-06T20:00:00Z', updatedAt: '2026-09-06T20:00:00Z',
    person: mockPeople.worker1,
    project: { id: 'proj3', name: 'Greenwood Estate', address: '2100 Greenwood Ave' },
    truck: { id: 'truck1', name: 'Truck #1' },
  },
  {
    id: 'a10', companyId: 'company1', projectId: 'proj2', personId: 'worker4',
    scheduledDate: offsetDate(2), isFullDay: true, sortOrder: 1,
    status: 'scheduled', confirmationState: 'not_sent',
    createdAt: '2026-09-06T20:00:00Z', updatedAt: '2026-09-06T20:00:00Z',
    person: mockPeople.worker4,
    project: { id: 'proj2', name: 'Chen Property', address: '890 Overlook Rd' },
  },

  // ── Yesterday (completed) ──
  {
    id: 'a11', companyId: 'company1', projectId: 'proj1', personId: 'worker1',
    scheduledDate: offsetDate(-1), startTime: '07:00', endTime: '15:00',
    isFullDay: false, sortOrder: 1, status: 'completed', confirmationState: 'confirmed',
    truckId: 'truck1',
    createdAt: '2026-09-05T18:00:00Z', updatedAt: '2026-09-06T15:00:00Z',
    person: mockPeople.worker1,
    project: { id: 'proj1', name: 'Beachwood Residence', address: '142 Beachwood Dr' },
    truck: { id: 'truck1', name: 'Truck #1' },
  },
  {
    id: 'a12', companyId: 'company1', projectId: 'proj3', personId: 'worker2',
    scheduledDate: offsetDate(-1), isFullDay: true, sortOrder: 1,
    status: 'completed', confirmationState: 'confirmed',
    createdAt: '2026-09-05T18:00:00Z', updatedAt: '2026-09-06T17:00:00Z',
    person: mockPeople.worker2,
    project: { id: 'proj3', name: 'Greenwood Estate', address: '2100 Greenwood Ave' },
  },

  // ── Earlier this week (completed) — for Worker Activity history ──
  {
    id: 'a13', companyId: 'company1', projectId: 'proj2', personId: 'worker1',
    scheduledDate: offsetDate(-2), startTime: '08:00', endTime: '14:30',
    isFullDay: false, sortOrder: 1, status: 'completed', confirmationState: 'confirmed',
    truckId: 'truck1',
    createdAt: '2026-09-04T18:00:00Z', updatedAt: '2026-09-16T14:25:00Z',
    person: mockPeople.worker1,
    project: { id: 'proj2', name: 'Chen Property', address: '890 Overlook Rd' },
    truck: { id: 'truck1', name: 'Truck #1' },
  },
  {
    id: 'a14', companyId: 'company1', projectId: 'proj3', personId: 'worker1',
    scheduledDate: offsetDate(-3), startTime: '07:00', endTime: '11:00',
    isFullDay: false, sortOrder: 1, status: 'completed', confirmationState: 'confirmed',
    truckId: 'truck1',
    createdAt: '2026-09-03T18:00:00Z', updatedAt: '2026-09-15T11:10:00Z',
    person: mockPeople.worker1,
    project: { id: 'proj3', name: 'Greenwood Estate', address: '2100 Greenwood Ave' },
    truck: { id: 'truck1', name: 'Truck #1' },
  },
  {
    id: 'a15', companyId: 'company1', projectId: 'proj1', personId: 'worker1',
    scheduledDate: offsetDate(-3), startTime: '12:00', endTime: '16:15',
    isFullDay: false, sortOrder: 2, status: 'completed', confirmationState: 'confirmed',
    createdAt: '2026-09-03T18:00:00Z', updatedAt: '2026-09-15T16:20:00Z',
    person: mockPeople.worker1,
    project: { id: 'proj1', name: 'Beachwood Residence', address: '142 Beachwood Dr' },
  },
];

export const mockScheduleChanges: ScheduleChange[] = [
  {
    id: 'sc1', assignmentId: 'a1', companyId: 'company1', changedBy: 'owner1',
    changeType: 'created',
    newValue: JSON.stringify({ project: 'Beachwood Residence', time: '07:00–15:00' }),
    createdAt: '2026-09-06T18:00:00Z', changer: mockPeople.owner1,
  },
  {
    id: 'sc2', assignmentId: 'a2', companyId: 'company1', changedBy: 'owner1',
    changeType: 'created',
    newValue: JSON.stringify({ project: 'Beachwood Residence', time: '07:00–12:00' }),
    createdAt: '2026-09-06T18:00:00Z', changer: mockPeople.owner1,
  },
  {
    id: 'sc3', assignmentId: 'a3', companyId: 'company1', changedBy: 'owner1',
    changeType: 'created',
    newValue: JSON.stringify({ project: 'Greenwood Estate', time: '13:00–17:00' }),
    notes: 'Added second job for Tyler',
    createdAt: '2026-09-06T18:30:00Z', changer: mockPeople.owner1,
  },
  {
    id: 'sc4', assignmentId: 'a5', companyId: 'company1', changedBy: 'owner1',
    changeType: 'time_changed',
    previousValue: JSON.stringify({ startTime: '08:00', endTime: '14:00', isFullDay: false }),
    newValue: JSON.stringify({ isFullDay: true }),
    notes: 'Changed to full day — more stone work needed',
    createdAt: '2026-09-06T19:00:00Z', changer: mockPeople.owner1,
  },
];

// ── Announcements ───────────────────────────────────────────────

export const mockAnnouncements: Announcement[] = [
  {
    id: 'ann1', companyId: 'company1', createdBy: 'owner1',
    title: 'Early start tomorrow — 6:30 AM',
    body: 'Big delivery coming for the Beachwood project. Everyone on the Beachwood crew needs to be on site by 6:30 AM sharp.',
    audience: 'all_workers', priority: 'urgent',
    createdAt: '2026-09-06T20:00:00Z', updatedAt: '2026-09-06T20:00:00Z',
    author: mockPeople.owner1, readCount: 3, totalRecipients: 4,
  },
  {
    id: 'ann2', companyId: 'company1', createdBy: 'owner1',
    title: 'Safety reminder: hydration',
    body: 'With temperatures forecasted above 90 this week, make sure you are drinking water every 20 minutes and taking shade breaks. We have extra coolers at the shop.',
    audience: 'all_workers', priority: 'normal',
    createdAt: '2026-09-05T08:00:00Z', updatedAt: '2026-09-05T08:00:00Z',
    author: mockPeople.owner1, readCount: 4, totalRecipients: 4,
  },
  {
    id: 'ann3', companyId: 'company1', createdBy: 'owner1',
    title: 'New truck arriving next week',
    body: 'We have a new 2026 Ford F-350 arriving Monday. Carlos will be assigned to it.',
    audience: 'all_workers', priority: 'normal',
    createdAt: '2026-09-03T14:00:00Z', updatedAt: '2026-09-03T14:00:00Z',
    author: mockPeople.owner1, readCount: 4, totalRecipients: 4,
  },
];

// Per-worker read receipts backing each announcement's readCount above.
// worker1 (Marcus) has not read ann1 yet, so Worker Today has something to surface.
export const mockAnnouncementReads: AnnouncementRead[] = [
  { id: 'ar1', announcementId: 'ann1', personId: 'worker2', readAt: '2026-09-06T20:30:00Z' },
  { id: 'ar2', announcementId: 'ann1', personId: 'worker3', readAt: '2026-09-06T21:00:00Z' },
  { id: 'ar3', announcementId: 'ann1', personId: 'worker4', readAt: '2026-09-07T06:00:00Z' },
  { id: 'ar4', announcementId: 'ann2', personId: 'worker1', readAt: '2026-09-05T09:00:00Z' },
  { id: 'ar5', announcementId: 'ann2', personId: 'worker2', readAt: '2026-09-05T09:10:00Z' },
  { id: 'ar6', announcementId: 'ann2', personId: 'worker3', readAt: '2026-09-05T09:20:00Z' },
  { id: 'ar7', announcementId: 'ann2', personId: 'worker4', readAt: '2026-09-05T09:30:00Z' },
  { id: 'ar8', announcementId: 'ann3', personId: 'worker1', readAt: '2026-09-03T15:00:00Z' },
  { id: 'ar9', announcementId: 'ann3', personId: 'worker2', readAt: '2026-09-03T15:10:00Z' },
  { id: 'ar10', announcementId: 'ann3', personId: 'worker3', readAt: '2026-09-03T15:20:00Z' },
  { id: 'ar11', announcementId: 'ann3', personId: 'worker4', readAt: '2026-09-03T15:30:00Z' },
];

// ── Projects ────────────────────────────────────────────────────

export const mockProjects: Project[] = [
  {
    id: 'proj1',
    companyId: 'company1',
    customerId: 'customer1',
    name: 'Beachwood Residence',
    address: '142 Beachwood Dr',
    city: 'Cleveland Heights',
    state: 'OH',
    zip: '44122',
    status: 'active',
    progress: 65,
    startDate: '2026-07-15',
    estimatedEndDate: '2026-10-01',
    notes: 'Full backyard redesign with patio and retaining wall. Customer wants natural stone.',
    createdAt: '2026-07-10T10:00:00Z',
    updatedAt: '2026-09-05T14:30:00Z',
    customer: mockPeople.customer1,
    teamCount: 3,
    taskCount: 12,
    openTaskCount: 4,
    customerProjectCode: 'BEACH142',
    customerClaimedBy: 'customer1',
    customerClaimedAt: '2026-07-11T09:00:00Z',
  },
  {
    id: 'proj2',
    companyId: 'company1',
    customerId: 'customer2',
    name: 'Chen Property',
    address: '890 Overlook Rd',
    city: 'Lakewood',
    state: 'OH',
    zip: '44107',
    status: 'active',
    progress: 32,
    startDate: '2026-08-01',
    estimatedEndDate: '2026-11-15',
    notes: 'Front yard renovation + new irrigation system',
    createdAt: '2026-07-25T09:00:00Z',
    updatedAt: '2026-09-04T11:00:00Z',
    customer: mockPeople.customer2,
    teamCount: 2,
    taskCount: 8,
    openTaskCount: 5,
    customerProjectCode: 'CHEN8901',
    customerClaimedBy: 'customer2',
    customerClaimedAt: '2026-07-26T10:00:00Z',
  },
  {
    id: 'proj3',
    companyId: 'company1',
    customerId: 'customer3',
    name: 'Greenwood Estate',
    address: '2100 Greenwood Ave',
    city: 'Shaker Heights',
    state: 'OH',
    zip: '44122',
    status: 'active',
    progress: 81,
    startDate: '2026-06-01',
    estimatedEndDate: '2026-09-15',
    notes: 'Large property. Outdoor living space + fire pit area.',
    createdAt: '2026-05-20T13:00:00Z',
    updatedAt: '2026-09-06T16:45:00Z',
    customer: mockPeople.customer3,
    teamCount: 4,
    taskCount: 15,
    openTaskCount: 3,
    customerProjectCode: 'GREEN210',
    customerClaimedBy: 'customer3',
    customerClaimedAt: '2026-05-21T14:00:00Z',
  },
  {
    id: 'proj4',
    companyId: 'company1',
    customerId: 'customer4',
    name: 'Thompson Weekly Maintenance',
    address: '567 Elm St',
    city: 'Rocky River',
    state: 'OH',
    zip: '44116',
    status: 'active',
    progress: 0,
    startDate: '2026-04-01',
    notes: 'Recurring weekly mowing and edging',
    createdAt: '2026-03-28T10:00:00Z',
    updatedAt: '2026-09-06T08:00:00Z',
    customer: mockPeople.customer4,
    teamCount: 1,
    taskCount: 0,
    openTaskCount: 0,
    customerProjectCode: 'THOMP567',
  },
  {
    id: 'proj5',
    companyId: 'company1',
    customerId: 'customer5',
    name: 'Park Residence Drainage',
    address: '334 Hilltop Ln',
    city: 'Bay Village',
    state: 'OH',
    zip: '44140',
    status: 'on_hold',
    progress: 15,
    startDate: '2026-08-10',
    estimatedEndDate: '2026-10-30',
    notes: 'French drain + grading. On hold — waiting for permit approval.',
    createdAt: '2026-08-01T14:00:00Z',
    updatedAt: '2026-08-20T09:00:00Z',
    customer: mockPeople.customer5,
    teamCount: 2,
    taskCount: 6,
    openTaskCount: 5,
  },
  {
    id: 'proj6',
    companyId: 'company1',
    customerId: 'customer1',
    name: 'Mitchell Front Walkway',
    address: '142 Beachwood Dr',
    city: 'Cleveland Heights',
    state: 'OH',
    zip: '44122',
    status: 'completed',
    progress: 100,
    startDate: '2026-03-01',
    estimatedEndDate: '2026-05-01',
    completedAt: '2026-04-28T15:00:00Z',
    notes: 'Flagstone walkway with border plantings',
    createdAt: '2026-02-15T10:00:00Z',
    updatedAt: '2026-04-28T15:00:00Z',
    customer: mockPeople.customer1,
    teamCount: 2,
    taskCount: 8,
    openTaskCount: 0,
    customerProjectCode: 'MITCH142',
    customerClaimedBy: 'customer1',
    customerClaimedAt: '2026-02-16T11:00:00Z',
  },
  {
    id: 'proj7',
    companyId: 'company1',
    customerId: 'customer4',
    name: 'Thompson Spring Cleanup',
    address: '567 Elm St',
    city: 'Rocky River',
    state: 'OH',
    zip: '44116',
    status: 'completed',
    progress: 100,
    startDate: '2026-03-15',
    estimatedEndDate: '2026-04-15',
    completedAt: '2026-04-10T12:00:00Z',
    createdAt: '2026-03-10T09:00:00Z',
    updatedAt: '2026-04-10T12:00:00Z',
    customer: mockPeople.customer4,
    teamCount: 2,
    taskCount: 5,
    openTaskCount: 0,
  },
];

// ── Project Tasks (for proj1 — Beachwood Residence) ─────────────

export const mockTasks: Record<string, ProjectTask[]> = {
  proj1: [
    { id: 't1', projectId: 'proj1', title: 'Demo existing patio', status: 'completed', sortOrder: 1, completedAt: '2026-07-20T16:00:00Z', createdAt: '2026-07-10T10:00:00Z', updatedAt: '2026-07-20T16:00:00Z' },
    { id: 't2', projectId: 'proj1', title: 'Grade and compact sub-base', status: 'completed', sortOrder: 2, completedAt: '2026-07-25T14:00:00Z', createdAt: '2026-07-10T10:00:00Z', updatedAt: '2026-07-25T14:00:00Z' },
    { id: 't3', projectId: 'proj1', title: 'Install retaining wall footings', status: 'completed', sortOrder: 3, completedAt: '2026-08-02T15:00:00Z', createdAt: '2026-07-10T10:00:00Z', updatedAt: '2026-08-02T15:00:00Z' },
    { id: 't4', projectId: 'proj1', title: 'Build retaining wall', status: 'completed', sortOrder: 4, assignedTo: 'worker1', completedAt: '2026-08-15T17:00:00Z', assignee: mockPeople.worker1, createdAt: '2026-07-10T10:00:00Z', updatedAt: '2026-08-15T17:00:00Z' },
    { id: 't5', projectId: 'proj1', title: 'Lay paver base and sand', status: 'completed', sortOrder: 5, completedAt: '2026-08-22T14:00:00Z', createdAt: '2026-07-10T10:00:00Z', updatedAt: '2026-08-22T14:00:00Z' },
    { id: 't6', projectId: 'proj1', title: 'Install natural stone pavers', status: 'completed', sortOrder: 6, assignedTo: 'worker1', completedAt: '2026-08-30T16:00:00Z', assignee: mockPeople.worker1, createdAt: '2026-07-10T10:00:00Z', updatedAt: '2026-08-30T16:00:00Z' },
    { id: 't7', projectId: 'proj1', title: 'Set border stones and edging', status: 'completed', sortOrder: 7, completedAt: '2026-09-02T15:00:00Z', createdAt: '2026-07-10T10:00:00Z', updatedAt: '2026-09-02T15:00:00Z' },
    { id: 't8', projectId: 'proj1', title: 'Polymeric sand joints', status: 'completed', sortOrder: 8, completedAt: '2026-09-04T11:00:00Z', createdAt: '2026-07-10T10:00:00Z', updatedAt: '2026-09-04T11:00:00Z' },
    { id: 't9', projectId: 'proj1', title: 'Install landscape lighting', status: 'in_progress', sortOrder: 9, assignedTo: 'worker2', assignee: mockPeople.worker2, createdAt: '2026-07-10T10:00:00Z', updatedAt: '2026-09-05T10:00:00Z' },
    { id: 't10', projectId: 'proj1', title: 'Plant perennial border', status: 'pending', sortOrder: 10, createdAt: '2026-07-10T10:00:00Z', updatedAt: '2026-07-10T10:00:00Z' },
    { id: 't11', projectId: 'proj1', title: 'Mulch and top-dress beds', status: 'pending', sortOrder: 11, createdAt: '2026-07-10T10:00:00Z', updatedAt: '2026-07-10T10:00:00Z' },
    { id: 't12', projectId: 'proj1', title: 'Final cleanup and walkthrough', status: 'pending', sortOrder: 12, createdAt: '2026-07-10T10:00:00Z', updatedAt: '2026-07-10T10:00:00Z' },
  ],
  proj2: [
    { id: 't20', projectId: 'proj2', title: 'Remove old sod and shrubs', status: 'completed', sortOrder: 1, completedAt: '2026-08-10T14:00:00Z', createdAt: '2026-08-01T09:00:00Z', updatedAt: '2026-08-10T14:00:00Z' },
    { id: 't21', projectId: 'proj2', title: 'Trench for irrigation lines', status: 'completed', sortOrder: 2, completedAt: '2026-08-18T16:00:00Z', createdAt: '2026-08-01T09:00:00Z', updatedAt: '2026-08-18T16:00:00Z' },
    { id: 't22', projectId: 'proj2', title: 'Install irrigation system', status: 'in_progress', sortOrder: 3, assignedTo: 'worker3', assignee: mockPeople.worker3, createdAt: '2026-08-01T09:00:00Z', updatedAt: '2026-09-04T11:00:00Z' },
    { id: 't23', projectId: 'proj2', title: 'Amend soil and grade', status: 'pending', sortOrder: 4, createdAt: '2026-08-01T09:00:00Z', updatedAt: '2026-08-01T09:00:00Z' },
    { id: 't24', projectId: 'proj2', title: 'Install new sod', status: 'pending', sortOrder: 5, createdAt: '2026-08-01T09:00:00Z', updatedAt: '2026-08-01T09:00:00Z' },
    { id: 't25', projectId: 'proj2', title: 'Plant foundation shrubs', status: 'pending', sortOrder: 6, createdAt: '2026-08-01T09:00:00Z', updatedAt: '2026-08-01T09:00:00Z' },
    { id: 't26', projectId: 'proj2', title: 'Edge beds and mulch', status: 'pending', sortOrder: 7, createdAt: '2026-08-01T09:00:00Z', updatedAt: '2026-08-01T09:00:00Z' },
    { id: 't27', projectId: 'proj2', title: 'Final walkthrough', status: 'pending', sortOrder: 8, createdAt: '2026-08-01T09:00:00Z', updatedAt: '2026-08-01T09:00:00Z' },
  ],
};

// ── Project Team ────────────────────────────────────────────────

export const mockTeam: Record<string, ProjectTeamMember[]> = {
  proj1: [
    { id: 'tm1', projectId: 'proj1', personId: 'worker1', addedAt: '2026-07-10T10:00:00Z', person: mockPeople.worker1 },
    { id: 'tm2', projectId: 'proj1', personId: 'worker2', addedAt: '2026-07-10T10:00:00Z', person: mockPeople.worker2 },
    { id: 'tm3', projectId: 'proj1', personId: 'worker3', addedAt: '2026-08-01T08:00:00Z', person: mockPeople.worker3 },
  ],
  proj2: [
    { id: 'tm4', projectId: 'proj2', personId: 'worker1', addedAt: '2026-08-01T09:00:00Z', person: mockPeople.worker1 },
    { id: 'tm5', projectId: 'proj2', personId: 'worker3', addedAt: '2026-08-01T09:00:00Z', person: mockPeople.worker3 },
  ],
  proj3: [
    { id: 'tm6', projectId: 'proj3', personId: 'worker1', addedAt: '2026-06-01T08:00:00Z', person: mockPeople.worker1 },
    { id: 'tm7', projectId: 'proj3', personId: 'worker2', addedAt: '2026-06-01T08:00:00Z', person: mockPeople.worker2 },
    { id: 'tm8', projectId: 'proj3', personId: 'worker3', addedAt: '2026-06-15T08:00:00Z', person: mockPeople.worker3 },
  ],
};

// ── Project History (for proj1) ─────────────────────────────────

export const mockHistory: Record<string, ProjectHistoryEntry[]> = {
  proj1: [
    { id: 'h1', projectId: 'proj1', actorId: 'owner1', eventType: 'project_created', description: 'Project created', createdAt: '2026-07-10T10:00:00Z', actor: mockPeople.owner1 },
    { id: 'h2', projectId: 'proj1', actorId: 'owner1', eventType: 'team_member_added', description: 'Added Marcus Rivera to project team', createdAt: '2026-07-10T10:05:00Z', actor: mockPeople.owner1 },
    { id: 'h3', projectId: 'proj1', actorId: 'owner1', eventType: 'team_member_added', description: 'Added Tyler Brooks to project team', createdAt: '2026-07-10T10:05:00Z', actor: mockPeople.owner1 },
    { id: 'h4', projectId: 'proj1', actorId: 'owner1', eventType: 'progress_updated', description: 'Progress updated to 15%', metadata: { from: 0, to: 15 }, createdAt: '2026-07-22T09:00:00Z', actor: mockPeople.owner1 },
    { id: 'h5', projectId: 'proj1', actorId: 'owner1', eventType: 'task_completed', description: 'Completed: Demo existing patio', createdAt: '2026-07-20T16:00:00Z', actor: mockPeople.owner1 },
    { id: 'h6', projectId: 'proj1', actorId: 'owner1', eventType: 'progress_updated', description: 'Progress updated to 35%', metadata: { from: 15, to: 35 }, createdAt: '2026-08-05T09:00:00Z', actor: mockPeople.owner1 },
    { id: 'h7', projectId: 'proj1', actorId: 'owner1', eventType: 'team_member_added', description: 'Added Deshawn Williams to project team', createdAt: '2026-08-01T08:00:00Z', actor: mockPeople.owner1 },
    { id: 'h8', projectId: 'proj1', actorId: 'owner1', eventType: 'update_posted', description: 'Posted update: "Retaining wall complete"', createdAt: '2026-08-16T10:00:00Z', actor: mockPeople.owner1 },
    { id: 'h9', projectId: 'proj1', actorId: 'owner1', eventType: 'progress_updated', description: 'Progress updated to 65%', metadata: { from: 35, to: 65 }, createdAt: '2026-09-05T14:30:00Z', actor: mockPeople.owner1 },
  ],
};

// ── Project Updates ─────────────────────────────────────────────

export const mockUpdates: Record<string, ProjectUpdate[]> = {
  proj1: [
    {
      id: 'u1', projectId: 'proj1', createdBy: 'owner1', title: 'Retaining wall complete',
      body: 'The retaining wall is finished and looking great. We used natural Pennsylvania fieldstone as discussed. Next up is the paver installation.',
      isCustomerVisible: true, createdAt: '2026-08-16T10:00:00Z', updatedAt: '2026-08-16T10:00:00Z', author: mockPeople.owner1,
    },
    {
      id: 'u2', projectId: 'proj1', createdBy: 'owner1', title: 'Pavers laid — joints tomorrow',
      body: 'All the natural stone pavers are in place. Tomorrow we will finish the polymeric sand joints and then move on to lighting and planting.',
      isCustomerVisible: true, createdAt: '2026-09-03T17:00:00Z', updatedAt: '2026-09-03T17:00:00Z', author: mockPeople.owner1,
    },
  ],
};

// ── Project Requests ────────────────────────────────────────────

export const mockRequests: Record<string, ProjectRequest[]> = {
  proj1: [
    {
      id: 'r1', projectId: 'proj1', requestedBy: 'customer1', title: 'Add solar lights along walkway',
      description: 'Can we add some solar pathway lights along the new walkway? Something subtle and modern.',
      category: 'additional_work',
      status: 'acknowledged', respondedAt: '2026-09-02T11:00:00Z', responseNote: 'Great idea — we can incorporate these into the lighting plan.',
      createdAt: '2026-09-01T20:00:00Z', updatedAt: '2026-09-02T11:00:00Z', requester: mockPeople.customer1,
    },
    {
      id: 'r2', projectId: 'proj1', requestedBy: 'customer1', title: 'Can we change the mulch color?',
      description: 'I was thinking dark brown instead of the red mulch we discussed. Is it too late to switch?',
      category: 'change_request',
      status: 'pending',
      createdAt: '2026-09-06T14:00:00Z', updatedAt: '2026-09-06T14:00:00Z', requester: mockPeople.customer1,
    },
    {
      id: 'r3', projectId: 'proj1', requestedBy: 'customer1', title: 'Timeline question',
      description: 'Are we still on track for the October 1st completion?',
      category: 'question',
      status: 'pending',
      createdAt: '2026-09-07T09:00:00Z', updatedAt: '2026-09-07T09:00:00Z', requester: mockPeople.customer1,
    },
  ],
  proj2: [
    {
      id: 'r4', projectId: 'proj2', requestedBy: 'customer2', title: 'Add drip line to garden bed',
      description: 'While the irrigation is going in, could we add a drip line to the existing garden bed on the east side?',
      category: 'additional_work',
      status: 'converted', linkedTaskId: 't22',
      respondedAt: '2026-09-03T10:00:00Z', responseNote: 'Added to the irrigation task — no extra cost since we are already trenching nearby.',
      createdAt: '2026-09-02T18:00:00Z', updatedAt: '2026-09-03T10:00:00Z', requester: mockPeople.customer2,
    },
  ],
};

// ── Project Settings ────────────────────────────────────────────

export const mockSettings: Record<string, ProjectSettings> = {
  proj1: {
    id: 'ps1', projectId: 'proj1', customerInteractionEnabled: true,
    completionPhotoRequired: true, checkinRadiusMeters: 150,
    customerCanRequest: true, customerCanViewPhotos: true, customerCanComment: true,
    createdAt: '2026-07-10T10:00:00Z', updatedAt: '2026-07-10T10:00:00Z',
  },
  proj2: {
    id: 'ps2', projectId: 'proj2', customerInteractionEnabled: true,
    completionPhotoRequired: false, customerCanRequest: true,
    customerCanViewPhotos: true, customerCanComment: true,
    createdAt: '2026-08-01T09:00:00Z', updatedAt: '2026-08-01T09:00:00Z',
  },
  proj3: {
    id: 'ps3', projectId: 'proj3', customerInteractionEnabled: true,
    completionPhotoRequired: true, checkinRadiusMeters: 200,
    customerCanRequest: true, customerCanViewPhotos: false, customerCanComment: true,
    createdAt: '2026-05-20T13:00:00Z', updatedAt: '2026-05-20T13:00:00Z',
  },
  proj6: {
    id: 'ps6', projectId: 'proj6', customerInteractionEnabled: false,
    completionPhotoRequired: false, customerCanRequest: false,
    customerCanViewPhotos: true, customerCanComment: false,
    createdAt: '2026-02-15T10:00:00Z', updatedAt: '2026-04-28T15:00:00Z',
  },
};

// ── Worker Activity Feed ───────────────────────────────────────

export const mockWorkerActivities: WorkerActivity[] = [
  {
    id: 'wa1', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a11', projectId: 'proj1',
    activityType: 'checked_in', description: 'Checked in at Beachwood Residence',
    timestamp: offsetDate(-1) + 'T07:05:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
  {
    id: 'wa2', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a11', projectId: 'proj1',
    activityType: 'task_started', description: 'Started: Set border stones and edging',
    timestamp: offsetDate(-1) + 'T07:15:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
  {
    id: 'wa3', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a11', projectId: 'proj1',
    activityType: 'task_completed', description: 'Completed: Set border stones and edging',
    timestamp: offsetDate(-1) + 'T11:30:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
  {
    id: 'wa4', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a11', projectId: 'proj1',
    activityType: 'photo_taken', description: 'Photo: Border stones complete',
    timestamp: offsetDate(-1) + 'T11:32:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
  {
    id: 'wa5', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a11', projectId: 'proj1',
    activityType: 'task_started', description: 'Started: Polymeric sand joints',
    timestamp: offsetDate(-1) + 'T12:00:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
  {
    id: 'wa6', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a11', projectId: 'proj1',
    activityType: 'task_completed', description: 'Completed: Polymeric sand joints',
    timestamp: offsetDate(-1) + 'T14:30:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
  {
    id: 'wa7', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a11', projectId: 'proj1',
    activityType: 'checked_out', description: 'Checked out from Beachwood Residence',
    timestamp: offsetDate(-1) + 'T15:02:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
  {
    id: 'wa8', personId: 'worker1', companyId: 'company1',
    activityType: 'schedule_confirmed', description: 'Confirmed schedule for today',
    timestamp: offsetDate(-1) + 'T20:30:00Z',
  },

  // ── Tuesday: Chen Property (a13) ──
  {
    id: 'wa9', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a13', projectId: 'proj2',
    activityType: 'checked_in', description: 'Checked in at Chen Property',
    timestamp: offsetDate(-2) + 'T08:05:00Z',
    project: { id: 'proj2', name: 'Chen Property' },
  },
  {
    id: 'wa10', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a13', projectId: 'proj2',
    activityType: 'task_started', description: 'Started: Remove old sod and shrubs',
    timestamp: offsetDate(-2) + 'T08:15:00Z',
    project: { id: 'proj2', name: 'Chen Property' },
  },
  {
    id: 'wa11', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a13', projectId: 'proj2',
    activityType: 'task_completed', description: 'Completed: Remove old sod and shrubs',
    timestamp: offsetDate(-2) + 'T09:30:00Z',
    project: { id: 'proj2', name: 'Chen Property' },
  },
  {
    id: 'wa12', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a13', projectId: 'proj2',
    activityType: 'photo_taken', description: 'Photo: Old sod removed',
    timestamp: offsetDate(-2) + 'T09:32:00Z',
    project: { id: 'proj2', name: 'Chen Property' },
  },
  {
    id: 'wa13', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a13', projectId: 'proj2',
    activityType: 'task_started', description: 'Started: Trench for irrigation lines',
    timestamp: offsetDate(-2) + 'T10:00:00Z',
    project: { id: 'proj2', name: 'Chen Property' },
  },
  {
    id: 'wa14', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a13', projectId: 'proj2',
    activityType: 'task_completed', description: 'Completed: Trench for irrigation lines',
    timestamp: offsetDate(-2) + 'T12:00:00Z',
    project: { id: 'proj2', name: 'Chen Property' },
  },
  {
    id: 'wa15', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a13', projectId: 'proj2',
    activityType: 'photo_taken', description: 'Photo: Irrigation trenches dug',
    timestamp: offsetDate(-2) + 'T12:05:00Z',
    project: { id: 'proj2', name: 'Chen Property' },
  },
  {
    id: 'wa16', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a13', projectId: 'proj2',
    activityType: 'task_started', description: 'Started: Install irrigation system',
    timestamp: offsetDate(-2) + 'T12:30:00Z',
    project: { id: 'proj2', name: 'Chen Property' },
  },
  {
    id: 'wa17', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a13', projectId: 'proj2',
    activityType: 'task_completed', description: 'Completed: Install irrigation system',
    timestamp: offsetDate(-2) + 'T13:45:00Z',
    project: { id: 'proj2', name: 'Chen Property' },
  },
  {
    id: 'wa18', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a13', projectId: 'proj2',
    activityType: 'photo_taken', description: 'Photo: Irrigation system installed',
    timestamp: offsetDate(-2) + 'T13:50:00Z',
    project: { id: 'proj2', name: 'Chen Property' },
  },
  {
    id: 'wa19', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a13', projectId: 'proj2',
    activityType: 'task_started', description: 'Started: Amend soil and grade',
    timestamp: offsetDate(-2) + 'T14:00:00Z',
    project: { id: 'proj2', name: 'Chen Property' },
  },
  {
    id: 'wa20', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a13', projectId: 'proj2',
    activityType: 'task_completed', description: 'Completed: Amend soil and grade',
    timestamp: offsetDate(-2) + 'T14:20:00Z',
    project: { id: 'proj2', name: 'Chen Property' },
  },
  {
    id: 'wa21', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a13', projectId: 'proj2',
    activityType: 'checked_out', description: 'Checked out from Chen Property',
    timestamp: offsetDate(-2) + 'T14:25:00Z',
    project: { id: 'proj2', name: 'Chen Property' },
  },

  // ── Monday morning: Greenwood Estate (a14) ──
  {
    id: 'wa22', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a14', projectId: 'proj3',
    activityType: 'checked_in', description: 'Checked in at Greenwood Estate',
    timestamp: offsetDate(-3) + 'T07:05:00Z',
    project: { id: 'proj3', name: 'Greenwood Estate' },
  },
  {
    id: 'wa23', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a14', projectId: 'proj3',
    activityType: 'task_started', description: 'Started: Plant foundation shrubs',
    timestamp: offsetDate(-3) + 'T07:15:00Z',
    project: { id: 'proj3', name: 'Greenwood Estate' },
  },
  {
    id: 'wa24', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a14', projectId: 'proj3',
    activityType: 'task_completed', description: 'Completed: Plant foundation shrubs',
    timestamp: offsetDate(-3) + 'T08:30:00Z',
    project: { id: 'proj3', name: 'Greenwood Estate' },
  },
  {
    id: 'wa25', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a14', projectId: 'proj3',
    activityType: 'photo_taken', description: 'Photo: Shrubs planted',
    timestamp: offsetDate(-3) + 'T08:32:00Z',
    project: { id: 'proj3', name: 'Greenwood Estate' },
  },
  {
    id: 'wa26', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a14', projectId: 'proj3',
    activityType: 'task_started', description: 'Started: Edge beds and mulch',
    timestamp: offsetDate(-3) + 'T09:00:00Z',
    project: { id: 'proj3', name: 'Greenwood Estate' },
  },
  {
    id: 'wa27', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a14', projectId: 'proj3',
    activityType: 'task_completed', description: 'Completed: Edge beds and mulch',
    timestamp: offsetDate(-3) + 'T10:30:00Z',
    project: { id: 'proj3', name: 'Greenwood Estate' },
  },
  {
    id: 'wa28', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a14', projectId: 'proj3',
    activityType: 'photo_taken', description: 'Photo: Beds edged and mulched',
    timestamp: offsetDate(-3) + 'T10:32:00Z',
    project: { id: 'proj3', name: 'Greenwood Estate' },
  },
  {
    id: 'wa29', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a14', projectId: 'proj3',
    activityType: 'task_started', description: 'Started: Final walkthrough',
    timestamp: offsetDate(-3) + 'T10:45:00Z',
    project: { id: 'proj3', name: 'Greenwood Estate' },
  },
  {
    id: 'wa30', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a14', projectId: 'proj3',
    activityType: 'task_completed', description: 'Completed: Final walkthrough',
    timestamp: offsetDate(-3) + 'T11:05:00Z',
    project: { id: 'proj3', name: 'Greenwood Estate' },
  },
  {
    id: 'wa31', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a14', projectId: 'proj3',
    activityType: 'checked_out', description: 'Checked out from Greenwood Estate',
    timestamp: offsetDate(-3) + 'T11:10:00Z',
    project: { id: 'proj3', name: 'Greenwood Estate' },
  },

  // ── Monday afternoon: Beachwood Residence (a15) — second job, same day ──
  {
    id: 'wa32', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a15', projectId: 'proj1',
    activityType: 'checked_in', description: 'Checked in at Beachwood Residence',
    timestamp: offsetDate(-3) + 'T12:05:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
  {
    id: 'wa33', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a15', projectId: 'proj1',
    activityType: 'task_started', description: 'Started: Install landscape lighting',
    timestamp: offsetDate(-3) + 'T12:15:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
  {
    id: 'wa34', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a15', projectId: 'proj1',
    activityType: 'task_completed', description: 'Completed: Install landscape lighting',
    timestamp: offsetDate(-3) + 'T14:00:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
  {
    id: 'wa35', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a15', projectId: 'proj1',
    activityType: 'photo_taken', description: 'Photo: Landscape lighting installed',
    timestamp: offsetDate(-3) + 'T14:02:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
  {
    id: 'wa36', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a15', projectId: 'proj1',
    activityType: 'task_started', description: 'Started: Plant perennial border',
    timestamp: offsetDate(-3) + 'T14:15:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
  {
    id: 'wa37', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a15', projectId: 'proj1',
    activityType: 'task_completed', description: 'Completed: Plant perennial border',
    timestamp: offsetDate(-3) + 'T16:00:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
  {
    id: 'wa38', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a15', projectId: 'proj1',
    activityType: 'photo_taken', description: 'Photo: Perennial border planted',
    timestamp: offsetDate(-3) + 'T16:02:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
  {
    id: 'wa39', personId: 'worker1', companyId: 'company1',
    assignmentId: 'a15', projectId: 'proj1',
    activityType: 'checked_out', description: 'Checked out from Beachwood Residence',
    timestamp: offsetDate(-3) + 'T16:20:00Z',
    project: { id: 'proj1', name: 'Beachwood Residence' },
  },
];

// ── Worker Check-in History ────────────────────────────────────

export const mockCheckIns: CheckIn[] = [
  {
    id: 'ci1', assignmentId: 'a11', personId: 'worker1', projectId: 'proj1', companyId: 'company1',
    timestamp: offsetDate(-1) + 'T07:05:00Z',
    gps: { latitude: 41.4756, longitude: -81.5558, accuracy: 12, distanceFromSite: 35 },
    withinRadius: true, createdAt: offsetDate(-1) + 'T07:05:00Z',
  },
  {
    id: 'ci2', assignmentId: 'a13', personId: 'worker1', projectId: 'proj2', companyId: 'company1',
    timestamp: offsetDate(-2) + 'T08:05:00Z',
    gps: { latitude: 41.4802, longitude: -81.5601, accuracy: 10, distanceFromSite: 18 },
    withinRadius: true, createdAt: offsetDate(-2) + 'T08:05:00Z',
  },
  {
    id: 'ci3', assignmentId: 'a14', personId: 'worker1', projectId: 'proj3', companyId: 'company1',
    timestamp: offsetDate(-3) + 'T07:05:00Z',
    gps: { latitude: 41.4901, longitude: -81.5710, accuracy: 9, distanceFromSite: 22 },
    withinRadius: true, createdAt: offsetDate(-3) + 'T07:05:00Z',
  },
  {
    id: 'ci4', assignmentId: 'a15', personId: 'worker1', projectId: 'proj1', companyId: 'company1',
    timestamp: offsetDate(-3) + 'T12:05:00Z',
    gps: { latitude: 41.4756, longitude: -81.5558, accuracy: 11, distanceFromSite: 28 },
    withinRadius: true, createdAt: offsetDate(-3) + 'T12:05:00Z',
  },
];

export const mockCheckOuts: CheckOut[] = [
  {
    id: 'co1', assignmentId: 'a11', personId: 'worker1', projectId: 'proj1', companyId: 'company1',
    timestamp: offsetDate(-1) + 'T15:02:00Z',
    gps: { latitude: 41.4758, longitude: -81.5556, accuracy: 8, distanceFromSite: 20 },
    createdAt: offsetDate(-1) + 'T15:02:00Z',
  },
  {
    id: 'co2', assignmentId: 'a13', personId: 'worker1', projectId: 'proj2', companyId: 'company1',
    timestamp: offsetDate(-2) + 'T14:25:00Z',
    gps: { latitude: 41.4803, longitude: -81.5602, accuracy: 9, distanceFromSite: 15 },
    createdAt: offsetDate(-2) + 'T14:25:00Z',
  },
  {
    id: 'co3', assignmentId: 'a14', personId: 'worker1', projectId: 'proj3', companyId: 'company1',
    timestamp: offsetDate(-3) + 'T11:10:00Z',
    gps: { latitude: 41.4902, longitude: -81.5711, accuracy: 8, distanceFromSite: 19 },
    createdAt: offsetDate(-3) + 'T11:10:00Z',
  },
  {
    id: 'co4', assignmentId: 'a15', personId: 'worker1', projectId: 'proj1', companyId: 'company1',
    timestamp: offsetDate(-3) + 'T16:20:00Z',
    gps: { latitude: 41.4757, longitude: -81.5557, accuracy: 10, distanceFromSite: 24 },
    createdAt: offsetDate(-3) + 'T16:20:00Z',
  },
];

// ── Worker Settings ────────────────────────────────────────────

export const mockWorkerSettings: WorkerSettings = {
  navApp: 'google_maps',
  notificationsEnabled: true,
};

// ── Project Photos ────────────────────────────────────────────
// Worker-uploaded photos are INTERNAL by default. Only photos with
// isCustomerVisible: true (set by owner) are shown to the customer.

export const mockProjectPhotos: Record<string, ProjectPhoto[]> = {
  proj1: [
    {
      id: 'ph1', projectId: 'proj1', taskId: 't1', uploadedBy: 'worker1',
      fileKey: 'proj1/demo-before.jpg', fileUrl: 'https://placehold.co/800x600/e8d5b7/1B3A2D?text=Before+Demo',
      caption: 'Existing patio before demolition',
      isCustomerVisible: false,
      photoType: 'before', takenAt: '2026-07-15T08:00:00Z', createdAt: '2026-07-15T08:05:00Z',
      uploader: mockPeople.worker1,
    },
    {
      id: 'ph2', projectId: 'proj1', taskId: 't1', uploadedBy: 'worker1',
      fileKey: 'proj1/demo-after.jpg', fileUrl: 'https://placehold.co/800x600/a0b8a0/1B3A2D?text=Demo+Complete',
      caption: 'Area cleared after demo',
      isCustomerVisible: false,
      photoType: 'after', takenAt: '2026-07-20T15:30:00Z', createdAt: '2026-07-20T15:35:00Z',
      uploader: mockPeople.worker1,
    },
    {
      id: 'ph3', projectId: 'proj1', taskId: 't3', uploadedBy: 'worker1',
      fileKey: 'proj1/footings.jpg', fileUrl: 'https://placehold.co/800x600/8b8b7a/ffffff?text=Wall+Footings',
      caption: 'Retaining wall footings poured',
      isCustomerVisible: false,
      photoType: 'progress', takenAt: '2026-08-01T14:00:00Z', createdAt: '2026-08-01T14:05:00Z',
      uploader: mockPeople.worker1,
    },
    {
      id: 'ph4', projectId: 'proj1', taskId: 't4', uploadedBy: 'worker1',
      fileKey: 'proj1/wall-progress.jpg', fileUrl: 'https://placehold.co/800x600/9caf88/1B3A2D?text=Wall+Progress',
      caption: 'Retaining wall halfway done — natural fieldstone',
      isCustomerVisible: false,
      photoType: 'progress', takenAt: '2026-08-10T11:00:00Z', createdAt: '2026-08-10T11:05:00Z',
      uploader: mockPeople.worker1,
    },
    {
      id: 'ph5', projectId: 'proj1', taskId: 't4', uploadedBy: 'worker1',
      fileKey: 'proj1/wall-complete.jpg', fileUrl: 'https://placehold.co/800x600/7CB342/ffffff?text=Wall+Complete',
      caption: 'Retaining wall finished',
      customerDescription: 'Your retaining wall is complete! We used Pennsylvania natural fieldstone as discussed.',
      isCustomerVisible: true, sharedBy: 'owner1', sharedAt: '2026-08-16T10:05:00Z',
      photoType: 'after', takenAt: '2026-08-15T16:30:00Z', createdAt: '2026-08-15T16:35:00Z',
      uploader: mockPeople.worker1, sharer: mockPeople.owner1, taskTitle: 'Build retaining wall',
    },
    {
      id: 'ph6', projectId: 'proj1', taskId: 't6', uploadedBy: 'worker1',
      fileKey: 'proj1/pavers-progress.jpg', fileUrl: 'https://placehold.co/800x600/c2b280/1B3A2D?text=Pavers+In+Progress',
      caption: 'Laying natural stone pavers — about 60% done',
      isCustomerVisible: false,
      photoType: 'progress', takenAt: '2026-08-27T14:00:00Z', createdAt: '2026-08-27T14:05:00Z',
      uploader: mockPeople.worker1,
    },
    {
      id: 'ph7', projectId: 'proj1', taskId: 't6', uploadedBy: 'worker1',
      fileKey: 'proj1/pavers-complete.jpg', fileUrl: 'https://placehold.co/800x600/7CB342/ffffff?text=Pavers+Done',
      caption: 'All pavers installed',
      customerDescription: 'All the natural stone pavers are laid. The pattern came out beautifully!',
      isCustomerVisible: true, sharedBy: 'owner1', sharedAt: '2026-09-03T17:05:00Z',
      photoType: 'after', takenAt: '2026-08-30T15:45:00Z', createdAt: '2026-08-30T15:50:00Z',
      uploader: mockPeople.worker1, sharer: mockPeople.owner1, taskTitle: 'Install natural stone pavers',
    },
    {
      id: 'ph8', projectId: 'proj1', taskId: 't7', uploadedBy: 'worker2',
      fileKey: 'proj1/border-stones.jpg', fileUrl: 'https://placehold.co/800x600/8b7d6b/ffffff?text=Border+Stones',
      caption: 'Border stones set along patio edge',
      isCustomerVisible: false,
      photoType: 'progress', takenAt: '2026-09-02T14:00:00Z', createdAt: '2026-09-02T14:05:00Z',
      uploader: mockPeople.worker2,
    },
    {
      id: 'ph9', projectId: 'proj1', taskId: 't8', uploadedBy: 'worker1',
      fileKey: 'proj1/joints-done.jpg', fileUrl: 'https://placehold.co/800x600/d4c5a0/1B3A2D?text=Sand+Joints',
      caption: 'Polymeric sand applied to all joints',
      isCustomerVisible: false,
      photoType: 'after', takenAt: '2026-09-04T10:30:00Z', createdAt: '2026-09-04T10:35:00Z',
      uploader: mockPeople.worker1,
    },
    {
      id: 'ph10', projectId: 'proj1', taskId: 't9', uploadedBy: 'worker2',
      fileKey: 'proj1/lighting-issue.jpg', fileUrl: 'https://placehold.co/800x600/cc0000/ffffff?text=Wire+Issue',
      caption: 'Found existing wire running through the planned lighting trench — need owner input',
      isCustomerVisible: false,
      photoType: 'issue', takenAt: '2026-09-05T09:00:00Z', createdAt: '2026-09-05T09:05:00Z',
      uploader: mockPeople.worker2, taskTitle: 'Install landscape lighting',
    },
    {
      id: 'ph11', projectId: 'proj1', taskId: 't9', uploadedBy: 'worker1',
      fileKey: 'proj1/lighting-installed.jpg', fileUrl: 'https://placehold.co/800x600/2e4a3a/ffffff?text=Lighting+Installed',
      caption: 'Landscape lighting installed',
      isCustomerVisible: false,
      photoType: 'after', takenAt: offsetDate(-3) + 'T14:02:00Z', createdAt: offsetDate(-3) + 'T14:02:00Z',
      uploader: mockPeople.worker1, taskTitle: 'Install landscape lighting',
    },
    {
      id: 'ph12', projectId: 'proj1', taskId: 't10', uploadedBy: 'worker1',
      fileKey: 'proj1/border-planted.jpg', fileUrl: 'https://placehold.co/800x600/6b8f5a/ffffff?text=Border+Planted',
      caption: 'Perennial border planted',
      isCustomerVisible: false,
      photoType: 'after', takenAt: offsetDate(-3) + 'T16:02:00Z', createdAt: offsetDate(-3) + 'T16:02:00Z',
      uploader: mockPeople.worker1, taskTitle: 'Plant perennial border',
    },
  ],
  proj2: [
    {
      id: 'ph20', projectId: 'proj2', taskId: 't20', uploadedBy: 'worker3',
      fileKey: 'proj2/sod-removed.jpg', fileUrl: 'https://placehold.co/800x600/8b7d6b/ffffff?text=Old+Sod+Removed',
      caption: 'Old sod and shrubs cleared',
      isCustomerVisible: false,
      photoType: 'after', takenAt: '2026-08-10T13:00:00Z', createdAt: '2026-08-10T13:05:00Z',
      uploader: mockPeople.worker3,
    },
    {
      id: 'ph21', projectId: 'proj2', taskId: 't21', uploadedBy: 'worker3',
      fileKey: 'proj2/trench.jpg', fileUrl: 'https://placehold.co/800x600/6b5b3e/ffffff?text=Irrigation+Trench',
      caption: 'Trenching complete for irrigation lines',
      customerDescription: 'Irrigation trenches are dug and ready for pipe installation.',
      isCustomerVisible: true, sharedBy: 'owner1', sharedAt: '2026-08-19T09:00:00Z',
      photoType: 'progress', takenAt: '2026-08-18T15:00:00Z', createdAt: '2026-08-18T15:05:00Z',
      uploader: mockPeople.worker3, sharer: mockPeople.owner1, taskTitle: 'Trench for irrigation lines',
    },
    {
      id: 'ph22', projectId: 'proj2', taskId: 't20', uploadedBy: 'worker1',
      fileKey: 'proj2/sod-removed-2.jpg', fileUrl: 'https://placehold.co/800x600/8b7d6b/ffffff?text=Old+Sod+Removed',
      caption: 'Old sod removed',
      isCustomerVisible: false,
      photoType: 'after', takenAt: offsetDate(-2) + 'T09:32:00Z', createdAt: offsetDate(-2) + 'T09:32:00Z',
      uploader: mockPeople.worker1, taskTitle: 'Remove old sod and shrubs',
    },
    {
      id: 'ph23', projectId: 'proj2', taskId: 't21', uploadedBy: 'worker1',
      fileKey: 'proj2/trench-2.jpg', fileUrl: 'https://placehold.co/800x600/6b5b3e/ffffff?text=Irrigation+Trench',
      caption: 'Irrigation trenches dug',
      isCustomerVisible: false,
      photoType: 'progress', takenAt: offsetDate(-2) + 'T12:05:00Z', createdAt: offsetDate(-2) + 'T12:05:00Z',
      uploader: mockPeople.worker1, taskTitle: 'Trench for irrigation lines',
    },
    {
      id: 'ph24', projectId: 'proj2', taskId: 't22', uploadedBy: 'worker1',
      fileKey: 'proj2/irrigation-installed.jpg', fileUrl: 'https://placehold.co/800x600/5a7a6b/ffffff?text=Irrigation+Installed',
      caption: 'Irrigation system installed',
      isCustomerVisible: false,
      photoType: 'after', takenAt: offsetDate(-2) + 'T13:50:00Z', createdAt: offsetDate(-2) + 'T13:50:00Z',
      uploader: mockPeople.worker1, taskTitle: 'Install irrigation system',
    },
  ],
  proj3: [
    {
      id: 'ph30', projectId: 'proj3', taskId: undefined, uploadedBy: 'worker2',
      fileKey: 'proj3/firepit-area.jpg', fileUrl: 'https://placehold.co/800x600/7a6b5b/ffffff?text=Fire+Pit+Area',
      caption: 'Fire pit foundation work',
      isCustomerVisible: false,
      photoType: 'progress', takenAt: '2026-08-20T11:00:00Z', createdAt: '2026-08-20T11:05:00Z',
      uploader: mockPeople.worker2,
    },
    {
      id: 'ph31', projectId: 'proj3', uploadedBy: 'worker1',
      fileKey: 'proj3/shrubs-planted.jpg', fileUrl: 'https://placehold.co/800x600/6b8f5a/ffffff?text=Shrubs+Planted',
      caption: 'Shrubs planted',
      isCustomerVisible: false,
      photoType: 'after', takenAt: offsetDate(-3) + 'T08:32:00Z', createdAt: offsetDate(-3) + 'T08:32:00Z',
      uploader: mockPeople.worker1, taskTitle: 'Plant foundation shrubs',
    },
    {
      id: 'ph32', projectId: 'proj3', uploadedBy: 'worker1',
      fileKey: 'proj3/beds-mulched.jpg', fileUrl: 'https://placehold.co/800x600/8b7355/ffffff?text=Beds+Mulched',
      caption: 'Beds edged and mulched',
      isCustomerVisible: false,
      photoType: 'after', takenAt: offsetDate(-3) + 'T10:32:00Z', createdAt: offsetDate(-3) + 'T10:32:00Z',
      uploader: mockPeople.worker1, taskTitle: 'Edge beds and mulch',
    },
  ],
};

// ── Customer Timeline ─────────────────────────────────────────
// Only events that the customer should see. Created when owner shares
// content or updates progress.

export const mockCustomerTimeline: Record<string, CustomerTimelineEvent[]> = {
  proj1: [
    {
      id: 'ct1', projectId: 'proj1', eventType: 'project_started',
      title: 'Project started', description: 'Work has begun on your backyard redesign.',
      timestamp: '2026-07-15T10:00:00Z',
    },
    {
      id: 'ct2', projectId: 'proj1', eventType: 'progress_updated',
      title: 'Progress: 35%', description: 'Demolition and grading complete. Starting on the retaining wall.',
      timestamp: '2026-08-05T09:00:00Z',
    },
    {
      id: 'ct3', projectId: 'proj1', eventType: 'photo_shared',
      title: 'New photo shared', description: 'Your retaining wall is complete! We used Pennsylvania natural fieldstone as discussed.',
      photoUrl: 'https://placehold.co/800x600/7CB342/ffffff?text=Wall+Complete',
      timestamp: '2026-08-16T10:05:00Z',
    },
    {
      id: 'ct4', projectId: 'proj1', eventType: 'update_shared',
      title: 'Update: Retaining wall complete',
      description: 'The retaining wall is finished and looking great. Next up is the paver installation.',
      timestamp: '2026-08-16T10:00:00Z',
    },
    {
      id: 'ct5', projectId: 'proj1', eventType: 'progress_updated',
      title: 'Progress: 65%', description: 'Pavers installed, border stones set, joints filled. Moving to lighting and planting.',
      timestamp: '2026-09-05T14:30:00Z',
    },
    {
      id: 'ct6', projectId: 'proj1', eventType: 'photo_shared',
      title: 'New photo shared', description: 'All the natural stone pavers are laid. The pattern came out beautifully!',
      photoUrl: 'https://placehold.co/800x600/7CB342/ffffff?text=Pavers+Done',
      timestamp: '2026-09-03T17:05:00Z',
    },
    {
      id: 'ct7', projectId: 'proj1', eventType: 'update_shared',
      title: 'Update: Pavers laid — joints tomorrow',
      description: 'All the natural stone pavers are in place. Tomorrow we will finish the polymeric sand joints.',
      timestamp: '2026-09-03T17:00:00Z',
    },
    {
      id: 'ct8', projectId: 'proj1', eventType: 'request_responded',
      title: 'Your request was acknowledged', description: 'Re: Add solar lights along walkway — Great idea, we can incorporate these into the lighting plan.',
      timestamp: '2026-09-02T11:00:00Z',
    },
  ],
  proj2: [
    {
      id: 'ct20', projectId: 'proj2', eventType: 'project_started',
      title: 'Project started', description: 'Work has begun on your front yard renovation.',
      timestamp: '2026-08-01T10:00:00Z',
    },
    {
      id: 'ct21', projectId: 'proj2', eventType: 'photo_shared',
      title: 'New photo shared', description: 'Irrigation trenches are dug and ready for pipe installation.',
      photoUrl: 'https://placehold.co/800x600/6b5b3e/ffffff?text=Irrigation+Trench',
      timestamp: '2026-08-19T09:00:00Z',
    },
    {
      id: 'ct22', projectId: 'proj2', eventType: 'request_responded',
      title: 'Your request was converted to a task', description: 'Re: Add drip line to garden bed — Added to the irrigation task, no extra cost.',
      timestamp: '2026-09-03T10:00:00Z',
    },
  ],
  proj6: [
    {
      id: 'ct60', projectId: 'proj6', eventType: 'project_started',
      title: 'Project started', description: 'Work has begun on the front walkway.',
      timestamp: '2026-03-01T10:00:00Z',
    },
    {
      id: 'ct61', projectId: 'proj6', eventType: 'project_completed',
      title: 'Project completed', description: 'Your flagstone walkway is finished! Thanks for choosing Brighton Lawn + Landscape.',
      timestamp: '2026-04-28T15:00:00Z',
    },
  ],
};

// ── Company Resources (demo mode only) ─────────────────────────
// Codes for these live in src/hooks/useResources.ts (demo stand-in for
// Supabase Vault), never on the resource objects themselves.

export const mockResources: CompanyResource[] = [
  { id: 'res1', companyId: 'company1', category: 'access_code', name: 'Main yard gate', description: 'Keypad on the left post. Close the gate behind you after 6 PM.', hasSecret: true, createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z' },
  { id: 'res2', companyId: 'company1', category: 'vehicle', name: 'Truck #1 key lockbox', description: 'Lockbox is on the driver-side hitch.', truckId: 'truck1', hasSecret: true, createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z' },
  { id: 'res3', companyId: 'company1', category: 'vehicle', name: 'Trailer hitch lock', truckId: 'truck4', hasSecret: true, createdAt: '2026-09-02T10:00:00Z', updatedAt: '2026-09-02T10:00:00Z' },
  { id: 'res4', companyId: 'company1', category: 'equipment', name: 'Storage shed padlock', itemName: 'Equipment shed', description: 'Mowers and trimmers. Return fuel cans to the back shelf.', hasSecret: true, createdAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-03T10:00:00Z' },
  { id: 'res5', companyId: 'company1', category: 'company_card', name: 'Fuel card', cardLastFour: '4417', cardHolderId: 'worker1', description: 'Fuel only. Keep receipts in the truck folder.', createdAt: '2026-09-04T10:00:00Z', updatedAt: '2026-09-04T10:00:00Z' },
];

export const mockResourceAccess: ResourceAccess[] = [
  { id: 'ra1', companyId: 'company1', resourceId: 'res1', personId: 'worker1', createdAt: '2026-09-01T10:00:00Z' },
  { id: 'ra2', companyId: 'company1', resourceId: 'res1', personId: 'worker3', createdAt: '2026-09-01T10:00:00Z' },
  { id: 'ra3', companyId: 'company1', resourceId: 'res2', personId: 'worker1', createdAt: '2026-09-01T10:00:00Z' },
  { id: 'ra4', companyId: 'company1', resourceId: 'res5', personId: 'worker1', createdAt: '2026-09-04T10:00:00Z' },
];
