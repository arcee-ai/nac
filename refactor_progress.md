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

- The original `AGENTS.md` was read completely at task start. Milestone 7
  replaced that untracked branch-specific brief with the committed durable
  repository guide while preserving every other protected local path.
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

### M4 — Decompose durable harness gravity wells (implementation complete; final durability gate in M8)

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

### M5 — Tool-kernel convergence (complete)

- Remaining first-party direct tools are registered native implementations with
  prepared calls; the numeric `LegacyDirectTool` dispatcher is retired.
- Keep definitions/runtime-dependent exposure, validation, authorization,
  observability, admission, execution, rendering, cancellation, and protocol
  adapters separate.
- Imported MCP traverses an explicit one-capability kernel snapshot while
  preserving dynamic schema/transport behavior and authorization.
- Verification: kernel collision/order/native-vs-model parity, direct/worker
  topology, permission denial, mutation/retention/cancellation, MCP, and web
  family suites.

### M6 — Generated API contract and frontend features (implementation complete; final E2E gate in M8)

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
- The managed-host UI now has one feature boundary with pure model helpers,
  TanStack query ownership, controller hooks/context, and presentation panels.
  The former 456-line host modal is a 50-line layout/navigation shell over
  focused status, GitHub, and secret panels; repository onboarding retains its
  polling, abort, invalidation, toast, and navigation behavior in a 322-line
  feature-owned workflow. Shared query exports remain as compatibility seams
  for unaffected consumers while managed implementations live with the
  feature. All feature production files are below 500 lines.
- Frontend typecheck, lint, format check, and all 178 Vitest cases pass. The
  production build is green, and `make test-assets` passes from the committed
  source and synchronized production bundle at `8b86c97`.

### M7 — Durable agent navigation (complete)

- Root `AGENTS.md` is now a stable topology/dependency/placement/invariant
  guide with exact commands, generated-file ownership, and reference policy.
- Substantive nested guides cover `nac-core`, tools, permission/execution,
  sessions/store/recovery, process supervision, catalog generation,
  `nac-managed`, `nac-server`, web, and `docker/managed` at real ownership
  boundaries. Every cohesive production module above 800 lines is named in
  its nearest guide with its reason and placement restriction.
- Focused tracked ADRs record dependency direction and the generated API
  contract; the absent local decision notebook was not recreated.
- Guide placement/read-back and local Markdown-link audits pass; the final
  ownership/size measurement refinements are committed at `5b3058c`.

### M8 — Integration and finite acceptance (complete)

- Obsolete managed module paths, legacy first-party dispatch, duplicate wire
  DTOs, broad query/service bags, public implementation modules, dependency
  cycles, stale generated output, and undocumented large owners were audited.
- Final hotspot/dependency measurements and public compatibility are recorded
  below. No transitional production consumer remains for the retired paths.
- Every required final gate passed. Docker 29.7.2 was available, so the optional
  pinned Linux/amd64 managed-image build and smoke also ran and passed.
- The production-embedded in-app browser smoke covered ordinary project and
  session launch, toggled all three behavior selectors, inspected managed
  readiness, and opened Add repository/GitHub onboarding without real
  credentials. The browser reported no console errors; its isolated state was
  removed afterward.
- The single independent review budget found one generated-contract gap and no
  other blocker. The three duplicated wire enums now derive from `ApiSchema`,
  two redundant refinements use generated records directly, and an unused
  handwritten steering request was removed. Proportionate contract/frontend/
  asset verification passed after the repair; no second review was started.

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
- `19a4235 refactor(web): organize managed host feature` — moves managed host
  model/query/controller/presentation ownership under one feature boundary,
  splits the host modal into focused panels, preserves compatibility exports,
  adds pure model regressions, and commits the synchronized production bundle.
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
- Permission approval coordination now has a 365-line broker owner, while
  ordered rule/default/grant evaluation and wildcard matching live in a
  147-line evaluation owner. The public permission types and wildcard path are
  unchanged. Last-rule-wins, remembered-grant precedence, hard-denial
  precedence, headless fail-closed, waiter cancellation, reply ownership, and
  subscriber-loss regressions pass; the complete core test build is green.
