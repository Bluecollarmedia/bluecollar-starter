/**
 * Auth Group Layout
 *
 * Minimal layout for the sign-in screens: welcome, login, create a company, forgot password.
 * (Workers and customers create their login from their private link; there is no plain "create an account" screen.)
 * No tab bar or header — just clean, focused auth UI.
 */

import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        animationDuration: 280,
      }}
    />
  );
}
