import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';
import { useIssues, type IssueWhere } from '@/data/issues';
import { IssueRow } from './IssueRow';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

/** Owner: every problem reported at one property or project (hidden when there are none). */
export function IssuesSection({ where }: { where: IssueWhere }) {
  const { colors } = useTheme();
  const issues = useIssues(where);
  if (issues.length === 0) return null;
  const open = issues.filter((i) => i.status === 'open').length;
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={[typeScale.overline, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
        {open ? `ISSUES · ${open} OPEN` : 'ISSUES'}
      </Text>
      <View style={{ gap: spacing.sm }}>
        {issues.slice(0, 5).map((i) => <IssueRow key={i.id} issue={i} showPlace={false} />)}
      </View>
    </View>
  );
}
