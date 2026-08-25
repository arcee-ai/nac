# Expanded NAC harness progress

Last updated: 2026-08-25

## Active post-review repair phase

Status: **in progress**. The earlier implementation milestones remain useful
history, but their completion claim predates the post-implementation review in
`demo_review.md`. The current goal is to resolve NAC-REV-001 through
NAC-REV-024 with evidence and bring the web-first MVP to production-equivalent
launch, browser-E2E, and deterministic durability coverage.

Protected initial state verified on 2026-08-25:

- HEAD is `d3e3fc0` on `allison-demo`; the reviewed implementation range is
  `61b1709..d3e3fc0` and contains the eleven recorded milestone commits.
- `.gitignore` is modified, `AGENTS.md` and `demo_review.md` are untracked, and
  `demo_decisions.md` is intentionally ignored. These are user-owned/local and
  must not be staged or committed.
- The configured NAC model/backend/effort is available. Sandboxed NAC creation
  was rejected because Podman is not installed, so read-only audits run with
  the same model/backend/effort in separate detached clean worktrees at
  `d3e3fc0`; their Git state must be checked and any mutation attempt cancelled.

### Repair milestones

0. **Completed — re-baseline and acceptance map.** Inspected history and
   surrounding contracts, run baseline checks, map every review finding, and
   obtain three independent read-only NAC audits before settling code changes.
1. **Completed — terminal and authorization safety.** NAC-REV-001..005, 012,
   013, and 018 are implemented with escape-boundary regression tests; focused
   and complete `nac-core` gates pass.
2. **In progress — durability and lifecycle correctness.** Resolve NAC-REV-006..009,
   016, 017, and 019 with deterministic barriers/failpoints and multi-process
   assertions; incorporate NAC-REV-014 at its service-lock seam.
3. **Pending — production-equivalent test foundation.** Preserve `make dev`;
   add `make demo`, `make test-web`, scripted-model Playwright E2E, and a
   deterministic durability target; wire frontend tests into declared CI.
4. **Pending — settled web MVP journeys.** Resolve NAC-REV-010, 011, 015,
   020..023 through behavior-aware creation/navigation, active-run inbox UX,
   literal `/goal`, child ownership guards, documentation, and browser tests.
5. **Pending — closure and integrated review.** Reproduce the permission-SSE
   lag risk, close all remaining findings, run final NAC adversarial review,
   production browser smoke, all required gates, and final state audit.

### Finding map