- Permission resource and shell ownership is now explicit: file/canonical
  projection (300 lines), shell parsing (190), command classification (95),
  hard policy (772), opaque-shell policy (437), and canonical resource/command
  binding (740). The 198-line root owns public contracts and composes those
  stages; crate-visible entry points preserve their original paths. The two
  larger cohesive modules remain below 800 lines and keep path binding separate
  from denial analysis. Authority-amplification/broad-deletion denials,
  canonical workdir projection, unlink/rmdir/git mutation policy, and grant vs
  hard-denial precedence regressions pass; warning-denied Clippy and the
  complete core test build are green.
- Runtime configuration parsing now lives in a focused 275-line owner. It
  retains the public `runtime` exports while isolating strict non-model loads,
  explicit-file model identity import, removed-key warnings, credential
  destination policy, and all storage/model/compaction/sandbox/worker settings.
  Ambient and explicit config, non-model strictness, removed-key migration,
  the complete core test build, and warning-denied Clippy pass.
- Runtime model and launch-setting resolution now lives in a focused 144-line
  owner. It composes explicit/config model values, catalog provider selection,
  compaction defaults, worker time/output limits, header transport, local
  config cwd, and store-path resolution without owning run construction.
  Model override/clear semantics, ambient isolation, compaction bounds, header
  validation, worker limits, store-path behavior, the complete core test
  build, and warning-denied Clippy pass.
- Fresh primary-session and managed-worker construction now lives in a focused
  417-line builder owner. Behavior selects the agent mode at construction;
  SSH, local, and sandbox workspace assembly remain mutually exclusive; model,
  light-model, MCP, skill, worktree rollback, and durable snapshot ordering are
  unchanged. Required-model preflight, managed-worker context and SSH restore,
  direct behavior, sandbox default/enablement, invalid SSH+sandbox rejection,
  the complete core test build, and warning-denied Clippy pass.
- Resume selection and construction now lives in a focused 468-line owner. It
  owns picker admission, snapshot lookup/normalization, interrupted-run
  recovery, operation-lease migration, model/client restoration, local/SSH/
  sandbox workspace reconstruction, and resumed agent assembly. Picker network
  deferral, message restoration, effort migration/lease ownership, remote and
  local path normalization, invalid legacy repair, SSH+sandbox rejection, the
  complete core test build, and warning-denied Clippy pass. The picker tests'
  loopback mock required the authorized unsandboxed test run.
- Sandbox option resolution and construction now lives in a focused 223-line
  owner. It keeps enablement separate from defaults, rejects SSH+sandbox
  combinations before persistence, maps mounts/workspaces and GPU selectors,
  rolls back forked worktrees on specification failure, and launches with the
  existing durable owner/activity keys. Sandbox default/enablement, GPU CDI,
  explicit-mount mapping, worktree rollback, remote conflict, the complete core
  test build, and warning-denied Clippy pass.
- Runtime launch/resume contracts now live in a focused 313-line owner, and the
  SSH browse/canonicalization adapter in a 61-line owner. Public `runtime` type
  and function paths remain stable; private option-resolution and validation
  methods are visible only to sibling runtime owners. The 100-line runtime root
  is now composition/re-export wiring plus two generic path helpers. SSH config
  cwd, remote creation, optional-model, sandbox enablement, the complete core
  test build, and warning-denied Clippy pass. The fake MCP loopback test required
  the authorized unsandboxed run.
- The 808-line tool capability/kernel characterization suite now lives in a
  sibling test file rather than obscuring production composition. All 14 moved
  registry ordering/topology, native/model parity, authorization binding,
  hard-denial, terminal approval, and ancestor-swap regressions pass; the
  complete core test build and warning-denied Clippy are green. Tool production
  code is now 1,524 lines before responsibility extraction.
- `write` and `edit` are now explicit native prepared-invocation types owned by
  their mutation families. Each owns full decode-before-authorization,
  canonical file-resource projection/binding, exclusive workspace admission,
  and the same atomic backend execution; numeric legacy dispatch cases 1 and 2
  are retired. All 14 write/edit family tests and all 14 kernel/capability/
  authorization characterizations pass; the complete core test build and
  warning-denied Clippy are green.
- `glob` and `grep` are now explicit native prepared-invocation types owned by
  their discovery families. They retain bounded full decoding, parallel
  admission, canonical root projection/binding, backend parity, stable paging,
  ignore semantics, and cancellable execution; numeric legacy dispatch cases 3
  and 4 and their dead shared validators are retired. The discovery suite passes
  34 tests with its three documented optional/environment-specific cases
  ignored, all 14 kernel characterizations pass, and warning-denied Clippy is
  green.
