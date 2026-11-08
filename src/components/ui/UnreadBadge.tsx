/**
 * The small red unread count on a bell. Shows the real number of unread notifications, and nothing at all when there are none
 * (never a "0"). Put it inside a relatively positioned wrapper around the bell.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNotifications } from '@/hooks/useOperations';
import { typeScale } from '@/theme/typography';

/** "9+" would hide the real number, so only very large counts are shortened. */
export const badgeText = (n: number) => (n > 99 ? '99+' : String(n));

export function UnreadBadge({ count }: { count?: number }) {
  const live = useNotifications().unreadCount;
  const n = count ?? live;
  if (n <= 0) return null;
  return (
    <View style={styles.badge} pointerEvents="none" accessible accessibilityLabel={`${n} unread notification${n === 1 ? '' : 's'}`}>
      <Text style={[typeScale.caption, styles.text]}>{badgeText(n)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: '#E53935',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { color: '#FFFFFF', fontSize: 11, lineHeight: 13, fontWeight: '800' },
});