| Finding | Subsystem | Reproduction / contract seam | Focused test seam | Depends on |
| --- | --- | --- | --- | --- |
| NAC-REV-001 | terminal launch, permissions | TTY must spawn the exact authorized command; stdin continues that process only | local/SSH/Podman PTY argv, handle authority, input-vs-poll authorization | terminal process contract |
| NAC-REV-002 | canonical path policy | workspace symlink reaches protected/external target | existing/nonexistent read and mutation symlink targets | canonical resource resolver |
| NAC-REV-003 | shell hard policy | opaque syntax or wrappers conceal dangerous operation | redirects/substitution/parentheses and wrapper corpus | parser-independent hard classification |
| NAC-REV-004 | shell argument policy | default-safe command carries external/sensitive path or executable manifest | `rg` external `.env`, Cargo manifest/config/path options | canonical shell argument projection |
| NAC-REV-005 | cancellation/terminal | cancel while foreground PTY exists and model is between tool polls | deterministic run barrier plus process-tree liveness | terminal ownership/settlement |
| NAC-REV-006 | inbox/transcript | cancellation races delivered-steer transcript commit | commit barrier, restart, exactly-one successor/canonical message | inbox settlement transaction |
| NAC-REV-007 | deletion/lifecycle | child creation races parent deletion; SSE retains deleted service/terminal | lifecycle gate barrier and retained-reference cleanup | relationship creation/deletion boundary |
| NAC-REV-008 | leases/managed monitor | peer process observes active foreign-owned orchestrator | two-process lease owner/observer | durable ownership status |
| NAC-REV-009 | run recovery/relationships | crash after run terminal persistence but before relationship settlement | failpoints at both terminal crash windows, restart exactly-once | atomic/recoverable settlement |
| NAC-REV-010 | web creation | both creation flows omit behavior | component plus real-browser selector/default assertions | behavior API already present |
| NAC-REV-011 | web inbox | active direct composer disables send and exposes no pending controls | component/API/browser steer, edit, cancel, queue | durable inbox API already present |
| NAC-REV-012 | tool decoding | malformed legacy call asks/persists before full validation | invalid non-projected argument with broker spy | typed/prepared decode seam |
| NAC-REV-013 | approval broker/SSE | sole subscriber disconnects after ask is created | subscriber lifetime barrier and waiter cancellation | event subscriber ownership |
| NAC-REV-014 | goal/service locking | live run goal creation cannot bind current baseline | barrier during model run and stale-run settlement | narrower service/agent lock scope |
| NAC-REV-015 | child ownership/goals | child stored as direct reaches REST/UI goal controls | service REST denial and read-only child browser transcript | ownership-aware capability guard |
| NAC-REV-016 | managed launch | executable prompt starts before durable relationship binding | pre-submit failpoint and restart | bind-first launch transaction |
| NAC-REV-017 | relationship generations | continuation rewrites foreground/background mode | concurrent continuation and exactly-once delivery assertions | immutable generation fields |
| NAC-REV-018 | terminal capacity | exited retained handles fill limit until polled | many short retained commands without manual poll | liveness refresh/eviction |
| NAC-REV-019 | HTTP ownership mapping | wrong parent receives 500/existence signal | child/orchestrator opaque not-found routes | structured domain error mapping |
| NAC-REV-020 | commands/web goal UX | literal `/goal` grammar absent | parser/service/component/browser lifecycle cases | goal REST controls |
| NAC-REV-021 | behavior-aware navigation | direct shows empty Threads/Worksets and weak lineage | component/browser topology and Back-to-Parent journeys | child/orchestrator list APIs |
| NAC-REV-022 | goal replacement UX | completed goal requires indirect clear/create | component/browser replacement action | `/goal`/panel command model |
| NAC-REV-023 | documentation | launch docs omit behavior/default/immutability and usage index | documentation assertions/manual review | settled UI/API wording |
| NAC-REV-024 | Make/CI | Vitest passes outside declared gates | `make test-web`, CI/release invocation, asset freshness | test target wiring |

### NAC read-only audit ledger

- Safety audit `529265ea-b683-4985-a42e-1c1873cc4809` — complete and clean;
  independently confirmed NAC-REV-001..005, 012, 013, and 018, identified the
  approval-claim/cancellation race and non-atomic multi-action grant write, and
  recommended deferring automatic completion until exit identity/settlement
  has an honest durable design.
- Durability audit `18a259e0-5dc3-474b-afae-9f70a5d96cbe` — active; covers
  NAC-REV-006..009, 014, 016, 017, and 019.
- Web/E2E audit `b3e6db71-d220-4d33-9225-72c1f2736cb8` — active; covers
  NAC-REV-010, 011, 015, 020..024, production launch/E2E architecture, and the
  permission-SSE replay-gap risk.

### Current verification and next action

- Initial Git state/history inspection: complete.
- Required repository/notebook/review/objective reading: complete.
- Baseline `make check`: passed.
- Milestone 1 implementation: exact-command PTYs on Local/Podman/SSH; canonical
  local and remote authorization targets; opaque/broad/wrapper and path-bearing
  shell guards; complete legacy adapter decoding before approval; independent
  terminal observe/input policy and safe telemetry; direct foreground-terminal
  cancellation; approval dismissal on sole interactive disconnect; atomic
  multi-action grants with reply-claim ordering; live-capacity pruning with
  bounded process-local exit tombstones; and parent-cancellation propagation to
  foreground managed orchestrators.
