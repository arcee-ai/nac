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

## Launching separate tasks from a direct chat

Ask a persistent Local direct chat to start a separate task for a specific brief.
The new chat has its own title, session identity and initial input. Both chats
remain independently steerable. A launch starts no goal and copies no transcript.
Traditional children and managed orchestrators keep their existing semantics.

The native tools are:

- `list_projects`: read saved project IDs, names, locations, configured model
  defaults and backend eligibility. A query filters candidates without selecting
  one. This operation does not scan or initialize directories.
- `launch_task`: launch a goal-free direct chat in a saved project. An explicit
  `project_id` wins; omission uses the caller's bound saved project. If the caller
  has no project, choose an ID from discovery. Names and paths are not guessed.
- `task_launch_status`: read the caller's request receipt and committed task/run
  state. It never attaches, wakes, recovers, subscribes to or controls a target.
  Process-local approval queues remain unknown; open the task to see them.

Provide a canonical UUID `request_id` for each intentional new task. Retrying
the exact same key and arguments returns the original task, including after
response loss or restart. Changed arguments or a different caller conflict.
Two intentional tasks need different keys even when their briefs are identical.
The durable receipt reports preparation, errors, session/project identity and
the exact `/session/<id>` route. The transcript opens a receipt link only after
the passive session inventory confirms the independent direct task and project.
Markdown URL policy is unchanged.

`workspace: "auto"` starts Git projects in a retained isolated worktree through
the shared clean-ref launch service. Same-project launches default to the
invoking checkout's committed `HEAD`; cross-project launches use the
destination's configured default branch. `git_ref` selects an explicit ref or
predecessor. When a project has no saved Git binding yet, `default_ref` must
name its intended default branch. Resolve once and retry the original receipt;
moving or deleting a selected ref does not repin an accepted request.
Clean-ref launches exclude source edits; the receipt explicitly reports that
policy. They preserve the source checkout, index and files.

Ordinary non-Git Local projects use their saved directory. An explicit
`workspace: "existing_checkout"` also keeps the established shared-checkout
behavior for Git projects; it cannot select a ref. `workspace: "clean_ref"`
requires a Git source and never falls back after a source error. Current-contents
capture, remote task launch, automatic cleanup and peer control are separate work.

The initial `prompt` must contain the necessary handoff facts. `skill` adds the
requested named skill to that fresh brief; it does not install skills or copy
their contents. Explicit `model` and `reasoning_effort` values are preserved;
otherwise the destination's existing launch defaults apply. The new task keeps
its own normal agent permissions and default manual answer policy. Human product
invocation authority and the caller's approval mode or remembered grants do not
transfer. Hard/configured denials, canonical project/source ownership and backend
admission still apply. Native launches currently require an unmanaged Local
caller and destination; unsupported backends fail without substitution.

After acceptance, preparation belongs to the serving lifetime even if the
tool response is lost. Interrupted preparation is reported as failed and can be
reconciled by an exact retry. A cancelled publication cannot insert a session
or initial input. Published tasks retain their workspace under the existing
retention contract; cancelling a run is independent of steering the caller.
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
