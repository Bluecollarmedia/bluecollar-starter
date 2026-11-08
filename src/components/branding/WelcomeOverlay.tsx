/**
 * Sign-in welcome animation.
 *
 *  1. Tap Sign In → the screen fades to white and the Brighton leaf springs in,
 *     breathing with a soft green ripple while the password is checked.
 *  2. Signed in → the leaf settles and lifts, "Welcome back, <name>" rises in.
 *  3. Brief hold, then the whole thing fades away into the app.
 *  If sign-in fails, it simply fades out so the error is visible.
 */

import React, { useEffect, useRef, useState } from 'react';
import { properName } from '@/lib/names';
import { Image, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { resetWelcome, useWelcomePhase, welcomeStartedAt } from '@/lib/welcomeAnimation';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { brand } from '@/theme/colors';

const LEAF = 112;
/** Leaf is on screen at least this long before the welcome text, even on a fast sign-in. */
const MIN_LEAF_MS = 700;
const HOLD_MS = 1300;
/** Give up on the animation if sign-in hangs (the login screen still shows its own state). */
const TIMEOUT_MS = 20000;

export function WelcomeOverlay({ ready, name }: { ready: boolean; name?: string }) {
  const t = useT();
  const { colors } = useTheme();
  const phase = useWelcomePhase();
  const [visible, setVisible] = useState(false);
  const [greetName, setGreetName] = useState<string | undefined>();
  const welcomed = useRef(false);

  const bg = useSharedValue(0);
  const leafScale = useSharedValue(0.4);
  const leafOpacity = useSharedValue(0);
  const leafRotate = useSharedValue(-14);
  const leafLift = useSharedValue(0);
  const ripple = useSharedValue(0);
  const textOpacity = useSharedValue(0);
  const textLift = useSharedValue(16);
  const outScale = useSharedValue(1);

  function finish() {
    setVisible(false);
    welcomed.current = false;
    resetWelcome();
  }

  function fadeAway() {
    bg.value = withTiming(0, { duration: 380, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(finish)();
    });
    outScale.value = withTiming(1.05, { duration: 380 });
  }

  // 1. Start: fade in and spring the leaf, then breathe while we wait.
  useEffect(() => {
    if (phase !== 'verifying') return;
    welcomed.current = false;
    setVisible(true);
    bg.value = 0;
    outScale.value = 1;
    leafOpacity.value = 0;
    leafScale.value = 0.4;
    leafRotate.value = -14;
    leafLift.value = 0;
    textOpacity.value = 0;
    textLift.value = 16;

    bg.value = withTiming(1, { duration: 220 });
    leafOpacity.value = withDelay(80, withTiming(1, { duration: 260 }));
    leafRotate.value = withDelay(80, withSpring(0, { damping: 9, stiffness: 120 }));
    leafScale.value = withDelay(
      80,
      withSequence(
        withSpring(1, { damping: 10, stiffness: 140 }),
        withRepeat(
          withSequence(
            withTiming(1.07, { duration: 650, easing: Easing.inOut(Easing.sin) }),
            withTiming(1, { duration: 650, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
        ),
      ),
    );
    ripple.value = 0;
    ripple.value = withDelay(300, withRepeat(withTiming(1, { duration: 1300, easing: Easing.out(Easing.quad) }), -1));

    const timer = setTimeout(fadeAway, TIMEOUT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Failed sign-in: just fade out.
  useEffect(() => {
    if (phase === 'cancelled' && visible) fadeAway();
    else if (phase === 'cancelled') resetWelcome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // 2. Signed in: settle the leaf, raise the greeting, hold, fade into the app.
  useEffect(() => {
    if (phase !== 'verifying' || !ready || welcomed.current) return;
    welcomed.current = true;
    setGreetName(name);
    const wait = Math.max(0, MIN_LEAF_MS - (Date.now() - welcomeStartedAt()));
    const timer = setTimeout(() => {
      cancelAnimation(ripple);
      ripple.value = withTiming(0, { duration: 200 });
      cancelAnimation(leafScale);
      leafScale.value = withSpring(1, { damping: 12, stiffness: 160 });
      leafLift.value = withTiming(-28, { duration: 450, easing: Easing.out(Easing.cubic) });
      textOpacity.value = withDelay(120, withTiming(1, { duration: 450 }));
      textLift.value = withDelay(120, withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) }));
      setTimeout(fadeAway, 620 + HOLD_MS);
    }, wait);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ready, name]);

  const containerStyle = useAnimatedStyle(() => ({ opacity: bg.value }));
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ scale: outScale.value }] }));
  const leafStyle = useAnimatedStyle(() => ({
    opacity: leafOpacity.value,
    transform: [
      { translateY: leafLift.value },
      { scale: leafScale.value },
      { rotate: `${leafRotate.value}deg` },
    ],
  }));
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: (1 - ripple.value) * 0.5,
    transform: [{ translateY: leafLift.value }, { scale: 0.8 + ripple.value * 1.1 }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textLift.value }],
  }));

  if (!visible) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: colors.background }, containerStyle]}
      pointerEvents="auto"
    >
      <Animated.View style={[styles.center, contentStyle]}>
        <Animated.View style={[styles.ripple, { backgroundColor: brand.primarySurface }, rippleStyle]} />
        <Animated.View style={[styles.badge, leafStyle]}>
          <Image source={require('../../../assets/images/logo-leaf.png')} style={styles.leaf} resizeMode="contain" />
        </Animated.View>
        <Animated.View style={[styles.textWrap, textStyle]}>
          <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, textAlign: 'center' }]}>
            {t('Welcome Back')}{greetName ? ',' : ''}
          </Text>
          {greetName ? (
            <Text style={[typeScale.displaySmall, { color: brand.accent, textAlign: 'center', marginTop: 2 }]}>
              {properName(greetName)}
            </Text>
          ) : null}
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

/** Root-level wrapper: reads auth so the overlay knows when sign-in has gone through. */
export function SignInWelcome() {
  const { appState, user } = useAuth();
  const ready = appState !== 'unauthenticated';
  return <WelcomeOverlay ready={ready} name={user?.firstName?.trim() || undefined} />;
}

const styles = StyleSheet.create({
  overlay: { zIndex: 1000, elevation: 1000 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // White circle badge holding the leaf.
  badge: {
    width: LEAF,
    height: LEAF,
    borderRadius: LEAF / 2,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1B3A2D',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  leaf: { width: LEAF * 0.5, height: LEAF * 0.5 },
  ripple: { position: 'absolute', width: LEAF * 1.4, height: LEAF * 1.4, borderRadius: LEAF * 0.7 },
  textWrap: { position: 'absolute', top: '50%', marginTop: LEAF / 2 + spacing.md, left: 0, right: 0 },
});
