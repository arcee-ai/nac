# Managed NAC v0 and native web retrieval progress

Status: five invariant repairs complete; exact-candidate gates and closure review pending
Branch: `allison-demo`
Integration owner: this primary Codex goal session only

## Finite objective

Implement the settled Managed NAC v0 contract in `demo_ext_managed.md` and the
settled native `web_search`/`web_fetch` contract in `tooling.md`, preserving all
existing NAC behavior when managed configuration and a nonblank
`EXA_API_KEY` are absent. Complete credential-independent tests, committed
production assets, image/delivery integration, the required exact-candidate
gates, and one bounded detached read-only review.

## Non-goals

- The unfinished normal-agent tool inventory or UX findings from Allison's
  still-pending manual review.
- Missing-Exa-key UI, arbitrary direct target fetching, or a general network
  proxy.
- Web tools for orchestrator primaries/workers or traditional child agents.
- Runtime behavior switching, automatic worktrees, repository deletion,
  backups, multiplayer hosts, Project-scoped secrets, or external secret
  brokers.
- Platform provisioning, Kubernetes/controller, gateway/SSO, or infrastructure
  lifecycle owned by Gerred/platform.
- A Managed-NAC-specific SQLite migration unless implementation evidence proves
  the file-backed settled contract impossible; that boundary requires human
  direction.

## Protected initial dirty state

Captured before this goal made any edit at `HEAD`
`da8cbbe10f86dbf8916a4b86f994032ca0574134`:

```text
## allison-demo...origin/allison-demo [ahead 70]
 M .gitignore
 M progress.md
?? .agents/skills/goal-prompt/
?? AGENTS.md
?? demo_ext_managed.md
?? demo_review.md
?? manual_todo.md
?? tooling.md
```

Protected and never to be staged, normalized, overwritten, or committed by
this goal: `.gitignore`, `progress.md`, `.agents/skills/goal-prompt/`,
`AGENTS.md`, `demo_review.md`, `manual_todo.md`, and ignored
`demo_decisions.md`. The canonical inputs `demo_ext_managed.md` and
`tooling.md` may be committed only with their first relevant implemented
vertical slices. Exact-path staging is mandatory; `git add -A` and
`git add .` are forbidden.

The published-main NAC MCP server on port 3210 and its custom store are outside
this goal and must not be stopped, reconfigured, or opened with this branch's
binary. Any branch server must use a different explicit port and store path.

## Settled invariants

- Managed configuration and onboarding are optional and additive. Ordinary
  local/SSH Projects and default orchestrator behavior remain unchanged.
- Managed Projects are ordinary persistent Projects/checkouts using the local
  backend; onboarding publishes the checkout atomically and creates the
  Project last.
- GitHub App user tokens and generic host secrets use versioned owner-only,
  symlink-rejecting, atomically replaced files under `NAC_HOME`, not a new
  SQLite schema.
- Credentials never enter transcripts, remote URLs, command arguments,
  provider/model messages, structured events, or ordinary logs.
- Every newly spawned agent command across direct, child, worker, and launched
  orchestrator topologies receives one immutable host-secret snapshot. Existing
  processes retain their original snapshot.
- `web_search` and `web_fetch` appear only in top-level `direct` and
  `direct-with-orchestrator` request snapshots when a nonblank Exa credential
  resolves; environment wins over managed storage. Existing workers and
  traditional children retain their exact topology.
- Web retrieval uses only Exa Search/Contents. NAC never directly connects to a
  model-supplied target URL in v0. Hard URL/provider validation, cancellation,
  bounds, capability admission, and redaction remain non-bypassable.
- Existing permission approval never changes the selected execution backend or
  overrides hard safety rules.
- Production frontend assets remain committed and current.

## Current implementation seams

- `nac-core::tools::kernel` already separates typed native tools, prepared
  invocation, canonical permission resources, authorization, immutable
  capability snapshots, rich results, cancellation, and parallel/exclusive
  admission.
- `crates/nac-core/src/tools/mod.rs` currently composes exact fixed capability
  arrays for workers, direct primaries, direct-with-orchestrator primaries, and
  traditional children. Web visibility must become a request-consistent
  conditional direct snapshot without widening the other arrays or admitting
  invocation through an older/different snapshot.
