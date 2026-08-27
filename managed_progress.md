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
  helper paths. A single immutable spawn-environment value must be resolved at
  run construction and threaded into every agent command path without changing
  unmanaged environments or readiness/model subprocesses.
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
3. **Command environment and generic secrets — pending.**
4. **GitHub authorization and repository onboarding — pending.**
5. **Native Exa web tools — pending.**
6. **Managed UI, readiness, image, and delivery — pending.**
7. **Integrated exact-candidate acceptance — pending.**
8. **Single final detached review — pending and unspent.**

## Coherent commits and verification

The first foundation slice includes `demo_ext_managed.md`, optional managed
configuration, durable credential/secret primitives, environment-before-store
named credential resolution, CLI/manager plumbing, and this handoff. Focused
verification before commit:

- `cargo test --locked -p nac-core managed::tests` — 7 passed.
- `cargo test --locked -p nac-core named_integration_credentials_prefer_nonblank_environment_then_storage` — 1 passed.
- `cargo test --locked -p nac-server --bin nac-web managed_configuration_is_explicit_and_ordinary_server_cli_remains_unmanaged` — 1 passed.
- `cargo check --locked -p nac-core -p nac-server` — passed.

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

Commit the audited foundation with exact-path staging, then implement the shared
immutable command-environment snapshot and write-only host-secret REST surface,
including all direct/child/worker/launched-orchestrator inheritance and canary
redaction tests without changing unmanaged spawn behavior.
