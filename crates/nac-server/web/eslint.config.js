import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config([
  { ignores: ["dist", "packages/nac-client/dist/**", "../assets/**"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Design-system atoms, providers, and the Effect cache deliberately export
    // hooks next to their provider, which costs those files Fast Refresh.
    files: ["src/app/atoms/**", "src/app/providers/**", "src/app/effect/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    files: ["e2e/**/*.{ts,tsx}", "playwright.config.ts"],
    languageOptions: { globals: globals.node },
    rules: {
      "no-empty-pattern": "off",
      "react-hooks/rules-of-hooks": "off",
      "react-refresh/only-export-components": "off",
    },
  },
]);
