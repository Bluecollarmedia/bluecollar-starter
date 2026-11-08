import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

/**
 * Whether "Create a Company" should be offered. The app allows exactly one
 * company: it is offered only while no company exists, and comes back once the
 * company has been deleted (supabase/updates/036). The server decides and also
 * refuses a second company, so this only controls the button. It asks again
 * every time the screen is focused. Starts hidden until the server answers;
 * demo mode always shows it.
 */
export function useCompanySlotOpen(): boolean {
  const [open, setOpen] = useState(!isSupabaseConfigured);

  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured) return;
      let active = true;
      supabase.rpc('company_slot_open').then(({ data, error }) => {
        if (!active) return;
        // Database not updated yet (no such function): keep the old behavior.
        setOpen(error ? true : data === true);
      });
      return () => { active = false; };
    }, []),
  );

  return open;
}
