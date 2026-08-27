# NAC architectural refactor progress

Last updated: 2026-08-27
Integration owner: the primary Codex goal session for this worktree

## Objective and finite acceptance contract

Refactor NAC from exact baseline
`90dd3c9c47446fb14f08cc303c231748a929ee83` through dependency-ordered,
behavior-preserving slices. The result must make managed-host behavior an
explicit bounded context, make HTTP and frontend delivery depend on focused
application/domain contracts, establish responsibility-sized internal seams in
the durable harness, converge first-party tools on the prepared native kernel,
derive frontend DTOs from the Rust/OpenAPI source of truth, and leave durable
agent-navigation guides.

Completion requires milestones 0 through 8 below, current generated assets,
the exact final gates named in this ledger, a bounded production-embedded
browser smoke, and one final independent review. New review findings enter
required scope only when they are reachable through a supported path, violate
a settled contract or required gate, and identify a missing invariant.

## Governing evidence and protected state

- `AGENTS.md` was read completely at task start. It is currently an untracked,
  branch-specific guide and is explicitly task-owned only for milestone 7.
- `demo_decisions.md` was not carried into this worktree. It was not recreated;
  the delegated objective plus tracked implementation/tests and the named local
  ledgers control this run.
- The repository-local `goal-prompt` skill and its complete NAC goal contract
  were read. They require finite review, exact-path staging, coherent green
  commits, and honest treatment of unavailable infrastructure.
- Historical `progress.md`, `managed_progress.md`, `demo_review.md`,
  `manual_todo.md`, `demo_ext_managed.md`, and `tooling.md` were inspected.
  Later settled managed and optional-Podman decisions override stale historical
  review language.
- Preserve exactly and never stage or normalize the pre-existing modified
  `.gitignore` and `progress.md`.
- Preserve `demo_review.md`, `manual_todo.md`, and
  `.agents/skills/goal-prompt/` unless an exact objective-required edit becomes
  necessary; never stage them incidentally.
- Never create or commit `demo_decisions.md`. If it later appears, append only
  material decisions or unresolved questions and keep it local.
- Never reset, clean, amend, rewrite, or discard user state. Inspect worktree
  and staged diffs and stage exact task-owned paths before every commit.
- The human-accepted optional-Podman late-cidfile window remains a documented
  coverage/risk boundary and is not reopened by this refactor.

## Exact baseline and quantitative hotspots

- HEAD: `90dd3c9c47446fb14f08cc303c231748a929ee83` (detached materialization of
  `allison-demo`; the requested baseline exactly).
- Existing dirty state at start: `M .gitignore`, `M progress.md`, untracked
  `.agents/skills/goal-prompt/`, `AGENTS.md`, `demo_review.md`, and
  `manual_todo.md`.
- Baseline `make check`: passed on 2026-08-27.
- Workspace crates: `nac-core`, `nac-server`, `nac-catalog-gen`.
- Rust/TypeScript source baseline: 199,412 lines in the measured source set.

Largest ownership hotspots before refactoring:

| File | Lines | Current mixed responsibilities |
| --- | ---: | --- |
| `crates/nac-server/src/lib.rs` | 17,351 | state/composition, application operations, DTOs/OpenAPI, routers, handlers, error mapping, shutdown, frontend serving, and 9,235 lines of inline tests |
| `crates/nac-core/src/session_service.rs` | 9,831 | attachment, frontend projections, submission/admission, settlement, cancellation, recovery, inbox/goals, delegated completion, and 5,437 lines of inline tests |
| `crates/nac-core/src/permissions.rs` | 4,925 | rule/broker model, evaluation, shell parsing/projection/hard policy, resource binding, grants, and 1,748 lines of inline tests |
| `crates/nac-core/src/runtime.rs` | 4,716 | config parsing, model resolution, direct/orchestrator/worker construction, resume, sandbox construction, and 2,771 lines of inline tests |
| `crates/nac-core/src/tools/mutation.rs` | 3,167 | mutation definitions, path-safe execution, transport behavior, and tests |
| `crates/nac-core/src/terminal/manager.rs` | 2,963 | admission, process lifecycle, retention, cleanup, and tests |
| `crates/nac-core/src/tools/mod.rs` | 2,361 | runtime context, capability composition, legacy decode/dispatch, authorization binding, and tests |
| `crates/nac-server/web/src/app/services/queries.ts` | 1,605 | queries/mutations for unrelated features |
| `crates/nac-server/web/src/app/types/api.ts` | 1,592 | handwritten duplication of the Rust/OpenAPI wire contract |
| `crates/nac-core/src/managed_clone.rs` | 1,345 | managed workflow/domain, Git process adapter, durable operation files, and tests inside harness core |
| `crates/nac-core/src/managed_github.rs` | 1,197 | provider client, token lifecycle, persistence, discovery, and tests inside harness core |

The line target is a design constraint, not a fragmentation metric: prefer
production modules below about 500 lines, and document cohesive exceptions over
800 lines rather than hiding them behind arbitrary one-call wrappers.

## Current architecture inventory

### Domain and durable contracts

- `nac-core::sessions` owns persisted session behavior and snapshot contracts.
- `nac-core::store` owns SQLite schema, projects, transcript, recovery,
  relationships, inbox, goals, grants, revisions, and cross-process leases.