- `exec_command`, `write_stdin`, and `read_command_output` are now explicit
  native prepared-invocation types behind a focused 355-line terminal adapter.
  It owns full decode, shell/handle/output resource projection, canonical
  command/workdir binding, exclusive mutation vs parallel output admission,
  and delegation to the existing cancellation/retention/process owner. The
  numeric legacy built-in dispatcher and all kind matches are removed. The
  685-line terminal behavior suite moved to a sibling test file; all 18 tests
  and all 14 kernel characterizations pass, warning-denied Clippy is green, and
  the tool composition root is 971 lines. The Git prompt loopback case required
  the authorized unsandboxed run.
- Runtime-defined MCP tools now adapt into an immutable one-capability kernel
  snapshot. Their dynamic schema is preserved, inputs are decoded before
  policy, `mcp_call` targets participate in the same broker evaluation and
  revalidation pipeline, and transport executes only after authorization.
  Default permission behavior remains allow, preserving existing calls while
  explicit rules can deny imported capabilities. A regression proves denial
  occurs before the transport adapter; all 14 kernel characterizations and
  warning-denied Clippy pass.
- The native-kernel module's 466-line characterization suite now lives in a
  sibling file. The 613-line production owner exposes registry construction,
  typed handles, strict capability snapshots, prepared calls, authorization/
  revalidation, binding, and invocation without inline test weight. All six
  moved collision, ordering, prepared-call, hard-denial, canonical-binding, and
  interactive-broker tests pass; warning-denied Clippy is green.
- Tool execution context and thread lifecycle now have explicit owners. A
  131-line runtime-context module owns construction-time capabilities, backend,
  terminal/environment/redaction services, workspace gates, and path helpers;
  a 401-line lifecycle module owns run generations, dispatch admission,
  steering settlement, cancellation, and drain. Four stale-generation,
  cancellation/drain, and shared-workspace-gate regressions pass; the complete
  core test build and warning-denied Clippy are green. The tool root is now 455
  lines of contracts, native registry/capability composition, and routing.
- The terminal manager's 1,707-line behavior suite now lives in a sibling test
  file, leaving 1,242 production lines for the process/retention extraction.
  Thirty-five admission, cancellation, process-tree cleanup, bounded output,
  retention/eviction, authority, settlement, and remote-cleanup tests pass;
  the SSH and Podman contract cases remain explicitly ignored pending their
  optional infrastructure. The complete core test build and warning-denied
  Clippy are green.
- Terminal ownership is now responsibility-sized: the 229-line manager root
  owns shared state, construction, durable authority, and pipe reading; a
  330-line interactive owner handles PTY admission/input; a 399-line one-shot
  owner handles process lifecycle and bounded stream capture; and a 299-line
  retention owner handles output paging, settlement, retained handles, leases,
  and remote cleanup retries. Cross-owner methods are parent-scoped only.
  All 35 terminal manager regressions pass with the same two optional SSH/
  Podman cases ignored; the complete core test build and warning-denied Clippy
  are green.
- The mutation family now separates its 1,081-line regression suite and its
  562-line remote Python protocol/transport from the local revision/atomicity
  owner. All 31 local, mounted, remote, cross-process lock, symlink-swap,
  metadata, failure-injection, and backend-parity tests pass; warning-denied
  Clippy is green. The remaining 1,529-line local owner is cohesive around
  byte/text projection, revision checking, directory-descriptor traversal,
  atomic publication, metadata preservation, and cross-process file locks; its
  size and placement restriction must be documented in the nested tool guide.
- The complete core suite passes 1,156 tests with nine explicit optional or
  environment-dependent ignores after the runtime, permission, session,
  terminal, mutation, and tool-kernel decompositions. This establishes one
  integrated M4/M5 candidate before the final durability gate.
- Discovery now has explicit owners for backend-safe filesystem traversal (956
  lines), ignore-rule parsing (202), pattern compilation/matching (284), and
  stable bounded pagination (445); the 739-line family root owns tool schemas,
  decoded search orchestration, and native prepared invocation. The 1,609-line
  regression suite remains a sibling module. All 34 runnable discovery tests
  pass with the same three documented Podman/SSH/PATH cases ignored, and the
  warning-denied core check is green. The filesystem adapter deliberately
  exceeds 800 lines because it keeps local, mounted-sandbox, and SSH no-follow
  traversal parity in one auditable safety owner; the nested tool guide must
  document this restriction.
