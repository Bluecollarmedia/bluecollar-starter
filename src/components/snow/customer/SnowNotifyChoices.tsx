/**
 * The customer's own Snow notification switches, in Account (Settings): "Crew arrives" and "Service finished". They turn a kind of
 * message off (or back on) just for this customer. Which messages the company sends at all is the owner's setting; this never changes it.
 * Saving is immediate: the switch moves at once and goes back if it could not be saved.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ListSection } from '@/components/ui';
import { Switch } from '@/components/ui/Switch';
import { IconTile } from '@/components/settings/SettingsList';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { loadNotifyChoices, saveNotifyChoices, type NotifyChoices } from '@/data/snowCustomer';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

const ROWS: { key: keyof NotifyChoices; title: string; text: string; icon: 'bell' | 'check-circle' }[] = [
  { key: 'crewArrives', title: 'Crew arrives', text: 'A message when the crew gets to your property.', icon: 'bell' },
  { key: 'serviceFinished', title: 'Service finished', text: 'A message when the work is done.', icon: 'check-circle' },
];

export function SnowNotifyChoices() {
  const t = useT();
  const { colors } = useTheme();
  const [choices, setChoices] = useState<NotifyChoices | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    loadNotifyChoices().then((r) => { if (alive && r.ok) setChoices(r.data); });
    return () => { alive = false; };
  }, []));

  async function change(key: keyof NotifyChoices, next: boolean) {
    if (!choices || busy) return;
    const before = choices;
    setChoices({ ...choices, [key]: next });
    setBusy(true);
    const res = await saveNotifyChoices({ [key]: next });
    setBusy(false);
    if (!res.ok) {
      setChoices(before);
      const msg = t(res.error);
      if (Platform.OS === 'web') alert(msg); else Alert.alert(t("Couldn't save"), msg);
    }
  }

  // Not loaded (or the database has no choices yet): show nothing rather than switches that do nothing.
  if (!choices) return null;

  return (
    <ListSection title={t('Snow notifications')} footer={t('Your company decides which messages are sent. These switches turn them off just for you.')}>
      {ROWS.map((r) => (
        <View key={r.key} style={styles.row}>
          <IconTile name={r.icon} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{t(r.title)}</Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 1 }]}>{t(r.text)}</Text>
          </View>
          <Switch value={choices[r.key]} disabled={busy} onValueChange={(v) => change(r.key, v)} accessibilityLabel={t(r.title)} />
        </View>
      ))}
    </ListSection>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
});