- `nac-core::model::auth_store` already provides owner-only, symlink-rejecting,
  fsynced atomic credential replacement and cross-process locks. The managed
  credential/secret foundation should reuse that native behavior rather than
  create a parallel weaker store.
- Command construction is distributed across Local, SSH, Podman, terminal, and
  helper paths. Managed local commands now snapshot the owner-only store at
  each spawn; worker dispatch transports only the nonsecret store root so the
  child worker applies the same late snapshot and controlled-output redaction.
  Unmanaged environments and readiness/model subprocesses remain unchanged.
- `nac-server` already owns managed provider device-login coordination, the
  Project REST surface, settings modals, embedded static assets, and a
  credential-free production Playwright harness with isolated HOME/NAC_HOME,
  store, workspace, provider, and process cleanup.
- Existing `Makefile` gates are `make ci`, `make test-durability`,
  `make test-assets`, and `make test-e2e`. New focused managed-image,
  GitHub-double, secret-redaction, and Exa-double gates must join the final
  exact-candidate evidence.

## Milestones

1. **Baseline and contract map — complete.** Contracts and manual exclusions
   read in full; exact dirty state, current history, Makefile, native kernel,
   runtime/session seams, credential primitives, Projects/API/UI, production
   assets, durability tests, and Playwright harness inspected. Focused tests
   prove the managed configuration remains absent unless explicitly selected
   and a nonblank named integration credential resolves environment before
   storage while treating no usable credential as absent.
2. **Managed configuration and credential foundation — complete.** Strict
   version-1 managed host configuration is explicit through CLI or
   `NAC_MANAGED_CONFIG`; ordinary server CLI remains unmanaged. Structural
   validation covers absolute distinct roots, HTTPS model endpoint, hostname,
   client/host identity, and reserved model credential environment names.
   Host secrets use a versioned owner-only atomic file and cross-process lock,
   reject symlink targets, enforce reserved names and finite limits, survive
   reopen/rotation, serialize concurrent updates, expose summaries/snapshots
   without values, and provide exact-value redaction.
3. **Command environment and generic secrets — complete.** The managed-only
   REST surface creates/replaces/deletes values and lists metadata without
   values; unmanaged hosts fail closed. Reserved integration/runtime names and
   finite file limits are enforced. Direct commands snapshot values immediately
   before one-shot or PTY spawn, retained output keeps its spawn redactor across
   rotation, and later processes see replacement/deletion. Server-owned new,
   resumed, and attached runs all receive the store. Orchestrator worker
   dispatch passes only the nonsecret store root to the hidden worker CLI so
   worker command processes use the same late snapshot without adding secrets
   to worker argv or NAC's global environment.
4. **GitHub authorization and repository onboarding — complete.** GitHub App device flow, reload-safe
   polling/cancellation, owner-only token persistence, cross-process refresh
   serialization and atomic rotation, revocation cleanup, SAML/app-install
   classification, connection metadata, paginated repository/branch discovery,
   command-scoped refreshed `GH_TOKEN`, a GitHub-HTTPS-only credential helper,
   persistent editable Git identity, and nonsecret state-root/client/home
   transport to worker agents are implemented. Repository onboarding now uses
   provider-validated repository/branch selection, exact destination
   reservations, operation-owned staging, live progress/cancellation, safe
   restart reconciliation, branch-specific clone, atomic publication, and
   Project-last creation. Every pre-existing destination, including a matching
   Git checkout, is preserved and rejected with guidance to choose another
   destination or create an ordinary Project from the existing checkout.
5. **Native Exa web tools — complete.** Top-level direct and
   direct-with-orchestrator agents now resolve the Exa credential before each
   ordinary model request and expose one exact request/runtime snapshot that
   includes first-party `web_search` and `web_fetch` only while that credential
   is usable. Traditional children, orchestrator primaries/workers, and
   Exa-disabled direct agents retain their prior exact capability sets. The
   native tools call only fixed Exa Search/Contents endpoints, validate and
   bound inputs/provider output, propagate cancellation through requests,
   retries, decoding, and result construction, prevent credential replay on
   redirects, and redact credentials and URL queries from errors/results.
   Fetch never connects from NAC to the model-supplied target URL.
