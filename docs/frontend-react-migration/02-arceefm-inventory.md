# 02 — Inwentaryzacja ArceeFM (źródło komponentów i tokenów)

Źródło: `/Users/aleksy/Documents/GitHub/ArceeFM/frontend`. Stack: React 19 +
Vite + TS, Tailwind v4 (CSS-first), Redux Toolkit + redux-persist, React Query,
react-router, i18next, radix-ui, react-markdown (+remark/rehype/katex/prism),
lucide-react. `cn = twMerge(clsx(...))`.

## Warstwa wizualna (do skopiowania — Step 1)

- **Tokeny motywu** (`src/app-theme.css` → importuje):
  - `app/theme/setup.css`, `app/theme/primitives.css`,
    `app/theme/light-mode.css`, `app/theme/dark-mode.css`
  - Setki zmiennych semantycznych: `--color-bg-*` (elevation-ground/level-0..3,
    btn-*, danger/error/info/success, input-*, divider-*), `--color-text-*`,
    `--color-border-*`, `--color-fill-*`, `--brand-50..950`, `--shadow-*`
    (w tym `convex`/`concave`).
- **`tailwind.config.js`** — mapuje tokeny na klasy Tailwind
  (`bg-elevation-level-1`, `text-basic-secondary`, `border-primary`,
  `fill-accent-primary`, `shadow-convex`…), keyframes/animacje
  (`shimmer`, `text-shimmer`, `spin-reverse`, `progress`, `pulse-opacity`,
  `loader-gradient-move`), `backgroundImage` shimmer, plugin `.text-shimmer-*`,
  screen `3xl`.
- **`src/index.css`** — klasy typografii (`.title`, `.header-*`, `.label-*`,
  `.text-*`, `.paragraph-*`, `.tag-label`, `.code-*`), `@font-face`
  (Inter, IBMPlexMono, Asap, Tiempos), animacje (`fade`, `fade-up/down/left/right`,
  `popup-bounce`, `slide-in-right`, `loading-gleam`), scrollbary, notification-root.
- **Fonty**: `src/app/assets/fonts/*` (Inter*, IBMPlexMono*, Asap*, Tiempos*).

## Atomy (`src/app/atoms/*`) — 66 plików, kandydaci do konwersji

Wzorzec: komponent TSX + (czasem) `index.css` z `@apply`/klasami tokenów.
Przykład `Button` używa klas globalnych (`btn`, `btn-primary`, `btn-medium`,
`btn-icon-left`, `btn-disabled`) z `atoms/button/index.css` + `Loader`.

Najważniejsze (priorytet migracji):
- **button/** (`index.tsx`, `CopyButton`, `StickyButton`) — warianty
  (Primary/Secondary/Tertiary/Ghost × accent/destructive/highlighted), rozmiary,
  content (icon/text), stan `loading`.
- **input/** (`index.tsx`, `text-area`, `SelectInput`, `search-input`,
  `PasswordInput`, `NumberInput`, `CodeInput`, `InputWrapper`, `StickyInput`).
- **selector/**, **checkbox/**, **radio-input/**, **switcher/**,
  **range-input/**, **tags-selector/**, **add-values-input/**.
- **tab-button/**, **horizontal-tabs-item/**, **separator/**, **pagination/**.
- **tooltip/**, **hover-hint/**, **hint/**, **dropdown-content/**,
  **menu-button/**, **badge/**, **avatar/**, **label/**, **info-row/**.
- **loader/** (`index`, `CircularLoader`, `ShimmerLoader`, `ProgressLoader`),
  **chat-loader/**.
- **toast/** (`Toast.tsx`), **notification-modal/** (`createNotification`,
  `Variant`), **message-box/**, **cover-background/**.
- **icon/** (`index.tsx` + `icon-paths.ts` — dane ścieżek SVG),
  **logo/**, **theme-mode-switcher/**, **editable-header/**,
  **keyboards-shortcut-displayer/**.

## Providery / stan (`src/app/context/*`, `src/app/state/*`)

- **ThemeContext** — tryb light/dark (mapuje na `theme/*-mode.css`).
- **ToastContext** — kolejka notyfikacji (+ `notification-modal`).
- **ChatContext / ChatSettingsContext / ChatDemoContext** — stan czatu, modele.
- **ToolCallsSidebarContext**, **NavigationContext**, **DevModeContext**,
  **AuthProvider**, **LanguageContext**.
- **Redux Store** (`state/Store.ts`) + slices: `UserSlice`, `ChatSettingsSlice`,
  `EnvSlice`, `ActivitySlice`, `RagSlice`, `DevModeSlice`,
  `UserPermissionsSlice` (+ `redux-persist`, `use-context-selector`).

## Czat (najbliższy transkryptowi `nac`) — `src/app/components/chat/*`

- **ChatResponse/** — wiadomość asystenta: avatar/loader, stany streamingu
  (placeholder loader z „perceptual floor" 400ms), meta/warning, akcje
  (copy/delete/regenerate/flag/api-call). Deleguje treść do `ChatSegments`.
- **ChatSegments/** — parser treści na segmenty: `TextSegment` (markdown),
  `ToolsSegments`/`ToolCallLabel`/`ToolCallsSidebar` (narzędzia),
  `StepByStepDisplayer` (reasoning/kroki), `utils/{parsing,display}`.
- **ChatInput/** (`index`, `ChatInputMobile`, `useChatInput`), **ChatMessages**,
  **ChatInputPanel**, **ChatBackground**.
- Markdown: `react-markdown` + `remark-gfm`, `remark-math`, `rehype-katex`,
  `rehype-raw`, `rehype-sanitize`, `react-syntax-highlighter`/`prismjs`.

## Hooks / services / utils (wzorce do przeniesienia)
- **hooks/**: `useChat`, `useChatScroll`, `useRWD` (responsywność),
  `useLang`, `useUserProfile`, `useApiKey`, `useSentry`.
- **services/**: `sseParser.ts` (parser SSE — cenny wzorzec pod nasz SSE),
  `*Service.ts` (warstwa API/fetch).
- **utils/**: `cn.ts` (clsx+twMerge), `fetch.ts`, `uuid.ts`,
  `contentFilters.ts`, `sessionManager.ts`, `numberFormatter.ts`.

## Co świadomie pomijamy (nie pasuje do zero-build / zakresu nac)
- Redux + redux-persist, React Query, react-router, i18next, Sentry, PostHog,
  auth/OAuth, panele admina/analytics, RAG, demo-mode.
- `react-markdown`/remark/rehype/prism (zastępuje nasz łańcuch markdown).
- radix-ui (zastępujemy własnymi atomami na natywnym DOM + ARIA).
