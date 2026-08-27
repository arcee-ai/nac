# nac-core guide

`nac-core` owns the durable agent harness: model/tool execution, immutable
session behavior, orchestration, traditional children, permissions, execution
backends, session lifecycle, persistence, recovery, and workspace operations.
It must not own HTTP/React delivery or managed-host product onboarding.

## Invariants and dependencies

- Preserve orchestrator prompts/defaults and the three persisted session
  behaviors. Construction chooses one behavior; there is no runtime switching.
- Orchestrator workers, traditional child sessions, and managed orchestrators
  are distinct topologies. Shared lifecycle code does not make them one role.
- Durable state is generation-aware and restart-safe. Completion delivery,
  recovery markers, inbox/goals, relationships, leases, transcript revisions,
  and cancellation ordering are compatibility surfaces.
- Permission evaluation and approval cannot change the selected Local, SSH, or
  Podman backend. Non-bypassable path/sandbox/mutation policy remains separate.
- Core may depend on small inward contracts/infrastructure crates. It must not
  depend on `nac-server` or managed-host orchestration. `nac-managed` appears
  only as a dev dependency for compatibility fixtures.
- Keep modules private unless another crate has a supported reason to call the
  contract. Add public re-exports deliberately in `src/lib.rs`.

## Starting points

- `src/agent/` — model loop, prompts, compaction, message/tool boundaries.
- `src/runtime/` — configuration/model resolution and direct/orchestrator/
  worker/resume/backend construction.
- `src/session_service/AGENTS.md` — run admission through durable settlement.
- `src/store/AGENTS.md` and `src/sessions/` — persisted domain and schema.
- `src/permissions/AGENTS.md` — policy, binding, grants, approval broker.
- `src/tools/AGENTS.md` — native kernel and tool families.
- `src/terminal/`, `src/process.rs`, `src/sandbox/` — execution and cleanup.
- `src/workspace/` — revision and Git workspace ownership.

## Verification

```sh
make crate-check CRATE=nac-core
make crate-test CRATE=nac-core
make test-durability
```

Use focused test filters while iterating, then run the crate suite. Optional
SSH/Podman fixtures must be reported as skipped/ignored unless their
infrastructure is present.

## Generated artifacts and placement mistakes

This crate owns no checked-in generated source. Keep workspace `Cargo.lock`
changes tied to manifest changes and use root generation targets for OpenAPI or
web assets.

- Do not add Axum DTOs, React concerns, managed GitHub/clone policy, or image
  readiness here.
- Do not make session lifecycle call delivery adapters.
- Do not duplicate process supervision or credential persistence already owned
  by the shared infrastructure crates.
- Do not hide a cross-owner mutation behind a broad context/service bag; pass a
  narrow capability or port at construction.
