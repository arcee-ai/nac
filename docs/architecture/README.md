# Architecture decisions

This directory records durable dependency and maintenance decisions that apply
across features. User-visible behavior remains documented under the topical
`docs/` sections; historical implementation ledgers remain historical evidence.

- [0001 — Dependency boundaries](0001-dependency-boundaries.md)
- [0002 — Generated API contract](0002-generated-api-contract.md)
- [0003 — Managed Arcee bootstrap ownership and durability](0003-managed-arcee-bootstrap.md)
- [0004 — Persistence ownership and local store guarantees](0004-persistence-ownership.md)
- [0005 — Direct session workflow ownership](0005-direct-session-workflows.md)
- [0006 — Human terminal execution and observation](0006-human-terminal-observation.md)

When a change creates a durable new boundary or changes one of these decisions,
update the relevant record in the same commit. Do not use ADRs as progress logs.
