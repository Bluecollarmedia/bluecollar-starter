import React from 'react';
import { Tabs } from 'expo-router';
import { FloatingTabBar } from '@/components/weather/FloatingTabBar';

/**
 * The public Weather tabs (Weather, Request, Contact) with their own floating tab bar.
 * The screens stay alive once opened, so switching is instant and each keeps its place (scroll position, the hourly strip).
 */
export default function WeatherTabsLayout() {
  return (
    <Tabs
      backBehavior="history"
      tabBar={() => <FloatingTabBar />}
      screenOptions={{ headerShown: false, lazy: true, sceneStyle: { backgroundColor: 'transparent' } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="request" />
      <Tabs.Screen name="account" />
    </Tabs>
  );
}