- Durable compatibility surfaces include schema migrations, persisted behavior
  values, project/session IDs, relationship generations, recovery markers, and
  exactly-once completion delivery.

### Application and lifecycle coordination

- `SessionService` is the current durable run/application coordinator, but one
  large module owns attachment, projection, admission, settlement,
  cancellation, recovery, goal/inbox continuation, and delegated completion.
- `nac-server::SessionManager` currently owns server composition plus project,
  configuration, workspace, delegation, managed-host, and session operations.
  It is the main universal-service bag to replace with focused facades while
  preserving its lifecycle gates and transactional ordering.

### Infrastructure

- SQLite/filesystem stores live under `nac-core::store`, `sessions`, model auth
  stores, MCP file configuration, and managed files.
- Git/process execution is distributed across server workspace operations,
  terminal/execution modules, sandbox backends, worker dispatch, and managed
  clone.
- Provider HTTP clients include model clients, MCP, native Exa web retrieval,
  and managed GitHub.
- Local/SSH/Podman execution backends are selected before authorization;
  approval must never change or escape that backend.

### Agent/tool runtime

- `tools::kernel` already proves typed native operation, prepared invocation,
  definitions, authorization, admission, capability snapshots, native calls,
  rich results, and duplicate rejection.
- `tools::mod` still contains a central `LegacyDirectTool<const KIND>` and
  name/kind dispatch for remaining first-party direct tools. Imported MCP tools
  are dynamic adapters and must cross the same explicit invocation/authorization
  boundary without being forced into a static native type.
- `permissions.rs` combines six owners: rule evaluation, approval broker,
  grants, shell analysis, resource projection/binding, and hard policy.

### Delivery

- `nac-server::lib` owns Axum/OpenAPI composition and almost every HTTP DTO and
  handler. Existing `managed_github.rs` and `managed_status.rs` are early
  feature modules but still depend directly on the universal manager.
- The outgoing MCP adapter is separate in `nac-server/src/mcp.rs` and must keep
  its public tool behavior.
- React uses handwritten `app/types/api.ts`, a broad `services/api.ts`, and a
  1,605-line query module. Managed UI spans a global provider plus two large
  modals rather than a feature-owned model/query/controller/presentation seam.
- `crates/nac-server/assets/dist` is the committed production bundle and has a
  single writer: the repository web build/asset target.

### Managed bounded context

- Managed configuration and generic secret persistence are in
  `nac-core/src/managed.rs`; GitHub provider/auth/discovery in
  `managed_github.rs`; clone workflow/operation files/Git process in
  `managed_clone.rs`; server HTTP/device-login/status wiring in nac-server.
- `nac-core` therefore owns provider-specific product onboarding that is not
  required by the harness. The extraction must not make the managed context
  depend on `nac-server` or the whole agent runtime.
- Project publication requires a narrow application port. Native Exa remains a
  tool family and receives credentials through a narrow snapshot/provider,
  rather than depending on managed onboarding.

## Intended dependency graph

```text
React feature consumers
        |
HTTP/OpenAPI/MCP delivery adapters (nac-server)
        |
focused application services / composition ports
        |-------------------------------|
durable harness domain + runtime         managed product facade (nac-managed)
(nac-core: sessions/store/agent/tools)    |-- managed domain/workflows
        |                                 |-- GitHub provider adapter
        |                                 |-- credential/operation stores
        |                                 `-- Git/process adapter
        |                                                |
execution, SQLite/filesystem, model/MCP, sandbox infrastructure adapters ---'
```

Rules:

- Domain/application contracts do not depend on HTTP, React, Axum, or provider
  request/response types.
- `nac-managed` may depend on the smallest stable core contracts or a narrower
  shared contract crate only when evidence requires it; `nac-core` must not
  depend on `nac-managed` product orchestration.
- `nac-server` composes ports and adapters. Handlers decode/validate transport,
  invoke one application operation, and encode the response/error.
- Model-visible exposure, authorization, non-bypassable hard policy, and the
  selected execution backend remain distinct stages.
- Crates/modules are private by default; exports name supported composition or
  domain surfaces rather than leaking infrastructure internals.

## High-risk behavior map and characterization owners

| Seam | Preserved invariant | Existing evidence to retain/relocate |
| --- | --- | --- |
| session admission/settlement | one active owner, exact transcript/recovery ordering, cancellation cleanup | `session_service` and durability tests |
| child/orchestrator relationships | topology separation, bind-before-run, immutable generation mode, exactly-once completion | relationship store, service, server, and E2E tests |
| permissions | ordered rules, hard denial before grants, canonical binding, headless fail-closed, backend unchanged | `permissions` policy/broker/shell/kernel tests |
| terminal/execution | spawn/cancel ownership, retained output bounds, process-tree/backend cleanup | terminal manager/output and backend tests |
| tool invocation | decode before authorization, snapshot membership, collision rejection, rich/cancellable execution | kernel, direct/worker, web, MCP tests |
| persistence/recovery | backward migrations, lease identity, restart reconciliation, no historical data rewrite | store/schema/recovery and `make test-durability` |
| managed credentials | owner-only atomic files, redaction, environment isolation, write-only HTTP | managed/GitHub/web/command tests |
| managed clone | destination confinement, operation-owned staging, cancellation/recovery, Project last | managed clone and server/E2E tests |
| HTTP/OpenAPI | exact routes, response shapes, status opacity, defaults | server router/OpenAPI tests and generated contract snapshot |
| frontend | TanStack query ownership, abort/poll behavior, immutable behavior selectors, managed onboarding resume | Vitest and production Playwright |

## Dependency-ordered milestone plan

### M0 — Characterization and architecture map (complete)

- Complete the read-first baseline/reference inspection and record module,
  public API, persistence, generated-asset, and concurrency/safety maps here.
- Run baseline `make check` and focused inventory commands without changing
  production behavior.
- Identify existing characterization tests for every boundary above and add a
  regression only when an extraction would otherwise be unguarded.
- Acceptance: this ledger names owners, dependency direction, protected state,
  slices, and verification; no production behavior changed.

### M1 — Separate tests and expose internal seams (complete)

- Move inline test modules from server `lib.rs`, `session_service.rs`,
  `permissions.rs`, and `runtime.rs` into descriptive sibling test files using
  explicit `#[path]` modules, preserving test names and private access.
