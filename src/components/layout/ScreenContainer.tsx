/**
 * ScreenContainer — Standard Screen Wrapper
 *
 * Handles safe areas, scroll behavior, background color,
 * and max-width centering for tablet/web layouts.
 */

import React from 'react';
import {
  View,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useTheme } from '@/providers/ThemeProvider';
import { spacing, sizing } from '@/theme/spacing';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';

interface ScreenContainerProps {
  children: React.ReactNode;
  scrollable?: boolean;
  padded?: boolean;
  centered?: boolean;
  keyboardAvoiding?: boolean;
  /** 'grouped' uses the iOS grouped-list background (light gray) so white
   * ListSection/Card surfaces read clearly against it — use for
   * settings/list-style screens. Defaults to the plain screen background. */
  variant?: 'plain' | 'grouped';
  style?: ViewStyle;
  contentStyle?: ViewStyle;
}

export function ScreenContainer({
  children,
  scrollable = true,
  padded = true,
  centered = false,
  keyboardAvoiding = false,
  variant = 'plain',
  style,
  contentStyle,
}: ScreenContainerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();

  const outerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: variant === 'grouped' ? colors.groupedBackground : colors.background,
  };

  const innerStyle: ViewStyle = {
    flex: scrollable ? undefined : 1,
    ...(padded ? { paddingHorizontal: spacing.lg } : {}),
    ...(centered
      ? {
          maxWidth: sizing.maxContentWidth,
          width: '100%',
          alignSelf: 'center' as const,
        }
      : {}),
    // Scrollable screens get extra room so their last item can scroll out
    // from under the floating tab bar.
    paddingBottom: scrollable ? tabBarClearance : insets.bottom || spacing.lg,
    ...contentStyle,
  };

  const content = <View style={innerStyle}>{children}</View>;

  const scrollContent = scrollable ? (
    // Scrolls the focused field above the keyboard.
    <KeyboardAwareScrollView bounces={false}
      bottomOffset={KEYBOARD_GAP}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {content}
    </KeyboardAwareScrollView>
  ) : (
    content
  );

  const wrapped = keyboardAvoiding && !scrollable ? (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {scrollContent}
    </KeyboardAvoidingView>
  ) : (
    scrollContent
  );

  return <View style={[outerStyle, style]}>{wrapped}</View>;
}

/** Space kept between the focused field and the top of the keyboard. */
export const KEYBOARD_GAP = 24;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
});
