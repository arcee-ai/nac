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
- Managed composition, image contract, smoke coverage, and documentation are
  committed as `e5c830c7857d3bcb20458c624b4e431429e18d19`
  (`feat(managed): compose durable Arcee bootstrap`).
- The first bounded-review safety slice is committed as
  `878867926a9cb3a253b695dda3dd1a0fbd3a1f53` (`fix(managed): fail closed on
  durable auth corruption`).

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

## Final review disposition

One bounded independent review inspected the exact two-commit candidate ending
at `e5c830c7857d3bcb20458c624b4e431429e18d19`. It found three issues, all now
resolved with owner-level regression coverage:

1. Stored-auth schema and base-URL diagnostics no longer include parser details
   that can echo attacker-controlled secret-bearing values.
2. Managed-profile creation and resume fail closed when the durable receipt or
   credential is invalid. Credential matching is backend/endpoint based, so a
   valid managed authorization remains independent from the configured default
   model.
3. Receipt crash recovery consults the durable credential provenance before the
   current bootstrap mount. If generation A was stored before a crash and the
   mount reconciles to generation B, NAC records A's receipt without rewriting
   the credential or falsely consuming B.

No further review loop was started, per the bounded-review requirement.

## Provenance-binding follow-up

Parent review found that independently validating a receipt and a parseable
credential allowed a `preserved_existing` receipt to coexist with a legacy
`nac-cli` credential and satisfy managed admission. The follow-up fix validates
both durable records under the shared Arcee lock and requires an `imported` v1
`managed-nac` receipt bound to a `managed-nac` credential whose retained host
and bootstrap provenance matches exactly. Preserved, legacy, missing, corrupt,
revoked, and mismatched states now fail closed for managed readiness, catalog,
create, and resume without changing the stored credential.

Strict bootstrap v1 still rejects unknown keys, including
`host_incarnation_id`; that field is not part of NAC's settled v1 contract.

## Completion state

- Core import, refresh rotation, restart/reconciliation behavior, provider-
  neutral configuration, managed startup/catalog/readiness/session admission,
  image contract, smoke assertions, and documentation are implemented.
- Legacy stored auth and interactive `arcee-auth` remain compatible.
- No API/OpenAPI shape or web source changed; contract and committed asset drift
  checks are green.
- The final reviewed safety slice is included in the implementation history;
  no unrelated/local-only state was encountered.

## Verification ledger

- `make setup` — PASS (2026-09-01)
- `cargo test --locked -p nac-core model::arcee` — PASS (44 tests; includes
  bootstrap and refresh concurrency owner coverage).
- `make crate-check CRATE=nac-core` — PASS.
- `make crate-test CRATE=nac-core` — PASS (1176 passed, 9 expected ignored;
  doc tests pass).
- `make crate-check CRATE=nac-managed` — PASS.
- `make crate-test CRATE=nac-managed` — PASS (20 passed; doc tests pass).
- `make crate-check CRATE=nac-server` — PASS.
- `make crate-test CRATE=nac-server` — PASS (156 library + 23 binary tests;
  doc tests pass).
- `cargo test --locked -p nac-server
  managed_bootstrap_corruption_blocks_create_and_resume_without_secret_echo`
  — PASS.
- `cargo test --locked -p nac-core model::arcee_bootstrap -- --nocapture` —
  PASS (10 tests; includes bound receipt/provenance mismatch coverage and
  redacted rejection of an unknown `host_incarnation_id`).
- `cargo test --locked -p nac-server
  managed_preserved_legacy_auth_is_tombstoned_but_never_authorized
  -- --nocapture` — PASS.
- `make test-durability` — PASS.
- `make test-managed-image-contract` — PASS.
- `make test-source-size` — PASS (836 tracked human-source files).
- `make test-e2e` — PASS (18 production-embedded Playwright tests).
- `make ci` — PASS after the final review fixes. This includes repository
  formatting, workspace clippy, workspace Rust tests, 245 web tests, generated
  OpenAPI/type drift checks, web lint/typecheck/build, committed asset drift,
  source size, and the managed image contract.

## Known coverage gaps

- Live `make test-managed-image` is unavailable on this host. Docker is
  installed but its daemon is not running; Podman is installed but its
  configured machine refuses the connection. Static production image contract
  coverage passes, including shell syntax and the import/reconcile/no-mount
  smoke assertions.
