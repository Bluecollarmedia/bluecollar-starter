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
  if (ready && quote) text = `Quote ${quote.number} was approved (${formatMoney(quote.total)}). Start the project to schedule crews and add tasks.`;
  else if (quote) text = `Prospect: quote ${quote.number} is ${STATUS_LABEL[displayStatus({ kind: 'quote', ...quote })].toLowerCase()}. It becomes a project once the quote is approved.`;
  else text = 'Prospect: not on the schedule yet. Create a quote; once it’s approved you can start the project.';

  const start = () => confirmAction(
    'Start this project?',
    `${project.name} becomes an active project with ${quote?.number ?? 'the approved quote'} attached. No one is scheduled until you add them.`,
    'Start Project',
    () => startProjectFromQuote(projectId),
  );

  return (
    <View style={[styles.wrap, { backgroundColor: ready ? colors.primarySurface : colors.backgroundSecondary, borderColor: colors.separator }, style]}>
      <View style={styles.row}>
        <Icon name={ready ? 'check-circle' : 'clock'} size={18} color={ready ? colors.primary : colors.textSecondary} />
        <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>{text}</Text>
      </View>
      {ready ? (
        <Button title="Start Project" icon="play-circle" onPress={start} fullWidth style={{ marginTop: spacing.sm }} />
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
