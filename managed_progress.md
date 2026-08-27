# Managed NAC v0 and native web retrieval progress

Status: active implementation handoff
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
   Project-last creation. Existing matching checkouts are identified without
   accepting credential-bearing remotes; mismatches and collisions are
   preserved and rejected.
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
6. **Managed UI, readiness, image, and delivery — pending.**
7. **Integrated exact-candidate acceptance — pending.**
8. **Single final detached review — pending and unspent.**

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

## External coverage gaps versus product blockers

The external platform inputs enumerated by `demo_ext_managed.md` (ECR/OIDC,
controller/CR, PVC mounts and UID ownership, gateway/SSO, gVisor/egress,
host-scoped model credential, and real organization GitHub/SAML behavior) may
prevent a real staging journey. They are coverage gaps, not permission to omit
local NAC contracts or credential-independent doubles. Docker/Podman live-image
coverage will be reported as unexecuted if unavailable and will not be called a
pass.

No product blocker has been found.

## Exact next action

Commit the audited native-web slice with exact-path staging, including its
canonical `tooling.md` input, then implement the managed UI, health/readiness
contract, nonroot development image, production-asset publication, and
credential-independent browser/image acceptance journey.
