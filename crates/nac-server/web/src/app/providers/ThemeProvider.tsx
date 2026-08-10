import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const THEMES: Theme[] = ["light", "dark", "system"];
const STORAGE_KEY = "nac-theme";

// The product ships dark-only for now. Theme plumbing (tokens, types, storage)
// stays so light / system can come back without a redesign.
const FORCED_THEME: ResolvedTheme = "dark";

interface ThemeContextValue {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const prefersDark = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;

function resolve(_theme: Theme): ResolvedTheme {
  return FORCED_THEME;
}

function applyToDOM(): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", FORCED_THEME);
  root.classList.remove("light", "dark");
  root.classList.add(FORCED_THEME);
  root.style.colorScheme = FORCED_THEME;
}

function initialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (saved && THEMES.includes(saved)) return saved;
  return prefersDark() ? "dark" : "light";
}

export const ThemeProvider: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  const setTheme = useCallback((next: Theme) => {
    if (!THEMES.includes(next)) return;
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyToDOM();
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme =
        prev === "light" ? "dark" : prev === "dark" ? "system" : "light";
      localStorage.setItem(STORAGE_KEY, next);
      applyToDOM();
      return next;
    });
  }, []);

  useEffect(() => {
    applyToDOM();
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, resolved: resolve(theme), setTheme, toggleTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
