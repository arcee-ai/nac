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
const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const isTheme = (value: string | null): value is Theme =>
  value != null && THEMES.includes(value as Theme);

const prefersDark = () => window.matchMedia(COLOR_SCHEME_QUERY).matches;

function resolve(theme: Theme, systemDark: boolean): ResolvedTheme {
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

function applyToDOM(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isTheme(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Keep the in-memory preference when storage is unavailable.
  }
}

export const ThemeProvider: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [systemDark, setSystemDark] = useState(prefersDark);
  const resolved = resolve(theme, systemDark);

  const setTheme = useCallback((next: Theme) => {
    if (!THEMES.includes(next)) return;
    if (next === "system") setSystemDark(prefersDark());
    setThemeState(next);
    persistTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme =
      theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    if (next === "system") setSystemDark(prefersDark());
    setThemeState(next);
    persistTheme(next);
  }, [theme]);

  useEffect(() => {
    applyToDOM(resolved);
  }, [resolved]);

  useEffect(() => {
    if (theme !== "system") return;

    const media = window.matchMedia(COLOR_SCHEME_QUERY);
    const updateSystemTheme = (event: MediaQueryListEvent) =>
      setSystemDark(event.matches);
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, [theme]);

  useEffect(() => {
    const syncStoredTheme = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const next = isTheme(event.newValue) ? event.newValue : "system";
      if (next === "system") setSystemDark(prefersDark());
      setThemeState(next);
    };
    window.addEventListener("storage", syncStoredTheme);
    return () => window.removeEventListener("storage", syncStoredTheme);
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, resolved, setTheme, toggleTheme }}
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
