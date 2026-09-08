# 0001 — Dependency boundaries

Status: accepted

## Context

NAC combines a durable coding harness, product application services, HTTP/MCP
delivery, a React client, and an optional managed-host product. Earlier module
placement let delivery and provider-specific product workflows accumulate in
the harness core, which made safety-critical lifecycle code harder to navigate
and encouraged broad service bags.

The product has three settled immutable session behaviors and two distinct
delegation topologies. Reorganizing ownership must not redesign those public
concepts or weaken persistence, authorization, sandboxing, mutation, or process
cleanup.

## Decision

NAC uses the following inward dependency direction:

1. Durable domain contracts express sessions, projects, permissions, tools,
   relationships, and small shared ports without HTTP or UI dependencies.
2. Application services coordinate product use cases behind narrow APIs.
3. Infrastructure adapters implement SQLite/filesystem persistence,
   credentials, Git/process execution, provider HTTP, and sandbox backends.
4. The agent/tool runtime owns model loops, capability snapshots, prepared
   invocation, authorization, execution, events, cancellation, and results.
5. `nac-server` composes application services and exposes HTTP/OpenAPI/MCP.
   Handlers decode/validate transport, invoke one application operation, and
   encode its result.
6. `nac-managed` owns managed configuration, generic secrets, GitHub auth and
   discovery, clone workflow/operation persistence, and readiness. It depends
   on narrow shared contracts and infrastructure, never `nac-server` or the
   agent harness. Server composition implements ports such as project
   registration.
7. React consumes the generated API contract and organizes product workflows by
   feature rather than placing domain behavior in generic global providers.

Construction selects a session behavior and execution backend. Authorization
can approve a prepared operation but cannot change that behavior, backend, or
non-bypassable safety policy. Traditional children, managed orchestrators, and
orchestrator workers may reuse lifecycle mechanisms but remain distinct
topologies.

Modules are private by default. Public exports are supported contracts or
composition seams, not shortcuts around ownership. When an extraction would
create a dependency cycle, define a narrow inward port rather than reversing
the dependency.

## Consequences

- Managed workflows can be tested without Axum or the model loop.
- Delivery DTOs and provider wire types do not leak into durable contracts.
- Safety and durability owners retain focused sibling tests and explicit
  construction APIs.
- Some infrastructure is shared through small crates (`nac-contracts`,
  `nac-credential-store`, and `nac-process`) because these are real acyclic
  boundaries, not convenience wrappers.
- Moving code mechanically is insufficient: each extraction must assign an
  owner, narrow its API, and preserve behavior with tests.

## Rejected alternatives

- A greenfield rewrite would put persistence and compatibility guarantees at
  unnecessary risk.
- Giving `nac-core` knowledge of managed GitHub/clone orchestration would keep
  provider product policy in the harness.
- Making `nac-managed` depend on `nac-server` would reverse application and
  delivery dependencies.
- Treating visibility as permission or approval as sandbox escalation would
  collapse distinct safety stages.
- Splitting crates or files solely by size would hide ownership instead of
  clarifying it.
