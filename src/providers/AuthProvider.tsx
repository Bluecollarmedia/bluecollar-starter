/**
 * Auth Provider
 *
 * Wraps the app in authentication state powered by Supabase.
 * When Supabase is not configured (no .env), falls through to
 * demo mode with the built-in sample data so the app is explorable.
 *
 * Supports onboarding states:
 *  - unauthenticated → welcome / sign-in
 *  - authenticated, no membership → onboarding
 *  - authenticated, active membership → role-based routing
 *
 * Who you are and which company you belong to comes from the
 * get_my_context() database function (see supabase/schema.sql).
 */

import React, { createContext, useContext, useEffect, useMemo, useReducer, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import { AUTH_CALLBACK_URL } from '@/lib/authLink';
import { createInvitedLogin } from '@/lib/inviteSignup';
import { properName } from '@/lib/names';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { startSession, endSession, startDemoSession, updateRow } from '@/data/store';
import { unregisterForPush } from '@/lib/push';
import { syncMaterialReminders } from '@/lib/materialReminders';
import { syncTruckReminders } from '@/lib/truckReminders';
import type { AuthState, UserProfile, UserRole } from '@/types';
import type { OnboardingStep } from '@/types/onboarding';
import { fetchMySnowAccess } from '@/hooks/useSnowTeam';

// ── Extended auth state ─────────────────────────────────────────

export type AppState =
  | 'loading'
  | 'unauthenticated'
  | 'onboarding'
  | 'active';

/** What the signed-in person may use. The company's active mode never grants
 * access by itself; this comes from their landscaping membership and their
 * approved snow access. */
export interface ModeAccess {
  landscaping: boolean;
  snow: boolean;
}

interface ExtendedAuthState extends AuthState {
  appState: AppState;
  onboardingStep: OnboardingStep;
  /** The real membership role (admins use the owner screens, so user.role is 'owner' for them). */
  memberRole?: UserRole;
  modeAccess?: ModeAccess;
}

// ── Actions ──────────────────────────────────────────────────────
type AuthAction =
  | { type: 'RESOLVED'; user: UserProfile; session: AuthState['session']; appState: AppState; onboardingStep: OnboardingStep; memberRole?: UserRole; modeAccess?: ModeAccess }
  | { type: 'SIGN_OUT' }
  | { type: 'SET_LOADING'; isLoading: boolean }
  | { type: 'UPDATE_PROFILE'; user: UserProfile }
  | { type: 'SET_APP_STATE'; appState: AppState; onboardingStep?: OnboardingStep }
  | { type: 'SET_DEV_MODE'; user: UserProfile; session: AuthState['session']; appState: AppState; onboardingStep: OnboardingStep };

// ── Reducer ──────────────────────────────────────────────────────
function authReducer(state: ExtendedAuthState, action: AuthAction): ExtendedAuthState {
  switch (action.type) {
    case 'RESOLVED':
      return {
        isLoading: false,
        isAuthenticated: true,
        user: action.user,
        session: action.session,
        appState: action.appState,
        onboardingStep: action.onboardingStep,
        memberRole: action.memberRole,
        modeAccess: action.modeAccess,
      };
    case 'SIGN_OUT':
      return {
        isLoading: false,
        isAuthenticated: false,
        user: null,
        session: null,
        appState: 'unauthenticated',
        onboardingStep: 'welcome',
        memberRole: undefined,
        modeAccess: undefined,
      };
    case 'SET_LOADING':
      return { ...state, isLoading: action.isLoading };
    case 'UPDATE_PROFILE':
      return { ...state, user: action.user };
    case 'SET_APP_STATE':
      return {
        ...state,
        appState: action.appState,
        onboardingStep: action.onboardingStep ?? state.onboardingStep,
      };
    case 'SET_DEV_MODE':
      return {
        isLoading: false,
        isAuthenticated: action.appState !== 'unauthenticated',
        user: action.user,
        session: action.session,
        appState: action.appState,
        onboardingStep: action.onboardingStep,
        memberRole: action.user.role,
        modeAccess: { landscaping: true, snow: false },
      };
    default:
      return state;
  }
}

const initialState: ExtendedAuthState = {
  isLoading: true,
  isAuthenticated: false,
  user: null,
  session: null,
  appState: 'loading',
  onboardingStep: 'welcome',
};

// ── Sign-up details ──────────────────────────────────────────────

export interface SignUpProfile {
  firstName: string;
  lastName: string;
  phone?: string;
}

/** What to do as part of creating the account. Handled by the database at
 * sign-up (supabase/schema.sql handle_new_user), so it works even when email
 * confirmation is turned on. */
export interface SignUpIntent {
  company?: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  /** A private one-time invite link (supabase/updates/078_invite_links.sql): the database attaches the new login to the person the owner added. */
  inviteToken?: string;
}

export interface SignUpResult {
  /** True when Supabase requires the user to confirm their email before signing in. */
  needsEmailConfirmation: boolean;
}

// ── Context ──────────────────────────────────────────────────────
interface AuthContextValue extends ExtendedAuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, profile: SignUpProfile, intent?: SignUpIntent) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  /** Re-checks memberships (e.g. after creating a company or signing up from an invite link). */
  refreshContext: () => Promise<AppState>;
  switchDevRole: (role: UserRole) => void;
  switchDevState: (appState: AppState, onboardingStep?: OnboardingStep) => void;
  setAppState: (appState: AppState, opts?: { onboardingStep?: OnboardingStep }) => void;
  updateProfile: (profile: UserProfile) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// ── Helper: resolve who the signed-in user is ───────────────────