- The Exa web family now keeps its eight bounded-result, URL/network-policy,
  redirect, cancellation, and exact-credential-redaction regressions in a
  280-line sibling test module. The 841-line production module is one cohesive
  provider family covering schema, prepared authorization, target validation,
  retry/redirect policy, transport injection, bounded decoding, and masking;
  this deliberate exception must be recorded in the nested tool guide. All
  eight tests pass with authorized loopback fixtures and the warning-denied
  core check is green.
- `bb06530 refactor(web): generate API types from OpenAPI` — the assembled
  Rust/OpenAPI router now exposes one state-free document seam
  shared by the live `/openapi.json` route and an offline exporter. The checked-
  in 3.1 document drives a dependency-free, fail-closed TypeScript schema
  generator; `make test-api-contract` verifies both artifacts without mutation,
  and `test-assets` now depends on that drift gate. The stable `api.ts` surface
  fell from 1,592 handwritten lines to 450 lines of generated aliases and
  intentional frontend refinements; 142 same-name DTO declarations plus the
  managed/GitHub/catalog aliases now derive from 202 generated schemas.
  Required-nullable and constrained-enum OpenAPI corrections were added at the
  Rust owners without changing serialization. Contract generation, frontend
  typecheck/format/lint, all 175 frontend tests, both OpenAPI router/schema
  tests, and warning-denied core/server checks pass. The process-cleanup
  frontend cases require authorized process-table access; their confined
  `EPERM` run was non-authoritative and the authorized rerun was green.
- `19a4235 refactor(web): organize managed host feature` — managed frontend
  behavior now lives under
  `src/app/features/managed/{model,queries,controller,presentation}`. The former
  456-line host modal is a 50-line layout shell over status, GitHub, and secret
  panels; the 322-line repository workflow retains polling, abort, invalidation,
  toast, cancellation, and navigation semantics. All 178 frontend tests,
  typecheck, lint, and format check pass. `make test-assets` passes from commit
  `19a4235` with the OpenAPI/type drift checks and production build clean.
- `8b86c97 refactor(web): split query owners by feature` — the remaining
  1,507-line frontend query service bag is now a 20-line stable
  compatibility barrel over focused host (120), direct/delegation (286),
  configuration (352), session (393), workspace (139), project (143), key
  (80), and invalidation (18) owners. Existing imports and query-key bytes are
  unchanged; snapshot generation fencing, cancellation signals, polling,
  optimistic prompt state, ordering, and invalidation logic moved intact. Web
  typecheck/format/lint and all 178 tests pass. `make test-assets` passes clean
  with the source and generated bundle committed together.
- `407014c refactor(managed): narrow facade and internal adapters` — the
  integration public-surface audit makes all `nac-managed` implementation
  modules private and exports one explicit supported facade. Clone domain/
  workflow coordination is now a 625-line owner over a 177-line durable
  operation/destination/staging adapter and a 266-line supervised Git/process
  adapter. GitHub credential persistence and locking is a separate 94-line
  adapter; the 851-line provider client retains only OAuth/device/refresh,
  authenticated API discovery, provider policy, and wire decoding. All four
  managed inline test suites moved to descriptive sibling files. The complete
  managed suite passes 18 tests, the complete server suite passes 148 library
  plus 23 binary tests, the three focused core secret/redaction/worker
  propagation regressions pass, and managed/server checks compile cleanly.
- `9d8fcb9 docs: add durable repository navigation` — replaces the untracked
  branch research brief with a stable
  root ownership/dependency guide, adds substantive guides at the core, tool,
  permission, session lifecycle, session snapshot, store, managed, server, web,
  and managed-image boundaries, and records accepted dependency-direction and
  generated-contract decisions under `docs/architecture/`.

## Candidate dependency, public-surface, and hotspot audit

- Cargo resolves an acyclic workspace graph. `nac-managed` depends inward on
  `nac-contracts`, `nac-credential-store`, and `nac-process`; it has no normal
  dependency on `nac-core` or `nac-server`. Only `nac-server` composes the
  managed facade in normal production code; `nac-core` references it only in
  tests.
- `nac-managed` has no public implementation modules and exposes one explicit
  facade. No obsolete `nac_managed::{configuration,github,...}` paths remain.