- Milestone 1 evidence: focused regression groups pass; `make check` passes;
  `make lint` passes; complete `make crate-test CRATE=nac-core` passes with
  1035 passed and 9 environment-dependent ignored tests.
- Next action: begin deterministic durability repairs from the active
  durability audit, preserving the committed safety boundary as the new
  baseline.

## Objective and invariants

Build a coherent, tested, web-first NAC harness with three immutable session
behaviors: the backward-compatible/default `orchestrator`, `direct`, and
`direct-with-orchestrator`. Add a NAC-native dynamically exposed tool kernel,
durable direct-session input and `/goal`, pragmatic backend-safe permissions,
durable traditional child sessions, internal Rust orchestration control, and a
usable web experience.

Non-negotiable invariants:

- Existing orchestrator prompts, tools, topology, workers, persistence,
  defaults, and established API/UI behavior remain compatible.
- Omitted behavior and legacy rows resolve to `orchestrator`; unknown persisted
  behavior fails closed and direct-enabled stores cannot silently downgrade.
- Sessions do not switch behavior in place.
- Direct-with-orchestrator uses internal Rust operations to manage separate
  durable orchestrator sessions, never MCP/HTTP loopback or raw workset tools.
- Traditional subagents remain distinct from orchestrator workers.
- Permission approval never changes the selected local, Podman, or SSH backend
  and cannot bypass non-configurable safety policy.
- Preserve revision checks, atomic mutation, sandbox/path/worktree protections,
  retained output, cancellation, transcripts, recovery, and user changes.
- The MVP is web-only; local reference repositories remain read-only and are
  never build dependencies.
- `.gitignore` and untracked `AGENTS.md` are pre-existing user state and must
  not be staged or committed. `demo_decisions.md` remains local and uncommitted.

## Current baseline

- Worktree: `/Users/allison/git/nac.gwt/allison-demo`
- Branch: `allison-demo`, tracking `origin/allison-demo`.
- Pre-existing dirty state: `.gitignore` modified; `AGENTS.md` untracked.
- Reference branches verified on 2026-08-24: NAC `main`, OpenCode `v2`, Codex
  `main`, Archie `main`, archie2 `la/archie`, agentic_auxilary `main`; all six
  reference worktrees were clean.
- Recorded inherited baseline: `make check` passes and an elevated `make ci`
  passed on 2026-08-24. Socket-binding `Operation not permitted` failures from
  a confined direct `make test` are environmental, not inherited regressions.
- The native tool kernel, immutable behavior foundation, persistent direct
  primary, durable inbox, behavior-specific compaction, retained-terminal
  lifecycle, permission/safety, durable direct-only `/goal`, traditional-child,
  and managed-orchestrator verticals are committed and fully verified. All
  ordered milestones are complete.

## Ordered milestones

1. **Completed — Baseline and implementation plan.** Verified repository and
   references, inspect current seams/tests, run baseline checks, and establish
   this handoff.
2. **Completed — Native tool-kernel seam.** Exercised typed native registration,
   runtime validation, dynamic dispatch/capability snapshots, admission
   metadata, central settlement, and duplicate rejection with real NAC tools.
3. **Completed — Persistent direct session.** Add the compatible behavior
   discriminator, generalized direct loop, direct compaction/recovery,
   session-owned terminals, run outcomes, and durable steer/queue inbox.
4. **Completed — Permissions and safety.** Add ordered allow/ask/deny rules,
   canonical tool resources, interactive/headless approval behavior, saved
   grants, hard safety policy, and backend-specific defaults.
5. **Completed — Direct `/goal`.** Add durable direct-only goal state, controls,
   accounting, idle continuation, restart reconciliation, and tests.
6. **Completed — Traditional child sessions.** Add durable relationships,
   profiles, foreground/background execution, continuation/steering,
   cancellation, completion injection, guards, and web navigation.
