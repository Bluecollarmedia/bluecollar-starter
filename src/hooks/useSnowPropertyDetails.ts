import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { signedSnowMediaUrls } from '@/lib/snowMedia';
import { loadSnowPropertyDetails, type SnowPropertyDetails } from '@/data/snowProperties';

const LIVE_TABLES = ['snow_property_contacts', 'snow_property_services', 'snow_service_instructions', 'snow_reference_media'];

/**
 * One snow property's contacts, services, instructions and reference media,
 * kept current with live updates, plus signed links for the media files.
 */
export function useSnowPropertyDetails(propertyId: string | undefined) {
  const [details, setDetails] = useState<SnowPropertyDetails | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!propertyId) return;
    const ticket = ++latest.current;
    const res = await loadSnowPropertyDetails(propertyId);
    if (ticket !== latest.current) return;
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setDetails(res.data);
    const keys = res.data.media.map((m) => m.fileKey);
    try {
      const urls = await signedSnowMediaUrls(keys);
      if (ticket === latest.current) setMediaUrls(urls);
    } catch (err) {
      console.warn('[snow property] signed links failed', err);
    }
  }, [propertyId]);

  useEffect(() => {
    setLoading(true);
    reload();
    if (!propertyId || !isSupabaseConfigured) return;
    const channel = supabase.channel(`snow-property-${propertyId}`);
    for (const table of LIVE_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => { reload(); });
    }
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [propertyId, reload]);

  return { details, mediaUrls, error, loading, reload };
}
