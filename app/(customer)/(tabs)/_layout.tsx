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

function CustomerNativeTabs() {
  const t = useT();
  const { colors } = useTheme();

  return (
    <NativeTabs
      tintColor={colors.primary}
      minimizeBehavior="automatic"
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'house', selected: 'house.fill' }}
          src={<NativeTabs.Trigger.VectorIcon family={Feather} name="home" />}
        />
        <NativeTabs.Trigger.Label>{t('Properties')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="messages">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'message', selected: 'message.fill' }}
          src={<NativeTabs.Trigger.VectorIcon family={Feather} name="message-circle" />}
        />
        <NativeTabs.Trigger.Label>{t('Messages')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person', selected: 'person.fill' }}
          src={<NativeTabs.Trigger.VectorIcon family={Feather} name="user" />}
        />
        <NativeTabs.Trigger.Label>{t('Account')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function CustomerJSTabs() {
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
          title: t('Properties'),
          tabBarIcon: ({ color, size }) => (
            <Feather name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: t('Messages'),
          tabBarIcon: ({ color, size }) => (
            <Feather name="message-circle" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('Account'),
          tabBarIcon: ({ color, size }) => (
            <Feather name="user" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

export default function CustomerTabsLayout() {
  const useNative = NativeTabs != null && Platform.OS !== 'web';

  return useNative ? <CustomerNativeTabs /> : <CustomerJSTabs />;
}
