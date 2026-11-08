import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { loadStorms } from '@/data/snowStorms';
import type { SnowStorm } from '@/types/snow';

/** All storms the caller can see, newest first, kept current with live updates. */
export function useSnowStorms() {
  const [storms, setStorms] = useState<SnowStorm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    const res = await loadStorms();
    if (ticket !== latest.current) return;
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setStorms(res.data);
  }, []);

  useEffect(() => {
    reload();
    if (!isSupabaseConfigured) return;
    const channel = supabase
      .channel('snow-storms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'snow_storms' }, () => { reload(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [reload]);

  const active = storms.filter((s) => s.status === 'dispatched');
  const drafts = storms.filter((s) => s.status === 'draft');
  const ended = storms.filter((s) => s.status === 'ended');

  return { storms, active, drafts, ended, error, loading, reload };
}
