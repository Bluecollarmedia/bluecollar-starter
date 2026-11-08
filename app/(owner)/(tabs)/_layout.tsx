import { useT } from '@/i18n';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { sizing } from '@/theme/spacing';

// Native tabs for iOS Liquid Glass — falls back to JS tabs on web/Android-if-needed
let NativeTabs: any = null;
try {
  NativeTabs = require('expo-router/unstable-native-tabs').NativeTabs;
} catch {}

function OwnerNativeTabs() {
  const t = useT();
  const { colors } = useTheme();

  return (
    <NativeTabs
      tintColor={colors.primary}
      minimizeBehavior="automatic"
      sidebarAdaptable={Platform.OS === 'ios'}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'house', selected: 'house.fill' }}
          src={<NativeTabs.Trigger.VectorIcon family={Feather} name="home" />}
        />
        <NativeTabs.Trigger.Label>{t('Dashboard')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="projects">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'folder', selected: 'folder.fill' }}
          src={<NativeTabs.Trigger.VectorIcon family={Feather} name="folder" />}
        />
        <NativeTabs.Trigger.Label>{t('Projects')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="maintenance">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'leaf', selected: 'leaf.fill' }}
          src={<NativeTabs.Trigger.VectorIcon family={Feather} name="feather" />}
        />
        <NativeTabs.Trigger.Label>{t('Maintenance')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="workers">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.2', selected: 'person.2.fill' }}
          src={<NativeTabs.Trigger.VectorIcon family={Feather} name="users" />}
        />
        <NativeTabs.Trigger.Label>{t('Workers')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Icon
          sf="ellipsis"
          src={<NativeTabs.Trigger.VectorIcon family={Feather} name="menu" />}
        />
        <NativeTabs.Trigger.Label>{t('More')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function OwnerJSTabs() {
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
          // Tighter than caption so "Maintenance" fits on a 375pt-wide phone
          // (about the size of the iOS tab bar's own labels).
          fontSize: 10.5,
          letterSpacing: 0,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('Dashboard'),
          tabBarIcon: ({ color, size }) => (
            <Feather name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: t('Projects'),
          tabBarIcon: ({ color, size }) => (
            <Feather name="folder" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="maintenance"
        options={{
          title: t('Maintenance'),
          tabBarIcon: ({ color, size }) => (
            <Feather name="feather" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="workers"
        options={{
          title: t('Workers'),
          tabBarIcon: ({ color, size }) => (
            <Feather name="users" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('More'),
          tabBarIcon: ({ color, size }) => (
            <Feather name="menu" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

export default function OwnerTabsLayout() {
  const useNative = NativeTabs != null && Platform.OS !== 'web';

  return useNative ? <OwnerNativeTabs /> : <OwnerJSTabs />;
}