interface MyContext {
  person: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    avatar_url: string | null;
    phone: string | null;
    created_at: string;
    updated_at: string;
  };
  memberships: { id: string; company_id: string; role: UserRole; status: string; company_name: string }[];
  join_request: { id: string; status: string; company_id: string; company_name: string; decline_reason?: string } | null;
}

const ROLE_PRIORITY: Record<string, number> = { owner: 0, admin: 1, worker: 2, customer: 3 };

interface Resolution {
  user: UserProfile;
  appState: AppState;
  onboardingStep: OnboardingStep;
  memberRole?: UserRole;
  companyId?: string;
  modeAccess?: ModeAccess;
}

async function resolveContext(): Promise<Resolution | null> {
  // Snow access is read separately so a database without the Snow update still works (the list is just empty then).
  const [{ data, error }, snowAccess] = await Promise.all([
    supabase.rpc('get_my_context'),
    fetchMySnowAccess().catch(() => [] as Awaited<ReturnType<typeof fetchMySnowAccess>>),
  ]);
  if (error || !data) {
    console.warn('[auth] get_my_context failed:', error?.message);
    return null;
  }
  const ctx = data as MyContext;
  const p = ctx.person;
  const active = (ctx.memberships ?? [])
    .filter((m) => m.status === 'active')
    .sort((a, b) => (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9));
  const membership = active[0];

  // Admins use the owner screens.
  const routeRole: UserRole = membership ? (membership.role === 'admin' ? 'owner' : membership.role) : 'worker';

  const user: UserProfile = {
    id: p.id,
    email: p.email,
    role: routeRole,
    firstName: properName(p.first_name ?? ''),
    lastName: properName(p.last_name ?? ''),
    avatarUrl: p.avatar_url ?? undefined,
    phone: p.phone ?? undefined,
    activeCompanyId: membership?.company_id,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };

  const snowOnly = snowAccess[0];

  if (membership) {
    return {
      user, appState: 'active', onboardingStep: 'ready', memberRole: membership.role, companyId: membership.company_id,
      modeAccess: { landscaping: true, snow: snowAccess.some((e) => e.companyId === membership.company_id) || membership.role === 'owner' || membership.role === 'admin' },
    };
  }
  // Approved for snow only: a worker with no landscaping access. They get no
  // company membership, so landscaping data stays closed to them.
  if (snowOnly) {
    return {
      user: { ...user, role: 'worker', activeCompanyId: snowOnly.companyId },
      appState: 'active', onboardingStep: 'ready', memberRole: 'worker', companyId: snowOnly.companyId,
      modeAccess: { landscaping: false, snow: true },
    };
  }
  return { user, appState: 'onboarding', onboardingStep: 'create_company' };
}

