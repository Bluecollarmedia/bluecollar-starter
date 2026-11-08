/**
 * Root Layout
 *
 * Wraps the entire app in providers (Theme, Auth) and handles
 * the splash screen lifecycle. Routes based on auth + onboarding state.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { usePrefetchKeyImages } from '@/lib/imageCache';
import { StyleSheet } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { SplashScreen } from '@/components/branding/SplashScreen';
import { AppNotSetUpScreen } from '@/components/branding/AppNotSetUpScreen';
import { isAppNotSetUp } from '@/lib/supabase';
import { SignInWelcome } from '@/components/branding/WelcomeOverlay';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { applyPendingSignup } from '@/data/pendingSignup';
import { ensureGlobalErrorHandler, installGlobalErrorHandler, showLastErrorIfAny } from '@/lib/errorReporting';
import { installWebAlert } from '@/lib/webDialog';
import { syncLanguageToAccount } from '@/i18n';
import { db } from '@/data/store';
import { todayKey } from '@/lib/ids';
import { hasOpenProjectWork } from '@/lib/workerAreas';
import { WebDialogHost } from '@/components/ui/WebDialogHost';
import { usePublicWeatherSwitch } from '@/hooks/usePublicWeatherSwitch';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { signedOutRedirect } from '@/lib/launchRoute';
import { sweepStorageSoon } from '@/lib/storageSweep';
import { blockedFeature } from '@/config/featureRoutes';
import { FeatureOffScreen } from '@/components/branding/FeatureOffScreen';

// On the website Alert.alert does nothing by itself; this points it at the app's own dialog (a phone keeps the system alert).
installWebAlert();

ExpoSplashScreen.preventAutoHideAsync();
installGlobalErrorHandler();

function RootNavigator() {
  const { isLoading, isAuthenticated, user, appState, onboardingStep } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [splashDone, setSplashDone] = useState(false);
  // The approval page (/approve/<token>), the invite page (/invite/<token>), the legal pages (/legal/privacy, terms, support) the password reset page and the email-link landing page (auth-callback) are public:
  // no sign-in, no redirects.
  const isPublicPage = ['approve', 'invite', 'legal', 'reset-password', 'auth-callback'].includes((segments as string[])[0]);
  // Is the public Weather experience on? Off unless the server (or a recent saved answer) says on. Never blocks launch.
  const weatherOn = usePublicWeatherSwitch(!isAuthenticated);

  usePushNotifications(user?.role, appState === 'active' && isAuthenticated && !!user);
  // Files of things deleted earlier (or by someone else, or along with their project) are cleared out shortly after the app opens signed in.
  useEffect(() => { if (appState === 'active' && isAuthenticated && user) sweepStorageSoon(); }, [appState, isAuthenticated, user?.id]);
  // Tell the server which language this person uses, so its push notices come in it (update 95).
  useEffect(() => { if (appState === 'active' && isAuthenticated && user) syncLanguageToAccount(); }, [appState, isAuthenticated, user?.id]);
  usePrefetchKeyImages();
  // The home and lock screen widgets get their forecast for everyone, signed in or not (only when the settings file has widgets on).
  useWidgetSync();
  // A screen whose feature is switched off in the settings file is covered by a plain "Not available" page (src/config/featureRoutes.ts).
  const offFeature = blockedFeature(segments as string[]);

  // Photo, birthday, shirt size and ID set aside while the account waited for email confirmation are saved on first sign-in.
  useEffect(() => {
    if (appState === 'active' && isAuthenticated && user?.email) applyPendingSignup(user.email);
  }, [appState, isAuthenticated, user?.email]);

  useEffect(() => {
    if (!isLoading) {
      ExpoSplashScreen.hideAsync();
    }
  }, [isLoading]);

  useEffect(() => {
    if (isAppNotSetUp || isLoading || !splashDone || isPublicPage) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboardingGroup = segments[0] === '(onboarding)';
    const currentGroup = segments[0];

    if (appState === 'unauthenticated') {
      const goTo = signedOutRedirect({ firstSegment: (segments as string[])[0], weatherOn });
      if (goTo) router.replace(goTo as any);
      return;
    }

    // The setup hub links to the create-company screen, which also works for an already-signed-in user.
    const setupScreens = ['create-company'];
    const onSetupScreen = inAuthGroup && setupScreens.includes((segments as string[])[1] ?? '');

    if (appState === 'onboarding') {
      // Signed in but not part of a company yet.
      if (!inOnboardingGroup && !onSetupScreen) {
        router.replace('/(onboarding)/setup');
      }
      return;
    }

    if (appState === 'active' && isAuthenticated && user) {
      // Every signed-in person goes to their role's area.
      if (user.role !== 'owner' && user.role !== 'worker' && user.role !== 'customer') return;
      const role = user.role;
      const target = `/(${role})`;
      // An admin who is put on a job can work it like a worker: the worker area is open to them while they have work coming up.
      const adminWorks = db.role === 'admin' && hasOpenProjectWork(db.assignments, db.personId, todayKey());
      const onTarget = currentGroup === `(${role})` || (adminWorks && currentGroup === '(worker)');
      if (inAuthGroup || inOnboardingGroup || !onTarget) {
        router.replace(target as any);
      }
    }
  }, [isLoading, isAuthenticated, user, appState, onboardingStep, segments, splashDone, isPublicPage, weatherOn]);

  const handleSplashFinish = useCallback(() => {
    setSplashDone(true);
  }, []);

  // A release build made without its Supabase settings never runs demo mode: it shows one plain "App not set up" screen
  // everywhere (only the legal pages, which need no server, still open).
  if (isAppNotSetUp && (segments as string[])[0] !== 'legal') {
    return <AppNotSetUpScreen />;
  }

  if (!isPublicPage && (isLoading || !splashDone)) {
    return <SplashScreen onFinish={handleSplashFinish} />;
  }

  // Same element tree for public and normal pages. If a public page (Privacy, Terms, Support) returned a different
  // tree, opening it would rebuild the whole navigator and Back would land on the Dashboard instead of the
  // screen you came from.
  return (
    <>
      <Slot />
      {offFeature ? <FeatureOffScreen feature={offFeature} /> : null}
      {isPublicPage ? null : <SignInWelcome />}
      <WebDialogHost />
    </>
  );
}

export default function RootLayout() {
  // Another library may swap the global error handler after launch; put ours back (twice, a little apart), and show last time's error if the app closed on one.
  useEffect(() => {
    ensureGlobalErrorHandler();
    const timers = [setTimeout(ensureGlobalErrorHandler, 3000), setTimeout(ensureGlobalErrorHandler, 10000), setTimeout(() => { void showLastErrorIfAny(); }, 2500)];
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <KeyboardProvider>
        <ThemeProvider>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