7. **Completed — Internal orchestrator control.** Extract protocol-independent
   operations, expose direct-with-orchestrator tools, persist relationships,
   prevent recursion, and preserve outgoing MCP behavior.
8. **Completed — Web UI/API vertical completion.** Expose behaviors, direct
   transcripts/tools, permissions, inbox semantics, goals, child controls, and
   transcript links while preserving orchestrator UX.
9. **Completed — Hardening and handoff.** Complete migrations/regressions,
   recovery/race/durability/safety/web tests, docs, production assets, full
   `make ci`, limitations, and clean milestone history.

## Decisions made and rationale

- Use the provisional persisted/API/UI labels from the objective because they
  are explicit, reversible, and backward compatible.
- Begin at the tool-kernel seam before changing session topology because later
  direct, permission, child, and orchestration tools all depend on a sound
  invocation boundary.
- Preserve the existing orchestrator path during shared refactors and require
  regression coverage at every seam.
- Keep the first kernel inside `nac-core::tools` with no new dependency, proc
  macro, or extracted crate. A registered native tool owns a runtime definition,
  typed input/decoder, admission, permission projection, and behavior; the
  registry erases it only after registration.
- Decode model JSON into a prepared call before leaf authorization and side
  effects. Prepared calls retain backend-resolved semantic resources and keep
  invocation separate, which provides the Milestone 3 permission seam.
- Keep runtime services separate from thin call identity, preserve tool order,
  reject duplicate registration and ambiguous explicit capability sets, and
  retain concrete registered instances for native calls without JSON.
- Route all eight bootstrap worker tools through the kernel now, with `read` as
  the fully typed native proof and explicit value adapters for the other seven.
  Preserve the existing worker scheduler; direct sessions will consume the new
  `Parallel`/`Exclusive` admission metadata.
- Persist behavior as a constrained text discriminator in schema version 17.
  Creation and legacy migration default to `orchestrator`; ordinary snapshot
  saves cannot mutate it; unknown values fail closed in both load and list.
- Treat schema 17 as a deliberate downgrade barrier: older binaries reject the
  store instead of silently reconstructing direct sessions as orchestrators;
  resume now selects construction from the stored discriminator.
- Use one new direct construction policy inside the existing lower `Agent`
  model/tool loop, while retaining the worker-specific bounded dispatch prompt,
  timeout/process wrapper, episodes, and handoff lifecycle. Both direct
  behaviors share this base loop; orchestration control will be an additive
  capability set.
- Give direct primaries a construction-owned coding prompt, the exact eight-tool
  bootstrap snapshot, persistent transcript/compaction state, and session-owned
  process-local terminal manager. Omitted API behavior and outgoing MCP create
  remain orchestrator.
- Enforce the model-visible capability snapshot at execution as well as
  exposure, so a hallucinated hidden `thread` or other tool cannot cross into a
  topology the behavior was not given.
- Consume kernel admission metadata in direct batches: consecutive discovery
  calls can overlap; mutations, arbitrary shell, and unknown tools are
  exclusive ordered barriers. Existing worker/orchestrator scheduling remains
  unchanged.
- Reset command cancellation per direct run, allow up to two seconds for
  cooperative cleanup before abort, preserve failed streamed partial output
  with an explicit marker, and capture direct cancellation revisions. Existing
  orchestrator cancellation timing remains unchanged.
- Apply direct permissions only after typed preparation and immediately before
  invocation. Configured rules are ordered and backend-specific defaults remain
  pragmatic; configured/native denials precede session-scoped remembered
  grants. Pending asks are process-local and interactive-only, while grants are
  durable and bound to backend plus session config revision. Approval never
  changes execution backends.
- Represent `/goal` as one versioned, direct-session-owned durable generation
  with six explicit states and optional token budget. Account only usage after
  the goal's run baseline, serialize continuation claims with the existing
  session operation lease, prioritize the durable inbox, pause on explicit
  cancellation, block on run failure, and reserve broad lifecycle control for
  the user while model tools can only report genuine completion or blockage.
