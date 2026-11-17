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
`fb17440d9f65eab1be13f66268934778f32e4c6c`. Later cutover work must record the
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

### Baseline file disposition

The tracked, hidden-file-inclusive ALL-609 baseline is
`914782659a6183b89070a3516e2e44776b1eeb06`; these dispositions cover the
maintained documentation, guide and repository QA matches assigned to ALL-610.

| Baseline owner | Disposition |
| --- | --- |
| `README.md` | Direct identity; legacy reliability lane remains factual until ALL-612. |
| `docs/README.md`, `docs/usage/README.md` | Remove retired topic links and name direct sessions. |
| `docs/usage/managed-orchestrators.md` | Delete tutorial and guide ref; never repurpose the ref. |
| `docs/usage/session-behaviors.md` | Replace mode selection with direct session and safety guidance. |
| `docs/usage/skills.md`, `agents-md.md` | Document direct discovery, expansion and instruction loading. |
| `docs/usage/traditional-children.md`, `direct-goals.md` | Preserve direct child and goal contracts; remove retired topology advice. |
| `docs/usage/web-retrieval.md`, `permissions.md` | Preserve direct capability, credential and authorization boundaries. |
| `docs/usage/independent-tasks.md`, `mcp-disconnect-and-logout.md`, `workspaces.md` | Preserve direct task, refresh and backend semantics; remove mode comparisons. |
| `docs/usage/nac-guide.md` | Preserve provenance, paging and installed-source guidance; remove dispatch advice. |
| `docs/configuration/model.md` | Retain the direct checkpoint wire key and stable ref until ALL-615. |
| `docs/configuration/example.md` | Retain shared output settings under their current key until ALL-615; ALL-614 removes worker-only configuration. |
| `docs/api/http.md` | Teach explicit direct creation; current omitted default and retired routes remain narrowly identified until ALL-613. |
| `docs/managed/README.md` | Retain current host security and maintenance facts; ALL-614 removes legacy transport descriptions. ALL-612 owns workload-specific reliability docs. |
| `docs/qualification/direct-qa.md`, `linked-skills.md` | Preserve historical fixture limits; remove current retired choreography advice. |
| `.agents/skills/qa/SKILL.md`, `references/direct.md` | Replace dispatch policy with setup, parallel children and aggregate while retaining isolation and evidence rules. |
| `crates/nac-core/src/guide/{mod.rs,router.md,pack.json}`, `scripts/nac-guide/sources.json` | Route to direct help; regenerate from canonical sources and retire obsolete refs. |
| Guide tests and packaged/browser journeys | Replace retired tutorials with direct retrieval, provenance and resume coverage. |

ALL-612 owns `docs/managed/deterministic-load.md`, `docs/managed/telemetry.md`
and `docs/ci/` reliability guidance as its workload changes. Other runtime,
CI, image and schema references remain implementation facts until ALL-613/614;
ALL-616 owns the final current-source audit. Historical evidence is not current
usage guidance.