// ── Dev mock users (no Supabase) ────────────────────────────────
const DEV_USERS: Record<'owner' | 'worker' | 'customer', UserProfile> = {
  owner: {
    id: 'owner1', email: 'joey@brightonlawn.com', role: 'owner',
    firstName: 'Joey', lastName: 'Angeloco', activeCompanyId: 'company1',
    avatarUrl: 'https://ui-avatars.com/api/?name=Joey+Angeloco&background=7CB342&color=fff&size=128',
    createdAt: '2024-01-15T10:00:00Z', updatedAt: '2024-01-15T10:00:00Z',
  },
  worker: {
    id: 'worker1', email: 'marcus@brightonlawn.com', role: 'worker',
    firstName: 'Marcus', lastName: 'Rivera', activeCompanyId: 'company1',
    avatarUrl: 'https://ui-avatars.com/api/?name=Marcus+Rivera&background=42A5F5&color=fff&size=128',
    createdAt: '2025-03-01T08:00:00Z', updatedAt: '2025-03-01T08:00:00Z',
  },
  customer: {
    id: 'customer1', email: 'sarah.mitchell@email.com', role: 'customer',
    firstName: 'Sarah', lastName: 'Mitchell', activeCompanyId: 'company1',
    avatarUrl: 'https://ui-avatars.com/api/?name=Sarah+Mitchell&background=AB47BC&color=fff&size=128',
    createdAt: '2026-02-15T10:00:00Z', updatedAt: '2026-02-15T10:00:00Z',
  },
};

const DEV_SESSION = { accessToken: 'dev', refreshToken: 'dev', expiresAt: 0 };

function devUser(role: UserRole): UserProfile {
  return DEV_USERS[role === 'admin' ? 'owner' : role];
}

