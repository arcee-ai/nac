# Independent direct tasks

A direct chat can find and inspect other visible direct chats, its independent
tasks, without launching, waking or steering them. Session ID is task identity.
Traditional child sessions and managed orchestrators keep their own topologies
and are never returned as tasks.

## Finding tasks

`find_tasks` searches this chat's saved project by default. Naming
`project_id` searches another saved project explicitly; an unknown project
returns `project_not_found`, and a chat outside any project must name one. Give
at most one selector:

- `session_id`: exact lookup.
- `reference`: a work-unit or ticket token such as `ALL-469`, matched as a whole
  case-insensitive token in the title or last prompt (`ALL-4690` does not match).
- `text`: a case-insensitive substring of the title or last prompt.

With no selector it lists recent tasks. Every candidate is a separate attempt and
is never collapsed into one duplicate; a match is discovery evidence rather than
identity. `ambiguous` is `true` when a page shows several matches, `false` only
when a single page covered the whole search with at most one match, and `null`
(unknown) on any other page of a multi-page search. Pages hold at most 20
candidates and examine at most 500 sessions; continue with `next_after`.
`scan_limit_reached` means rows remain unexamined, not that nothing matched.

## Reading a task

`read_task` returns one bounded snapshot read in a single store transaction:

- `durable`: run count, current durable run, pending inbox items, the current
  goal with ID, version and status, the last 8 replaced or cleared goals with
  their final status, and the last 8 run outcomes with a result excerpt of up to
  2,000 characters or the failure. Stored excerpts and failures, prompt
  excerpts and goal objectives are credential-redacted.
- `ephemeral.approvals`: always `unknown`. Approval requests live in the
  target's live owner process, so their absence from a passive read never means
  none are pending.
- `navigation`: the app route that opens the task.

A task outside this chat's saved project returns `outside_scope` without its
contents until its `project_id` is named. Missing sessions return `not_found`;
the store cannot tell a never-created session from a deleted one. Sessions of
another topology in scope return `not_independent_task` with only their kind;
out of scope they return `outside_scope` like any other session.

A goal-free run ending is a result, not proof that an objective was completed.
Each run outcome is recorded once at settlement, or at restart when the
process stopped before settling; later follow-up activity adds a new outcome and
never rewrites an earlier one. A run cut off by a restart is recorded as failed
with an `interrupted` failure, and a run settled at restart has no result
excerpt.

## Passivity and permissions

Neither tool attaches, recovers or wakes a session, consumes inbox input,
acquires a lease or subscribes to session events, so an idle task with pending
inbox work or an active goal stays exactly as it was. Both tools are available
only to a persisted direct primary and use ordinary permission evaluation under
the `task_read` action with resources `project:<id>` and `session:<id>`. A
default-scope search or exact read also evaluates the resolved `project:<id>`, so
rules on a concrete project apply whether or not `project_id` was passed.
Configured Deny applies, and Ask fails closed without an interactive approver.
Sessions whose `session:<id>` is not allowed without a prompt are skipped before
matching, so they affect no candidate, flag or cursor.
