import React from "react";
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
interface ThemeContextValue {
    theme: Theme;
    resolved: ResolvedTheme;
    setTheme: (next: Theme) => void;
    toggleTheme: () => void;
}
export declare const ThemeProvider: React.FC<{
    children?: React.ReactNode;
    local?: boolean;
}>;
export declare function useTheme(): ThemeContextValue;
export {};