// ── Provider ─────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  /** Company the data store is currently loaded for, so re-resolving doesn't reload needlessly. */
  const loadedFor = useRef<string | null>(null);

  const applyResolution = useCallback(async (res: Resolution, authSession: AuthState['session']) => {
    if (res.appState === 'active' && res.companyId) {
      const key = `${res.user.id}:${res.companyId}:${res.memberRole}`;
      if (loadedFor.current !== key) {
        loadedFor.current = key;
        await startSession({ companyId: res.companyId, personId: res.user.id, role: (res.memberRole ?? res.user.role) as 'owner' });
      }
    } else if (loadedFor.current) {
      loadedFor.current = null;
      endSession();
    }
    dispatch({
      type: 'RESOLVED',
      user: res.user,
      session: authSession,
      appState: res.appState,
      onboardingStep: res.onboardingStep,
      memberRole: res.memberRole,
      modeAccess: res.modeAccess,
    });
  }, []);

  const resolveFromSession = useCallback(async (
    s: { access_token: string; refresh_token: string; expires_at?: number } | null,
    opts: { keepStateOnError?: boolean } = {},
  ) => {
    if (!s) {
      if (loadedFor.current) endSession();
      loadedFor.current = null;
      dispatch({ type: 'SIGN_OUT' });
      return 'unauthenticated' as AppState;
    }
    const res = await resolveContext();
    if (!res) {
      if (opts.keepStateOnError) return null;
      // Signed in but the database isn't set up (or unreachable) — don't strand
      // the user on a spinner; send them back to sign in.
      dispatch({ type: 'SIGN_OUT' });
      return 'unauthenticated' as AppState;
    }
    await applyResolution(res, {
      accessToken: s.access_token,
      refreshToken: s.refresh_token,
      expiresAt: s.expires_at ?? 0,
    });
    return res.appState;
  }, [applyResolution]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      const user = DEV_USERS.worker;
      startDemoSession(user.id, user.role as 'worker');
      dispatch({ type: 'SET_DEV_MODE', user, session: DEV_SESSION, appState: 'active', onboardingStep: 'ready' });
      return;
    }

    let mounted = true;

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (mounted) return resolveFromSession(session);
      })
      .catch(() => {
        if (mounted) dispatch({ type: 'SIGN_OUT' });
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT' || !session) {
        resolveFromSession(null);
        return;
      }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        // Supabase recommends not awaiting other Supabase calls inside this
        // callback (it can deadlock the auth client), so defer the work.
        setTimeout(() => {
          if (mounted) resolveFromSession(session);
        }, 0);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [resolveFromSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured. Add credentials to .env');
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, profile: SignUpProfile, intent?: SignUpIntent): Promise<SignUpResult> => {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase is not configured. Add credentials to .env');
      }
      const metadata: Record<string, string> = {
        first_name: profile.firstName,
        last_name: profile.lastName,
      };
      if (profile.phone) metadata.phone = profile.phone;
      if (intent?.company) {
        const c = intent.company;
        metadata.company_name = c.name;
        if (c.phone) metadata.company_phone = c.phone;
        if (c.email) metadata.company_email = c.email;
        if (c.address) metadata.company_address = c.address;
        if (c.city) metadata.company_city = c.city;
        if (c.state) metadata.company_state = c.state;
        if (c.zip) metadata.company_zip = c.zip;
      }
      if (intent?.inviteToken) metadata.invite_token = intent.inviteToken;

      // An invite link is proof enough: the login is made already confirmed (no second email) and the person is signed in at once.
      // If that function is not available, fall through to the normal sign-up below.
      if (intent?.inviteToken && !intent.company) {
        const made = await createInvitedLogin(email, password, profile, intent.inviteToken);
        if (made === 'ok') {
          const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (signInError) throw signInError;
          return { needsEmailConfirmation: false };
        }
        if (made !== 'unavailable') throw new Error(made);
      }

      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: metadata, ...(Platform.OS !== 'web' ? { emailRedirectTo: AUTH_CALLBACK_URL } : {}) } });
      if (error) throw error;
      if (!data.user) throw new Error('Sign up failed');
      // Supabase hides "already registered" behind a fake user with no identities.
      if (data.user.identities && data.user.identities.length === 0) {
        throw new Error('An account with this email already exists. Try signing in instead.');
      }
      return { needsEmailConfirmation: !data.session };
    },
    [],
  );

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured) {
      await unregisterForPush();
      // The next person to sign in on this phone shouldn't get these.
      await syncMaterialReminders([]);
      await syncTruckReminders([]);
      await supabase.auth.signOut();
    }
    if (loadedFor.current) endSession();
    loadedFor.current = null;
    dispatch({ type: 'SIGN_OUT' });
  }, []);

  const appStateRef = useRef<AppState>(state.appState);
  appStateRef.current = state.appState;

  const refreshContext = useCallback(async (): Promise<AppState> => {
    if (!isSupabaseConfigured) return appStateRef.current;
    const { data: { session } } = await supabase.auth.getSession();
    const next = await resolveFromSession(session, { keepStateOnError: true });
    return next ?? appStateRef.current;
  }, [resolveFromSession]);

  const switchDevRole = useCallback((role: UserRole) => {
    if (isSupabaseConfigured) return;
    const user = devUser(role);
    startDemoSession(user.id, user.role as 'owner');
    dispatch({
      type: 'SET_DEV_MODE',
      user,
      session: DEV_SESSION,
      appState: 'active',
      onboardingStep: 'ready',
    });
  }, []);

  const switchDevState = useCallback((appState: AppState, onboardingStep?: OnboardingStep) => {
    if (isSupabaseConfigured) return;
    const step = onboardingStep ?? (appState === 'unauthenticated' ? 'welcome' : 'ready');
    const user = appState === 'unauthenticated' ? null : DEV_USERS.worker;
    dispatch({
      type: 'SET_DEV_MODE',
      user: user ?? DEV_USERS.worker,
      session: appState === 'unauthenticated' ? null! : DEV_SESSION,
      appState,
      onboardingStep: step,
    });
    if (appState === 'unauthenticated') {
      dispatch({ type: 'SIGN_OUT' });
    }
  }, []);

  const setAppState = useCallback(
    (appState: AppState, opts?: { onboardingStep?: OnboardingStep }) => {
      dispatch({ type: 'SET_APP_STATE', appState, onboardingStep: opts?.onboardingStep });
    },
    [],
  );

  const updateProfile = useCallback((profile: UserProfile) => {
    dispatch({ type: 'UPDATE_PROFILE', user: profile });
    updateRow('people', profile.id, {
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: profile.phone,
      avatarUrl: profile.avatarUrl,
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signUp, signOut, refreshContext, switchDevRole, switchDevState, setAppState, updateProfile }),
    [state, signIn, signUp, signOut, refreshContext, switchDevRole, switchDevState, setAppState, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
