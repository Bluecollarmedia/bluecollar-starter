/**
 * Theme Provider
 *
 * Provides the current color theme to all components.
 * Starts with light theme only; dark mode support is architectural
 * (the tokens exist) but not exposed to users yet.
 *
 * `appMode` picks the brand identity: Landscaping (green) or Snow
 * (winter blue). Snow is visual only — it is not an access check.
 * Wrap a Snow subtree in <SnowThemeScope> (or pass appMode="snow")
 * and every component using `useTheme()` picks up the snow colors.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { lightTheme, darkTheme, snowTheme, type ThemeColors } from '@/theme/colors';

type ThemeMode = 'light' | 'dark';
export type AppMode = 'landscaping' | 'snow';

interface ThemeContextValue {
  mode: ThemeMode;
  appMode: AppMode;
  isSnowMode: boolean;
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  appMode: 'landscaping',
  isSnowMode: false,
  colors: lightTheme,
});

export function useTheme() {
  return useContext(ThemeContext);
}

interface ThemeProviderProps {
  mode?: ThemeMode;
  appMode?: AppMode;
  children: React.ReactNode;
}

export function ThemeProvider({ mode = 'light', appMode = 'landscaping', children }: ThemeProviderProps) {
  const value = useMemo<ThemeContextValue>(() => {
    const isSnowMode = appMode === 'snow';
    // Snow has no dark variant yet (dark mode isn't exposed to users).
    const colors = isSnowMode ? snowTheme : mode === 'dark' ? darkTheme : lightTheme;
    return { mode, appMode, isSnowMode, colors };
  }, [mode, appMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Renders its children in the Snow Mode theme, keeping the parent's light/dark mode. */
export function SnowThemeScope({ children }: { children: React.ReactNode }) {
  const { mode } = useTheme();
  return (
    <ThemeProvider mode={mode} appMode="snow">
      {children}
    </ThemeProvider>
  );
}
