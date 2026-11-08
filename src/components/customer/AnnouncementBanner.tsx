/**
 * The banner on a customer's home screen for messages their landscaper sent them (see supabase/updates/055). It shows every
 * unread one, newest first, until the customer dismisses it. Dismissing marks that notification read; the message itself is
 * kept. This is the same notification that was pushed to their phone, so tapping a push lands them on the screen with the banner.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { useNotifications } from '@/hooks/useOperations';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

/** At most this many banners at once; the rest appear as the customer dismisses these. */
const MAX_BANNERS = 3;

export function AnnouncementBanner() {
  const t = useT();
  const { colors } = useTheme();
  const { notifications, markRead } = useNotifications();
  const unread = notifications
    .filter((n) => n.eventType === 'announcement_posted' && n.status === 'unread' && (n.metadata as { to?: string } | undefined)?.to === 'customers')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (unread.length === 0) return null;
  const shown = unread.slice(0, MAX_BANNERS);

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      {shown.map((n) => (
        <View key={n.id} style={[styles.banner, { backgroundColor: colors.primarySurface, borderColor: colors.primary }]}>
          <Icon name="volume-2" size={18} color={colors.primaryDark} />
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{n.title}</Text>
            {n.body ? <Text style={[typeScale.bodySmall, { color: colors.textPrimary, marginTop: 2 }]}>{n.body}</Text> : null}
          </View>
          <Pressable onPress={() => markRead(n.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Dismiss message: {title}', { title: n.title })}>
            <Icon name="x" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      ))}
      {unread.length > shown.length ? (
        <Text style={[typeScale.caption, { color: colors.textSecondary, textAlign: 'center' }]}>
          {unread.length - shown.length === 1
            ? t('1 more message after you dismiss these')
            : t('{count} more messages after you dismiss these', { count: unread.length - shown.length })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginBottom: spacing.md },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
});
