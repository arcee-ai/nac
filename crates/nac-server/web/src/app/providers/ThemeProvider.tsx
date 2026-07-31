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

interface ThemeContextValue {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const prefersDark = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;

function resolve(theme: Theme): ResolvedTheme {
  if (theme === "system") return prefersDark() ? "dark" : "light";
  return theme;
}

function applyToDOM(theme: Theme): void {
  const actual = resolve(theme);
  const root = document.documentElement;
  root.setAttribute("data-theme", actual);
  root.classList.remove("light", "dark");
  root.classList.add(actual);
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
    applyToDOM(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme =
        prev === "light" ? "dark" : prev === "dark" ? "system" : "light";
      localStorage.setItem(STORAGE_KEY, next);
      applyToDOM(next);
      return next;
    });
  }, []);

  // Apply on mount and react to system changes while in "system" mode.
  useEffect(() => {
    applyToDOM(theme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((localStorage.getItem(STORAGE_KEY) ?? "system") === "system") {
        applyToDOM("system");
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