- Represent a traditional child as one durable depth-one relationship and a
  sequence of versioned generations. The visible immutable `general` profile
  inherits the parent's model/backend/workspace and configured permission-rule
  ceiling but starts with fresh grants/context and exactly the eight coding
  tools. Background settlement owns exactly-once parent queue insertion;
  foreground returns the same structured outcome directly. Parent attachment
  reconciles abandoned children, parent deletion removes child sessions, and a
  process-local per-store/workspace read/write gate serializes tool invocations.
- Represent managed orchestration as a durable relationship between one
  `direct-with-orchestrator` parent and one immutable orchestrator session.
  Expose exactly six native control tools only to that parent behavior, keep
  outgoing MCP create semantics orchestrator-only, and share one Rust operation
  seam across native and MCP adapters without loopback. Foreground returns the
  durable outcome; background settlement injects exactly one parent queue item;
  restart attachment, cancellation, continuation/steering, ownership, four-run
  concurrency, recursion prevention, and deletion cascade are explicit.

## Files and subsystems currently changing

- Milestone 1 changed `crates/nac-core/src/tools/kernel.rs`, direct-tool
  registration/dispatch in `tools/mod.rs`, typed `read` input/execution,
  colocated `write`/`edit` definitions, and call identity wiring in
  `agent/dag.rs`.
- Milestones 2–4 changed session snapshots and schema migrations, direct
  construction/resume and prompting, capability/admission enforcement,
  terminal and inbox lifecycle, and service/API behavior selection. The
  permission checkpoint specifically adds backend-aware ordered policy, typed
  canonical resources at the prepared-call seam, exact/narrow shell grants,
  hard safety denials, schema-19 session/backend/config-revision-bound grants,
  process-local interactive asks with timeout/cancellation dismissal, REST/SSE
  state, and the direct-only web approval/grant-management surface plus rebuilt
  production assets.
- Milestone 5 adds schema-20 goal persistence and accounting, native direct-only
  goal tools, service-owned idle/restart continuation and claim reconciliation,
  REST/OpenAPI control, direct-only web controls, neutral internal transcript
  rendering, documentation, and the rebuilt production assets.
- Milestone 6 adds schema-21 child relationships/generations, a server-backed
  protocol-independent controller, native foreground/background/status/cancel
  tools, fresh child construction with an exact capability boundary, durable
  completion/restart reconciliation, REST/OpenAPI routes, web launch/status/
  continuation/cancel/transcript navigation, readable completion rendering,
  shared-workspace tool gates, cascade cleanup, and documentation.
- Milestone 7 adds schema-22 managed-orchestrator relationships/generations,
  six native tools behind an exact 20-tool delegating-direct capability set, a
  shared protocol-independent Rust session-operations seam used by outgoing MCP
  and native control, durable foreground/background settlement and restart
  reconciliation, REST/OpenAPI routes, web launch/status/continuation/cancel/
  transcript navigation, readable completion rendering, cascade cleanup, and
  documentation.

## Verification

- `make check` — passed before implementation.
- `cargo test -p nac-core tools::kernel --locked` — 3 passed.
- `cargo test -p nac-core tools::read --locked` — 5 passed.
- `cargo test -p nac-core discovery_tool_definition_tests --locked` — 4
  passed, including exact ordered inventory/admission and real native/dynamic
  read operation coverage.
- `cargo test -p nac-core --locked` — 963 passed, 9 ignored, 0 failed in
  82.57s before the final permission-resource service parameter refinement;
  affected focused tests passed again after that refinement.
- `make format-check` — passed.
- `make lint` — passed, including workspace Clippy with warnings denied.
- Behavior persistence focused tests — passed, covering all values, list/load,
  creation immutability, unknown-value failure, v16 migration, and the
  pre-side-effect orchestrator resume guard.
- `make check` — passed after the behavior-persistence implementation.
- `make ci` — passed after the behavior-persistence implementation: 967 core,
  111 server, and 21 CLI tests; frontend format, lint, typecheck, and production
  build all passed.
