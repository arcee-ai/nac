# Tool runtime guide

This directory owns first-party model capabilities from definition through
prepared invocation: schemas/exposure, strict capability composition, argument
decoding, resource projection, authorization, admission, execution, events,
and rich results. Individual families own their native operation and tests.

## Invariants and dependency restrictions

- Register first-party tools through `kernel.rs`; duplicate names and ambiguous
  capability composition fail explicitly. Native and model invocation must
  share the same prepared behavior.
- Decode and project resources before policy. Bind/revalidate canonical targets
  after approval and before execution. Visibility is not authorization.
- Imported MCP tools may remain dynamic adapters, but `mcp_adapter.rs` must put
  each call through an explicit capability snapshot and permission pipeline.
- Execution uses the backend and runtime context selected during construction.
  A permission decision cannot select a backend or bypass its confinement.
- Preserve cancellation, event emission, retained terminal output, exact-value
  redaction, rich text/image results, workspace gates, and parallel/exclusive
  admission semantics.
- File mutation remains revision-checked, no-follow, metadata-preserving, and
  atomic. Search/read behavior remains bounded and backend-consistent.
- Native web retrieval is a tool/provider family. It receives credentials via
  the narrow command-environment contract and must not depend on managed-host
  orchestration.

## Starting points

- `mod.rs` — private composition root and supported tool-set assembly.
- `kernel.rs` / `kernel_tests.rs` — registry, handles, snapshots, prepared call,
  policy/revalidation, invocation, collision and ordering contracts.
- `runtime_context.rs` — construction-time backend, environment, terminal,
  redaction, and workspace capabilities.
- `terminal_tools.rs` and `thread_lifecycle.rs` — process-tool adapter and run
  generation/cancellation admission.
- `mcp_adapter.rs` — dynamic imported capability adapter.
- `discovery.rs` and `discovery/` — glob/grep orchestration and traversal.
- `mutation.rs`, `mutation_remote.rs`, `mutation_tests.rs` — local/remote edit
  protocol and atomicity regressions.
- `web.rs` / `web_tests.rs` — Exa schema, URL policy, transport and redaction.
- `thread/`, `workset.rs`, `orchestrator.rs`, `subagent.rs`, `goal.rs` — topology
  capabilities; keep worker and child semantics distinct.

## Cohesive size exceptions

- `mutation.rs` is intentionally large because one auditable local owner keeps
  byte/text projection, revision checks, directory-descriptor traversal,
  atomic publication, metadata preservation, and cross-process file locking.
  Do not add remote transport or unrelated tools there.
- `discovery/filesystem.rs` keeps Local, mounted-Podman, and SSH no-follow
  traversal parity together. Split only when an adapter boundary preserves the
  same validation algorithm and tests.
- `web.rs` keeps one provider family's schema, target validation, redirect and
  retry policy, cancellable transport injection, bounded decoding, and masking.
  Do not add managed onboarding or generic HTTP product clients there.

## Verification

```sh
cargo test --locked -p nac-core tools::kernel
cargo test --locked -p nac-core tools::discovery
cargo test --locked -p nac-core tools::mutation
cargo test --locked -p nac-core tools::web
make crate-check CRATE=nac-core
```

Run relevant permission and direct/worker topology tests when changing prepared
resources, admission, or capability composition.

## Generated artifacts and placement mistakes

Tool schemas are produced at runtime from native definitions; this directory
owns no checked-in generated source. Do not hand-maintain a second schema or
dispatch table for another adapter.

- Do not introduce central name-based built-in dispatch or per-caller tool
  implementations.
- Do not authorize raw arguments after transport has started.
- Do not place provider product credentials, HTTP handlers, or React DTOs here.
- Do not split safety algorithms into one-call fragments merely to reduce line
  counts.
