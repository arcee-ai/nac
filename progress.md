# Expanded NAC harness progress

Last updated: 2026-08-24

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
- The native tool kernel, immutable behavior foundation, and first persistent
  direct-primary create/resume/API vertical are committed. The durable direct
  inbox implementation is in verification before its checkpoint commit.

## Ordered milestones

1. **Completed — Baseline and implementation plan.** Verified repository and
   references, inspect current seams/tests, run baseline checks, and establish
   this handoff.
2. **Completed — Native tool-kernel seam.** Exercised typed native registration,
   runtime validation, dynamic dispatch/capability snapshots, admission
   metadata, central settlement, and duplicate rejection with real NAC tools.
3. **In progress — Persistent direct session.** Add the compatible behavior
   discriminator, generalized direct loop, direct compaction/recovery,
   session-owned terminals, run outcomes, and durable steer/queue inbox.
4. **Pending — Permissions and safety.** Add ordered allow/ask/deny rules,
   canonical tool resources, interactive/headless approval behavior, saved
   grants, hard safety policy, and backend-specific defaults.
5. **Pending — Direct `/goal`.** Add durable direct-only goal state, controls,
   accounting, idle continuation, restart reconciliation, and tests.
6. **Pending — Traditional child sessions.** Add durable relationships,
   profiles, foreground/background execution, continuation/steering,
   cancellation, completion injection, guards, and web navigation.
7. **Pending — Internal orchestrator control.** Extract protocol-independent
   operations, expose direct-with-orchestrator tools, persist relationships,
   prevent recursion, and preserve outgoing MCP behavior.
8. **Pending — Web UI/API vertical completion.** Expose behaviors, direct
   transcripts/tools, permissions, inbox semantics, goals, child controls, and
   transcript links while preserving orchestrator UX.
9. **Pending — Hardening and handoff.** Complete migrations/regressions,
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

## Files and subsystems currently changing

- Milestone 1 changed `crates/nac-core/src/tools/kernel.rs`, direct-tool
  registration/dispatch in `tools/mod.rs`, typed `read` input/execution,
  colocated `write`/`edit` definitions, and call identity wiring in
  `agent/dag.rs`.
- Milestone 2 changes session snapshots/summaries, schema/migrations,
  persistence queries, and view/service metadata. The current slice adds
  direct construction/resume in `runtime.rs`,
  direct prompt/tool policy in `agent`, exact capability and admission
  enforcement in `tools`/`agent`, direct terminal outcomes in
  `session_service.rs`, and explicit API behavior selection in `nac-server`.
  The current slice adds schema-18 inbox persistence, atomic prompt/steer
  delivery, service promotion/restart wakeup, and REST CRUD. Direct-specific
  compaction policy text, retained-terminal transition/loss reporting, and UI
  controls remain in progress.

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
- Recorded pre-goal baseline: `make check` and elevated `make ci` passed on
  2026-08-24.

## Completed commits

- `09261af feat(core): introduce native tool kernel`.
- `3ae182a feat(core): persist session behavior`.
- `edb14e4 feat(core): add persistent direct primary`.

## Known problems and blockers

- None. The implementation surface is broad; milestones intentionally remain
  narrow and reviewable.

## Exact next action

Finish broad verification and checkpoint the durable direct-session inbox,
then complete direct-specific compaction and retained-terminal lifecycle
contracts before closing the persistent-direct milestone.
