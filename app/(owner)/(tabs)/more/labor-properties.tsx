import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { SearchBar } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { db, useDb } from '@/data/store';
import { Card, Empty, LaborScreen } from '@/components/time/LaborBits';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { w } from '@/config/brand';

/** Pick a project to see every visit and its labor. */
export default function LaborPropertiesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  useDb();
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const projects = useMemo(() => db.projects.filter((p) => !ql || p.name.toLowerCase().includes(ql)).slice().sort((a, b) => a.name.localeCompare(b.name)), [ql, db.projects]);
  const open = (id: string, name: string) =>
    router.push({ pathname: '/(owner)/more/labor-property', params: { id, name } } as never);

  const row = (key: string, name: string, sub: string, onPress: () => void) => (
    <Pressable key={key} onPress={onPress} accessibilityRole="button" style={[styles.row, { borderColor: colors.borderLight }]}>
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{name}</Text>
        <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{sub}</Text>
      </View>
      <Icon name="chevron-right" size={18} color={colors.textTertiary} />
    </Pressable>
  );

  return (
    <LaborScreen title={w('Job site & Job History')}>
      <SearchBar value={q} onChangeText={setQ} placeholder={w('Search jobs')} />
      <Card title={w('JOBS')}>
        {projects.length === 0 ? <Empty icon="briefcase" text={w('No jobs match.')} /> : projects.map((p) => row(p.id, p.name, p.status.replace(/_/g, ' '), () => open(p.id, p.name)))}
      </Card>
    </LaborScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth },
});
