# Permission and execution-policy guide

This directory owns the model-visible authorization decision for prepared tool
operations. It evaluates ordered rules, classifies shell authority, projects
and binds resources, enforces hard denials, brokers interactive approval, and
scopes persisted grants. Runtime confinement and backend selection remain
separate owners.

## Invariants and dependencies

- Rule evaluation is ordered and deterministic. Hard policy cannot be
  overridden by approval or remembered grants.
- Canonical resource binding must match the operation that eventually executes;
  reject resources that cannot be independently projected or revalidated.
- Agent execution fails closed when approval is required without an approver.
  Authenticated human-initiated product operations never enter that agent
  approval lifecycle: private service-issued intent skips Ask only after hard
  and configured Deny. It creates no grants and does not read/change answer mode.
  Broker evaluation retains canonical targets and the selected backend.
- Remembered grants are scoped to the exact supported resource/operation class.
  Broad/opaque shell authority and nonempty terminal input remain invocation-
  only where the current policy requires it.
- Shell wrappers, redirections, mutable project launchers, interpreters, and
  opaque command forms must retain their conservative classification.
- Approval authorizes a prepared invocation on the already-selected backend.
  It never changes Local/SSH/Podman selection and never claims to be a sandbox.
- Explicit PTY controller transfer is private service-issued human intent, with
  deterministic control Deny and additional input Deny when granting human input.
  It grants no model approval bypass. Process-incarnation/controller revision
  fences must survive approval waits and actual queued writer admission.
- Automatic review answers only an Ask that policy produced, never creates
  grants, and fails closed: an ineligible request keeps the manual path and
  an unavailable reviewer blocks rather than allows.
- Persistence of grants belongs to the store adapter; evaluation depends on a
  narrow grant interface rather than transport or UI types.

## Starting points

- `mod.rs` — public permission contracts and composition.
- `evaluation.rs` — ordered rule decision.
- `hard_policy.rs` / `opaque_policy.rs` — non-overridable and broad authority.
- `shell_parser.rs` / `command_classification.rs` — token/command semantics.
- `resource_projection.rs` / `resource_binding.rs` — prepared resource identity
  before and after approval.
- `broker.rs` — interactive request/reply lifecycle. It stays one module
  (about 900 lines) because pending prompts, answer-mode transitions, captured
  run capabilities, waiter delivery and human grant settlement share admission
  ordering and the durable revision fence. Grant transaction mechanics remain
  in the inward store adapter.
- `broker_review.rs` — Approve for me on the broker: reviewer wiring, the
  review of one eligible Ask request, and blocked-action retry authorization.
- `review.rs` — review eligibility, the redacted reviewer projection, and
  per-run review limits. Its roughly 900 lines keep the bounded review record,
  exact-action retry memory, latched run capability and outcome accounting
  together so reset, retry restoration and stop limits share one owner. The
  reviewer itself (Jev) lives in `../model/jev.rs`.
- `review_failure.rs` — fixed failure categories for clients; provider details
  remain server diagnostics and never become model or UI error text.
- `../store/permission_grants.rs` — durable remembered-grant adapter.
- `permissions_tests.rs` — sibling characterization suite.

## Verification

```sh
cargo test --locked -p nac-core permissions
cargo test --locked -p nac-core tools::kernel
make crate-check CRATE=nac-core
```

Add regressions for every new command/resource form, especially denial-before-
execution and approval/revalidation races.

## Generated artifacts and placement mistakes

Permission rules and projected resources are runtime contracts; this directory
owns no generated files. Persisted rule/grant compatibility is enforced by Rust
types, store migrations, and tests.

- Do not embed process execution, sandbox construction, HTTP approval DTOs, or
  frontend presentation in policy modules.
- Do not treat tool registration or visibility as an authorization grant.
- Do not persist a broad grant because a narrower argument happened to appear
  in one invocation.
- Do not weaken classification to make an unsupported shell syntax convenient;
  either bind it safely or fail closed.
