/**
 * Theme Provider
 *
 * Provides the current color theme to all components.
 * Starts with light theme only; dark mode support is architectural
 * (the tokens exist) but not exposed to users yet.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { lightTheme, darkTheme, type ThemeColors } from '@/theme/colors';

type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  colors: lightTheme,
});

export function useTheme() {
  return useContext(ThemeContext);
}

interface ThemeProviderProps {
  mode?: ThemeMode;
  children: React.ReactNode;
}

export function ThemeProvider({ mode = 'light', children }: ThemeProviderProps) {
  const value = useMemo<ThemeContextValue>(() => {
    const colors = mode === 'dark' ? darkTheme : lightTheme;
    return { mode, colors };
  }, [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
