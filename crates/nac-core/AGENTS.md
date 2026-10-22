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

- `src/agent/` — model loop, prompt rendering, compaction, transcript state,
  repeated tool-failure policy, and message/tool boundaries.
- `src/runtime/` — configuration/model resolution and direct/orchestrator/
  worker/resume/backend construction.
- `src/session_service/AGENTS.md` — run admission through durable settlement.
- `src/store/AGENTS.md` and `src/sessions/` — persisted domain and schema.
- `src/permissions/AGENTS.md` — policy, binding, grants, approval broker.
- `src/tools/AGENTS.md` — native kernel and tool families.
- `src/terminal/`, `src/process.rs`, `src/sandbox/` — execution and cleanup.
- `src/workspace/` — revision and Git workspace ownership.

## Cohesive size exceptions

The following production owners deliberately exceed 800 lines. Keep their
listed responsibility closed; a new concern requires a real submodule/port:

- `agent/mod.rs` owns the model/tool turn state machine, prompt commit boundary,
  usage/event settlement, and compaction handoff. Prompt rendering,
  repeated-failure identity, transcript preparation, compaction algorithms,
  previews, and tests live beside it; do not return those policies or add
  session persistence/delivery mapping to the loop.
  `agent/protected_construction.rs` supplies the actual retained context and
  preselected backend to this same constructor. The paired private service
  constructor checks the exact original source snapshot before initial service
  composition; neither exposes a post-build context setter. Ordinary tool
  dispatch stays refused for that context until protected adapters are joined.
- `telemetry.rs` owns the bounded observation vocabulary, content-free correlation,
  global recorder seam and store/runtime observation guards. Export queue/accounting
  and resource sampling remain private sibling modules; do not add transport DTOs,
  application policy or provider payloads to this owner.
- `events.rs` owns the typed agent/session event vocabulary plus the bounded
  replay/stream bus and durable thread-event bridge. Do not add React/SSE
  formatting; delivery serializes these contracts.
- `model/chatgpt_codex.rs`, `model/arcee.rs`, `model/client/mod.rs`, and
  `model/catalog/overlay.rs` each keep one provider/protocol or catalog-overlay
  policy auditable with its exact authentication, streaming, redaction, retry,
  validation, and response decoding. New providers get their own owner.
  `model/client/protected_model.rs` owns the private protected builder's actual
  imported-key client construction and retained key/runtime checks. It must not
  resolve environment, mounted-file or stored-login fallback credentials.
  Completed import association is historical; it never supplies Ready or a
  runtime deadline. The genuine factory owns independent runtime eligibility.
- `sandbox/podman.rs` keeps container creation authority, cidfile/token records,
  reconciliation, command wrappers, cleanup retries, and backend lifecycle in
  one safety owner. Do not put authorization policy or generic process control
  there.
- `mcp/file_config.rs` keeps revision-checked TOML editing, publication journal,
  locking, recovery, validation, and probe-facing records together. MCP
  transport invocation belongs elsewhere.
  `mcp/file_config/source.rs` owns retained original configuration descriptors
  and the shared-source/exclusive-publication fence; it cannot issue CREATE,
  runtime, credential or terminal authority.
  `configuration_source_files.rs` is the private no-follow descriptor mechanism
  shared by that participant and `model/catalog/source.rs`. The catalog owner
  retains all four original layers and a shared home-directory publication
  fence; the common cache writer takes its exclusive side before output. Neither
  participant issues admission; captured catalog resolution remains DATA.
  `runtime/create_global_source.rs` captures configured HOME/NAC_HOME once at
  trusted startup and retains their original namespace resources, including
  absence. Per-preparation views remain resources only, carry the original
  cutoff and are consumed by source resolution. AGENTS/skills content IO and
  MCP process/network mounts still require independent actual qualification.
- `model/managed_host_key_bootstrap_slot.rs` retains the actual startup
  NAC_HOME descriptor and a common credential reservation before provider
  issuance. It does not grant eligibility or create a provider key. The explicit
  initial-import continuation requires the same source-held Arc and an unchanged
  provisional binding, adding only the settled provider key ID. Short key IO
  excludes SQL; cancellation/unknown outcomes retain durable quarantine.
  `runtime/post_import_runtime.rs` owns the separate explicit operator runtime
  clock after actual eight-phase completion. It retains the same custody,
  completion and startup roots before checks, with a one-shot latch on custody;
  repeated wrappers cannot renew it. Its negative handles and original import
  invalidator wake the same supervisor. This resource owner grants no CREATE,
  Ready, backend substitution or execution. Private model scope cancellation
  leaves other sessions' shared key valid; actual key/IO failures revoke it.
- `terminal/session.rs` keeps one PTY adapter's construction, child/slave/master
  ownership, collector lifetime, input-root binding, geometry and explicit cleanup
  together. These fields share the same incarnation and reaping gate. Controller
  algorithms, cached process observation, output policy and tests live in focused
  sibling owners; do not add provider, transport or durable-session policy here.
- `view.rs` is the typed read-projection facade over session/thread/workset and
  workspace owners; `terminal/output.rs` is the bounded output registry,
  paging/UTF-8 boundary, preview, eviction, and lease owner. Neither may acquire
  new mutation/lifecycle responsibilities.

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
web assets. The model catalog JSON included by core is generated only by
`nac-catalog-gen` under its nested guide.

- Do not add Axum DTOs, React concerns, managed GitHub/clone policy, or image
  readiness here.
- Do not make session lifecycle call delivery adapters.
- Do not duplicate process supervision or credential persistence already owned
  by the shared infrastructure crates.
- Do not hide a cross-owner mutation behind a broad context/service bag; pass a
  narrow capability or port at construction.