- Direct-primary focused tests — passed for create/persist/resume, API default
  and explicit behavior selection, exact capability enforcement, admission
  grouping, and failed partial-output settlement.
- `make check` — passed after the direct-primary implementation.
- `cargo test -p nac-core --locked` — 970 passed, 9 ignored, 0 failed in
  83.03s after fixing two compatibility regressions found by the first broad
  run.
- `cargo test -p nac-server --locked` — 111 server and 21 CLI tests passed in
  83.24s.
- Durable-inbox focused tests — passed for schema-17 migration, atomic
  transcript/delivery commits, FIFO one-at-a-time promotion, model-boundary
  steer consumption, versioned mutation/cancellation, orchestrator rejection,
  REST CRUD/OpenAPI registration, and restart attachment wakeup.
- `cargo test -p nac-core --locked` — 977 passed, 9 ignored, 0 failed in
  83.36s with the durable inbox implementation.
- `cargo test -p nac-server --locked` — 113 server and 21 CLI tests passed in
  81.88s with the durable inbox implementation.
- `make check` — passed after final inbox API response shaping.
- `make lint` — passed after the durable inbox implementation; workspace
  Clippy and frontend lint report no warnings.
- Direct-compaction policy tests — passed for approved prompt bytes, distinct
  fail-closed direct/orchestrator checkpoint restoration, preserved
  orchestrator compatibility, and the live direct auto-compaction request.
- `cargo test -p nac-core compaction --locked` — 69 passed, 0 failed; `make
  lint` and `make check` also passed for the direct compaction slice.
- Terminal lifecycle focused tests — passed for explicit retain transition,
  foreground settlement/cancellation, retained survival, process-instance
  loss reporting, output recovery, and process-tree cleanup; `make lint` and
  `make check` passed afterward.
- `cargo test -p nac-core --locked` — 984 passed, 9 ignored, 0 failed in
  84.61s with the retained-terminal lifecycle.
- `cargo test -p nac-server --locked` — 113 server and 21 CLI tests passed in
  87.28s with retained terminals preventing unsafe idle service eviction.
- Permission policy/broker/kernel focused tests — passed for ordered wildcard
  evaluation, strict multi-resource aggregation, configured/hard denial before
  grants, backend defaults, canonical file/shell projection, exact external
  scope, opaque expansions/redirections, hard command safety, headless failure,
  once/always persistence, cancellation dismissal, and authorization before
  side effects.
- Permission schema/API focused tests — passed for v18-to-v19 migration,
  deduplicated session/backend/config-revision grant scope, direct-only state,
  reply/delete status mapping, and OpenAPI/router registration.
- `cargo test -p nac-core --locked` — 999 passed, 9 ignored, 0 failed in
  83.93s with permissions and safety.
- `cargo test -p nac-server --locked` — 114 server and 21 CLI tests passed in
  86.58s with the permission REST/SSE surface.
- Frontend verification — 129 tests passed across 16 files; lint, typecheck,
  format, and production build passed. Permission UI coverage includes
  direct-only rendering, automatic pending presentation, all three replies,
  and disabling unsafe reusable grants.
- `make check`, `make lint`, and `make format-check` — passed after the complete
  permission slice. `make test-assets` rebuilt the production bundle and
  reported the expected uncommitted asset delta that this checkpoint includes.
- Recorded pre-goal baseline: `make check` and elevated `make ci` passed on
  2026-08-24.
- Goal store/tool/service focused tests — passed for all six states, versioned
  updates, optional budgets, mid-run accounting baselines, inbox priority,
  cancellation pause, failure blocking, one continuation claim, restart
  reconciliation, direct-only capability exposure, and model authority.
- Goal REST/OpenAPI and frontend focused tests — passed for the complete user
  lifecycle, exact routes and status mapping, direct-only flag controls,
  accounting/budget display, and neutral internal continuation rendering.
