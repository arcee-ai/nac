# Architecture decisions

This directory records durable dependency and maintenance decisions that apply
across features. User-visible behavior remains documented under the topical
`docs/` sections; historical implementation ledgers remain historical evidence.

- [0001 — Dependency boundaries](0001-dependency-boundaries.md)
- [0002 — Generated API contract](0002-generated-api-contract.md)

Design proposals (not current product behavior):

- [Universal two-type sessions](universal-sessions.md) — Agent and NAC as
  the only session types; spawn, fork, and continue-in-X handoff.

When a change creates a durable new boundary or changes one of these decisions,
update the relevant record in the same commit. Do not use ADRs as progress logs.
