import { useT } from '@/i18n';
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

function MaintenanceNativeTabs() {
  const t = useT();
  const { colors } = useTheme();

  return (
    <NativeTabs
      tintColor={colors.primary}
      minimizeBehavior="automatic"
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'sun.max', selected: 'sun.max.fill' }}
          src={<NativeTabs.Trigger.VectorIcon family={Feather} name="sun" />}
        />
        <NativeTabs.Trigger.Label>{t('Today')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="route">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'map', selected: 'map.fill' }}
          src={<NativeTabs.Trigger.VectorIcon family={Feather} name="map" />}
        />
        <NativeTabs.Trigger.Label>{t('Route')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="activity">
        <NativeTabs.Trigger.Icon
          sf="chart.xyaxis.line"
          src={<NativeTabs.Trigger.VectorIcon family={Feather} name="activity" />}
        />
        <NativeTabs.Trigger.Label>{t('Activity')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
          src={<NativeTabs.Trigger.VectorIcon family={Feather} name="settings" />}
        />
        <NativeTabs.Trigger.Label>{t('Settings')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function MaintenanceJSTabs() {
  const t = useT();
  const { colors } = useTheme();

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
        tabBarLabelStyle: {
          ...typeScale.caption,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('Today'),
          tabBarIcon: ({ color, size }) => (
            <Feather name="sun" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="route"
        options={{
          title: t('Route'),
          tabBarIcon: ({ color, size }) => (
            <Feather name="map" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: t('Activity'),
          tabBarIcon: ({ color, size }) => (
            <Feather name="activity" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('Settings'),
          tabBarIcon: ({ color, size }) => (
            <Feather name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

/**
 * Maintenance workers' own tab bar: Today (route-first), Route, Activity,
 * Settings. Separate from the regular worker's (tabs) so a maintenance
 * worker never sees the project-based Jobs screens.
 */
export default function MaintenanceTabsLayout() {
  const useNative = NativeTabs != null && Platform.OS !== 'web';

  return useNative ? <MaintenanceNativeTabs /> : <MaintenanceJSTabs />;
}