6. **Managed UI, readiness, image, and delivery — complete locally.** Managed mode
   now has credential-free `/healthz`, strict `/readyz`, owner-facing status,
   responsive Projects/Settings onboarding, GitHub device authorization,
   write-only Secrets, repository/branch selection, visible clone completion
   and cancellation, and Project-preserving removal copy. Production-embedded
   journeys cover desktop, exact 390×844 mobile, Exa absent/present request
   snapshots, and the managed first-run flow. The pinned non-root image,
   read-only-root smoke, configurable ECR/OIDC workflow, static contract gate,
   and operator documentation are implemented. Docker, Podman, and Buildah are
   absent on this host, so live image
   build/smoke remains an exact unexecuted local coverage gap; the GitHub
   workflow runs it without real provider credentials.
7. **Integrated exact-candidate acceptance — complete on candidate
   `42e2d9d6dcba04cabc23f5145f8d5354f554ad4a`.** All four broad gates and the
   new focused managed-image, GitHub, clone, secret-redaction, and Exa gates
   passed. Live image execution remains the explicitly unexecuted environment
   gap below.
8. **Original final detached review — consumed; qualified blockers found.** The
   only authorized review round inspected the exact candidate in a clean
   detached worktree across compatibility/topology, credentials/redaction,
   lifecycle/clone, and production product/assets. Compatibility/topology had
   no qualified blocker. The five concrete blockers recorded below require
   human adjudication. On 2026-08-27 Allison adjudicated all five as required
   repairs and authorized this bounded follow-up plus one fresh closure review
   limited to the repaired invariants and their immediately adjacent
   regressions.
9. **Bounded repair/closure follow-up — repairs complete; acceptance pending.**
   All five adjudicated invariants now have deterministic seam regressions and
   minimal repairs. Three coherent core/server commits are complete; the
   onboarding source, browser regressions, generated assets, and this ledger
   form the final implementation commit. The named broad and focused gates
   must now run once on that immutable candidate, followed by exactly one fresh
   detached closure review limited to these five repairs and immediately
   adjacent regressions.

## Coherent commits and verification

Commit `8584de2` is the first foundation slice and includes
`demo_ext_managed.md`, optional managed
configuration, durable credential/secret primitives, environment-before-store
named credential resolution, CLI/manager plumbing, and this handoff. Focused
verification before commit:

- `cargo test --locked -p nac-core managed::tests` — 7 passed.
- `cargo test --locked -p nac-core named_integration_credentials_prefer_nonblank_environment_then_storage` — 1 passed.
- `cargo test --locked -p nac-server --bin nac-web managed_configuration_is_explicit_and_ordinary_server_cli_remains_unmanaged` — 1 passed.
- `cargo check --locked -p nac-core -p nac-server` — passed.

The command-environment slice adds write-only managed-secret HTTP operations,
spawn-time injection through the existing one-shot/PTY machinery, retained
output redaction bound to output identity, managed run attachment at every
server construction/resume seam, and nonsecret worker-store transport. Focused
verification before commit:

- `cargo test --locked -p nac-core tools::exec_command::tests::managed_secrets_are_snapshotted_per_spawn_and_redacted_from_all_output_views -- --exact` — 1 passed.
- `cargo test --locked -p nac-core managed_worker_receives_only_the_nonsecret_store_root -- --nocapture` — 1 passed.
- `cargo test --locked -p nac-server managed_host_secret_api_is_write_only_and_unmanaged_hosts_fail_closed -- --nocapture` — 1 passed.
- `cargo test --locked -p nac-server openapi_special_wire_schemas_and_docs_are_live -- --nocapture` — 1 passed outside the workspace sandbox because the existing fixture reads user-level NAC configuration.
- `cargo check --locked -p nac-core -p nac-server` — passed.

Commit `df439b5` contains that command-environment slice. Commit `a61a06e`
contains the GitHub managed-auth slice: its durable credential lifecycle, HTTP
surface, repository and branch discovery, command/Git credential delivery, and
Git identity. Focused verification before its commit:

- `cargo test --locked -p nac-core managed_github::tests -- --nocapture` — 3 passed against a loopback fake (device polling, pagination/branches, serialized refresh rotation, revocation, and SAML); local networking required running this fixture outside the workspace sandbox.
- `cargo test --locked -p nac-core managed_github_token_and_home_are_command_scoped_and_only_the_token_is_redacted -- --nocapture` — 1 passed.
- `cargo test --locked -p nac-core managed_worker_receives_only_the_nonsecret_store_root -- --nocapture` — 1 passed.
- `cargo test --locked -p nac-server managed_github -- --nocapture` — 2 passed.
- `cargo test --locked -p nac-server --bin nac-web` — 23 passed, including the HTTPS/GitHub-only credential helper contract.
- Both nac-server OpenAPI route/schema contract tests passed outside the workspace sandbox because their existing fixtures read user-level NAC configuration.
- `cargo check --locked -p nac-core -p nac-server` — passed.

The repository-onboarding slice adds durable filesystem operation records,
cross-process destination locks, ownership-proven staging cleanup, cancellation
through NAC's process-tree guard, bounded/redacted progress and errors, atomic
checkout publication, Project-last creation, and REST/OpenAPI polling and
cancellation. Focused verification before its commit:

- `cargo test --locked -p nac-core managed_clone::tests -- --nocapture` — 6 passed using local bare repositories and a deterministic fake Git process, covering non-default branches, cancellation, destination races, matching/mismatched existing remotes, traversal/symlinks/collisions, interrupted restart cleanup, and recovery after the Project-last commit boundary.
- `cargo test --locked -p nac-core store::projects::tests -- --nocapture` — 3 passed, preserving ordinary Project behavior.
- `cargo test --locked -p nac-server --lib managed_github -- --nocapture` — 2 passed.
- `cargo test --locked -p nac-server --bin nac-web` — 23 passed.
- `cargo test --locked -p nac-server openapi_document_matches_the_running_api_router -- --nocapture` — passed outside the workspace sandbox because its existing fixture reads user-level NAC configuration.
- `cargo clippy --locked -p nac-core -p nac-server --lib -- -D warnings` — passed.
- `cargo check --locked -p nac-core -p nac-server --all-features` — passed.

The native-web slice adds request-consistent conditional capability snapshots
and fixed-provider Exa Search/Contents operations with hard validation,
query-safe permission resources, bounded retries/output, cancellation, and
redaction. Focused and broad verification before its commit:

- `cargo test --locked -p nac-core tools::web::tests -- --nocapture` — 7 passed against loopback provider doubles, covering request/result shapes, default/ask/deny permission behavior, cancellation during retry, cross-origin redirect credential isolation, provider-error redaction, and oversized bodies.
- `cargo test --locked -p nac-core direct_topologies_expose_exact_capability_boundaries` — 1 passed.
- `cargo test --locked -p nac-core direct_registries_preserve_exact_topology_capabilities` — 1 passed.
- `cargo test --locked -p nac-core model_execution_cannot_invoke_a_tool_outside_its_capability_snapshot` — 1 passed.
- `cargo test --locked -p nac-core agent::compaction_integration_tests::projection_durability::valid_checkpoint_projects_after_restore_when_generation_is_disabled -- --exact` — 1 passed.
- `cargo test --locked -p nac-core -q` — 1,177 passed, 9 ignored; loopback fixtures required running outside the workspace sandbox.
- `cargo fmt --all -- --check` — passed.
- `cargo clippy --locked -p nac-core -p nac-server --lib -- -D warnings` — passed.
- `cargo check --locked -p nac-core -p nac-server --all-features` — passed.

Historical `progress.md` and `demo_review.md` remain evidence only and are not
acceptance authority for these new contracts.

The managed UI/readiness candidate passed:

- `cargo test --locked -p nac-server` — 148 library and 23 binary tests passed.
- `cargo clippy --locked -p nac-server --lib --bin nac-web -- -D warnings` — passed.
- `npm --prefix crates/nac-server/web test` — 175 tests passed.
- Frontend typecheck and lint — passed.
- Production-embedded `embedded.e2e.ts` plus `managed.e2e.ts` — 14 journeys
  passed after correcting one test-only root-route assertion. Coverage includes
  managed desktop/mobile onboarding, clone cancellation, and Exa absent/present
  capability requests with the canary absent from the provider payload.
