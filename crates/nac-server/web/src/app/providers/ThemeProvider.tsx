import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];
const STORAGE_KEY = "nac-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function prefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DARK_QUERY).matches
    : true;
}

function resolve(theme: Theme, systemDark: boolean): ResolvedTheme {
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}

/**
 * The document owns the theme class for the standalone app. `index.html`
 * applies the same rule before first paint, so this only keeps it current.
 */
function applyToDOM(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute("content", resolved);
}

function readStored(): Theme | null {
  try {
    // SAFETY: the stored value is validated against THEMES before it is used,
    // so a foreign string never escapes as a Theme.
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    return saved && THEMES.includes(saved) ? saved : null;
  } catch {
    return null;
  }
}

function writeStored(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode, sandboxed host); the choice
    // still applies for this page.
  }
}

/**
 * Light, dark, or follow the system. A `local` provider is a packed
 * presentation inside someone else's page: it never touches the host
 * document or its storage, and the theme class lives on the presentation
 * root instead.
 */
export const ThemeProvider: React.FC<{ children?: React.ReactNode; local?: boolean }> = ({
  children,
  local = false,
}) => {
  const [theme, setThemeState] = useState<Theme>(() =>
    local ? "dark" : (readStored() ?? "system"),
  );
  const [systemDark, setSystemDark] = useState(prefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  const resolved = resolve(theme, systemDark);

  useEffect(() => {
    if (!local) applyToDOM(resolved);
  }, [local, resolved]);

  const setTheme = useCallback(
    (next: Theme) => {
      if (!THEMES.includes(next)) return;
      setThemeState(next);
      if (!local) writeStored(next);
    },
    [local],
  );

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = THEMES[(THEMES.indexOf(prev) + 1) % THEMES.length];
      if (!local) writeStored(next);
      return next;
    });
  }, [local]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
