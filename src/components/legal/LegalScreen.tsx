import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { BUSINESS, LEGAL_DOCS, type LegalDoc } from '@/legal/legalContent';
import { useT } from '@/i18n';

/** Shows one of the legal pages. Works signed in or out, in the app and on the web. */
export function LegalScreen({ slug, onClose }: { slug: LegalDoc['slug']; /** Set when shown as a pop-up: Back closes it instead of navigating. */ onClose?: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const doc = LEGAL_DOCS[slug];

  function goBack() {
    if (onClose) { onClose(); return; }
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.back} accessibilityRole="button" accessibilityLabel={t('Go back')}>
          <Icon name="chevron-left" size={22} color={colors.textPrimary} />
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{t('Back')}</Text>
        </Pressable>
      </View>
      <ScrollView bounces={false} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing['3xl'] }]}>
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>{t(doc.title)}</Text>
        <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: spacing.sm }]}>{doc.intro}</Text>

        {slug === 'support' && (
          <View style={styles.actions}>
            <Action label={t('Email us')} icon="mail" onPress={() => Linking.openURL(`mailto:${BUSINESS.email}`)} />
            <Action label={t('Call us')} icon="phone" onPress={() => Linking.openURL(`tel:${BUSINESS.phone.replace(/\D/g, '')}`)} />
          </View>
        )}

        {doc.sections.map((s) => (
          <View key={s.heading} style={styles.section}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{s.heading}</Text>
            {s.paragraphs?.map((p, i) => (
              <Text key={i} style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: spacing.xs }]}>{p}</Text>
            ))}
            {s.bullets?.map((b, i) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>{'•'}</Text>
                <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, flex: 1 }]}>{b}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Action({ label, icon, onPress }: { label: string; icon: 'mail' | 'phone'; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.action, { backgroundColor: colors.primarySurface }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={16} color={colors.primary} />
      <Text style={[typeScale.labelLarge, { color: colors.primary, marginLeft: spacing.xs }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, maxWidth: 760, width: '100%', alignSelf: 'center' },
  section: { marginTop: spacing.xl },
  bulletRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, paddingRight: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  action: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, height: 44, borderRadius: radius.full },
});
