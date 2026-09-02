# Web client guide

This directory owns the React/Vite client, browser-facing state, checked-in API
contract, component tests, and production-embedded Playwright journeys. The
server remains the source of business truth and wire schemas.

## Ownership and dependencies

- `src/app/features/<feature>/` owns feature model helpers, queries, controller
  hooks/context, and presentation when a workflow spans those concerns.
- `src/app/services/api.ts` is the HTTP transport adapter. TanStack query keys,
  caching, cancellation, invalidation, and polling belong to query owners, not
  presentational components.
- `src/app/types/openapi.generated.ts` is generated from Rust/OpenAPI. Import
  stable aliases from `src/app/types/api.ts`; client-only refinements may live
  there, but do not hand-copy wire DTOs.
- Keep managed-host product state inside `features/managed`. Managed
  orchestrator session views remain session/delegation features because they
  are a distinct durable topology.
- Preserve navigation, abort signals, polling settlement, optimistic state,
  query invalidation, accessibility labels, and behavior-selection defaults.
- Generic providers are for genuinely cross-feature browser state. Do not use
  them as a home for one feature's workflow.

## Starting points

- `src/App.tsx` — provider/router composition.
- `src/app/services/api.ts` — HTTP transport and error decoding.
- `src/app/services/queries.ts` — stable compatibility barrel only.
- `src/app/services/queries/` — focused host, direct/delegation,
  configuration, session, workspace, project, key, and invalidation owners.
- `src/app/features/managed/` — managed model/query/controller/presentation.
- `src/app/types/api.ts` — stable aliases/refinements over generated schemas.
- `openapi.json`, `scripts/generate-api-types.mjs` — checked-in contract and
  fail-closed generator.
- `e2e/` and `playwright.config.ts` — production-embedded browser coverage.

## Cohesive size exceptions

- `components/inspector/ChatInputBox.tsx` keeps one composer state machine:
  text/selection, slash commands, attachments, send-versus-queue behavior,
  keyboard/IME handling, and its accessible presentation. Put server state and
  API mutations in query/controller owners, not in this component.
- `components/modals/ConfigurationsPanel.tsx` and `SettingsModal.tsx` keep the
  existing dense configuration forms whose field validation and save ordering
  are exercised as one workflow. Managed-host panels do not belong there.
- `components/inspector/ThreadsView.tsx` keeps the orchestrator Actions timeline
  (thoughts/tools plus retained worker threads), the Threads list tab, and
  episode rendering together. Direct-child and managed-host workflows remain
  separate features.

These existing UI owners may exceed 800 lines because splitting their tightly
coupled local form/view state would scatter one workflow. Do not add unrelated
queries, providers, or new product workflows to them; extract a real controller
or feature boundary when new behavior proves one.

## Commands

```sh
npm --prefix crates/nac-server/web run typecheck
npm --prefix crates/nac-server/web run lint
npm --prefix crates/nac-server/web run format:check
npm --prefix crates/nac-server/web test
make test-api-contract
make test-assets
make test-e2e
```

## Generated artifacts and single writers

- `make generate-api-contract` writes `openapi.json` and
  `src/app/types/openapi.generated.ts`. The generator fails on unsupported
  schema constructs; extend it explicitly rather than widening to `any`.
- `npm ... run build` writes `../assets/dist`. Commit source and bundle together.
  Do not edit hashed assets by hand.
- `scripts/sync-file-icons.mjs` is the writer for synchronized icon assets when
  that source set changes.

## Placement mistakes

- Do not encode server validation, persistence defaults, or authorization in
  React helpers.
- Do not fetch directly from presentation components when a query owner needs
  to preserve cancellation/polling/invalidation semantics.
- Do not scatter one managed workflow across generic modal/provider folders.
- Do not edit generated API types or committed production chunks manually.
