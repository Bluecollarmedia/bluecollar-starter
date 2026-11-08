/**
 * Shared auth utilities for Edge Functions.
 * Validates JWT, extracts user, checks company membership and role.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export function getUserClient(authHeader: string) {
  return createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  });
}

export interface AuthContext {
  userId: string;
  companyId: string;
  role: string;
}

export async function authenticateRequest(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid Authorization header', 401);
  }

  const userClient = getUserClient(authHeader);
  const { data: { user }, error } = await userClient.auth.getUser();

  if (error || !user) {
    throw new AuthError('Invalid or expired token', 401);
  }

  const serviceClient = getServiceClient();
  const { data: membership } = await serviceClient
    .from('company_members')
    .select('company_id, role')
    .eq('person_id', user.id)
    .eq('status', 'active')
    .single();

  if (!membership) {
    throw new AuthError('No active company membership', 403);
  }

  return {
    userId: user.id,
    companyId: membership.company_id,
    role: membership.role,
  };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