- Split tests further only by an actual owner established in later slices; do
  not rename tests merely for movement.
- Introduce substantive internal modules at the first extraction seam, with a
  narrow API and local tests; avoid empty wrappers.
- Verification: exact before/after test inventory, focused crate tests,
  `make check`, format, and lint before the coherent milestone commit.

### M2 — Thin server and focused application services (complete)

- Extract transport DTOs/OpenAPI, error mapping, router composition, server
  lifecycle/frontend serving, and thin handler modules.
- Introduce focused project, configuration, workspace, session, delegation,
  and managed-host application facades. Preserve shared lifecycle gates inside
  the owning coordinator rather than duplicating them.
- Move one use-case family at a time with handler-level and service-level
  characterization tests. End with `lib.rs` as composition/export wiring.
- Verification: focused server suites per family, OpenAPI/router contract,
  complete `nac-server` tests, check/lint/format.

### M3 — Managed bounded context (implementation complete; final image/E2E gates in M8)

- Add a substantive `nac-managed` crate owning managed domain/workflow state,
  configuration/secrets, GitHub provider/auth/discovery, clone operations,
  readiness facts, filesystem stores, and Git/process adapter.
- Define a narrow project-registration port implemented by server/application
  composition; keep Axum and harness runtime out of `nac-managed`.
- Replace tool-runtime dependencies on managed types with narrow credential and
  command-environment snapshot interfaces; keep native Exa in the tool family.
- Migrate in vertical slices with compatibility re-exports only while consumers
  move, then retire them.
- Verification: managed unit tests without HTTP, server adapter tests, native
  web/credential isolation tests, complete managed E2E and image contract.

### M4 — Decompose durable harness gravity wells (in progress)

- Session service owners: attachment/submission, admission/settlement,
  cancellation, recovery, frontend projection, inbox/goals, delegated
  completion.
- Permission owners: model/evaluation, broker, grants, shell analysis,
  resources/binding, hard policy.
- Runtime owners: config/model resolution, direct/orchestrator/worker builders,
  resume, sandbox, execution context.
- Tool owners: runtime context, registry/capabilities, prepared authorization,
  adapters, individual families. Decompose terminal/execution only where needed
  to clarify admission, process lifecycle, retention, and cleanup.
- Verification: focused owner tests plus complete core and durability suites;
  no topology, safety, prompt, persistence, or backend change.

### M5 — Tool-kernel convergence (pending)

- Replace remaining `LegacyDirectTool` kind dispatch with registered native
  implementations and prepared calls, one cohesive family at a time.
- Keep definitions/runtime-dependent exposure, validation, authorization,
  observability, admission, execution, rendering, cancellation, and protocol
  adapters separate.
- Route imported MCP through an explicit common capability/invocation boundary;
  preserve its dynamic nature and authorization.
- Verification: kernel collision/order/native-vs-model parity, direct/worker
  topology, permission denial, mutation/retention/cancellation, MCP, and web
  family suites.

### M6 — Generated API contract and frontend features (pending)

- Make the Rust/OpenAPI document generate a deterministic checked-in TypeScript
  contract (or an equivalently strict generated compile-time contract) with a
  drift gate. Remove handwritten DTO duplication incrementally.
- Move managed frontend behavior under one feature boundary with model,
  API/query, controller, and presentation ownership. Split modal panels by
  workflow while retaining TanStack cancellation/poll/navigation semantics.
- Split broad query/API files by feature only where imports prove ownership.
- Rebuild and commit production assets with the slice that changes sources.
- Verification: generator drift test, typecheck/lint/format/Vitest,
  `make test-assets`, and managed production Playwright journeys.

### M7 — Durable agent navigation (pending)

- Replace root `AGENTS.md` with a stable topology/dependency/placement/invariant
  guide and exact commands/generated-file/reference policies.
- Add substantive nested guides for `nac-core`, tools plus permission/execution,
  sessions/store/recovery, `nac-managed`, `nac-server`, web, and
  `docker/managed` only at true ownership boundaries.
