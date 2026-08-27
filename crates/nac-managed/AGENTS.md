# nac-managed guide

`nac-managed` is the optional managed-host bounded context. It owns managed
configuration, generic secret administration, GitHub authentication and
repository discovery, durable clone operations, Git/process workflow, and
managed readiness facts. It is usable and testable without HTTP or the agent
harness.

## Invariants and dependency restrictions

- The crate must not depend on `nac-server` or `nac-core`. Depend only on narrow
  shared contracts/infrastructure and ordinary provider libraries.
- Managed behavior is opt-in. Missing managed configuration must not change
  ordinary NAC startup or session behavior.
- Secret reads remain internal snapshots; public administration surfaces expose
  names/status, never values. Exact-value redaction and file ownership/mode
  guarantees are preserved.
- GitHub credentials, Exa secrets, and model-provider credentials keep their
  distinct ownership. The command-environment provider exposes only the narrow
  spawn snapshot required by consumers.
- Clone operations are durable and cancellable. State transitions, progress,
  reconciliation, cleanup, destination policy, and project publication ordering
  remain testable without Axum.
- Project creation crosses `ProjectRegistrar`; do not import server managers or
  core project storage to avoid the port.
- Readiness reports facts. Delivery decides HTTP status/shape and deployment
  wiring decides which facts are required.

## Starting points

- `configuration.rs` — host config, secret store and command-environment
  implementation.
- `github.rs` — provider transport, device auth/token lifecycle, repository and
  branch discovery.
- `clone_workflow.rs` — domain state, operation store, Git/process adapter,
  cancellation/reconciliation, and `ProjectRegistrar` port.
- `readiness.rs` — provider-independent readiness facts.
- `lib.rs` — intentionally small public boundary.

## Verification

```sh
make crate-check CRATE=nac-managed
make crate-test CRATE=nac-managed
cargo test --locked -p nac-server managed
make test-managed-image-contract
```

Provider transport tests should inject local/fake transport. Live credentials
are never required for the ordinary test suite.

## Generated artifacts and placement mistakes

OpenAPI derives are feature-gated annotations, not a delivery dependency. This
crate owns no generated frontend files or container assets.

Do not place Exa web search/fetch here; it is a native tool/provider family.
Do not add Axum handlers, React models, server session managers, model loops, or
workspace session lifecycle. Do not make readiness mutate the host to satisfy a
check.