- The checked-in OpenAPI document currently contains 205 schemas. The stable
  frontend API surface has generated `ApiSchema<...>` aliases plus only three
  intentional manual record refinements (`SessionOverviewRecord`,
  `ThreadEventBoundary`, and `SshTarget`); none duplicates an OpenAPI schema or
  wire request/response DTO. `EpisodeStatus`, `ManagedAuthProvider`, and
  `McpTransport` now derive from their generated schemas.
- No `LegacyDirectTool` or migrated-tool central name dispatch remains. Native
  and dynamic tools cross the explicit capability/preparation/authorization
  boundary; model visibility is not treated as execution authority.
- Quantitative production hotspot delta (baseline to candidate):

  | Owner | Baseline | Candidate owner(s) |
  | --- | ---: | ---: |
  | `nac-server/src/lib.rs` | 17,351 | 1,728 |
  | `session_service.rs` | 9,831 | 1,297 |
  | `permissions.rs` | 4,925 | 198 |
  | `runtime.rs` | 4,716 | 100 |
  | `tools/mod.rs` | 2,361 | 455 |
  | terminal manager | 2,963 | 229 |
  | mutation family | 3,167 | 1,529 local owner plus remote/tests |
  | managed clone | 1,345 core-owned | 625 workflow plus 177/266 adapters |
  | managed GitHub | 1,197 core-owned | 851 provider plus 94 credential store |
  | frontend queries | 1,605 | 20 barrel; largest owner 393 |
  | frontend API types | 1,592 | 450 generated aliases/refinements |

- Remaining production modules above 800 lines are cohesive safety, provider,
  lifecycle, composition, UI, or generated-output owners. Their nearest
  `AGENTS.md` guide states why they remain intact and rejects unrelated growth;
  arbitrary fragmentation was not used to game the size target.

## Final acceptance evidence

All commands below passed on 2026-08-27 from the final candidate unless the
post-review note says otherwise:

- `make format-check` — frontend and Rust formatting current.
- `make lint` — frontend lint plus warning-denied workspace Clippy current.
- `make ci` — workspace Rust suites green, including 1,156 core tests with the
  nine contractually ignored live/optional-infrastructure cases, 18 managed
  tests, 148 server library tests, 23 server binary tests, 178 frontend tests,
  generated OpenAPI/TypeScript drift checks, production build, and managed
  image contract.
- `make test-durability` — all ten focused transcript, child completion,
  recovery, relationship, peer-lease, and managed-settlement regressions pass.
- `make test-assets` — OpenAPI and generated TypeScript current; lint,
  typecheck, production build, and committed bundle drift check pass.
- `make test-e2e` — all 14 production-embedded Playwright journeys pass,
  including direct execution, native tool results, immutable behavior,
  steering/inbox/goal flows, child navigation, managed onboarding, responsive
  repository selection, and clone cancellation.
- `make test-managed-image-contract` — shell and static image/workflow contract
  pass.
- `make test-managed-image` — Docker 29.7.2 built the pinned Linux/amd64 image;
  readiness, restart, toolchain, and SIGTERM smoke pass.
- The bounded in-app browser smoke used an isolated loopback server and
  task-owned temporary stores. It exercised all three immutable behavior
  controls, created an ordinary project and reached its new-chat/session
  surface, inspected exact managed readiness failures, and opened the GitHub/
  Add repository entry without real credentials. No browser console errors
  were emitted; the server, tab, and temporary directory were removed.
- The one independent final review found only a P2 generated-contract gap:
  three handwritten enums and one unused request interface could drift from
  OpenAPI. The final slice removes that duplication. Afterward,
  `make format-check`, all 178 frontend tests, and `make test-assets` (including
  generation, lint, typecheck, build, and bundle drift) pass.

## Public compatibility summary

- HTTP route names, methods, response/error shapes, OpenAPI paths, outgoing MCP
  tool names, CLI/configuration defaults, and persisted public vocabulary are
  unchanged. OpenAPI corrections only describe already-serialized nullability
  and enums more precisely.
- No database migration or historical data rewrite was introduced. Existing
  schema, transcript, relationship, lease, goal, inbox, recovery, and session
  behavior values retain their supported read/write direction.
- Orchestrator, direct, and direct-with-orchestrator remain immutable session
  behaviors. Traditional child sessions, managed child orchestrators, and NAC
  workers remain separate durable topologies.
- Local, SSH, and optional Podman execution stay selected before authorization;
  approval does not change backend confinement. Hard denials, canonical
  resource binding, remembered-grant scope, headless fail-closed behavior,
  revision/atomic mutation, output retention, cancellation, and cleanup are
  preserved behind narrower owners.