- Add focused tracked ADRs for durable decisions introduced by this refactor;
  do not commit local historical notebooks.
- Verification: guide placement/link/read-back audit and `git diff --check`.

### M8 — Integration and finite acceptance (pending)

- Retire obsolete transition paths after all consumers migrate; audit exports,
  dependency cycles, duplicate DTOs, broad service bags, maps, and generated
  drift.
- Record final hotspot/dependency measurements and compatibility summary here.
- Required final candidate gates: `make format-check`, `make lint`, `make ci`,
  `make test-durability`, `make test-assets`, `make test-e2e`, and
  `make test-managed-image-contract`.
- Run `make test-managed-image` only if Docker/Podman prerequisites are
  available; otherwise record the exact gap without calling it a pass.
- Run one bounded production-embedded browser smoke covering ordinary project/
  session launch, all behavior selectors, managed status, GitHub entry, and Add
  repository without real credentials.
- Consume exactly one final independent review budget after the candidate is
  green. Repair only qualified direct regressions and rerun proportionate gates.

## Reference-repository findings

- `agentic_auxilary` is clean `main` at
  `81db6151a7a0d08907bde51e24aafc05fd8dd676`. Its useful direction is a small
  native `Tool` contract, separate wire `ToolCodec`, request context, type-erased
  registry, typed handles, protocol renderers, and sibling integration tests.
  NAC must retain its stricter duplicate rejection, prepared authorization,
  admission, rich results, durable events, and backend guarantees; no code or
  path dependency will be copied.
- Codex is clean `main` at
  `c941572917b9295c7318b28aab27709202a645c7`. Its useful direction is private
  modules/explicit exports, sibling test files, under-500-line production
  targets, distinct execution policy/approval/sandbox confinement, typed tool
  runtimes, and narrow crate ownership. NAC will preserve its own settled
  behavior rather than import Codex implementations or licenses.

## Commits and verification

- `3df2b65 refactor: separate core and server test modules` — records the M0
  architecture handoff and moves the four priority inline test modules into
  sibling files with unchanged test inventories and green crate suites/checks.
- `217825f refactor(server): isolate project application service` — moves the
  complete project use-case family behind a focused application facade while
  preserving HTTP contracts and lifecycle deletion ordering.
- `fd30178 refactor(server): isolate project HTTP delivery` — moves project
  DTOs and thin Axum/OpenAPI handlers behind a delivery boundary while keeping
  crate-root public re-exports and the generated contract stable.
- `2035930 refactor(server): isolate SSH configuration flows` — gives saved SSH
  connections focused application and HTTP owners with tri-state update tests.
- `8620c99 refactor(server): isolate saved configuration deletion` — moves
  saved model-configuration list/delete and generated-key retirement behind
  application and delivery boundaries.
- `46e882a refactor(server): isolate credential administration` — moves the
  ordinary write-only credential store behind application and delivery APIs.
- `567c278 refactor(server): isolate saved model configuration writes` — moves
  create/update, light-model validation, and generated-key transaction ordering
  into the configuration application owner.
- `bed766e refactor(server): isolate model provider resolution` — moves saved/
  file model resolution and its fatal/nonfatal provider error contract out of
  HTTP delivery.
- `00cf276 refactor: introduce shared command environment contract` — adds the
  inward `nac-contracts` ownership boundary for immutable per-spawn process
  environments and exact-value output redaction without coupling tool/runtime
  consumers to managed credential stores.
- `1850ff3 refactor(core): inject command environment provider` — replaces the
  three managed-specific fields in `ToolRuntime` with one provider-neutral
  capability while preserving spawn snapshots, retained-output redaction, and
  worker reconstruction metadata.
- `76be2ec refactor(core): inject environment at composition boundary` — makes
  agent/orchestrator/worker construction accept only the shared port and moves
  managed implementation assembly to server/CLI composition.
- `7540dbd refactor: extract hardened credential store` — gives private file
  replacement and cross-process locking an infrastructure owner shared by
  ordinary authentication and managed persistence.
- `8edde97 refactor(managed): extract host and GitHub context` — establishes
  the harness-independent managed crate and points server/CLI consumers at its
  configuration, secret, provider, and command-environment owners.
- `f9969ec refactor: extract process supervision` — moves descendant-aware
  spawn/cancellation/cleanup into shared infrastructure used by terminals,
  workers, and managed Git execution.
- `a76dc07 refactor(managed): own durable clone workflow` — moves clone state,
  operation persistence, Git/process behavior, and reconciliation behind a
  server-implemented project registration port.
- `c6fe667 refactor(managed): own readiness and secret use cases` — completes
  managed readiness facts and application/delivery ownership for generic
  secret administration.
- Baseline `make check` passed at `90dd3c9` on 2026-08-27.
- M0 inventory and dependency plan are complete; no production behavior changed.
- M1 extracted the complete inline test modules from server `lib.rs`,
  `session_service.rs`, `permissions.rs`, and `runtime.rs` into sibling files.
  Reconstructing each original source from the extracted parts matched its
  original SHA-256 before rustfmt. After formatting, complete `cargo test
  -- --list` inventory hashes are unchanged from baseline: nac-core
  `6efe31b4119e3a7bb5c98c0208d3ce9bd3788811b9cf4a08bb0c3932382546cc`
  and nac-server
  `8b020dccfe566d87baa48814f6e41545db9a7af108c96597861dca61ce3464b4`.
