import React from "react";
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export declare const THEMES: readonly Theme[];
interface ThemeContextValue {
    theme: Theme;
    resolved: ResolvedTheme;
    setTheme: (next: Theme) => void;
    toggleTheme: () => void;
}
/**
 * Light, dark, or follow the system. A `local` provider is a packed
 * presentation inside someone else's page: it never touches the host
 * document or its storage, and the theme class lives on the presentation
 * root instead.
 */
export declare const ThemeProvider: React.FC<{
    children?: React.ReactNode;
    local?: boolean;
}>;
export declare function useTheme(): ThemeContextValue;
export {};
