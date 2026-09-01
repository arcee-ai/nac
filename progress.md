# ALL-12 implementation handoff

## Goal

Implement noninteractive Managed NAC ArceeAuth bootstrap with durable refresh
rotation and receipt semantics while preserving legacy and interactive auth.

## Current state

- The finite implementation goal is registered and active.
- Linear ALL-12 and its empty comment thread were re-read on 2026-09-01.
- Root and relevant nested `AGENTS.md` guides were re-read.
- `demo_decisions.md` was requested but is not present in this worktree.
- This file was not present and has been created as the operational handoff.
- `make setup` completed successfully. The first sandboxed invocation stalled in
  the Playwright Chromium install and was interrupted; the permitted network
  rerun completed the full target.
- The starting revision is `1a63d1d2360ddb5a0350d46323cbc8d9abc5d09f`
  on a detached HEAD. The worktree was clean before implementation.
- Core auth/bootstrap is committed as
  `8a70815752fbe7cb6049ee4706928b4915f8fe43` (`feat(core): import managed
  Arcee credentials durably`).

## Settled implementation choices

- `managed_host_id` and `bootstrap_id` are distinct UUIDs.
- Managed imports store client identity `managed-nac`; legacy records default to
  `nac-cli`, and refresh uses the stored identity.
- Bootstrap input is the strict v1 regular file
  `/run/secrets/nac/bootstrap.json`; the importer retains no dependency on it
  after startup.
- The importer uses the existing Arcee credential lock and atomic/no-follow
  credential-store primitives. It never replaces any pre-existing canonical
  credential file, including corrupt or foreign content.
- A separate nonsecret durable receipt tombstones the consumed generation.
  Credential provenance repairs the receipt-only crash window without replaying
  or rewriting the credential.
- A consumed receipt blocks all automatic later imports on the same durable
  state. Interactive Arcee login remains the explicit repair path.
- No `host_incarnation_id` is added: this repository has no current incarnation
  identity to validate, and overloading the stable logical host identity is
  forbidden.

## Work in progress

1. Add provider-neutral managed credential-source configuration and server
   composition/readiness/catalog behavior.
2. Update managed image contract, docs/ADR, and production-equivalent smoke
   coverage.
3. Commit the green integration slice, run broad verification, and request one bounded final
   independent review of the exact candidate.

## Verification ledger

- `make setup` — PASS (2026-09-01)
- `cargo test --locked -p nac-core model::arcee` — PASS (43 tests; includes
  bootstrap and refresh concurrency owner coverage).
- `make crate-check CRATE=nac-core` — PASS.
- `make crate-test CRATE=nac-core` — PASS (1174 passed, 9 expected ignored;
  doc tests pass).
- `make crate-check CRATE=nac-managed` — PASS.
- `make crate-test CRATE=nac-managed` — PASS (20 passed; doc tests pass).
- `make crate-check CRATE=nac-server` — PASS.
- `make crate-test CRATE=nac-server` — PASS (154 library + 23 binary tests;
  doc tests pass).
- `make test-managed-image-contract` — PASS.
- `make test-source-size` — PASS (833 tracked human-source files).

## Known coverage gaps

- Live `make test-managed-image` is unavailable on this host. Docker is
  installed but its daemon is not running; Podman is installed but its
  configured machine refuses the connection. Static production image contract
  coverage passes, including shell syntax and the import/reconcile/no-mount
  smoke assertions.
