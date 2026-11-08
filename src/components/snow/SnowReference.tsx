/**
 * Snow property reference: a service's written instructions and its
 * reference photos/videos (supabase/updates/022), read-only.
 *
 *  • SnowReferenceView shows a reference already loaded.
 *  • SnowServiceReferenceCard loads one property + service itself, as the
 *    database lets the viewer see it (a route lead sees only the services on
 *    routes they lead). Pass `at` (a visit's completion time) to show what
 *    the crew was given then, not what the property says today.
 *
 * Reference media guides the crew. It is not proof of work: completion
 * photos belong to the visit.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon, LoadingSpinner } from '@/components/ui';
import { TaskMediaStrip, TaskMediaViewer, type TaskMediaItem } from '@/components/tasks/TaskMedia';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { signedSnowMediaUrls } from '@/lib/snowMedia';
import { loadServiceReference } from '@/data/snowProperties';
import { SNOW_SERVICE_LABELS, type SnowService, type SnowServiceReference, type SnowReferenceMedia } from '@/types/snowProperty';

/** Media rows → strip items, leaving out any the viewer has no link for. */
export function snowMediaItems(media: SnowReferenceMedia[], urls: Record<string, string>): TaskMediaItem[] {
  return media
    .filter((m) => urls[m.fileKey])
    .map((m) => ({ key: m.id, uri: urls[m.fileKey], mediaType: m.mediaType }));
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface SnowReferenceViewProps {
  reference: SnowServiceReference;
  mediaUrls: Record<string, string>;
  /** Shown under the title, e.g. "As of Jan 12". */
  note?: string;
  showTitle?: boolean;
}

export function SnowReferenceView({ reference, mediaUrls, note, showTitle = true }: SnowReferenceViewProps) {
  const t = useT();
  const { colors } = useTheme();
  const [open, setOpen] = useState<number | null>(null);
  const items = useMemo(() => snowMediaItems(reference.media, mediaUrls), [reference.media, mediaUrls]);
  const missing = reference.media.length - items.length;
  const body = reference.instructions?.body?.trim();

  return (
    <View style={{ gap: spacing.sm }}>
      {showTitle && (
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>
          {t(SNOW_SERVICE_LABELS[reference.service.service])}
        </Text>
      )}
      {note ? <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{note}</Text> : null}
      <Text style={[typeScale.bodyLarge, { color: body ? colors.textPrimary : colors.textTertiary }]}>
        {body || t('No instructions for this service.')}
      </Text>
      {items.length > 0 ? (
        <TaskMediaStrip items={items} onOpen={setOpen} />
      ) : (
        <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{t('No reference photos or videos.')}</Text>
      )}
      {missing > 0 && (
        <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
          {missing === 1 ? t("One file couldn't be loaded.") : t("{n} files couldn't be loaded.", { n: missing })}
        </Text>
      )}
      <TaskMediaViewer items={items} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} />
    </View>
  );
}

interface SnowServiceReferenceCardProps {
  propertyId: string;
  service: SnowService;
  /** A past visit's completion time: shows what was in effect then. */
  at?: string;
}

export function SnowServiceReferenceCard({ propertyId, service, at }: SnowServiceReferenceCardProps) {
  const t = useT();
  const { colors } = useTheme();
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'none' }
    | { kind: 'ready'; reference: SnowServiceReference; urls: Record<string, string> }
  >({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ kind: 'loading' });
    (async () => {
      const res = await loadServiceReference(propertyId, service, at);
      if (!alive) return;
      if (!res.ok) return setState({ kind: 'error', message: res.error });
      if (!res.data) return setState({ kind: 'none' });
      let urls: Record<string, string> = {};
      try {
        urls = await signedSnowMediaUrls(res.data.media.map((m) => m.fileKey));
      } catch (err) {
        console.warn('[snow reference] signed links failed', err);
      }
      if (alive) setState({ kind: 'ready', reference: res.data, urls });
    })();
    return () => { alive = false; };
  }, [propertyId, service, at]);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      {state.kind === 'loading' && <LoadingSpinner />}
      {state.kind === 'error' && (
        <View style={styles.row}>
          <Icon name="alert-circle" size={16} color={colors.textSecondary} />
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, flex: 1 }]}>{t(state.message)}</Text>
        </View>
      )}
      {state.kind === 'none' && (
        <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>
          {t('No {service} instructions are available for this property.', { service: t(SNOW_SERVICE_LABELS[service]).toLowerCase() })}
        </Text>
      )}
      {state.kind === 'ready' && (
        <SnowReferenceView
          reference={state.reference}
          mediaUrls={state.urls}
          note={at ? t('As it was on {date}', { date: formatDate(at) }) : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
