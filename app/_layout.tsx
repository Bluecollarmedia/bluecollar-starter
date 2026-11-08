/**
 * Root Layout
 *
 * Wraps the entire app in providers (Theme, Auth) and handles
 * the splash screen lifecycle. Routes based on auth + onboarding state.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { usePrefetchKeyImages } from '@/lib/imageCache';
import { View, StyleSheet } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ThemeProvider, useTheme } from '@/providers/ThemeProvider';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { SplashScreen } from '@/components/branding/SplashScreen';
import { SignInWelcome } from '@/components/branding/WelcomeOverlay';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { applyPendingSignup } from '@/data/pendingSignup';
import { useModeAccess } from '@/hooks/useModeAccess';
import { ensureGlobalErrorHandler, installGlobalErrorHandler, showLastErrorIfAny } from '@/lib/errorReporting';
import { installWebAlert } from '@/lib/webDialog';
import { syncLanguageToAccount } from '@/i18n';
import { db } from '@/data/store';
import { todayKey } from '@/lib/ids';
import { hasOpenProjectWork } from '@/lib/workerAreas';
import { useAdminWorksSnow } from '@/lib/adminSnowWork';
import { WebDialogHost } from '@/components/ui/WebDialogHost';
import { usePublicWeatherSwitch } from '@/hooks/usePublicWeatherSwitch';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { signedOutRedirect } from '@/lib/launchRoute';
import { sweepStorageSoon } from '@/lib/storageSweep';

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
  const { shell, pending: shellPending } = useModeAccess(user?.role);
  // An admin who opened their Snow route may stay in the worker Snow area (see lib/adminSnowWork).
  const adminOnSnowRoute = useAdminWorksSnow();
  const { colors } = useTheme();
  // Is the public Weather experience on? Off unless the server (or a recent saved answer) says on. Never blocks launch.
  const weatherOn = usePublicWeatherSwitch(!isAuthenticated);

  usePushNotifications(user?.role, appState === 'active' && isAuthenticated && !!user);
  // Files of things deleted earlier (or by someone else, or along with their project) are cleared out shortly after the app opens signed in.
  useEffect(() => { if (appState === 'active' && isAuthenticated && user) sweepStorageSoon(); }, [appState, isAuthenticated, user?.id]);
  // Tell the server which language this person uses, so its push notices come in it (update 95).
  useEffect(() => { if (appState === 'active' && isAuthenticated && user) syncLanguageToAccount(); }, [appState, isAuthenticated, user?.id]);
  usePrefetchKeyImages();
  // The home and lock screen widgets get their forecast for everyone, signed in or not.
  useWidgetSync();

  // Photo, birthday, hoodie and ID set aside while the account waited for email confirmation are saved on first sign-in.
  useEffect(() => {
    if (appState === 'active' && isAuthenticated && user?.email) applyPendingSignup(user.email);
  }, [appState, isAuthenticated, user?.email]);

  useEffect(() => {
    if (!isLoading) {
      ExpoSplashScreen.hideAsync();
    }
  }, [isLoading]);

  useEffect(() => {
    if (isLoading || !splashDone || isPublicPage) return;

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
      // Snow Mode has its own shells under /snow/<role>. Which one a person
      // sees comes from useModeAccess: the company's mode, limited to the
      // modes this person is allowed into (the mode itself grants nothing).
      if (user.role !== 'owner' && user.role !== 'worker' && user.role !== 'customer') return;
      // A worker's screen depends on answers that arrive a moment after launch: wait, rather than route to the wrong one first.
      if (shellPending) return;
      const role = user.role;
      const target =
        shell === 'snow' ? `/snow/${role}` : shell === 'snow_notice' ? '/snow/notice' : `/(${role})`;
      const s1 = (segments as string[])[1];
      // An admin who is put on a job can work it like a worker: the worker area is open to them while they have work coming up.
      const adminWorks = db.role === 'admin' && hasOpenProjectWork(db.assignments, db.personId, todayKey());
      // Legal & Support opens inside the Snow area (so Back returns to Settings): it is part of whichever Snow shell they are in.
      const inLegal = s1 === 'legal-support';
      const onTarget =
        shell === 'snow' ? currentGroup === 'snow' && (s1 === role || inLegal || (db.role === 'admin' && adminOnSnowRoute && s1 === 'worker'))
        : shell === 'snow_notice' ? currentGroup === 'snow' && (s1 === 'notice' || inLegal)
        : currentGroup === `(${role})` || (adminWorks && currentGroup === '(worker)');
      if (inAuthGroup || inOnboardingGroup || !onTarget) {
        router.replace(target as any);
      }
    }
  }, [isLoading, isAuthenticated, user, appState, onboardingStep, segments, splashDone, isPublicPage, shell, shellPending, adminOnSnowRoute, weatherOn]);

  const handleSplashFinish = useCallback(() => {
    setSplashDone(true);
  }, []);

  if (!isPublicPage && (isLoading || !splashDone)) {
    return <SplashScreen onFinish={handleSplashFinish} />;
  }

  // Signed in, but which screen this worker gets is not known yet (a split second): a plain blank screen, never the wrong one.
  if (!isPublicPage && shellPending && appState === 'active' && isAuthenticated) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  // Same element tree for public and normal pages. If a public page (Privacy, Terms, Support) returned a different
  // tree, opening it would rebuild the whole navigator and Back would land on the Dashboard instead of the
  // screen you came from.
  return (
    <>
      <Slot />
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
