import { useT } from '@/i18n';
import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { sizing } from '@/theme/spacing';

let NativeTabs: any = null;
try {
  NativeTabs = require('expo-router/unstable-native-tabs').NativeTabs;
} catch {}

export interface SnowTab {
  /** Route file name inside the (tabs) folder. */
  name: string;
  title: string;
  feather: keyof typeof Feather.glyphMap;
  sf: string | { default: string; selected: string };
  /** Keep the route but leave it out of the tab bar (e.g. a lead-only tab for a non-lead). */
  hidden?: boolean;
}

/**
 * The tab bar for a Snow Mode shell (owner, worker or customer). Same
 * structure as the landscaping tab bars: native Liquid Glass tabs on iOS,
 * JS tabs on web. Colors come from the snow theme the layout wraps it in.
 */
export function SnowTabs({ tabs }: { tabs: SnowTab[] }) {
  const { colors } = useTheme();
  const tx = useT();

  if (NativeTabs != null && Platform.OS !== 'web') {
    return (
      <NativeTabs tintColor={colors.primary} minimizeBehavior="automatic">
        {tabs.map((t) => (
          <NativeTabs.Trigger key={t.name} name={t.name} hidden={!!t.hidden}>
            <NativeTabs.Trigger.Icon
              sf={t.sf}
              src={<NativeTabs.Trigger.VectorIcon family={Feather} name={t.feather} />}
            />
            <NativeTabs.Trigger.Label>{tx(t.title)}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        ))}
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.borderLight,
          borderTopWidth: 1,
          height: sizing.tabBarHeight + 20,
          paddingTop: 6,
        },
        tabBarLabelStyle: { ...typeScale.caption, marginTop: 2 },
      }}
    >
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: tx(t.title),
            ...(t.hidden ? { href: null } : {}),
            tabBarIcon: ({ color, size }) => <Feather name={t.feather} size={size} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
