import React, { useEffect, useRef, useState } from 'react';
import { useHasSnow } from '@/hooks/useHasSnow';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { EmptyState, GlassIconButton } from '@/components/ui';
import { MessageComposer, MessageList } from '@/components/messages/MessageThread';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { db, useDb } from '@/data/store';

/**
 * Customer ↔ owner chat. The message box sits at the bottom of the screen
 * (above the tab bar), rises exactly to the top of the keyboard when typing,
 * and the messages scroll above it.
 */
export default function CustomerMessagesScreen() {
  const t = useT();
  const hasSnow = useHasSnow();
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const keyboardOpen = useKeyboardState((s) => s.isVisible);
  const v = useDb();
  const scrollRef = useRef<ScrollView>(null);

  const projects = db.projects.filter((p) => p.customerId === user?.id || p.customerClaimedBy === user?.id);
  const [selectedId, setSelectedId] = useState<string | undefined>(projects[0]?.id);
  const projectId = projects.some((p) => p.id === selectedId) ? selectedId : projects[0]?.id;
  const count = projectId ? db.messages[projectId]?.length ?? 0 : 0;

  // Keep the newest message in view, also when the keyboard opens or closes.
  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [count, projectId, v, keyboardOpen]);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(customer)' as any);
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + spacing.sm }]}
    >
      <View style={styles.header}>
        <GlassIconButton icon="chevron-left" onPress={goBack} accessibilityLabel={t('Back')} />
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>{t('Messages')}</Text>
          {db.company?.name ? (
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>{t('Chat with {company}', { company: db.company.name })}</Text>
          ) : null}
        </View>
      </View>

      {projects.length > 1 && (
        <View style={styles.chips}>
          {projects.map((p) => {
            const active = p.id === projectId;
            return (
              <Pressable
                key={p.id}
                onPress={() => setSelectedId(p.id)}
                style={[styles.chip, { backgroundColor: active ? colors.primary : colors.backgroundTertiary }]}
              >
                <Text style={[typeScale.labelSmall, { color: active ? '#FFFFFF' : colors.textSecondary, fontWeight: '600' }]}>{p.name}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {projectId ? (
        <>
          <ScrollView bounces={false}
            ref={scrollRef}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, flexGrow: 1, justifyContent: 'flex-end' }}
          >
            <MessageList
              projectId={projectId}
              emptyText={t('Questions about your project? Send a message and your landscaper will reply here.')}
            />
          </ScrollView>
          <View
            style={{
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.sm,
              // Above the floating tab bar when the keyboard is closed; just above the keyboard when it is open.
              paddingBottom: keyboardOpen ? spacing.sm : tabBarClearance,
            }}
          >
            <MessageComposer projectId={projectId} />
          </View>
        </>
      ) : (
        <EmptyState
          icon="message-circle"
          title={t('No messages')}
          description={hasSnow
            ? t('Messages are for landscaping projects. Your snow updates and photos are on the Account tab.')
            : t("Once you're added to a project, you can message your landscaper here.")}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full },
});