- `cargo fmt --all -- --check` passes for the extracted module layout.
- `make crate-test CRATE=nac-core` passes with 1,182 tests and 9 explicit
  environment-dependent ignores when run with loopback fixture permission.
  The confined run was non-authoritative: loopback bind denial poisoned the
  shared test environment and cascaded; representative non-network tests
  passed alone.
- `make crate-test CRATE=nac-server` passes with 149 library and 23 binary
  tests using the same loopback permission.
- `make crate-check CRATE=nac-core` and `make crate-check CRATE=nac-server`
  pass (package formatting plus warning-denied Clippy).
- The first M2 vertical seam moves project list/create/update/delete,
  membership, and ordering into `application::projects::ProjectApplication`.
  HTTP handlers now only decode transport fields, invoke one project use case,
  and encode its outcome; session teardown retains its original ordering by
  delegating to the existing lifecycle owner. The project-focused filter passes
  4 tests, and the complete server suite remains green at 149 library plus 23
  binary tests.
- Project transport DTOs and thin Axum/OpenAPI handlers now live in the
  246-line `delivery::projects` adapter. Public DTO re-exports remain at the
  crate root, the project and OpenAPI contract filters pass, and
  `make crate-check CRATE=nac-server` is green. Server `lib.rs` is now 7,754
  lines, down from its 17,351-line inline-test baseline and 7,977 lines after
  the application extraction.
- Saved SSH configuration CRUD now has a 96-line application service over the
  durable store and a 125-line HTTP delivery adapter. A shared application
  `Field<T>` carries tri-state patch semantics without importing HTTP DTOs.
  Focused application validation/update/delete coverage was added; the complete
  server gate passes 150 library and 23 binary tests, and warning-denied Clippy
  is green. Server `lib.rs` is now 7,637 lines.
- Saved model-configuration list/delete now crosses a focused application and
  delivery seam. Deletion keeps the accepted row-first ordering and retires
  only server-generated top-level/light-model credentials after success.
  Project-default conflict, credential-rotation, and OpenAPI parity regressions
  pass with warning-denied Clippy; `lib.rs` is now 7,588 lines. Create/update
  and provider resolution remain the next configuration slice.
- Ordinary write-only credential administration now has an application facade
  and a 113-line delivery adapter. Secret values remain mutation-only, listing
  returns only the existing redacted suffix contract, and generation/deletion
  preserve names and status behavior. The credential E2E-style server test,
  OpenAPI special-schema/parity tests, and warning-denied Clippy pass;
  `lib.rs` is now 7,466 lines.
- Saved model configuration create/update now lives in the focused application
  owner and its HTTP adapter only maps DTO fields. Generated credentials are
  stored before light-model validation, rolled back on validation/store
  failure, and superseded generated selectors are retired only after the row
  update succeeds, matching the original ordering. The complete server suite
  passes 150 library and 23 binary tests; `lib.rs` is now 7,121 lines. Provider
  discovery from saved/file configurations remains in delivery and is next.
- Saved and file-based provider resolution now belongs to the same application
  owner. Destination-policy checks and key resolution remain fail-fast; managed
  login discovery failures remain nonfatal `models_error` values, while keyed
  provider failures retain their 502 mapping. The full server suite passes 150
  library and 23 binary tests with warning-denied Clippy; `lib.rs` is now 6,945
  lines. The cohesive application module is 518 lines because it owns the full
  credential/row/provider transaction rather than fragmenting that ordering.
- A new lightweight `nac-contracts` inward boundary now owns immutable
  command-environment snapshots and exact-value output redaction. `nac-core`
  consumes the shared contract while the existing managed secret store retains
  its public compatibility re-export. Contract tests, all seven managed config/
  secret tests, and warning-denied core Clippy pass; the lockfile change is
  path-only and was generated offline. This boundary exists to prevent the
  forthcoming managed-product extraction from creating a core/managed cycle.
- `ToolRuntime` now consumes one injected `CommandEnvironmentProvider` rather
  than carrying managed secret, GitHub, and home-root objects as unrelated
  fields. The provider owns snapshot timing, fallback redaction, and the
  nonsecret metadata required to reconstruct a worker process. Focused secret,
  GitHub, worker-argument, and noninheritance tests pass; `make crate-check
  CRATE=nac-core` is green. The complete core suite passed 1,181 tests before
  one independent Podman process fixture returned `ENOENT`; that exact fixture
  passed immediately when rerun, confirming the slice's affected contracts.
- Agent, orchestrator-run, and worker-run construction now accept only the
  shared provider port. Managed credential objects are assembled at the outer
  server/CLI composition boundary; no core execution constructor names or
  accepts managed store/GitHub/home arguments. Both warning-denied crate checks,
  the full server suite (150 library plus 23 CLI tests), and both focused worker
  propagation/noninheritance tests pass.
