# 01 — Audyt obecnego frontendu `nac`

Źródła: `crates/nac-server/assets/{index.html,app.js,app.css}` oraz trasy w
`crates/nac-server/src/lib.rs`. Cel: zrozumieć role i zachowania, żeby migracja
zachowała parytet.

## Sposób serwowania

- Assety wkompilowane w binarkę przez `include_str!`/`include_bytes!` i
  serwowane przez Axum (`/`, `/assets/app.css`, `/assets/app.js`, fonty, vendor).
- CORS `permissive` — pozwala testować frontend z innego origin (serwer
  statyczny) na żywym API `:3210`.
- Zero builda już dziś; dwie zwektorowane biblioteki: `markdown-it`, `DOMPurify`.

## Architektura JS (`app.js`, ~4500 linii, vanilla)

- **Globalny `state`** (obiekt mutowalny) — kluczowe pola:
  `sessions`, `snapshots: Map`, `selectedId`, `eventsBySession: Map`,
  `activeRunsBySession`, `activeTab` (`chat|events|threads|worksets|workspace`),
  `mobileDetailOpen`, `inspectorFullscreen`, `paneRatio`, `sessionReorder`,
  `lastSequence: Map` (SSE), digesty renderu (`last*Digest`) itd.
- **`el`** — cache uchwytów DOM (`bindElements`), zdarzenia w `bindEvents`.
- **Render** — ręczny, sterowany „digestami" i `requestAnimationFrame`
  (`renderSessions`, `renderInspector`, `renderTranscript` z sygnaturami, by
  unikać zbędnych przebudów). To odpowiednik ręcznego reconciliation.
- **API** — `apiGet/Post/Put/Delete` + `readJson`.
- **Polling** — `scheduleSessionPoll`/`runSessionPoll` co `5s`
  (`SESSION_POLL_INTERVAL_MS`), statystyki workspace co `30s`.
- **SSE** — `openEventStream(sessionId)` → `EventSource` na
  `/sessions/{id}/events/stream`, sekwencje w `lastSequence`.

## Widoki i role (z `index.html`)

### Board (lewy panel) — lista sesji
- `#sessionGrid` — karty sesji; klik/keyboard/pointer → wybór, **drag-reorder**
  (`handleSessionPointer*`, próg `REORDER_DRAG_THRESHOLD_PX`, `PUT /sessions/order`).
- `#storePath` — ścieżka store; `#reorderLiveRegion` — a11y announce.
- ViewModel karty: `sessionCardViewModel`, digesty: `sessionCard*Digest`.

### Splitter
- `#paneSeparator` — zmiana proporcji paneli (`paneRatio`), mysz + klawiatura
  (`PANE_KEYBOARD_STEP`), media desktop `(min-width: 1180px)`; min. szerokości
  `PANE_BOARD_MIN_PX`/`PANE_INSPECTOR_MIN_PX`.

### Inspector (prawy panel)
- Nagłówek: `#inspectorTitle`, `#inspectorMeta`, przyciski: delete, rename,
  fullscreen (enter/exit ikony), settings, cancel-run; `#mobileBack` (mobile).
- Pasek metryk: `snapModel`, `snapBackend`, `snapMessages`, `snapRun`,
  `snapTokens`, `snapContext`.
- **Zakładki** (`#tabs`):
  - `chat` — `#transcript` (render markdown wiadomości) + `#promptForm`
    (`#promptInput`, Enter/Shift+Enter → `handlePromptKeydown`, `POST /sessions/{id}/runs`).
  - `events` — `#eventStreamStatus` + `#eventLog` (zdarzenia po wątkach, na żywo).
  - `threads` — `#threadsView` (cykl życia wątków, rozwijanie).
  - `worksets` — `#worksetsView` (dense-list).
  - `workspace` — `#workspaceView` (lista zmienionych plików + **diff viewer**,
    `GET /sessions/{id}/workspace/diff`).

### Modale (overlaye)
- `#launchOverlay` — tworzenie sesji: SSH host, cwd, backend, reasoning effort,
  model, base_url, `api_key_env`, extra headers (JSON), **sandbox** (enabled,
  no-mount, image, gpu, workdir, shm, mounts, mounts_ro), initial prompt.
  (`createSession` → `POST /sessions`, opcjonalnie `POST /sessions/{id}/runs`).
- `#renameOverlay` — zmiana tytułu (`PUT .../presentation`, focus-trap).
- `#deleteOverlay` — potwierdzenie usunięcia (`DELETE /sessions/{id}`).
- `#settingsOverlay` — zmiana konfiguracji sesji (model/backend/effort/…
  `PUT` konfiguracji).

## Zachowania przekrojowe (do zachowania)
- Tryb mobilny (master/detail, `mobileDetailOpen`, `showMobileSessions`).
- Fullscreen inspektora.
- Skróty klawiszowe (globalny `keydown`).
- A11y: live-regions, focus-trap w modalach, role/aria z `index.html`.
- Auto-scroll transkryptu (`scrollChatToBottom`).
- Znaczniki „attention"/aktywnych runów, liczniki czasu runu (`liveTimerInterval`).

## Design system (`app.css`, ~2645 linii)
- Zmienne CSS (kolory, `--space-*`, `--radius-*`, `--type-*`), neumorfizm,
  fonty (m.in. Doto), klasy `.panel`, `.transcript`, `.message-*`, `.inspector`,
  `.session-grid`, `.tabs`, `.launch-overlay`, reguły responsywne
  (np. ukrywanie inspektora < 1180px).
- **Los**: zastępowany tokenami/klasami z ArceeFM (Step 1), część reguł
  (np. transcript/markdown) przenosimy jako komponentowe klasy lub Tailwind.

## Endpointy API używane przez frontend
- `GET /store`, `GET /sessions` (`?workspace_stats`), `GET /sessions/{id}`
- `POST /sessions`, `DELETE /sessions/{id}`, `PUT /sessions/order`
- `PUT /sessions/{id}/presentation`
- `POST /sessions/{id}/runs`, `POST /sessions/{id}/cancel-active-run`
- `GET /sessions/{id}/events`, `GET /sessions/{id}/events/stream` (SSE)
- `GET /sessions/{id}/workspace/diff`
- Konfiguracja sesji (settings) — `PUT` (patrz `UpdateConfigRequest`).

Kształt wiadomości snapshotu: enum `types::Message` z tagiem `role`
(`system|user|assistant|tool`), `assistant.content` bywa `null` przy turach z
`tool_calls`. Mapowanie mamy już w PoC (`mapSnapshotMessages`).