- Managed NAC remains additive and opt-in. Managed model/GitHub/host-secret and
  ordinary Exa credentials retain their isolation and exact-value redaction
  boundaries; native web retrieval remains a tool/provider family rather than
  a managed-product dependency.

## Residual risks, coverage gaps, and pending decisions

- `demo_decisions.md` was absent and was not recreated. No product,
  persistence, public-API, migration, safety, dependency, or license decision
  is pending.
- Deliberately cohesive modules above 800 lines remain documented exceptions.
  Their guides name the closed responsibility and forbid unrelated growth;
  this is a maintenance constraint, not an acceptance gap.
- The existing optional-Podman late-cidfile limitation remains the previously
  accepted boundary and was not expanded by this refactor. Static Podman
  contracts, local/remote backend characterization, and the live managed Docker
  image smoke are green.
- Docker emitted only the expected host-platform warning while running the
  requested Linux/amd64 image on an arm64 host; emulated smoke completed.

## Exact manual test instructions

1. Run `make demo`, open the printed loopback URL, create a disposable local
   Project, select each of the three behavior cards in turn, and confirm the
   created chat labels the chosen immutable behavior. Use **New Chat** to verify
   that behavior selection is requested again.
2. In an ordinary direct chat configured with test credentials, submit a short
   prompt, steer the active run, queue/edit/cancel one pending input, and stop
   the run. Confirm the transcript and retained terminal/tool output survive a
   page reload.
3. Run `make test-managed-image`; then follow `docs/managed/README.md` with a
   disposable managed configuration. Confirm status/readiness, GitHub Connect,
   Add repository, repository/branch selection, clone cancellation, and
   bounded shutdown. Real provider/GitHub credentials are required only for a
   final external-service exercise, not for the checked-in automated or browser
   smoke evidence above.

## Exact next action

Commit this final generated-contract repair and acceptance handoff with exact-
path staging. No implementation, verification, or review work remains after
that commit.

## Post-candidate managed model contract integration

After the original acceptance candidate, the human merged
`67c5655 feat(managed): bootstrap host model credentials` onto the historical
`90dd3c9` baseline and requested that its behavior be incorporated here. A
blind merge would have restored retired owners (`nac-core::managed`, the
monolithic runtime/server, handwritten frontend DTOs, and generic managed UI),
so this worktree treats the side commit as a behavior contract and ports it
through the current dependency graph.

### Implemented slices

- `52ea611 feat(core): support mounted model credentials` introduces one
  provider-neutral trusted credential source. The shared credential adapter
  rejects symlinks, nonregular/oversized/non-UTF-8 files, and access for other
  users based on the opened descriptor. Model construction permits the source
  only for API-key providers; direct/resume/worker builders carry only the
  path, and the hidden worker flag never carries secret bytes.
- The pending managed application slice keeps strict host configuration and
  readiness in independent `nac-managed`, resolves the backend at server
  composition, applies omitted launch defaults in session creation, restores
  the source during matching resume, projects `/models` and
  `/managed/status` through focused application/delivery owners, derives the
  frontend schema from OpenAPI, and keeps managed model state under the
  frontend feature. The image owns a distinct read-only credential mount.

No persistence schema, public session vocabulary, ordinary host default, MCP
shape, permission decision, backend-selection rule, or managed topology was
changed. The new managed TOML fields and status object are the exact additive
contract introduced by `67c5655`; unmanaged composition remains inert.

### Integration verification before commit

- workspace all-target/all-feature check, `make format-check`, `make lint`,
  `make test-source-size`, `make test-api-contract`, and
  `make test-managed-image-contract` pass;
- all 13 credential-store tests, 1,158 core library tests (nine ignored), all
  19 managed tests, and the focused managed server create/resume/catalog/status
  regression pass;
- frontend typecheck/lint, the focused managed-profile model test, all 178
  frontend tests, the generated production build, and all 14
  production-embedded Playwright journeys pass.

### Exact next action

Commit the managed application/UI/image slice with exact-path staging and the
current generated contract/assets, leaving `.gitignore`, `progress.md`, the
local goal-prompt skill, `demo_review.md`, and `manual_todo.md` untouched. Then
run the complete immutable-candidate acceptance gates, the available live
managed image smoke, a bounded browser smoke of the new managed model surface,
and the already-authorized final dependency/safety/contract review.
