# 03 — Mapowanie: co wymienić / utworzyć / reużyć

Legenda: **REUŻYJ** (kopiuj z ArceeFM ~1:1) · **KONWERTUJ** (przenieś strukturę/
zachowanie do React+htm) · **NOWE** (napisz od zera dla `nac`) ·
**ZASTĄP** (zamień technologię na naszą, bez builda) · **POMIŃ**.

## A. Style / tokeny / animacje (Step 1)

| ArceeFM | Akcja | Cel w `nac` |
|---|---|---|
| `app/theme/setup.css`, `primitives.css`, `light-mode.css`, `dark-mode.css` | REUŻYJ | `assets/app/theme/*.css` |
| `tailwind.config.js` (mapowanie tokenów→klasy, keyframes, animacje) | KONWERTUJ | `@theme`/config wczytywany przez Tailwind browser (Step 0) |
| `index.css` typografia (`.title`,`.header-*`,`.label-*`,`.paragraph-*`,`.code-*`) | REUŻYJ | `assets/app/theme/typography.css` |
| `index.css` animacje (`fade*`,`popup-bounce`,`slide-in-right`,`loading-gleam`,`shimmer`) | REUŻYJ | `assets/app/theme/animations.css` |
| fonty (Inter/IBMPlexMono/Asap/Tiempos) | REUŻYJ | `assets/app/assets/fonts/*` + `@font-face` |
| `nac/app.css` (neumorfizm, Doto, `.message-*`) | ZASTĄP/część REUŻYJ | tokeny ArceeFM + komponentowe klasy transkryptu |

## B. Atomy (Step 2)

| ArceeFM atom | Akcja | Uwagi konwersji |
|---|---|---|
| `button` (+ `CopyButton`) | KONWERTUJ | JSX→htm; zostaw klasy `btn*` z `button/index.css` (REUŻYJ CSS) |
| `input`, `text-area`, `SelectInput`, `search-input` | KONWERTUJ | natywne `<input/textarea/select>` + `input/index.css` |
| `checkbox`, `radio-input`, `switcher` | KONWERTUJ | natywne + ARIA |
| `tab-button`, `horizontal-tabs-item` | KONWERTUJ | pod zakładki inspektora |
| `tooltip`, `hover-hint`, `hint` | KONWERTUJ + ZASTĄP radix | pozycjonowanie natywne (bez `@radix-ui/react-tooltip`) |
| `dropdown-content`, `menu-button` | KONWERTUJ | natywny popover |
| `badge`, `avatar`, `label`, `info-row`, `separator` | KONWERTUJ | proste, szybkie |
| `loader` (Circular/Shimmer/Progress), `chat-loader` | REUŻYJ CSS + KONWERTUJ | wykorzystane w streamingu transkryptu |
| `toast`/`notification-modal` | KONWERTUJ | pod `ToastProvider` |
| `icon` + `icon-paths.ts` | REUŻYJ dane + KONWERTUJ | inline SVG zamiast `lucide-react` |
| `pagination`, `number-input`, `range-input`, `date-selector`, `data-picker`, `password-*`, `tags-selector`, `add-values-input`, `code-input`, `editable-header`, `logo`, `theme-mode-switcher`, `keyboards-shortcut-displayer` | KONWERTUJ wg potrzeb | tworzymy dopiero gdy dany widok ich wymaga |
| `google-oauth-button`, `legal-note`, `ads-box`, `language-switcher` | POMIŃ | poza zakresem nac |

## C. Providery / stan (Step 3)

| ArceeFM | Akcja | Cel w `nac` |
|---|---|---|
| `ThemeContext` | KONWERTUJ | `context/ThemeProvider.js` (light/dark → klasa na `<html>`) |
| `ToastContext` + `notification-modal` | KONWERTUJ | `context/ToastProvider.js` |
| Redux Store + slices, redux-persist, use-context-selector | ZASTĄP | lekki store: `state/store.js` (`useReducer`+Context, `localStorage`) |
| `ChatContext`/`ChatSettingsContext` | KONWERTUJ (okrojone) | `context/SessionsProvider.js` (dane sesji, polling) + `SelectionProvider` |
| `NavigationContext` | NOWE (proste) | wybór taba/panelu; część `SelectionProvider` |
| Auth/Language/DevMode/ToolCallsSidebar | POMIŃ | poza zakresem (SSE narzędzi obsłużymy w zakładce events) |

## D. Komponenty / widoki (Steps 4–7)

| Obszar `nac` (audyt 01) | Źródło ArceeFM | Akcja |
|---|---|---|
| Transkrypt czatu (`#transcript`) | `ChatResponse` + `ChatSegments/TextSegment` | KONWERTUJ (nasz łańcuch markdown zamiast react-markdown); mamy PoC |
| Streaming/loader stanu | `ChatResponse` loader logic, `chat-loader` | REUŻYJ wzorzec (perceptual floor) |
| Segmenty narzędzi/reasoning | `ToolsSegments`, `StepByStepDisplayer` | KONWERTUJ (pod zakładkę events/threads) |
| Prompt input | `ChatInput`/`useChatInput` | KONWERTUJ (Enter/Shift+Enter, historia) |
| Lista sesji (board, karty) | — (brak odpowiednika) | NOWE, na atomach (card/badge/avatar) |
| Drag-reorder sesji | — | NOWE (port logiki z `app.js`) |
| Splitter/resize | — | NOWE (port `handlePane*` z `app.js`) |
| Inspector + metryki + zakładki | `tab-button`, `info-row` | KONWERTUJ atomy + NOWE złożenie |
| Modale (Launch/Rename/Delete/Settings) | atom `Modal` (z radix→natywny), `input*`, `SelectInput` | KONWERTUJ atomy + NOWE formularze |
| Events (SSE) | `services/sseParser.ts` | KONWERTUJ wzorzec parsera |
| Workspace diff | — | NOWE (port z `app.js`, `GET .../workspace/diff`) |
| Threads / Worksets | — | NOWE (dane z API `nac`) |

## E. Hooks / services / utils (Step 4 wzwyż, point 4)

| Element | Źródło | Akcja | Cel |
|---|---|---|---|
| `cn` | `utils/cn.ts` | REUŻYJ | `lib/cn.js` (clsx [+ tailwind-merge]) |
| API klient | `app.js` `apiGet/Post/...` + `utils/fetch.ts` | KONWERTUJ | `services/api.js` |
| SSE | `app.js` `openEventStream` + `services/sseParser.ts` | KONWERTUJ | `hooks/useEventStream.js` + `services/sse.js` |
| Markdown | PoC `renderMarkdown` | REUŻYJ | `lib/markdown.js` |
| Responsywność | `hooks/useRWD.ts` | KONWERTUJ | `hooks/useMediaQuery.js` |
| Polling sesji | `app.js` `runSessionPoll` | KONWERTUJ | `hooks/useSessions.js` (w providerze) |
| Drag-reorder / pane resize | `app.js` | KONWERTUJ | `hooks/useDragReorder.js`, `hooks/usePaneResize.js` |
| uuid / formatery | `utils/uuid.ts`, `numberFormatter.ts` | REUŻYJ | `lib/util.js` |

## Priorytety reużycia (nawet gdy layout się zmieni)
1. **Tokeny + animacje + typografia** (natychmiastowy, spójny „look").
2. **Atomy: Button, Input, Select, Tabs, Tooltip, Loader, Modal, Toast, Icon.**
3. **Wzorzec ChatResponse/segmenty** dla transkryptu i streamingu.
4. **`sseParser` i `cn`** jako gotowe, sprawdzone kawałki.
