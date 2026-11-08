/**
 * Shown on a Prospect project (created from a quote for a new job): what it's
 * waiting for, and once the quote is approved, the Start Project button that
 * makes it an active project (same project; nothing is copied or scheduled).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { confirmAction } from './ActionSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { db, useDb } from '@/data/store';
import { canStartProject, startProjectFromQuote, displayStatus, STATUS_LABEL } from '@/data/financials';
import { formatMoney } from '@/lib/money';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { w } from '@/config/brand';

export function ProspectBanner({ projectId, style }: { projectId: string; style?: object }) {
  const { colors } = useTheme();
  const router = useRouter();
  useDb();
  const project = db.projects.find((p) => p.id === projectId);
  if (project?.status !== 'prospect') return null;

  const quote = db.quotes.find((q) => q.projectId === projectId && q.status === 'approved')
    ?? db.quotes.find((q) => q.projectId === projectId);
  const ready = canStartProject(projectId);

  let text: string;
  if (ready && quote) text = w('Quote {number} was approved ({total}). Start the job to schedule crews and add tasks.', { number: quote.number, total: formatMoney(quote.total) });
  else if (quote) text = w('Prospect: quote {number} is {status}. It becomes a job once the quote is approved.', { number: quote.number, status: STATUS_LABEL[displayStatus({ kind: 'quote', ...quote })].toLowerCase() });
  else text = w('Prospect: not on the schedule yet. Create a quote; once it’s approved you can start the job.');

  const start = () => confirmAction(
    w('Start this job?'),
    w('{name} becomes an active job with {number} attached. No one is scheduled until you add them.', { name: project.name, number: quote?.number ?? 'the approved quote' }),
    w('Start Job'),
    () => startProjectFromQuote(projectId),
  );

  return (
    <View style={[styles.wrap, { backgroundColor: ready ? colors.primarySurface : colors.backgroundSecondary, borderColor: colors.separator }, style]}>
      <View style={styles.row}>
        <Icon name={ready ? 'check-circle' : 'clock'} size={18} color={ready ? colors.primary : colors.textSecondary} />
        <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>{text}</Text>
      </View>
      {ready ? (
        <Button title={w('Start Job')} icon="play-circle" onPress={start} fullWidth style={{ marginTop: spacing.sm }} />
      ) : quote ? (
        <Button
          title={`View Quote ${quote.number}`}
          variant="secondary"
          onPress={() => router.push({ pathname: '/(owner)/document', params: { kind: 'quote', id: quote.id } } as any)}
          fullWidth
          style={{ marginTop: spacing.sm }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
});
