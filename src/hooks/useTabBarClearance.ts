import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '@/theme/spacing';

/**
 * Height of the iOS Liquid Glass tab bar that floats over screen content.
 * Native tabs only auto-inset a ScrollView that is the screen's very first
 * child, and most of our screens wrap theirs in a View — so their last items
 * ended up hidden under the bar. Generous on purpose: extra space at the end
 * of a scroll is harmless, a hidden button is not.
 */
const IOS_TAB_BAR_OVERLAP = 84;

/** Bottom padding a scrollable screen needs so its last item clears the tab bar. */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  if (Platform.OS === 'ios') return insets.bottom + IOS_TAB_BAR_OVERLAP;
  return (insets.bottom || 0) + spacing.lg;
}
