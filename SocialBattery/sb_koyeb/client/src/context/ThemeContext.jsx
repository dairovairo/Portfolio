import { createContext, useContext, useEffect, useState } from 'react';

const VALID_THEMES = ['dark', 'light', 'aurora'];

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem('sb-theme');
    return VALID_THEMES.includes(saved) ? saved : 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    localStorage.setItem('sb-theme', theme);

    // Update PWA theme-color meta
    const meta = document.getElementById('theme-color-meta');
    if (meta) {
      const colors = { light: '#f4fbfb', dark: '#0a0a0f', aurora: '#0e0b1a' };
      meta.setAttribute('content', colors[theme] ?? '#0a0a0f');
    }
  }, [theme]);

  const setTheme = (next) => {
    if (VALID_THEMES.includes(next)) setThemeState(next);
  };

  // Legacy toggle kept for backward compat (dark ↔ light)
  const toggle = () => setThemeState(t => t === 'dark' ? 'light' : 'dark');

  return (
    <ThemeContext.Provider value={{
      theme,
      setTheme,
      toggle,
      isDark:   theme === 'dark' || theme === 'aurora',
      isAurora: theme === 'aurora',
      isLight:  theme === 'light',
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be inside ThemeProvider');
  return ctx;
};
