/**
 * Splash Screen — Brighton Lawn + Landscape
 *
 * Professional app-opening experience:
 *  1. Clean white background
 *  2. Main logo fades in with a subtle scale-up
 *  3. Brief hold
 *  4. Smooth fade out into login/app
 */

import React, { useEffect } from 'react';
import { View, Image, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const LOGO_WIDTH = Math.min(SCREEN_WIDTH * 0.6, 280);

const FADE_IN = 500;
// The logo still fades in and out; it just stays up for less time before the app appears (was 600 ms hold and 400 ms fade out: 1.5 s in all).
const HOLD = 200;
const FADE_OUT = 300;

interface SplashScreenProps {
  onFinish: () => void;
}

export function SplashScreen({ onFinish }: SplashScreenProps) {
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.88);
  const containerOpacity = useSharedValue(1);

  useEffect(() => {
    // Sequence: fade in → hold → fade out
    logoOpacity.value = withSequence(
      withTiming(1, { duration: FADE_IN, easing: Easing.out(Easing.cubic) }),
      withDelay(
        HOLD,
        withTiming(0, { duration: FADE_OUT }),
      ),
    );

    logoScale.value = withTiming(1, {
      duration: FADE_IN,
      easing: Easing.out(Easing.cubic),
    });

    // Fade out the white background at the end
    containerOpacity.value = withDelay(
      FADE_IN + HOLD,
      withTiming(0, { duration: FADE_OUT }, (finished) => {
        if (finished) {
          runOnJS(onFinish)();
        }
      }),
    );
  }, []);

  // Safety fallback — ensure splash always finishes
  useEffect(() => {
    const timeout = setTimeout(onFinish, FADE_IN + HOLD + FADE_OUT + 500);
    return () => clearTimeout(timeout);
  }, [onFinish]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      <Animated.View style={[styles.logoContainer, logoStyle]}>
        <Image
          source={require('../../../assets/images/logo-full.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_WIDTH * 0.45,
  },
});
