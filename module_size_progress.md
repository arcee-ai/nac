# Module-size refactor handoff

## Objective

Keep every tracked, human-authored source file at or below 2,000 physical lines
so agents can load the relevant owner without exhausting context on unrelated
responsibilities. A file may approach 3,000 lines only when it is a genuinely
cohesive exceptional owner, its nearest `AGENTS.md` explains why splitting would
hide an invariant, and the automated guard names the exception. The current
candidate has no justified human-source exception above 2,000 lines, so this
refactor aims to remove the entire backlog.

The line limit is an ownership constraint, not a fragmentation target. Extract
complete concepts, adapters, state-machine phases, or test families with useful
module names and narrow visibility. Do not create numbered fragments, empty
wrappers, include-only shards, or one-call indirection merely to satisfy the
counter. Preserve public API, persistence, safety, lifecycle, generated output,
and test behavior.

## Baseline and protected state

- Starting revision: `3ae15aa11faef9613e48c3f01529f0b2eff825bf`
  (detached HEAD), after the focused Clippy-policy goal.
- The complete acceptance suite passed at that revision, including `make ci`,
  durability, production-embedded E2E, and the managed Docker image smoke.
- Preserve the pre-existing modified `.gitignore` and `progress.md`, plus the
  untracked `.agents/skills/goal-prompt/`, `demo_review.md`, and
  `manual_todo.md`. Stage exact task-owned paths only.
- The tracked repository contains 266,707 physical lines. This includes
  generated contracts, lockfiles, fixtures, binary assets, and historical
  documentation; the enforcement target is human-maintained source and guide
  text, not machine-owned artifacts.

## Policy boundary

The automated guard will inspect tracked human-maintained files with source,
configuration, script, stylesheet, and Markdown extensions. It will exclude
only explicit machine writers and data artifacts, including:

- Cargo/npm lockfiles;
- OpenAPI and generated TypeScript contracts;
- generated frontend manifests and production bundles;
- generated model catalogs and catalog-generator fixtures;
- binary media and fonts.

Generated files remain protected by their existing deterministic drift checks.
An allowlist entry for a human-authored file must carry a reason and a ceiling
no greater than 3,000 lines. The final candidate should require no such entry.

## Exact oversized human-source inventory

| File | Baseline lines | Ownership diagnosis | Intended seam |
| --- | ---: | --- | --- |
| `crates/nac-server/src/lib_tests.rs` | 9,263 | server-wide test bag | contract/security, launch/configuration, lifecycle/topology, and shared harness modules |
| `crates/nac-core/src/session_service_tests.rs` | 5,386 | lifecycle characterization bag | projection, direct interaction, recovery/settlement, and shared fixtures |
| `crates/nac-core/src/sandbox/podman.rs` | 3,035 | 1,432 production lines plus inline tests | move behavior tests to a descriptive sibling without splitting safety authority |
| `crates/nac-core/src/runtime_tests.rs` | 2,765 | runtime-wide test bag | construction/configuration and resume/remote families over shared fixtures |
| `crates/nac-core/src/events.rs` | 2,638 | 1,444 production lines plus inline tests | move event-bus/sanitization tests to a sibling |
| `crates/nac-core/src/model/chatgpt_codex.rs` | 2,444 | 1,639 production lines plus inline tests | move provider/auth/stream tests to a sibling |
| `crates/nac-core/src/sessions/mod.rs` | 2,212 | 305 production lines plus inline tests | move durable snapshot/codec facade tests to a sibling |
| `crates/nac-core/src/agent/mod.rs` | 2,185 | cohesive turn loop with small prompt/failure helpers | extract prompt and failed-tool-round policy into named internal owners |
| `crates/nac-core/src/model/arcee.rs` | 2,028 | 1,072 production lines plus inline tests | move provider/auth tests to a sibling |

Large machine-maintained files currently outside the human-source policy are
`web/openapi.json` (13,885), `web/package-lock.json` (9,943), the catalog
generator fixture (4,962), `Cargo.lock` (3,983), and binary assets. Their
existing writers and drift checks remain authoritative.

## Dependency-ordered slices and verification

1. Extract the five inline Rust test modules. These are behavior-identical
   moves that expose the actual production owner sizes before changing logic.
   Run focused provider/session/event/Podman tests and `nac-core` Clippy/check.
2. Split the three dedicated test bags by behavioral owner. Keep only genuinely
   shared fixtures in each test composition root; child modules import ancestor
   helpers rather than duplicating setup. Verify test inventory/counts and run
   the owning crate suites plus durability where lifecycle tests move.
3. Reduce `agent/mod.rs` through substantive prompt and failed-tool-round
   internal modules. Preserve the model/tool state machine and its private API;
   run agent, direct/worker, and core suites.
4. Add a deterministic tracked-file size guard, wire it into the ordinary
   repository check/CI path, and document the placement rule in the root and
   relevant nested guides. Prove the guard with its own fixture/self-test if
   its policy parser is nontrivial.
