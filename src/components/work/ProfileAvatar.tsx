import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { OptimizedImage } from '@/components/ui';

/**
 * The picture that stands for Brighton on Our Work: the one the owner chose (More > Our Work > About us), or the leaf logo when none is set.
 * It fills a circle of `size`. Used on the profile, in stories, and beside the name in a project and a reel.
 */
export function ProfileAvatar({ uri, size }: { uri?: string | null; size: number }) {
  const circle = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <OptimizedImage source={uri} style={circle} />;
  return (
    <View style={[styles.leafBg, circle]}>
      <Image source={require('../../../assets/images/logo-leaf.png')} style={{ width: size * 0.5, height: size * 0.5, tintColor: '#2E5E34' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  leafBg: { backgroundColor: '#E3F1DC', alignItems: 'center', justifyContent: 'center' },
});
