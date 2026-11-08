/**
 * The form for an announcement to your workers: title, message, priority, an optional weather action, and Send. It lives right on the
 * Announcements page (no separate screen to open). After it sends, the form clears, the keyboard goes away, and the new announcement
 * shows in the list below it.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Alert, Platform, Keyboard } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import type { WeatherActionType } from '@/types/operations';

const WEATHER_OPTIONS: { key: WeatherActionType | 'none'; label: string; icon: string }[] = [
  { key: 'none', label: 'None', icon: 'slash' },
  { key: 'weather_warning', label: 'Weather Warning', icon: 'cloud' },
  { key: 'delayed_start', label: 'Delayed Start', icon: 'clock' },
  { key: 'no_work', label: 'No Work Today', icon: 'x-circle' },
  { key: 'early_finish', label: 'Early Finish', icon: 'sunset' },
];

const MESSAGE_MAX = 500;

export function WorkerAnnouncementComposer({ onSent }: { onSent?: () => void }) {
  const { colors } = useTheme();
  const { addAnnouncement } = useAnnouncements();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
  const [weatherAction, setWeatherAction] = useState<WeatherActionType | 'none'>('none');

  function handleSend() {
    if (!title.trim() || !body.trim()) {
      const msg = 'Please enter a title and message.';
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Required', msg);
      return;
    }
    addAnnouncement({
      title: title.trim(),
      body: body.trim(),
      audience: 'all_workers',
      priority,
      weatherAction: weatherAction === 'none' ? undefined : weatherAction,
    });
    // Sent: clear the form and put the keyboard away; the announcement appears in the list below.
    Keyboard.dismiss();
    setTitle('');
    setBody('');
    setPriority('normal');
    setWeatherAction('none');
    onSent?.();
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }, shadow.sm]}>
      <View style={styles.field}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.xs }]}>Title</Text>
        <TextInput
          style={[styles.input, { borderColor: colors.borderLight, backgroundColor: colors.backgroundSecondary, color: colors.textPrimary }]}
          value={title}
          onChangeText={setTitle}
          placeholder="Announcement title..."
          placeholderTextColor={colors.textTertiary}
        />
      </View>

      <View style={styles.field}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.xs }]}>Message</Text>
        <TextInput
          style={[styles.input, styles.messageInput, { borderColor: colors.borderLight, backgroundColor: colors.backgroundSecondary, color: colors.textPrimary }]}
          value={body}
          onChangeText={(v) => setBody(v.slice(0, MESSAGE_MAX))}
          placeholder="Write your message to the team..."
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={MESSAGE_MAX}
        />
        <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'right', marginTop: 2 }]}>
          {body.length}/{MESSAGE_MAX}
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.xs }]}>Priority</Text>
        <View style={styles.priorityRow}>
          <Pressable
            style={[styles.priorityPill, { borderColor: colors.borderLight }, priority === 'normal' && { backgroundColor: colors.primarySurface, borderColor: colors.primary }]}
            onPress={() => setPriority('normal')}
            accessibilityRole="button"
            accessibilityState={{ selected: priority === 'normal' }}
          >
            <View style={[styles.radioDot, { borderColor: priority === 'normal' ? colors.primary : colors.textTertiary }]}>
              {priority === 'normal' && <View style={[styles.radioDotFill, { backgroundColor: colors.primary }]} />}
            </View>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: priority === 'normal' ? '700' : '500', marginLeft: spacing.xs }]}>Normal</Text>
          </Pressable>
          <Pressable
            style={[styles.priorityPill, { borderColor: colors.borderLight }, priority === 'urgent' && { backgroundColor: semantic.errorLight, borderColor: semantic.error }]}
            onPress={() => setPriority('urgent')}
            accessibilityRole="button"
            accessibilityState={{ selected: priority === 'urgent' }}
          >
            <View style={[styles.radioDot, { borderColor: priority === 'urgent' ? semantic.error : colors.textTertiary }]}>
              {priority === 'urgent' && <View style={[styles.radioDotFill, { backgroundColor: semantic.error }]} />}
            </View>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: priority === 'urgent' ? '700' : '500', marginLeft: spacing.xs }]}>Urgent</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.field}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>Weather Action</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textTertiary, marginLeft: spacing.xs }]}>(optional)</Text>
        </View>
        <View style={[styles.weatherGrid, { marginTop: spacing.xs }]}>
          {WEATHER_OPTIONS.map((opt) => {
            const active = weatherAction === opt.key;
            return (
              <Pressable
                key={opt.key}
                style={[styles.weatherOption, { borderColor: colors.borderLight }, active && { backgroundColor: colors.primarySurface, borderColor: colors.primary }]}
                onPress={() => setWeatherAction(opt.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Icon name={opt.icon as any} size={16} color={active ? colors.primary : colors.textSecondary} />
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: active ? '700' : '500', marginLeft: spacing.xs, flexShrink: 1 }]} numberOfLines={1}>
                  {opt.label}
                </Text>
                {active && (
                  <View style={[styles.checkBadge, { backgroundColor: colors.primary }]}>
                    <Icon name="check" size={11} color="#FFFFFF" />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.pushInfoCard, { backgroundColor: '#DCE9FB' }]}>
        <Icon name="bell" size={18} color="#2E6BD6" />
        <View style={{ marginLeft: spacing.sm, flex: 1 }}>
          <Text style={[typeScale.bodySmall, { color: '#2E6BD6', fontWeight: '700' }]}>Push notifications will be sent</Text>
          <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]}>
            All active workers will receive a push notification for this announcement.
          </Text>
        </View>
      </View>

      <Pressable style={[styles.sendButton, { backgroundColor: colors.primary }]} onPress={handleSend} accessibilityRole="button" accessibilityLabel="Send to all workers">
        <Icon name="send" size={17} color="#FFFFFF" />
        <Text style={[typeScale.labelLarge, { color: '#FFFFFF', fontWeight: '700', marginLeft: spacing.xs }]}>Send to All Workers</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, borderWidth: 1, padding: spacing.lg },
  field: { marginBottom: spacing.lg },
  input: {
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typeScale.bodyLarge.fontSize,
  },
  messageInput: { minHeight: 110, textAlignVertical: 'top' },
  priorityRow: { flexDirection: 'row', gap: spacing.sm },
  priorityPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
  },
  radioDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioDotFill: { width: 8, height: 8, borderRadius: 4 },
  weatherGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  weatherOption: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  checkBadge: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' },
  pushInfoCard: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  sendButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, paddingVertical: spacing.md },
});
