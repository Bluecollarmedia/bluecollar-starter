/**
 * Owner Settings: "Customer Message Notifications", the on/off for the phone alert only. Messages always reach the in-app
 * notification center and the unread badge, whatever this says. The phone's own permission is separate: when it is off we say
 * so and offer to open the phone's notification settings. We never ask for the permission again on our own here.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, Linking, Pressable, StyleSheet, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { Switch } from '@/components/ui/Switch';
import { IconTile } from '@/components/settings/SettingsList';
import { useTheme } from '@/providers/ThemeProvider';
import { useDb } from '@/data/store';
import { customerMessagePushEnabled, setCustomerMessagePush } from '@/data/pushPrefs';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

type OsState = 'unknown' | 'granted' | 'denied' | 'undetermined';

export function CustomerMessagePushRow() {
  const { colors } = useTheme();
  useDb();
  const on = customerMessagePushEnabled();
  const [os, setOs] = useState<OsState>('unknown');

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return;
      let alive = true;
      import('expo-notifications')
        .then((N) => N.getPermissionsAsync())
        .then((p) => { if (alive) setOs(p.granted ? 'granted' : p.canAskAgain === false || p.status === 'denied' ? 'denied' : 'undetermined'); })
        .catch(() => {});
      return () => { alive = false; };
    }, []),
  );

  return (
    <View>
      <View style={styles.row}>
        <IconTile name="bell" color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>Customer Message Notifications</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 1 }]}>Receive push notifications when customers send you messages.</Text>
        </View>
        <Switch value={on} onValueChange={setCustomerMessagePush} accessibilityLabel="Customer Message Notifications" />
      </View>
      {on && os === 'denied' && (
        <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button" style={styles.warn}>
          <Icon name="alert-triangle" size={16} color={colors.warning} />
          <Text style={[typeScale.caption, { color: colors.textSecondary, flex: 1 }]}>
            Notifications are turned off for this app in your phone's settings, so alerts can't reach you. Messages still show in your notification center.
            <Text style={{ color: colors.primary, fontWeight: '700' }}> Open phone settings</Text>
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  warn: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', paddingHorizontal: spacing.md, paddingBottom: spacing.md },
});
