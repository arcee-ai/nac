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


## Explicit peer goal controls

`task_goal` provides `read`, `start`, `pause` and `resume` for an exact independent
plain `direct` task on an unmanaged Local host. Pass its `session_id` and saved
`project_id` explicitly. Ordinary task launch remains goal-free.

Every call first passes ordinary `task_goal_<action>` permission evaluation on
`session:<id>` and `project:<id>`. A new goal action then requires a separate manual human reply
for this invocation's exact action, target and arguments. Broad coordination
instructions, read permission, a peer message, remembered grants, Auto-approve,
Approve for me and authenticated human product invocation markers do not supply
that reply. Configured Deny still wins, and a headless caller fails closed.
This deliberately uses the existing approval interface; it does not transfer the
human goal panel's authority to an agent or create a reusable grant. A configured
Ask can therefore produce an ordinary permission question before the additional
explicit goal-action question.

Start requires an explicitly requested finite `objective` and a stable
caller-scoped `request_id`. Supply `token_budget` only if the human requested one.
For strict Responses calls, pass `null` for an unrequested budget and arguments
that do not apply to the selected action; ordinary callers may omit them. The
flat input also accepts well-typed unused fields from providers and discards
them. Only the selected action's fields enter its permissions and canonical
request binding; unused values cannot edit or retarget a goal. Required active
IDs, versions and objectives are never filled in automatically.
Control replies and start receipts redact objectives and cut them to 1,000
characters, with `objective_truncated` on each object. Reads retain the
`read_task` current and prior objective-truncation flags. Stored argument
binding and goal identity/version are unchanged; keep the original inputs for
retries rather than copying a shortened or redacted response.
Keep the ID and exact arguments for retries: after lost acknowledgement or restart,
NAC returns the original immutable admission receipt, including its goal ID and
original response. Reusing that ID with changed arguments conflicts. The receipt
is evidence of admission, not a claim that the goal is currently active or has
completed. Read the exact goal and retained evidence to establish its outcome.
Exact receipt replay needs no new manual goal authorization: it returns only
that already accepted action's original admission reply, after current ordinary
permission evaluation. It cannot authorize a new action or changed arguments,
and never attaches, wakes or changes a replacement objective. Once a fresh
control invocation is admitted, the serving lifecycle retains its commit and
existing wake path even if the caller loses the reply.

Pause and resume require `goal_id` and `expected_version` from a fresh read.
Pause leaves an already-running turn/tool running and preserves its accounting;
it prevents later autonomous continuation. Stopping a run is a separate action.
Resume accepts a paused, blocked or usage-limited goal with remaining budget
after active accounting has settled, using the existing human update owner. It
never replaces the objective or restarts a complete or budget-limited goal. Concurrent human changes, settlement, ownership or configuration
changes return conflict/unavailable instead of overwriting newer state. A start
while running requires the exact local accounting baseline. A fresh start waits
for a previous terminal goal's accounting to settle before retiring it; idle mutations retain
the cross-process operation lease.

The target alone can declare complete or blocked. This peer surface offers no
replacement, clear, budget edit, completion or blocked operation. Existing human
controls retain their behavior. Current and retained goal evidence uses the same
bounded persistence owner as `read_task`, so later goals cannot rewrite an earlier
success claim. Goal reads are passive and never subscribe as interactive approvers.