- Hardened private credential-file persistence now has a shared infrastructure
  owner in `nac-credential-store`. The atomic rename, mode-0600, symlink and
  nonregular-file rejection, parent syncing, and cross-process lock behavior
  moved with nine tests; core's 680-line auth-store gravity well is now a
  94-line model-specific path-policy adapter plus a test-only cross-
  implementation lock helper. The new crate suite and warning-denied core check
  pass. The complete core run passed 1,172 tests and again hit only the known
  unrelated Podman `ENOENT` fixture; its exact isolated rerun passed.
- The new harness-independent `nac-managed` crate now owns strict opt-in host
  configuration, write-only generic secrets, GitHub device authorization/token
  persistence and repository discovery, and the managed command-environment
  adapter. Server and CLI composition consume this crate directly; temporary
  core compatibility modules are implementation-free re-exports needed only
  until the clone workflow migrates. All 10 managed tests, warning-denied
  Clippy for managed/core/server, and focused secret/GitHub HTTP and credential-
  helper tests pass.
- Process-tree supervision now has a shared `nac-process` infrastructure owner
  instead of a 1,034-line core-private module. Core retains only a small private
  re-export seam for terminal/worker consumers and test hooks are feature-gated.
  Both process-tree cancellation tests, warning-denied core Clippy, the full
  core test build, and managed/core/server offline checks pass. This boundary
  lets managed Git execution retain the same descendant cleanup semantics
  without depending on the harness.
- Managed clone workflow state, owner-marked staging cleanup, durable operation
  persistence, Git publication, cancellation, and restart reconciliation now
  live in `nac-managed::clone_workflow`. A narrow `ProjectRegistrar` port uses
  shared domain `ProjectRecord`/`NewProject` contracts; the server owns the
  SQLite adapter. The old 1,345-line core clone module and both managed
  compatibility re-export modules are removed, leaving `nac-core` with no
  production dependency on `nac-managed`. All 16 managed tests, full server
  suite (150 library plus 23 CLI), warning-denied managed/core/server checks,
  core test build, contract test, and OpenAPI parity coverage pass.
- Managed readiness facts and credential-safe path/model/tool/command probes now
  belong to `nac-managed::readiness`; the server contributes only SQLite and
  response facts. Generic managed secret administration has a focused
  application service and 108-line delivery adapter, removing DTOs and handlers
  from server `lib.rs` while preserving write-only values and exact 404/400/500
  mapping. The managed suite now passes 18 tests; focused secret HTTP and
  OpenAPI/router parity tests plus warning-denied managed/server checks pass.
  `lib.rs` is 6,852 lines. Final production E2E and image-contract gates remain
  intentionally scheduled under M8.
- Workspace inspection and mutation now belong to a focused 343-line
  `WorkspaceApplication` with a 252-line HTTP/OpenAPI adapter. The application
  owns diff/files/revisions/open/branch/commit use cases and, critically, keeps
  the existing process gate plus durable workspace and all same-checkout
  session leases alive through uncancellable Git operations. DTOs remain
  crate-root re-exports for compatibility. Mutation admission, request
  cancellation, invalid-stage mapping, OpenAPI/router parity, full server test
  compilation, and warning-denied server Clippy pass. Server `lib.rs` is 6,357
  lines.
- Traditional child sessions and managed child orchestrators now cross one
  focused delegation application boundary while remaining distinct durable
  topologies. Parent behavior/nesting checks, controller selection, and
  foreground/background completion waits moved intact; a separate delivery
  adapter owns the six route pairs and maps HTTP DTOs into application
  commands. Both end-to-end foreground/background HTTP journeys, OpenAPI/router
  parity, the full server test build, and the server crate check pass.
- Session catalog and presentation use cases now have a focused application
  owner that combines durable summaries with process-local run state and
  bounded, checkout-deduplicated workspace measurements. Project, workspace,
  orchestration, MCP, and tests now call that explicit owner; a 113-line
  delivery adapter owns list/update/reorder DTOs and handlers. Presentation
  status/error-shape and serialized-order regressions, OpenAPI/router parity,
  the full server test build, and warning-denied Clippy pass. Server `lib.rs`
  is now 5,755 lines.
- Attached-session projections now have a separate `SessionStateApplication`:
  configuration, snapshots, lineage, paged messages, direct inbox/goal reads,
  permission state, thread events, and skill catalogs share the existing lazy
  attachment/recovery boundary but cannot admit runs or mutate user intent.
  Existing public manager methods remain small compatibility facades while
  catalog consumers use the owner directly. Focused snapshot-recovery, inbox,
  permission, and skill-route regressions plus the full server test build and
  warning-denied Clippy pass.
- Inbox creation/edit/cancellation, goal lifecycle mutations, and permission
  replies/grant deletion now belong to `SessionIntentApplication`. Its command
  types are transport-independent, direct-session eligibility and slash-
  command validation remain exact, and it explicitly cannot acquire operation
  leases or start runs. Existing manager methods are compatibility facades.
  Focused inbox, permission, complete goal lifecycle, and traditional-child
  rejection regressions plus the full test build and warning-denied Clippy
  pass. The cohesive sessions application module is 509 lines because it owns
  the catalog, attached-state, and non-run user-intent seams together.