- Production assets were rebuilt from the final UI sources.
- `sh scripts/test-managed-image-contract.sh` — passed.

Commit `dce5f65` contains the managed UI, readiness, graceful shutdown,
production-browser coverage, and generated assets. The image/delivery slice
also passed POSIX and Dash syntax checks, static workflow/image assertions,
Ruby YAML parsing, and `make -n managed-image`. The live image build and smoke
were not executed because no supported container runtime is installed.

Commit `42e2d9d` contains the managed developer image and delivery slice. The
immutable final candidate `42e2d9d6dcba04cabc23f5145f8d5354f554ad4a`
then received the complete acceptance run:

- `make ci` — passed on a clean rerun: formatting, linting, Clippy, all
  workspace suites (including 1,177 nac-core tests with 9 ignored, 148
  nac-server library tests, 23 server-binary tests, and 175 frontend tests),
  committed assets, and the managed-image static contract. An earlier run hit
  one transient pre-existing parallel-test `sleep` spawn `NotFound`; its exact
  isolated rerun and the unchanged candidate's full rerun both passed.
- `make test-durability` — all 10 focused lifecycle/crash regressions passed.
- `make test-assets` — lint, typecheck, and production asset rebuild/currentness
  passed.
- `make test-e2e` — all 14 production-embedded browser journeys passed.
- `make test-managed-image-contract` — POSIX/static image and workflow contract
  passed.
- `cargo test --locked -p nac-core managed_github::tests -- --nocapture` — 3
  passed with local-loopback permission.
- `cargo test --locked -p nac-core managed_clone::tests -- --nocapture` — 6
  passed.
- `cargo test --locked -p nac-core tools::web::tests -- --nocapture` — 7 passed
  with local-loopback permission.
- The exact managed command-secret redaction test — 1 passed; the server
  managed-GitHub tests — 2 passed; and the write-only managed-secret API test —
  1 passed.

The single final read-only review found these supported-path contract blockers:

1. Environment-sourced `EXA_API_KEY` remains inherited by local agent commands,
   while command output redaction snapshots include host secrets and
   `GH_TOKEN`, not this dedicated key. A direct agent can print the key into a
   tool result/model transcript; worker subprocesses inherit the server
   environment too. Evidence: `crates/nac-core/src/model/mod.rs:84`,
   `crates/nac-core/src/sandbox/backend.rs:226`, and
   `crates/nac-core/src/tools/mod.rs:510`. Missing invariant: remove the
   dedicated Exa credential from every agent/worker command environment while
   preserving it only in admitted native web-tool snapshots.
2. Web result/error masking delegates to the generic credential redactor,
   which replaces secrets shorter than four bytes only in credential-shaped
   contexts, although stored Exa credentials accept every nonblank value. A
   provider-controlled result containing a valid short key such as `abc` can be
   persisted unchanged. Evidence: `crates/nac-core/src/tools/web.rs:601`,
   `crates/nac-core/src/model/redact.rs:82`, and
   `crates/nac-core/src/model/api_key_store.rs:83`. Missing invariant:
   web-specific output/error masking must replace the exact admitted Exa key
   regardless of length (or the settled credential contract must change).
3. Reusing an existing matching checkout validates only remote identity, then
   creates the Project and reports completion without verifying or selecting
   the requested branch. A request for `feature` can therefore complete on
   `main`. Evidence: `crates/nac-core/src/managed_clone.rs:245`; the existing
   reuse test at line 1133 requests `main` from a `main` checkout. Missing
   invariant: the accepted checkout must observably be on the selected branch
   before Project creation.
4. SIGTERM bounds active-run cancellation to 20 seconds but places no deadline
   around Axum's subsequent graceful connection drain. A permanent SSE session
   stream can keep shutdown waiting past the controller grace period, and the
   image smoke sends SIGTERM without an open SSE client. Evidence:
   `crates/nac-server/src/lib.rs:5102`, `:7299`, and `:7741`. Missing invariant:
   bounded shutdown/force-close behavior proven with a live session event
   stream.