- `cargo test -p nac-core --locked` — 1010 passed, 9 ignored, 0 failed in
  79.17s with durable goals.
- `cargo test -p nac-server --locked` — 116 server and 21 CLI tests passed with
  the goal REST/OpenAPI surface.
- Frontend verification — 133 tests passed across 17 files; lint, typecheck,
  format, and production build passed.
- `make check`, `make lint`, and `make format-check` — passed after the complete
  goal slice. `make test-assets` rebuilt the production bundle included by this
  checkpoint.
- Traditional-child focused core tests — 7 passed for schema migration,
  immutable depth-one relationships, exact capability construction, foreground
  settlement, exactly-once background delivery, concurrency release, and
  readable completion rendering. Native controller/model-tool and workspace
  gate tests also passed.
- Traditional-child server tests — passed for live foreground then background
  continuation, automatic parent delivery, cancellation propagation, parent-
  only restart reconciliation, cascade deletion, orchestrator/nesting guards,
  and exact OpenAPI/router registration.
- Traditional-child frontend/type verification — TypeScript passed; 35 focused
  tests passed across child controls and completion rendering.
- Frontend verification — all 136 tests across 18 files passed; lint,
  formatting, typecheck, and production build passed. `make test-assets`
  rebuilt the expected committed bundle delta for this checkpoint.
- `make lint` and the required pre-commit `make check` passed for the complete
  traditional-child slice.
- Managed-orchestrator focused core tests — passed for schema-21 migration,
  exact relationship behaviors, concurrency release, exactly-once background
  delivery, readable completion rendering, exact 8/14/20 tool boundaries, and
  native model-boundary foreground/background launch.
- Managed-orchestrator server tests — passed for live foreground then
  background continuation, automatic parent delivery, cancellation propagation,
  parent-only restart reconciliation, cascade deletion, behavior/ownership/
  recursion guards, and exact OpenAPI router registration.
- Managed-orchestrator frontend verification — all 139 tests across 19 files,
  lint, formatting, and TypeScript passed, including launch/status/cancel/open
  controls and readable durable completion rendering.
- Final broad regression — 1025 core tests passed with 9 ignored, 124 server
  tests passed, and 21 CLI tests passed. Frontend lint, formatting, typecheck,
  all 139 tests, and the production build passed.
- `make lint`, `make format-check`, and the required pre-commit `make check`
  passed after the complete managed-orchestrator slice. The first full
  `make ci` reached its final asset-integrity check and reported only the
  expected uncommitted rebuilt production bundle; the bundle was included in
  the managed-orchestrator commit before the complete gate reran at HEAD.
- `make ci` — passed at managed-orchestrator commit `3e728d5`: formatting,
  warning-denied Clippy/frontend lint, 1025 core tests with 9 ignored, 124
  server tests, 21 CLI tests, doc tests, frontend typecheck/build, and committed
  production-asset integrity all passed.

## Completed commits

- `09261af feat(core): introduce native tool kernel`.
- `3ae182a feat(core): persist session behavior`.
- `edb14e4 feat(core): add persistent direct primary`.
- `2fad41d feat(core): add durable direct inbox`.
- `e460fec feat(core): specialize direct compaction`.
- `b905b34 feat(core): retain direct terminals`.
- `a06d9e7 feat(core): add direct permissions`.
- `63ccd2c feat(core): add durable direct goals`.
- `adcf1c0 feat(core): add durable traditional children`.
- `3e728d5 feat(core): add managed orchestrator control`.

## Known problems and blockers

- Retained/background processes can mutate after the tool invocation releases
  the process-local shared-workspace gate, and separate NAC processes do not
  share that gate. Revision checks/conflict reporting remain authoritative;
  the UI/docs tell callers not to assign overlapping mutations.

## Exact next action

Goal implementation and verification are complete. Preserve the two pieces of
pre-existing user state (`.gitignore` and untracked `AGENTS.md`) and use this
file plus `demo_decisions.md` as the continuation handoff for future work.
