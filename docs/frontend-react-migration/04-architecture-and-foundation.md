# 04 — Architektura i fundament (Step 0)

## Decyzje architektoniczne (buildless)

1. **Runtime: React 18 UMD + `htm`.** Bez JSX, bez transpilacji. JSX z ArceeFM
   przepisujemy na `` html`...` ``. (Sprawdzone w PoC transkryptu.)
   - Alternatywa rozważona i **odrzucona**: Babel/TS Standalone w przeglądarce
     (transpilacja TSX na żywo) — cięższe, wciąga graf zależności ArceeFM,
     kruche przy radix/redux/i18next. Zostajemy przy htm.
2. **Tailwind bez builda: `@tailwindcss/browser` v4** (zwektorowany lokalnie).
   Kompiluje utility w przeglądarce, skanując DOM. Konfigurację (tokeny,
   keyframes, animacje) podajemy przez `<style type="text/tailwindcss">`
   z `@theme`/`@import`. Perf/rozmiar nieistotne (praca lokalna).
3. **Markdown: nasz łańcuch** `markdown-it → highlight.js → DOMPurify →
   html-react-parser` (offline). Zastępuje react-markdown/remark/rehype/prism.
4. **Zależności natywnie zamiast npm:** radix → własne atomy (ARIA + natywny
   DOM), redux → `useReducer`+Context+`localStorage`, lucide → inline SVG z
   `icon-paths`, `cn` → `clsx` (+ opcj. `tailwind-merge`).
5. **Stan**: lekki store aplikacji (Context + `useReducer`), selektywne
   subskrypcje tam, gdzie potrzeba (ewentualnie `use-context-selector` port lub
   podział kontekstów, by uniknąć nadmiarowych renderów).

## Docelowa struktura folderów

```
crates/nac-server/assets/
├─ index.html                 # bootstrap: motyw + Tailwind browser + vendor + main
├─ app/
│  ├─ main.js                 # entry: montuje <App/> z providerami
│  ├─ App.js                  # shell: Board + Inspector + modale
│  ├─ lib/
│  │  ├─ html.js              # htm.bind(createElement)
│  │  ├─ cn.js                # clsx (+ tailwind-merge)
│  │  ├─ markdown.js          # łańcuch markdown (z PoC)
│  │  └─ util.js              # uuid, formatery, drobne
│  ├─ theme/                  # skopiowane z ArceeFM (Step 1)
│  │  ├─ setup.css
│  │  ├─ primitives.css
│  │  ├─ light-mode.css
│  │  ├─ dark-mode.css
│  │  ├─ typography.css
│  │  ├─ animations.css
│  │  └─ tailwind.css         # @import "tailwindcss" + @theme/config
│  ├─ assets/fonts/           # Inter, IBMPlexMono, Asap, Tiempos
│  ├─ atoms/                  # Button.js, Input.js, Select.js, Tabs.js,
│  │                          # Tooltip.js, Badge.js, Loader.js, Modal.js,
│  │                          # Toast.js, Icon.js, Separator.js, Checkbox.js…
│  ├─ components/
│  │  ├─ sessions/            # SessionBoard.js, SessionCard.js
│  │  ├─ inspector/           # Inspector.js, InspectorHeader.js, Metrics.js, TabsBar.js
│  │  ├─ transcript/          # Transcript.js, MessageRow.js, MessageBody.js, PromptForm.js
│  │  ├─ events/              # EventStream.js
│  │  ├─ threads/             # ThreadsView.js
│  │  ├─ worksets/            # WorksetsView.js
│  │  ├─ workspace/           # WorkspaceView.js, DiffViewer.js
│  │  └─ modals/              # LaunchModal.js, RenameModal.js, DeleteModal.js, SettingsModal.js
│  ├─ context/                # ThemeProvider, ToastProvider, SessionsProvider, SelectionProvider
│  ├─ hooks/                  # useEventStream, useSessions, useMediaQuery, useDragReorder, usePaneResize
│  ├─ services/               # api.js, sse.js
│  └─ state/                  # store.js (reducer + akcje), selectors
└─ vendor/
   ├─ react.production.min.js
   ├─ react-dom.production.min.js
   ├─ htm.js
   ├─ tailwindcss-browser.js  # @tailwindcss/browser v4
   ├─ markdown-it.min.js
   ├─ purify.min.js
   ├─ highlight.min.js
   ├─ highlight-github-dark.min.css
   ├─ html-react-parser.min.js
   └─ clsx.min.js             # (+ ewentualnie tailwind-merge)
```

## Zawartość Step 0 (fundament — pierwsze wejście po akceptacji planu)

1. **Vendor**: dociągnąć `@tailwindcss/browser` v4 i `clsx` (UMD/ESM) do
   `assets/vendor/` (React/htm/markdown-it/purify/highlight/html-react-parser
   już mamy z PoC).
2. **`lib/`**: `html.js`, `cn.js`, `markdown.js` (przeniesiony z
   `app-react-transcript.js`), `util.js`.
3. **`index.html` (nowy shell)**: ładuje `theme/*` + Tailwind browser + vendor +
   `app/main.js`; montuje minimalny `<App/>` (np. nagłówek + pusty Board +
   Inspector) na tokenach — dowód, że tokeny i Tailwind działają bez builda.
4. **Trasy Rust (tymczasowe)**: `/next` → nowy `index.html`, `/assets/app/**`
   i nowy vendor. Stary frontend zostaje pod `/` do czasu Step 8 (cutover).
5. **Weryfikacja**: serwer statyczny + zrzut; widać poprawne kolory/typografię z
   ArceeFM i brak błędów w konsoli.

## Ryzyka i mitigacje
- **Tailwind browser a `@config`/`@theme`**: zweryfikować, czy wersja browser
  wczytuje nasz config i `@apply` w komponentowych klasach; jeśli nie —
  inline'ujemy `@theme` w `<style type="text/tailwindcss">` i zamieniamy
  `@apply` na gotowe klasy. (Weryfikacja w Step 0/1.)
- **Selektywne rendery** (duże listy sesji, streaming): podział kontekstów +
  `memo`/`key`, jak w PoC.
- **Parytet a11y**: focus-trap/live-region/skróty portujemy świadomie (audyt 01).
- **Rozjazd z binarką**: assety przez `include_str!` wymagają rebuildu; w
  trakcie testujemy statycznie + CORS do `:3210`.

## Definicja ukończenia migracji (parytet)
Wszystkie widoki i zachowania z `01-nac-frontend-audit.md` działają na nowym
stacku, stary `app.js` usunięty/zarchiwizowany, `/` serwuje nowy shell.
