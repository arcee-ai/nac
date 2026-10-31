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

## Waiting on exact work

`wait_tasks` observes one or more independent sessions without starting or
steering them. A zero-time call takes a snapshot; a positive timeout waits for
new actionable evidence, any selected result or stopped goal, or pending input
to this coordinator. For example:

```json
{"targets":[{"session_id":"task-session","mode":"run","run_id":"exact-run"},{"session_id":"other-session","mode":"goal","goal_id":"exact-goal"}],"timeout_ms":30000}
```

Optional fields accept null: `mode: null` uses the documented `run` default,
and `timeout_ms: null` requests a zero-time snapshot. The provider-facing run
and goal shapes list every field explicitly and require the other mode's
identity to be null. Compact native calls may omit these fields. Supplying a
non-null identity for the wrong mode remains an error; it is never ignored.

Omit the identity to resolve the current run or goal once. Run mode uses the
current durable run, or the most recent retained result if no run is current.
Save each returned `resolved_identity` and `after_cursor`. Reuse that cursor
with the same caller, session, mode and project scope, or name the exact ID.
A cursor never switches to a later run or replacement goal. If there was no
identity when the selector resolved, it stays unavailable. Explicit identities
that conflict with a cursor are rejected. Cursors are bounded, untrusted
observation hints: editing one grants no authority and cannot change stored
facts. They survive restart; an epoch change sets `resync` and re-reads truth.

The response separates its wake reason (`snapshot`, `target_changed`, `timeout`,
`coordinator_input`, or cancellation) from each target's state:

- `active` means the exact durable work is still active, not a claim of process
  liveness or an interactive human connection.
- `result_available`, `failed` and `cancelled` are distinct run outcomes. A
  result never asserts objective completion.
- `goal_complete`, `goal_paused`, `goal_blocked`, `goal_usage_limited` and
  `goal_budget_limited` describe that exact goal. Retired active goals return
  `replaced` or `cleared`; retained stopped goals carry their original proof.
- `not_found` cannot distinguish deletion from never-created sessions.
  `unavailable` also covers unretained, interrupted or aged-out exact evidence;
  a later identity never substitutes for it. Scope and topology errors keep
  `read_task`'s distinct statuses.
- `approval_attention` carries one exact, existing request ID and an app route
  ending in `/insights?permission_request=<id>`. This only observes a local
  live broker. Other owners remain `unknown`. The human page revalidates the
  exact request; an expired link never selects another request for approval.
- `question_attention` carries an exact durable question ID, source run and
  generation, revision, responder class and a route ending in
  `/insights?question_request=<id>`. It remains distinct from approval attention
  and can survive restart. A pinned run or goal never selects another request.
  Question text and choices count toward the 128 KiB aggregate response limit;
  request fewer targets if a large set of questions exceeds it.

A repeated cursor suppresses already delivered proof and attention details,
marking `unchanged`. Status/commentary and active-goal accounting updates do not
wake a wait. The result stays inspectable through `read_task`; observation
never marks it read, acknowledges it, or deletes it. Proof retention remains
ALL-469's last eight run outcomes and eight retired goals per session.

Waiters subscribe before their first durable read. Goal-owner post-commit
hints include session/goal identity, version, status and current/replaced/cleared
kind. Hints are lossy process-local notifications, not completion evidence or
a second history store. A ring gap sets `resync`; periodic authoritative reads
cover missed hints, other owners, reconnects and restart. Delayed or reordered
hints can only cause another read. No delta subscription is added, so observing
cannot keep headless approval alive. Cancelling or timing out the wait never
cancels a target, pauses its goal, or consumes coordinator input.

Calls reject more than eight targets, a timeout over 60,000 ms, identifiers over
160 bytes, cursors over 4,096 bytes, or a response over 131,072 bytes. Result
excerpts in waits are capped at 500 characters; `read_task` keeps the longer
retained excerpt. Authoritative fallback revalidation runs every 250 ms, plus
relevant stopped-goal notifications. The timeout bounds the observation phase;
finishing its last authoritative read adds a small amount of elapsed time.

### Measured bounds

