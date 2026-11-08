import type { MembershipAuditEvent } from '@/types/onboarding';

// ── Audit Events ───────────────────────────────────────────────

export const mockAuditEvents: MembershipAuditEvent[] = [
  { id: 'ae1', companyId: 'company1', eventType: 'company_created', actorId: 'owner1', createdAt: '2024-01-15T10:00:00Z' },
];