5. Run formatting, lint, check, complete tests, durability, asset/contract,
   production E2E, and managed image-contract gates. Rerun the full managed
   image smoke when Docker remains available. Record before/after counts,
   commits, compatibility, residual risks, and protected state here.

## Milestone status

- Inventory and policy: in progress.
- Inline-test extraction: complete, pending commit.
- Dedicated-suite decomposition: complete.
- Agent production extraction: pending.
- Automated enforcement and navigation: pending.
- Full acceptance: pending.

## Decisions and next action

- Physical lines are used because the requested limit is simple, transparent,
  and reviewable with standard tools. Formatting remains the single writer of
  layout, making the count deterministic.
- Tests are subject to the same ceiling: large test bags consume agent context
  and obscure which invariant owns a regression.
- Generated files are not manually split. Their source-of-truth and drift
  checks are the maintainability boundary.

Next: inspect the exact inline-test module boundaries, move each suite to a
descriptive sibling file without changing test bodies, and verify test
inventory plus focused behavior before the first commit.

## Slice evidence

### Inline test ownership

The five tail-position inline suites now remain under their original private
`tests` module names but live in descriptive siblings. No test body or
production behavior changed:

| Production owner | Before | After | Sibling suite |
| --- | ---: | ---: | ---: |
| `sandbox/podman.rs` | 3,035 | 1,434 | `podman_tests.rs` (1,597) |
| `events.rs` | 2,638 | 1,446 | `events_tests.rs` (1,173) |
| `model/chatgpt_codex.rs` | 2,444 | 1,641 | `chatgpt_codex_tests.rs` (798) |
| `sessions/mod.rs` | 2,212 | 307 | `sessions/facade_tests.rs` (1,896) |
| `model/arcee.rs` | 2,028 | 1,074 | `arcee_tests.rs` (954) |

Focused evidence: 34 event tests, 28 ChatGPT/Codex tests, 32 Arcee tests, 29
session-facade tests, and 34 Podman tests pass. Provider loopback and Podman
process-supervision cases required the already-known unsandboxed test context;
their serial rerun passed completely. Warning-denied `nac-core` Clippy passes.

Next: commit the inline-test ownership slice, then decompose the dedicated
runtime, session-service, and server test bags around shared fixture roots.

### Runtime behavior suites

The 2,765-line runtime test bag is now a 48-line shared fixture/composition root
with two named owners: `runtime_tests/construction.rs` (1,714 lines) covers
configuration, model/backend resolution, construction, persistence parity, and
sandbox option validation; `runtime_tests/remote.rs` (1,010 lines) covers local
resume normalization plus SSH construction and reattachment. The only fixture
found to cross the boundary, `complete_model_config`, moved to the shared root
instead of being duplicated or exposed outside the test module.

All 48 runtime tests pass serially with their loopback/process fixtures, and
warning-denied `nac-core` Clippy remains green.

Next: commit the runtime-suite boundary, then partition the session-service
suite by projection/direct-interaction and recovery/settlement ownership.

### Session lifecycle behavior suites

The 5,386-line session-service bag is now an 815-line fixture/foundational-test
root plus four invariant-focused siblings: projection (782), direct interaction
(1,339), settlement (1,025), and recovery/cancellation (1,438). Cross-family
fixtures remain private in the common ancestor; `assert_run_started_event` was
the only helper discovered after compilation to be shared by three families and
was moved rather than duplicated. The subprocess selector was updated to its
new recovery module path so the crash-window test still launches exactly the
intended helper.

All 63 session-service tests pass (62 runnable, one manual benchmark ignored),
warning-denied `nac-core` Clippy passes, and all ten durability selections pass,
including their server relationship/managed-binding consumers.

Next: commit the session lifecycle test boundary, then decompose the server test
bag without duplicating its expensive router/session fixtures.

### Server delivery and lifecycle suites

The 9,263-line server bag is now a 769-line shared harness plus ten focused
modules: contract/security (1,560), configuration (1,491), child/lease topology
(1,224), managed topology (961), lifecycle (772), catalog/launch (706), recovery
(602), presentation (583), managed delivery (380), and projects (244). The
existing compaction suite remains a 724-line independent owner.

Compilation exposed four truly shared test capabilities, which now live once in
the common root: the serialized model-environment lock, hanging-model fixture,
POST/PUT helpers, and the already-shared manager/session seed harness. The
project test module is named `project_routes` to avoid shadowing the imported
core project store. The embedded-asset assertion uses the correct path relative
to its new contract owner. Root-level subprocess helpers kept their exact test
paths.

All 148 server library tests pass serially, including loopback, lease,
descriptor-limit, shutdown, managed topology, and OpenAPI/asset behavior.
Warning-denied server/core Clippy passes.

Next: commit the server test ownership boundary, then reduce the sole remaining
oversized human source, `agent/mod.rs`, through a substantive internal seam.
