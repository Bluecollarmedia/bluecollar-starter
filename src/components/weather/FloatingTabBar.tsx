import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { scrollTopOf } from '@/lib/scrollTop';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useT } from '@/i18n';
import { WX } from '@/components/weather/WeatherUI';
import { usePortfolioEnabled } from '@/hooks/usePortfolio';

const TABS: { path: string; label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'] }[] = [
  { path: '/weather', label: 'Weather', icon: 'weather-partly-cloudy' },
  { path: '/weather/history', label: 'Storm History', icon: 'history' },
  { path: '/weather/work', label: 'Our Work', icon: 'image-multiple-outline' },
  { path: '/weather/request', label: 'Request', icon: 'clipboard-check-outline' },
  { path: '/weather/account', label: 'Brighton', icon: 'leaf' },
];

/** The Weather area's own tab bar: a solid white pill floating above the page. (The app's other tab bars are untouched.) */
export function FloatingTabBar() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  // Our Work is in the bar only while the owner's switch for it is on.
  const workOn = usePortfolioEnabled();
  const tabs = TABS.filter((tab) => tab.path !== '/weather/work' || workOn);
  // Full-screen viewers (a video, a story) have no tab bar over them.
  if (pathname.startsWith('/weather/work-video') || pathname.startsWith('/weather/work-story')) return null;
  return (
    <View style={[styles.wrap, { bottom: Math.max(insets.bottom, 10) + 4 }]} pointerEvents="box-none">
      <View style={styles.bar}>
        {tabs.map((tab) => {
          const on = tab.path === '/weather' ? pathname === '/weather' || pathname === '/weather/' || pathname.startsWith('/weather/outlook') : pathname.startsWith(tab.path);
          return (
            <Pressable
              key={tab.path}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t(tab.label)}
              onPress={() => {
                // Tapping the tab you are already on takes that page back to its top (a long page, the Our Work feed, anything).
                if (on) scrollTopOf(tab.path);
                else router.navigate(tab.path as any);
              }}
              style={({ pressed }) => [styles.item, on && styles.itemOn, pressed && !on && { backgroundColor: WX.leafTint }]}
            >
              <MaterialCommunityIcons name={tab.icon} size={23} color={on ? WX.deep : WX.soft} />
              <Text style={[styles.label, on && { color: WX.deep, fontWeight: '700' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{t(tab.label)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 18, right: 18 },
  bar: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 6, borderRadius: 99,
    backgroundColor: WX.white, borderWidth: 1, borderColor: WX.line,
    shadowColor: '#14803C', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  item: { flex: 1, alignItems: 'center', minHeight: 48, justifyContent: 'center', paddingHorizontal: 4, borderRadius: 99 },
  itemOn: { backgroundColor: WX.leafTint },
  label: { color: WX.soft, fontSize: 10.5, marginTop: 2, fontWeight: '500' },
});
