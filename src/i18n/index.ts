/**
 * English / Spanish. English is the default and the text in the code is the key: t('Sign In') returns the Spanish for it when the phone is set
 * to Spanish and the dictionary (es.ts) has it, and the English text itself otherwise, so a screen that has not been translated yet simply
 * stays in English. Values in text go in as {name}: t('Hello {name}', { name }).
 *
 * The choice is kept on this phone (not a permission, not shared). It can be changed on the welcome, sign-in and invite screens before
 * anyone signs up, and in Settings afterwards.
 */
import { useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DICTIONARY } from './dictionary';

export type Language = 'en' | 'es';
export const LANGUAGES: { key: Language; label: string; short: string }[] = [
  { key: 'en', label: 'English', short: 'EN' },
  { key: 'es', label: 'Español', short: 'ES' },
];

const STORAGE_KEY = 'brighton.language';
let current: Language = 'en';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Fills {name} placeholders. */
function fill(text: string, vars?: Record<string, string | number>): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Translates for a given language (English, or any text the dictionary does not have yet, comes back as written). */
export function translate(lang: Language, text: string, vars?: Record<string, string | number>): string {
  return fill(lang === 'es' ? DICTIONARY[text] ?? text : text, vars);
}

/** For code that is not a component (alerts, messages made in data functions): uses the language at the moment it is called. */
export function tr(text: string, vars?: Record<string, string | number>): string {
  return translate(current, text, vars);
}

export function getLanguage(): Language {
  return current;
}

export function setLanguage(next: Language) {
  if (next === current) return;
  current = next;
  emit();
  AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  syncLanguageToAccount();
}

/** Saves the language on the signed-in account (update 95) so the server's push notices come in it. Quietly does nothing when signed out or the update is not installed. */
export function syncLanguageToAccount() {
  try {
    const { supabase } = require('@/lib/supabase') as typeof import('@/lib/supabase');
    supabase.rpc('set_my_language', { p_language: current }).then(() => {}, () => {});
  } catch { /* offline or signed out */ }
}

/** Reads the saved choice (called once at startup). Anything unexpected stays English. */
export async function loadLanguage(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if ((saved === 'es' || saved === 'en') && saved !== current) { current = saved; emit(); }
  } catch { /* stays English */ }
}
loadLanguage();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useLanguage(): { language: Language; setLanguage: (l: Language) => void } {
  const language = useSyncExternalStore(subscribe, () => current, () => 'en' as Language);
  return { language, setLanguage };
}

/** const t = useT(); then t('Sign In'). The screen redraws by itself when the language changes. */
export function useT(): (text: string, vars?: Record<string, string | number>) => string {
  const { language } = useLanguage();
  return useMemo(() => (text: string, vars?: Record<string, string | number>) => translate(language, text, vars), [language]);
}
