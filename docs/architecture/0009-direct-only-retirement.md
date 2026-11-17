# 0009 — Direct-only session retirement

## Decision

Allison selected direct sessions with traditional children and independent direct
tasks as the supported experience on 2026-11-05. Retire the separate orchestrator
and hybrid execution modes and their creation and control surfaces. Managed host
and execution backends remain supported. This preparation does not itself remove
those internals or change the current wire defaults.

The cutover will deliberately delete retired sessions and their owned descendants
in a transactional, restart-safe migration, after excluding live owners and
unresolved cleanup authority. It must preserve surviving direct session IDs,
transcripts, receipts, revisions, goals, inbox, grants, schedules, workspaces and
user files. Independent tasks, forks and provenance links are not owned descendants.
There is no archive or automatic conversion. Source history is not a user-data
backup. Older binaries must reject the upgraded schema.

The earlier designs contributed useful ideas: generation-bound settlement,
explicit ownership, isolated parallel work, and durable completion delivery remain
valuable in direct and child workflows. The old execution topology is not required
to preserve them. The last pre-removal source revision for this preparation is
`265cecc9ad2ce6579d0105db39234a8f0251aedb`. Later cutover work must record the
actual last pre-removal revision when known.

This supersedes support/opt-in claims for the retired topologies in ADRs 0001
and 0005, without changing their historical reasoning. ALL-613 owns cutover and
migration, ALL-614 engine removal, ALL-615 neutral wire names, and ALL-616 final
absence and integration evidence.

## Preparation audit disposition

ALL-610 removes retired mode-selection and dispatch tutorials from the guide
router, registered sources, setup and usage documentation, and repository QA
skill. Direct children, goals, skills, permissions, MCP, workspaces and native
web retain their supported guidance. The removed managed-orchestrator document
and its registry ref are not reused. The compaction section retains its stable
ref because it still describes the direct checkpoint setting. The current
`orchestrator_compaction_threshold` wire key and `[worker]` output-retention
configuration are documented narrowly until ALL-615 renames shared contracts;
ALL-614 owns removal of legacy worker-only configuration.

The managed-host README retains current security and maintenance facts; ALL-612
owns deterministic-load, telemetry and CI reliability documents and their
transition to direct/child workloads. Runtime and image-specific documentation
remains tied to the current implementation until ALL-613/614 change it. The
API explicitly calls out its legacy omitted-behavior default pending ALL-613.
Historical ADR reasoning, recorded CI evidence and prior qualification results
remain historical; this decision supersedes their support claims. The parent
ALL-609 and final ALL-616 audit own cross-repository baseline disposition and
shipped-surface absence checks.