Measured on 2026-10-30 (America/Los_Angeles), source
`6288b969a5b25c99b834e071f4f7f2eb75e3dc26`, Darwin arm64, Rust 1.98.0,
Node 26.12.0, using the unoptimized test profile and a warm SQLite store.
The shared exclusive gate held both Rust slots and the browser slot; other
heavy web work was deferred. Snapshot columns are the median and maximum of
ten native calls per fanout. Fixtures use active goals with 10,000-character
objectives and retained UTF-8 run results of 2,000 characters, cut to 500 in
wait responses. Compilation is excluded from the operation timings.

| Targets | Snapshot median (ms) | Snapshot max (ms) | Active reply (bytes) | Result reply (bytes) | 500 ms wait elapsed (ms) |
| --- | --- | --- | --- | --- | --- |
| 1 | 5.47 | 17.83 | 802 | 2,796 | 516 |
| 2 | 8.89 | 14.76 | 1,391 | 5,373 | 519 |
| 4 | 14.51 | 21.19 | 2,569 | 10,527 | 533 |
| 8 | 25.51 | 33.88 | 4,925 | 20,835 | 553 |

The eight-target result snapshot took 36.80 ms. The separate eight-target
60,000 ms upper-bound test returned `timeout` at 60,048 ms, with a 4,900-byte
reply. These are measured local fixture costs, not a cross-host latency promise.

Eight targets is the largest qualified fanout. The 60-second request bound
limits one observation call to about 240 fallback intervals per target while
allowing coordinator input to interrupt between reads. The 128 KiB response
ceiling leaves over six times the largest measured reply for identifiers and
failure evidence while keeping aggregate output finite. Larger fanouts or
longer waits require fresh qualification; argument and output overflow are
explicit errors. Reproduce with the owning tests
`representative_snapshots_and_bounded_wait_cost` and the explicitly ignored
`maximum_timeout_measurement` in an exclusive performance window.

## Structured questions

Plain direct sessions on Local expose `request_question`, `read_question` and
`answer_question`. A task can request one blocking question with a stable
`request_id`, text, optional suggested choices and a required responder class:
`information` or `human_decision`. Limits are 160 bytes per ID, 4,000 characters
of question or answer text, and eight choices of 300 characters each. Arbitrary
forms and nonblocking workflows are outside this surface.

Creation binds the request to its session and exact source run. For a direct
run, that immutable run UUID is also its generation; child and managed
relationship generations retain their separate meanings. After the complete
tool batch commits, NAC yields before another model request. Any active goal
stays active while the pending question gates autonomous continuation. A normal
message can still provide guidance without answering the question.

The human sees the question above the composer and submits an answer or cancels
that exact question. An expired exact link shows no replacement response
control. `read_question` returns one request by session and request ID;
`read_task` includes the current pending question in its durable snapshot.
Human HTTP delivery uses `/sessions/{session_id}/questions`, the exact request
resource, and its `/answer` or `/cancel` action.

An authorized coordinator may answer already-settled information within its
human-authorized scope. Its native answer binds `request_id`, `run_id`,
`generation`, `expected_revision` and literal `answer`. Human decisions reject
the agent route. Agent answers use ordinary prepared policy under
`task_question_answer`, plus the existing task/project read scope. Ask remains
headless fail-closed. Human delivery cannot be selected by an agent input field.
Neither answer is permission approval, a remembered grant, review intent or
authority to change the execution backend.

Identical creation and answer retries return stable receipts. Changed answers,
stale revisions/generations, incompatible owner/configuration/project or goal
bindings, and cancelled requests conflict. An answer reserves one durable inbox
item and one continuation run UUID. Even when guidance runs first, only that
reserved run can consume the answer at the transcript commit boundary. It
cannot be converted to Steer. Cancelling undelivered input cancels its delivery
obligation while retaining the accepted answer receipt. Replaying a delivered
or cancelled receipt never wakes replacement work. Process restart preserves a
pending question; explicit source cancellation, failure or target deletion does
not turn a delayed answer into authority over a replacement request.

## Explicit peer goal controls

`task_goal` provides `read`, `start`, `pause` and `resume` for an exact independent
plain `direct` task on an unmanaged Local host. Pass its `session_id` and saved
`project_id` explicitly, or pass `project_id: null` for a projectless target. The
project scope is never inferred. Ordinary task launch remains goal-free.

Every call first passes ordinary `task_goal_<action>` permission evaluation on
`session:<id>` and, for a saved project, `project:<id>`. A new goal action then
requires a separate manual human reply
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
