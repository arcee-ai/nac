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
candidates and examine at most 500 readable sessions; continue with `next_after`, an
opaque token that resumes only the same chat's search of the same project and
does not survive a restart.
`scan_limit_reached` means readable rows remain unexamined, not that nothing
matched.

## Reading a task

`read_task` returns one bounded snapshot read in a single store transaction:

- `durable`: run count, current durable run, pending inbox items, the current
  goal with ID, version and status (plus `goal_last_run_id`, the last run that
  settled against it), the last 8 replaced or cleared goals with their final
  status and last settling run, and the last 8 run outcomes with a result excerpt of up to
  2,000 characters or the failure. Goal objectives, current and retained, are
  cut to 1,000 characters, with `goal_objective_truncated` and each prior
  goal's `objective_truncated` saying when they were. Stored excerpts and failures, titles,
  prompt excerpts and goal objectives are credential-redacted, and search
  matches only the redacted text, so it cannot be used to guess a secret.
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
Once the chat's project is known, its concrete `project:<id>` is the resource
checked, so one Ask covers the call.
Sessions whose `session:<id>` is not allowed without a prompt are skipped before
matching and never count toward the 500-row scan, so they affect no
candidate, count, flag or cursor.

## Authorized follow-up

`send_task_followup` submits guidance to an exact independent plain-direct Local
task. Human authorization must cover the target and action. A peer asking for a
reply does not authorize sending it; read access and broad coordination intent
do not authorize arbitrary mutations. The tool uses ordinary agent permission
evaluation with an invocation-only Ask default and the selected target resource
`session:<id>`. Its action is `task_followup_queue`, `task_followup_steer` or
`task_followup_auto`; configured Deny remains effective, and a headless Ask fails
closed. An admitted peer message never becomes human review intent in the target.

Supply the target `session_id`, a stable `request_id`, `action` and `prompt`.
Crossing saved projects requires the target's `project_id` explicitly.

- `queue` admits a task-bound FIFO successor. An optional `run_id` checks that
  exact current run at admission, without changing queue delivery.
- `steer` requires the exact active `run_id` and delivers at the next safe agent
  boundary. Guidance admitted just before finishing stays pending for a successor.
- `auto` resolves once against committed active-run state: steer when active,
  otherwise queue a successor. An optional `run_id` is an exact binding and
  conflicts if it is no longer active.

The key is scoped to the caller's session, and binds target, project selector,
action, exact prompt and supplied run. Repeating identical arguments returns the
original admission and current delivery state, including after restart or a lost
acknowledgement. Changing arguments with that key conflicts. A stale explicit run
never silently targets a later run. Replays never recreate an item or blindly
wake another turn, even after delivery or cancellation. If an initial wake fails,
the input remains durable for the target's normal attachment/recovery path.

The receipt includes `requested_action`, `resolved_delivery`, immutable
`admitted_run_id`, `inbox_item_id`, eventual `delivered_run_id`, and task
navigation. `accepted_pending` means the input is admitted but has not entered
the model transcript; `delivered` means transcript delivery, not completed work
or exactly-once provider execution. `cancelled` is terminal for that item.
`unknown` means the commit or inbox evidence is unavailable and must not be
treated as a fresh request. Receipts survive deletion of their inbox items and
then report unknown rather than recreating work.

Use `read_task_followup` with the original `request_id` and target `session_id`
for passive inspection without repeating the prompt. It reads only this caller's
receipts under `task_read` policy, and never attaches, wakes, consumes input,
acquires execution leases or adds an approval subscription. Cancelling the
coordinator or its tool wait does not cancel the independent target or erase an
accepted input.