- Run admission, managed-orchestrator submission, steering, replay/event
  subscription, and cancellation now belong to a 268-line
  `SessionRunApplication`. The service retains the exact lifecycle-gate then
  durable-operation-lease ordering through synchronous active-run
  establishment; primary/delegated ownership checks are repeated under the
  gate, and peer-owned cancellation remains fail-closed. Existing manager
  methods are compatibility facades. Focused path-safe admission failure,
  peer cancellation, active steering, and idempotent cancellation regressions,
  the full server test build, and warning-denied Clippy pass.
- The attached-session HTTP surface (snapshot/messages, inbox, goals,
  permissions, and thread events) now lives in a dedicated delivery adapter
  rather than server composition. The move retains route operations, response
  shapes, status/error mapping, pagination clamps, and application-owner calls.
  OpenAPI/router parity, goal HTTP lifecycle, snapshot recovery, the full
  server test build, and warning-denied Clippy pass.
- Run submission, steering, replay/SSE, and cancellation HTTP adapters now live
  in a focused 191-line delivery module. Event-cursor validation stays beside
  the transport that consumes it; response compression exclusions and SSE
  rendering behavior remain unchanged. OpenAPI/router parity, active steering,
  idempotent cancellation, bounded shutdown with an open stream, the full test
  build, and warning-denied Clippy pass. Server `lib.rs` is now 5,191 lines.
  The same delivery owner now also contains the SSE stream multiplexer and
  event encoding, including replay boundaries/gaps, lag markers, transient
  assistant deltas, and durable event IDs. The bounded-shutdown stream
  regression and warning-denied server check pass after the move.
- Destructive session deletion now belongs to a 154-line lifecycle application
  service that preserves the complete authority chain: relationship gate,
  completion suppression, operation/resource leases, recursive descendant
  cleanup, terminal/sandbox teardown, durable deletion, revision unpinning,
  and final worktree cleanup. The request-independent task still retains leases
  after cancellation. Fail-closed corrupt-snapshot, cancelled-request cleanup,
  and both durable child-topology cascade regressions plus the full test build
  and warning-denied Clippy pass. Server `lib.rs` is now 5,054 lines.
- Transactional session configuration coordination now belongs to a 170-line
  application service. It retains the universal empty-patch no-op, primary
  ownership check, lifecycle gate, active-map write lock, durable operation and
  resource leases, full prospective validation, revision CAS, and eviction
  ordering. Pure patch/model validation helpers remain unchanged for the next
  ownership step. Empty-patch, both submission/patch race directions, invalid-
  patch rollback, the full test build, and warning-denied Clippy pass. Server
  `lib.rs` is now 4,927 lines.
- The remaining session resource endpoints—create, delete, skill projection,
  and configuration get/update—now live in a 92-line delivery adapter. HTTP
  handlers contain only extraction, one manager/application operation, and
  response mapping. OpenAPI/router parity, attached skill projection, the full
  test build, and warning-denied Clippy pass. Server `lib.rs` is now 4,768
  lines.
- Session attachment and durable recovery now belong to a cohesive 409-line
  application owner. It owns configuration-version cache validation,
  resource-lease-first resume construction, recovery reconciliation under the
  operation lease, cache publication, direct inbox wake-up, orphaned
  completion-suppression repair, and delegated monitor restart. Existing
  manager methods are compatibility facades for controllers and application
  consumers. Cached/uncached recovery, event-epoch rotation, ordinary no-
  sidecar attachment, resource-lease ordering, the full test build, and
  warning-denied Clippy pass. Server `lib.rs` is now 4,483 lines.
- Session creation and first-chat admission now belong to a focused 220-line
  application owner. Project location/default inheritance, SSH/sandbox
  exclusion, model/light-model/credential destination preflight, runtime
  construction, resource-lease acquisition, and cache publication remain one
  transaction. SSH/sandbox rejection, inheritance/null behavior, managed
  credential preflight, invalid backend/effort rejection, the full test build,
  and warning-denied Clippy pass. Server `lib.rs` is now 4,314 lines.
- The traditional-child and managed-orchestrator controller implementations
  now live in a dedicated 410-line durable-delegation runtime adapter with
  explicit imports. Foreground/background admission and wait, continuation,
  steering/read, cancellation, wake-up, generation checks, and completion
  delivery remain separate topology-specific implementations. Both end-to-end
  journeys and both cancellation paths, the full test build, and warning-
  denied Clippy pass. Server `lib.rs` is now 3,918 lines.
- Transactional configuration now accepts a transport-neutral
  `SessionConfigPatch` with application-owned tri-state fields; delivery maps
  the wire `RequestField` exactly once. Required-field clearing, optional
  clearing, header serialization, threshold validation, and diagnostic reset
  moved with the application command while the HTTP/OpenAPI schema remains
  unchanged. Empty no-op, invalid rollback, full state round-trip, OpenAPI
  parity, the full test build, and warning-denied Clippy pass. Server `lib.rs`
  is now 3,859 lines.
- HTTP/network composition now belongs to `delivery::server`: the OpenAPI
  router, host and cross-origin guards, bind policy, graceful shutdown,
  readiness/system routes, embedded frontend serving, and the remaining
  catalog/browser adapters no longer obscure application ownership in the
  crate root. Root exports preserve `router`, `serve*`, and `BindPolicy`.
  OpenAPI parity, proxy/host/origin safety, bounded shutdown with an open SSE
  stream, committed-asset integrity, and compression regressions pass; the
  complete server test build and warning-denied crate check are green. Server
  `lib.rs` is now 2,973 lines and the cohesive delivery composition module is
  888 lines because it is the single route/security/listener assembly owner.
