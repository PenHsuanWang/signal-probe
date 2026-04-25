import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'sp-theme';
const DEFAULT_THEME: Theme = 'dark';

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* localStorage unavailable */ }
  return DEFAULT_THEME;
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = getStoredTheme();
    // Apply immediately to avoid flash-of-wrong-theme
    applyTheme(t);
    return t;
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch { /* ignore */ }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
