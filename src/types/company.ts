import type { WorkerType } from './maintenance';
export interface Company {
  id: string;
  name: string;
  logoUrl?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  /** Where crews start and end the day (the yard). Separate from the office address above and from any jobsite. */
  yardAddress?: string;
  yardCity?: string;
  yardState?: string;
  yardZip?: string;
  /** Exact map spot of the yard, when the address was found on the map. */
  yardLatitude?: number;
  yardLongitude?: number;
  /** Owner's own photo for the dashboard header. */
  coverPhotoUrl?: string;
  /** Owner's own photo for the top of the workers' home screens. */
  workerCoverPhotoUrl?: string;
  /** Storage limit the owner picked, in GB. 0 means no limit. Missing means the 1 GB default. */
  storageLimitGb?: number;
  /** Biggest single upload the owner allows, in MB (1 to 200). Missing means the upload service's own maximum (200 MB). */
  maxFileSizeMb?: number;
  /** Task lists: true = only the job's Task Lead checks off tasks. Missing/false = anyone on the job can (update 120). */
  taskLeadOnly?: boolean;
  /** Payroll: pay each worker's target rate × hours, absorbing overtime into a lower base. */
  targetPayEnabled?: boolean;
  /** Landscaping Mode or Snow Mode. Set by the owner; never grants anyone access. Missing means landscaping. */
  activeMode?: CompanyMode;
  /** When and by whom the mode last changed (stamped by the database). */
  activeModeChangedAt?: string;
  activeModeChangedBy?: string;
  /** First-time setup progress: which steps were finished or skipped. */
  setupState?: CompanySetupState;
  setupCompletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type CompanyMode = 'landscaping' | 'snow';

export type SetupStepKey = 'trucks' | 'workers' | 'payRates' | 'notifications' | 'company';

export interface CompanySetupState {
  done?: Partial<Record<SetupStepKey, boolean>>;
  skipped?: Partial<Record<SetupStepKey, boolean>>;
}

export type CompanyRole = 'owner' | 'admin' | 'worker' | 'customer';
export type MemberStatus = 'active' | 'invited' | 'inactive';

export interface CompanyMember {
  id: string;
  companyId: string;
  personId: string;
  role: CompanyRole;
  status: MemberStatus;
  /** Workers only: 'maintenance' workers can be put on maintenance routes.
   * Missing means 'landscaping' (before supabase/updates/018). */
  workerType?: WorkerType;
  /** Workers only (supabase/updates/078): which areas the owner switched on. Missing on older rows; see lib/workerAreas.ts. */
  worksLandscaping?: boolean;
  worksMaintenance?: boolean;
  createdAt: string;
  updatedAt: string;
  person?: PersonSummary;
}

export interface PersonSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl?: string;
  phone?: string;
}

export interface Person {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
}
