import React from 'react';
import { Tabs } from 'expo-router';
import { FloatingTabBar } from '@/components/weather/FloatingTabBar';

/**
 * The public Brighton Weather tabs (Weather, Our Work while the owner has it on, Request, Brighton) with their own floating tab bar.
 * The screens stay alive once opened, so switching is instant and each keeps its place (scroll position, the hourly strip).
 * A project, a reel or a story is NOT a tab: those are screens in the stack above (see ../_layout.tsx), so they slide in, swipe back and close for real.
 */
export default function WeatherTabsLayout() {
  return (
    <Tabs
      backBehavior="history"
      tabBar={() => <FloatingTabBar />}
      screenOptions={{ headerShown: false, lazy: true, sceneStyle: { backgroundColor: 'transparent' } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="work" />
      <Tabs.Screen name="request" />
      <Tabs.Screen name="account" />
    </Tabs>
  );
}
