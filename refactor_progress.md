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

### M2 — Thin server and focused application services (in progress)

- Extract transport DTOs/OpenAPI, error mapping, router composition, server
  lifecycle/frontend serving, and thin handler modules.
- Introduce focused project, configuration, workspace, session, delegation,
  and managed-host application facades. Preserve shared lifecycle gates inside
  the owning coordinator rather than duplicating them.
- Move one use-case family at a time with handler-level and service-level
  characterization tests. End with `lib.rs` as composition/export wiring.
- Verification: focused server suites per family, OpenAPI/router contract,
  complete `nac-server` tests, check/lint/format.

### M3 — Managed bounded context (pending)

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

### M4 — Decompose durable harness gravity wells (pending)

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

Inspect exact worktree/staged diffs and commit the project application-service
slice without protected files. Then extract the next focused server use-case
family, using the project seam as the dependency-direction template.
