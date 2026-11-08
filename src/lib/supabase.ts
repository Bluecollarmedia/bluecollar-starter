/**
 * Supabase Client
 *
 * Configured for React Native with AsyncStorage for session persistence.
 * Replace the placeholder URL and anon key with your Supabase project values.
 *
 * The anon key is safe to embed in client code — Supabase uses Row Level
 * Security (RLS) to control data access, not the anon key.
 */

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured =
  SUPABASE_URL.length > 0 &&
  !SUPABASE_URL.includes('your-project') &&
  SUPABASE_ANON_KEY.length > 0 &&
  !SUPABASE_ANON_KEY.includes('your-anon-key');

/** True only in a development build (Metro sets __DEV__; release builds and the web export have it false). */
const IS_DEV_BUILD = typeof __DEV__ !== 'undefined' && __DEV__ === true;

/**
 * Demo mode (sample data, a pretend sign-in) is ONLY for development builds with no Supabase address/key.
 * A release build (App Store, Play Store, TestFlight, the web site) NEVER runs demo mode: without its Supabase settings it shows the
 * "App not set up" screen instead (app/_layout.tsx). Real demo data for a client comes only from the demo SQL, never from the app.
 */
export const isDemoMode = !isSupabaseConfigured && IS_DEV_BUILD;

/** A release build made without its Supabase address/key: the app shows "App not set up" and does nothing else. */
export const isAppNotSetUp = !isSupabaseConfigured && !IS_DEV_BUILD;

const SERVER_DOWN = "Can't reach the server right now. Check your connection and try again in a minute.";

/**
 * When the server's front door (Cloudflare) answers with its own web page (DNS error, 502, 522...), the app used to print that whole page as the
 * error. Any failed answer that is HTML is turned into one plain sentence in the shape the Supabase client already understands.
 */
export async function friendlyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.ok) return res;
  const type = res.headers.get('content-type') ?? '';
  if (!/text\/html/i.test(type)) return res;
  return new Response(JSON.stringify({ message: SERVER_DOWN, error: SERVER_DOWN, code: 'server_unreachable', hint: null, details: null }), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder',
  {
    global: { fetch: friendlyFetch },
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  },
);
