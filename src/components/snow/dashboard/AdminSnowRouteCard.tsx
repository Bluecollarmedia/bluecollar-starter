import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/providers/ThemeProvider';
import { db } from '@/data/store';
import { loadMyRoutes, type MyRoute } from '@/data/snowRoutes';
import { setAdminWorksSnow } from '@/lib/adminSnowWork';
import { haptics } from '@/lib/haptics';
import { useT } from '@/i18n';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

/**
 * An admin who leads (or is on the crew of) a dispatched Snow route sees it here, and opens it as a worker would: the route and its stops,
 * and the Snow time clock. Nothing for the owner, nor for an admin with no route in a storm that is under way.
 */
export function AdminSnowRouteCard() {
  const { colors } = useTheme();
  const router = useRouter();
  const t = useT();
  const [routes, setRoutes] = useState<MyRoute[]>([]);
  const isAdmin = db.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    loadMyRoutes().then((r) => { if (alive && r.ok) setRoutes(r.data.filter((x) => x.stormStatus === 'dispatched')); });
    return () => { alive = false; };
  }, [isAdmin]);

  if (!isAdmin || !routes.length) return null;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
      <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{t('Your route')}</Text>
      {routes.map((r) => (
        <Text key={r.id} style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>{r.stormName} · {r.name}</Text>
      ))}
      <Pressable
        onPress={() => { haptics.select(); setAdminWorksSnow(true); router.push('/snow/worker' as any); }}
        accessibilityRole="button"
        style={[styles.open, { backgroundColor: colors.primaryDark }]}
      >
        <Text style={[typeScale.labelLarge, { color: '#FFFFFF' }]}>{t('Open my route')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md, gap: spacing.xs },
  open: { minHeight: 44, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
});
