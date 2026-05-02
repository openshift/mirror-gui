import React, { createContext, useContext, useState, useLayoutEffect, useEffect, useCallback } from 'react';

export type ThemePreference = 'light' | 'dark' | 'auto';
export type EffectiveTheme = 'light' | 'dark';

interface ThemeContextType {
  themePreference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  setThemePreference: (preference: ThemePreference) => void;
}

const STORAGE_KEY = 'mirror-gui-theme';
const DARK_CLASS = 'pf-v6-theme-dark';

function getStoredPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    return stored;
  }
  return 'auto';
}

function getSystemTheme(): EffectiveTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveEffectiveTheme(preference: ThemePreference): EffectiveTheme {
  if (preference === 'auto') {
    return getSystemTheme();
  }
  return preference;
}

function applyThemeClass(theme: EffectiveTheme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add(DARK_CLASS);
  } else {
    root.classList.remove(DARK_CLASS);
  }
}

const ThemeContext = createContext<ThemeContextType>({
  themePreference: 'auto',
  effectiveTheme: 'light',
  setThemePreference: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(getStoredPreference);
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme>(() =>
    resolveEffectiveTheme(getStoredPreference()),
  );

  useLayoutEffect(() => {
    applyThemeClass(effectiveTheme);
  }, [effectiveTheme]);

  useEffect(() => {
    if (themePreference !== 'auto') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setEffectiveTheme(e.matches ? 'dark' : 'light');
    };

    setEffectiveTheme(mediaQuery.matches ? 'dark' : 'light');
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [themePreference]);

  const setThemePreference = useCallback((preference: ThemePreference) => {
    const resolved = resolveEffectiveTheme(preference);
    applyThemeClass(resolved);
    localStorage.setItem(STORAGE_KEY, preference);
    setThemePreferenceState(preference);
    setEffectiveTheme(resolved);
  }, []);

  return (
    <ThemeContext.Provider value={{ themePreference, effectiveTheme, setThemePreference }}>
      {children}
    </ThemeContext.Provider>
  );
};