- Shared HTTP wire contracts now live in `delivery::contracts` rather than
  alongside server state and lifecycle coordination. Crate-root re-exports and
  OpenAPI schema names remain unchanged; tri-state request decoding and config
  mapping moved with their wire owners. OpenAPI parity and special-schema,
  omitted/null/value, and legacy-header compatibility regressions pass; the
  complete server test build and warning-denied crate check are green. Server
  `lib.rs` is now 2,367 lines.
- Session creation now crosses a transport-neutral `SessionCreationCommand`
  and `SessionSandboxCommand`. Delivery maps tri-state wire fields and header
  wrappers once; the application service owns behavior, location, model,
  sandbox, and first-chat inputs without depending on serde/OpenAPI DTOs. The
  existing public manager facade and OpenAPI schema remain compatible.
  Create inheritance/null handling, invalid required fields, SSH/sandbox
  exclusion, OpenAPI parity, the complete test build, and warning-denied
  server check pass.
- Creation defaults and sibling inheritance now live with the session-creation
  application service. A separate 249-line request-validation owner holds
  model tuple parsing, destination policy, compaction thresholds, sandbox
  conversion, and steering validation shared by creation/configuration.
  `delivery::error` owns all HTTP status and body mapping. The crate root is
  now 1,726 lines of server state/composition, lifecycle gates, internal
  orchestration monitors, and compatibility facades rather than handlers,
  routers, DTO definitions, validation, or error mapping. The complete server
  suite passes 148 library and 23 CLI tests in addition to warning-denied
  Clippy, so M2 acceptance is complete.
- Durable direct-session interaction now has a focused
  `session_service::direct_interaction` owner for behavior gates, permission
  requests/grants, inbox enqueue/edit/cancel/promotion, and autonomous goal
  lifecycle. The move preserves methods on `SessionService` and leaves run
  admission/settlement in the coordinator. Inbox serialization, versioned
  mutation, peer-owned goal admission, budget-limited continuation, and
  orchestrator rejection regressions pass; the complete core test build is
  green. `session_service.rs` is now 4,006 lines, with the new owner at 395.
- Frontend projection now has two focused session-service owners: a 355-line
  snapshot/list/thread/workset assembler and a 516-line transcript paging,
  timestamp, revert, and scan-cache owner. Cross-owner helpers are
  `pub(super)` only; the public `SessionService` surface is unchanged. Paged
  legacy-window parity, bounded connection use, malformed/future event
  tolerance, steering reconciliation, and active-run nonblocking snapshot
  regressions pass; the complete core test build is green.
  `session_service.rs` is now 3,146 lines.
- Durable run recovery and traditional-child terminal reconciliation now live
  in a focused 240-line recovery owner. Operation-lease validation, cached
  transcript refresh, canonical/failed/interrupted terminal mapping, and
  exactly-once child settlement retain their original ordering. Pre-prompt and
  terminal crash-window delivery, shared-store peer recovery, and stale-
  snapshot admission reconciliation regressions pass; the complete core test
  build is green. `session_service.rs` is now 2,910 lines.
- Run lifecycle coordination now has explicit internal owners: a 552-line
  admission module for lease preparation, run creation, atomic prompt commit,
  and task launch; a 180-line cancellation module for owned cancellation and
  cleanup; and a 577-line settlement module for terminal ownership, durable
  snapshot ordering, goal/child settlement, revision capture, and active-run
  teardown. Cross-owner operations are `pub(super)` only. Busy admission,
  workspace exclusion, atomic-commit cancellation, dropped-caller ownership,
  completion/cancel races, cleanup retryability, persistence failure, and
  child terminal recovery regressions pass; the complete core test build is
  green. `session_service.rs` is now 1,615 lines.
- Session construction, client attachment/subscriptions, metadata snapshots,
  sandbox resource leases, and terminal/sandbox teardown now live in a focused
  322-line attachment/resource owner. Subscriber identity, sandbox detection,
  worktree-preserving container destruction, and retained-terminal teardown
  regressions pass; the complete core test build is green.
  `session_service.rs` is now 1,297 lines and serves as the public contract,
  shared state/type owner, steering facade, and submodule composition root.

## Residual risks, coverage gaps, and pending decisions

- `demo_decisions.md` is absent; no user decision is currently required because
  the delegated objective resolves private organization choices.
- Docker/Podman live managed-image prerequisites have not yet been rechecked.
  Their absence is an optional coverage gap, not a pass or automatic blocker.
- The refactor touches historically adversarial safety/durability seams. Moves
  must preserve exact code first, then extract ownership behind existing tests;
  semantic cleanups are separate coherent commits.
- No product, persistence, public-API, migration, safety, or dependency decision
  is currently pending.

## Exact next action

Commit the M4 session attachment/resource owner with exact-path staging. Then
inventory and decompose the permissions gravity well into rule evaluation,
shell/resource projection, hard policy, broker, and remembered-grant owners.
