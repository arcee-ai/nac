import { React, html } from "../lib/html.js";

const { createContext, useContext, useState, useEffect, useCallback } = React;

const THEMES = ["light", "dark", "system"];
const STORAGE_KEY = "nac-theme";

const ThemeContext = createContext(null);

function resolve(theme) {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

function applyToDOM(theme) {
  const actual = resolve(theme);
  const root = document.documentElement;
  root.setAttribute("data-theme", actual);
  root.classList.remove("light", "dark");
  root.classList.add(actual);
}

function initialTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && THEMES.includes(saved)) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(initialTheme);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyToDOM(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "light" ? "dark" : prev === "dark" ? "system" : "light";
      localStorage.setItem(STORAGE_KEY, next);
      applyToDOM(next);
      return next;
    });
  }, []);

  // Apply on mount and react to system changes when in "system" mode.
  useEffect(() => {
    applyToDOM(theme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((localStorage.getItem(STORAGE_KEY) || "system") === "system") applyToDOM("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
    // eslint-disable-next-line
  }, []);

  const value = { theme, resolved: resolve(theme), setTheme, toggleTheme };
  return html`<${ThemeContext.Provider} value=${value}>${children}</${ThemeContext.Provider}>`;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
