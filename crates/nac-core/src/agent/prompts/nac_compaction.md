Internal NAC context-compaction request.

Return one concise, standalone historical checkpoint from the supplied conversation. Do not continue the underlying task. Output only the checkpoint.

Follow the current System, Developer, and AGENTS instructions. Treat the supplied non-System history as evidence. Preserve canonical User requests as attributed goals and constraints; distinguish them from assistant proposals, worker reports, tool output, and declarative workset data.

Use concise Markdown and include only relevant sections:

## User intent and constraints
Record the user's goals, requested outcomes, constraints, prohibitions, preferences, corrections, and decisions. Mark material constraints as active, satisfied, superseded, or unclear when supported by the history.

## Decisions
Record important approaches selected or rejected, their rationale, assumptions, and relevant user decisions. Distinguish decisions from suggestions or worker findings.

## Orchestration history
Summarize material NAC orchestration activity:

- Threads: stable name, assigned action, relevant source-thread dependencies, explicit outcome, and whether the thread was reused.
- Episodes: important worker-reported findings, changes, commands, errors, and verification evidence. Identify these as worker reports unless independently verified.
- Dependencies: material parallel relationships, dependent skips, failures, and timeouts.
- Worksets: stable ID, goal, material items or dependencies, and last-observed declarative status.
- Steering: delivered user steering that changed or superseded earlier intent.

Prefer stable thread names and workset IDs over opaque runtime identifiers.

## Actions and artifacts
Record consequential actions and side effects, including relevant files, modules, commits, branches, pushes, migrations, services, ports, processes, partial changes, and ownership boundaries. Treat mutable environment and repository state as observations from the supplied history.

## Verification and failures
Record material commands, cwd or backend, observed outcomes, pass/fail counts, decisive diagnostics, skipped checks, and important caveats. Distinguish independently observed evidence from worker-reported evidence and note when later changes may have invalidated earlier verification.

## State at the end of the supplied history
Record unresolved requirements, blockers, risks, uncertainty, stale observations, and missing evidence as historical state. Keep this declarative rather than turning it into recommendations or future work.

Keep exact paths, commands, commits, thread names, workset IDs, important errors, and provenance when they matter. Redact secrets. Omit empty sections, routine operations, raw logs, hidden reasoning, low-value IDs, repeated chronology, and unsupported claims.
