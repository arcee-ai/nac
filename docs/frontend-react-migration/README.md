# Migracja frontendu `nac` → React + htm + Tailwind (bez builda)

Dokument główny. Zbiera cel, ograniczenia, zasady i **kolejne kroki (steps)**.
Szczegóły są w plikach towarzyszących — linki niżej.

## Cel

Zastąpić obecny frontend `nac` (jeden plik `app.js`, ~4500 linii vanilla JS +
ręczny `index.html` + `app.css`) architekturą komponentową w stylu React,
korzystając z design systemu i komponentów repo `ArceeFM`
(`/Users/aleksy/Documents/GitHub/ArceeFM`), **bez** kroku builda i **bez**
zależności od Node u użytkownika końcowego.

## Twarde ograniczenia (uzgodnione)

1. **Tailwind bez builda.** Używamy przeglądarkowego kompilatora Tailwind v4
   (`@tailwindcss/browser`), wektorowanego lokalnie. Działamy lokalnie —
   nie zależy nam na performance ani rozmiarze CSS.
2. **Tokeny/style/animacje z ArceeFM.** Kopiujemy warstwę wizualną (CSS
   custom properties, animacje, typografię) 1:1, potem dostrajamy.
3. **Konwersja komponentów/atomów/providerów z ArceeFM.** Repo ArceeFM jest w
   React + Vite + TS. Nie przenosimy jego grafu zależności (react-markdown,
   radix, redux, i18next…). Zamiast tego konwertujemy **strukturę i zachowanie**
   komponentów na nasz styl React+htm bez builda, reużywając jak najwięcej
   CSS/tokenów/logiki.
4. **Podział na foldery.** Nowy frontend rozbijamy na `atoms`, `components`,
   `context`, `hooks`, `services`, `state`, `theme`, `lib`, `vendor`.

## Zasady konwersji (wynik analizy)

- **Runtime bez transformacji.** Zostajemy przy sprawdzonym stacku z PoC:
  React 18 UMD + `htm` (JSX zapisujemy jako `` html`...` ``). Dzięki temu nie
  potrzebujemy Babela/TS w przeglądarce. JSX z ArceeFM tłumaczymy ręcznie na
  `htm` podczas konwersji.
- **Markdown zostaje na naszym łańcuchu** `markdown-it → highlight.js →
  DOMPurify → html-react-parser` (offline, zwektorowany), zamiast
  `react-markdown`+remark/rehype/prism z ArceeFM. Zachowujemy parytet funkcji
  (gfm, kod z podświetleniem, sanityzacja, bezpieczne linki).
- **Zależności zastępujemy natywnie:** radix → własne atomy (Modal/Tooltip/
  Tabs/Select na natywnym DOM + ARIA), redux/redux-persist → lekki store na
  `useReducer` + Context (+ `localStorage`), `lucide-react` → inline SVG z
  `icon-paths.ts` (kopiujemy dane ścieżek), `cn` → `clsx` (+ opcjonalnie
  `tailwind-merge`).
- **Reużywamy 1:1:** całą warstwę tokenów (`theme/*.css`), animacje, klasy
  typografii, oraz logikę API/SSE/diff już istniejącą w `nac` (portujemy z
  `app.js` do `services`/`hooks`).

## Kroki (steps)

Realizujemy **po kolei**, każdy krok = osobne wejście, weryfikowalne w
przeglądarce (serwer statyczny + żywe API `:3210`, jak w PoC).

- **Step 0 — Fundament (bez builda).** Vendorujemy Tailwind browser + React/htm +
  nasz łańcuch markdown; tworzymy `lib/` (`html`, `cn`, `api`, `markdown`),
  szkielet folderów, pusty shell renderujący się na tokenach.
  → `04-architecture-and-foundation.md`
- **Step 1 — Tokeny i motyw.** Kopiujemy `theme/setup|primitives|light|dark.css`
  + animacje + typografię z ArceeFM do `assets/app/theme/`, wpinamy motyw i
  weryfikujemy zmienne (`--color-bg-*` itd.) oraz przełącznik light/dark.
  → `03-mapping.md` (sekcja „Style/tokeny")
- **Step 2 — Atomy bazowe.** Konwertujemy: `Button`, `Input`/`TextArea`,
  `Select`, `Checkbox`, `Tabs`/`TabButton`, `Tooltip`/`HoverHint`, `Badge`,
  `Loader` (Circular/Shimmer), `Modal` (baza pod modale), `Toast`/notyfikacje,
  `Icon` (inline SVG). → `03-mapping.md` (tabela atomów)
- **Step 3 — Providery i store.** `ThemeProvider`, `ToastProvider`,
  `SessionsProvider` (dane + polling), `SelectionProvider` (wybrana sesja/tab);
  lekki store bez Redux. → `03-mapping.md` (sekcja „Providery")
- **Step 4 — Shell aplikacji.** `SessionBoard` (lista/karty sesji) + `Inspector`
  (nagłówek + zakładki: chat/events/threads/worksets/workspace) w React+htm,
  na nowych atomach i tokenach. → `01-nac-frontend-audit.md`
- **Step 5 — Transkrypt + prompt + SSE.** Port transkryptu (nasz łańcuch
  markdown), formularz promptu, streaming na żywo przez
  `GET /sessions/{id}/events/stream` z reconciliation. Bazujemy na PoC
  `app-react-transcript.js`.
- **Step 6 — Modale.** `LaunchModal` (z sandbox/SSH), `RenameModal`,
  `DeleteModal`, `SettingsModal` — na atomie `Modal`.
- **Step 7 — Zaawansowane.** Drag-reorder sesji, resize panelu (splitter),
  zakładki threads/worksets/workspace (+ diff viewer), tryb mobilny, skróty
  klawiszowe.
- **Step 8 — Przełączenie.** Zmiana tras Rust (`/` → nowy shell), usunięcie/
  archiwizacja starego `app.js`, finalne porządki i weryfikacja parytetu.

## Pliki towarzyszące

- `01-nac-frontend-audit.md` — co jest teraz w `nac`, role komponentów, stan, API, zdarzenia.
- `02-arceefm-inventory.md` — co jest w ArceeFM: tokeny, atomy, providery, czat.
- `03-mapping.md` — mapowanie „co na co" (wymienić / utworzyć / reużyć).
- `04-architecture-and-foundation.md` — decyzje architektoniczne + docelowa struktura folderów + Step 0.

## Weryfikacja (dla każdego kroku)

1. Serwer statyczny z `crates/nac-server` (jak w PoC) + żywe API na `:3210`.
2. Zrzut ekranu / sprawdzenie DOM po zmianie.
3. Brak błędów w konsoli, brak błędów lintera.
4. Parytet funkcji względem `01-nac-frontend-audit.md`.

> Uwaga: nowe pliki assetów wymagają tras w `crates/nac-server/src/lib.rs`
> (`include_str!`), a więc rebuildu binarki, żeby działały „produkcyjnie".
> W trakcie prac testujemy przez serwer statyczny + CORS do `:3210`.