5. **Add repository** while disconnected closes repository onboarding and opens
   generic Managed Settings on its default Status tab. Successful GitHub
   authorization only refreshes data/toasts; it does not resume onboarding.
   The E2E manually clicks the GitHub tab, closes Settings, and clicks **Add
   repository** again. Evidence:
   `crates/nac-server/web/src/app/providers/ManagedHostProvider.tsx:35`,
   `crates/nac-server/web/src/app/components/modals/ManagedHostModal.tsx:62` and
   `:173`, and `crates/nac-server/web/e2e/managed.e2e.ts:201`. Missing invariant:
   direct connection entry and automatic onboarding resume.

### Adjudicated repair outcomes and focused evidence

All five findings above were adjudicated as required repairs on 2026-08-27 and
are now resolved in the implementation candidate:

1. Commit `dce9280` makes `EXA_API_KEY` a NAC-only native-integration
   credential. The central local one-shot and PTY command builders, Podman and
   SSH command builders, and managed worker process spawn remove it from every
   model-controlled process environment. Native request snapshots still use
   environment-before-store resolution.
2. The same commit exact-replaces the admitted Exa credential in every web
   result/error before applying generic redaction, including credentials
   shorter than four bytes, without weakening the nonblank credential
   contract.
3. Commit `2f7dc26` removes matching-checkout reuse. Managed onboarding rejects
   every existing destination before inspecting or changing the checkout,
   preserves local files and existing Projects, and gives the settled
   different-destination/ordinary-Project guidance.
4. Commit `ade9079` separates shutdown signaling from Axum drain and installs a
   20-second OS watchdog after SIGTERM/Ctrl-C stops new acceptance. Active-run
   cancellation and graceful HTTP/SSE drain may finish normally; if either is
   stuck, process exit no longer depends on Tokio scheduler progress.
5. The final onboarding implementation commit makes the Managed Host tab
   provider-controlled. Disconnected **Add repository** opens GitHub
   authorization directly, and successful connection automatically closes
   settings and restores repository onboarding on desktop and mobile. The same
   commit includes the rebuilt production assets and this ledger.

Focused repair verification completed before the final implementation commit:

- The new real-command and real-PTY Exa environment regression passed, as did
  the real managed-worker process regression and the short-key result/error
  masking regression. The complete native web test module passed 8 tests; the
  environment-before-store credential test, direct topology boundary test,
  command-secret redaction test, and nonsecret worker transport test also
  passed.
- `cargo test --locked -p nac-core managed_clone::tests -- --nocapture` passed
  all 6 tests, including matching/mismatched Git checkouts and non-Git
  collisions preserved and rejected with no Project creation.
- The live `/sessions/{id}/events/stream` shutdown regression first reproduced
  the unbounded drain, then passed three consecutive runs with a 100 ms test
  watchdog and an open SSE client. The adjacent bind test and the required
  nac-server library Clippy target passed.
- Frontend typecheck, lint, and formatting passed. The rebuilt embedded binary
  passed all 3 `managed.e2e.ts` journeys: direct disconnected authorization and
  automatic onboarding resume, exact 390×844 mobile resume, clone completion,
  write-only secret handling, and clone cancellation without Project
  publication.

## External coverage gaps versus product blockers

The external platform inputs enumerated by `demo_ext_managed.md` (ECR/OIDC,
controller/CR, PVC mounts and UID ownership, gateway/SSO, gVisor/egress,
host-scoped model credential, and real organization GitHub/SAML behavior) may
prevent a real staging journey. They are coverage gaps, not permission to omit
local NAC contracts or credential-independent doubles. Docker/Podman live-image
coverage will be reported as unexecuted if unavailable and will not be called a
pass.

The five final-review findings above were product blockers under the goal's
stopping contract and are now repaired pending exact-candidate acceptance and
the bounded closure review. The unavailable local container runtime and the
external platform inputs remain coverage gaps rather than product blockers.

## Exact next action

Commit the final onboarding source, browser regressions, generated assets, and
this ledger as one coherent implementation slice. Then run the complete named
broad and focused gate set once on the immutable candidate and authorize
exactly one fresh detached read-only closure review limited to the five
repaired invariants and immediately adjacent regressions.

After repair or waiver, Allison can reproduce the credential-independent local
acceptance with:

```sh
make ci
make test-durability
make test-assets
make test-e2e
make test-managed-image-contract
```

When Docker or Podman is available, build and exercise the exact non-root,
read-only-root, restart, and SIGTERM contract with:

```sh
make test-managed-image MANAGED_IMAGE=nac-managed:local
```

For an interactive managed launch or external staging test, follow
`docs/managed/README.md`: use the committed image, mount the three durable
paths as `10001:10001`, provide strict managed TOML and an owner-only model
credential, publish on a non-3210 host port during local testing, and validate
device authorization, repository/branch onboarding, Git/`gh`, secrets,
restart/rescheduling, `/healthz`, `/readyz`, and `/managed/status`. Never point
this branch binary at the published-main store or its port 3210 process.

## Refactored integration of managed host model bootstrap (2026-08-27)

Commit `67c5655` landed on the original `90dd3c9` architecture after this
worktree had already extracted the managed bounded context and decomposed the
server/runtime/frontend owners. Its behavior was therefore ported semantically
rather than cherry-picked back across superseded files:

- `nac-managed` owns the strict, provider-neutral host profile and hardened
  mounted-credential/readiness facts; server composition validates the backend
  against the harness model taxonomy through a narrow profile;
- core model/runtime/session construction accepts a provider-neutral trusted
  credential path. Only that path crosses hidden worker argv; the credential
  value never enters argv, the environment, SQLite, or command snapshots;
- managed session creation supplies the host model only when callers omit the
  entire identity, while explicit settings remain authoritative. Resume
  reconstructs the ephemeral source only for a matching persisted profile;
- the focused model-catalog application and managed status projection report
  safe readiness/profile metadata without exposing credential bytes;
- generated OpenAPI/TypeScript contracts and the managed frontend feature now
  derive the host default, exact profile matching, and credential presentation
  from that response; and
- the managed image smoke uses a separate read-only credential volume and
  proves consumption plus failed overwrite.

The inward credential slice is commit `52ea611`. Focused validation for the
application/UI/image slice is green: 19 `nac-managed` tests, the managed
create/persist/resume/catalog/status server regression, frontend profile-model
tests, all 178 frontend tests, workspace check, format/lint, generated-contract
drift, source-size enforcement, the static image contract, and all 14
production-embedded Playwright journeys. The generated production bundle is
current. Full immutable-candidate acceptance and the live managed-image smoke
follow the integration commit.

### Interactive smoke repair

The bounded in-app browser smoke found one direct integration regression after
`7492aa4`: the empty managed-host **Create Project** modal can render outside
the modal-owning `ManagedHostProvider`, while the new model-profile hook had
required that provider. Opening the form therefore blanked the page. The hook
now depends directly on the managed-status query it reads, so it remains
feature-owned without depending on modal context. The managed Playwright
journey now opens the Project form and asserts the managed Trinity model and
host-supplied credential state. The focused three managed journeys, all 179
frontend tests, typecheck, lint, and a fresh interactive tab pass with zero
console errors.

### Managed-model integration closure

Commits `52ea611`, `7492aa4`, and `7d4e8a1` complete the semantic port of
`67c5655` through the refactored ownership boundaries. The final candidate
passes `make ci`, `make test-durability`, `make test-assets`, all 14
production-embedded Playwright journeys, the static image contract, and the
live managed Docker image smoke. The live image consumed the separate mounted
model credential and rejected an overwrite through its read-only volume.

The remaining external exercise is optional human validation with real
provider and organization GitHub/SAML credentials. It is a coverage gap, not a
local product blocker; no implementation or local acceptance work remains.

## Mainline fork/cancellation convergence (2026-08-28)

The refactor branch now merges `allison-demo` through `fbbc09d`. Mainline
conversation forks, durable stopping semantics, and descendant cleanup were
preserved while remaining inside the refactored store, application, process,
delivery, and frontend feature boundaries. The generated API contract and
embedded production bundle include the fork surface; managed-host model and
credential behavior remains unchanged. Pre-commit workspace check, Clippy,
focused process/fork tests, all 179 frontend tests, frontend static checks, and
the 2,000-line source guard pass. The complete clean-commit acceptance gates
follow the merge commit.
