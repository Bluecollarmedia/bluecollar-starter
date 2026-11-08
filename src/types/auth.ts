import type { CompanyRole } from './company';

export type UserRole = CompanyRole;

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  phone?: string;
  activeCompanyId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: UserProfile | null;
  session: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  } | null;
}
