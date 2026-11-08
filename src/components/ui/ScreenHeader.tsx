/**
 * ScreenHeader — the top of a pushed owner screen (Trucks, Join
 * Requests, Notifications, ...).
 *
 * A Liquid Glass back button on the left (the same glass material as
 * the Schedule tab's Day/Week control), optional buttons on the right,
 * then a large title and subtitle underneath. Also exports the two
 * header buttons so screens can use them on their own.
 */

import React from 'react';
import { View, Text, StyleSheet, Platform, ViewStyle, StyleProp } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { UnreadBadge } from './UnreadBadge';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

const HAS_LIQUID_GLASS = isLiquidGlassAvailable();
const BUTTON_SIZE = 44;

interface GlassIconButtonProps {
  icon: string;
  onPress: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  /** Unread count shown as a small red badge (nothing when 0 or missing). */
  badge?: number;
}

/** Round glass button. Real Liquid Glass on iOS 26, a frosted chip elsewhere. */
export function GlassIconButton({ icon, onPress, accessibilityLabel, style, badge }: GlassIconButtonProps) {
  const { colors } = useTheme();
  const glyph = <Icon name={icon as any} size={22} color={colors.textPrimary} />;
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.9}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={style}
    >
      <View>
      {HAS_LIQUID_GLASS ? (
        <GlassView glassEffectStyle="regular" isInteractive style={styles.glassButton}>
          {glyph}
        </GlassView>
      ) : (
        <View
          style={[
            styles.glassButton,
            styles.frosted,
            { backgroundColor: colors.surface, borderColor: colors.borderLight },
          ]}
        >
          {glyph}
        </View>
      )}
        {badge ? <UnreadBadge count={badge} /> : null}
      </View>
    </PressableScale>
  );
}

interface RaisedAddButtonProps {
  onPress: () => void;
  accessibilityLabel: string;
  icon?: string;
}

/** The + button: a flat deep-forest circle with a white plus. Springs when tapped. */
export function RaisedAddButton({ onPress, accessibilityLabel, icon = 'plus' }: RaisedAddButtonProps) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.9}
      haptic="light"
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[styles.raisedButton, { backgroundColor: colors.primary }]}>
        <Icon name={icon as any} size={22} color="#FFFFFF" />
      </View>
    </PressableScale>
  );
}

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Buttons shown top-right (e.g. a RaisedAddButton). */
  right?: React.ReactNode;
  /** Override the back action (defaults to router.back()). */
  onBack?: () => void;
  /** Hide the back button (e.g. when the screen is a tab's root). */
  hideBack?: boolean;
}

export function ScreenHeader({ title, subtitle, right, onBack, hideBack }: ScreenHeaderProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      {/* With no Back button the action sits on the RIGHT, like every other tab (it used to jump to the left). */}
      <View style={[styles.buttonRow, hideBack && { justifyContent: 'flex-end' }]}>
        {hideBack ? null : (
          <GlassIconButton
            icon="chevron-left"
            onPress={onBack ?? (() => router.back())}
            accessibilityLabel="Go back"
          />
        )}
        <View style={styles.right}>{right}</View>
      </View>
      <Animated.View entering={FadeIn.duration(260)}>
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>{subtitle}</Text>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  glassButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  frosted: {
    borderWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      android: { elevation: 1 },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
    }),
  },
  raisedButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
