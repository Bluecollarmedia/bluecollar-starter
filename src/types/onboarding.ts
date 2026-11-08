// ── Membership Audit ───────────────────────────────────────────

export type MembershipAuditEventType =
  | 'company_created'
  | 'invite_created'
  | 'invite_revoked'
  | 'worker_activated'
  | 'worker_deactivated'
  | 'customer_approved'
  | 'role_changed'
  | 'worker_areas_changed'
  | 'ownership_transferred';

export interface MembershipAuditEvent {
  id: string;
  companyId: string;
  eventType: MembershipAuditEventType;
  actorId: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// ── Onboarding State ───────────────────────────────────────────

export type OnboardingStep =
  | 'welcome'
  | 'sign_in'
  | 'create_company'
  | 'complete_profile'
  | 'ready';

export interface OnboardingState {
  step: OnboardingStep;
  companyId?: string;
  companyName?: string;
}

// ── Company Membership (clean separation) ──────────────────────

export type CompanyMembershipRole = 'owner' | 'admin' | 'worker' | 'customer';
export type CompanyMembershipStatus = 'active' | 'inactive' | 'suspended';

export interface CompanyMembership {
  id: string;
  companyId: string;
  personId: string;
  role: CompanyMembershipRole;
  status: CompanyMembershipStatus;
  /** How they joined: 'invitation_link' for people added with a private link. */
  joinMethod: 'invitation_link' | 'company_creator';
  approvedBy?: string;
  approvedAt?: string;
  deactivatedAt?: string;
  deactivatedBy?: string;
  createdAt: string;
  updatedAt: string;
}
