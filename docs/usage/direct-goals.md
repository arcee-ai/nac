# Durable direct goals

Durable goals are available only in `direct` and
`direct-with-orchestrator` sessions. They are opt-in multi-turn work, not the
default behavior for an ordinary prompt. The existing `orchestrator` behavior
does not expose goal tools, goal controls, or goal continuation, and remains the
default for old and omitted session behavior values.

Open the flag control beside the direct-session composer to create a goal. An
objective is required; the token budget is optional and has no implicit
default. The same panel edits the objective or budget and lets the user pause,
resume, clear, or apply `usage limited` and `budget limited` states. Clearing
deletes the current generation. Once a goal is complete, creating another goal
starts a fresh ID and zeroed accounting rather than reusing the old generation;
the completed-goal panel labels that action **Replace and start**.

The direct composer also implements literal goal commands. `/goal <objective>`
creates and activates a new goal, while `/goal edit`, `/goal pause`, `/goal
resume`, and `/goal clear` open or apply the corresponding user control. `/goal`
without arguments opens the detailed panel. An unfinished goal is never
silently replaced: edit it or clear it first. These commands are handled by the
web control plane; the objective then continues through NAC's ordinary durable
goal runner rather than treating the slash text as a model prompt.

The six durable statuses are `active`, `paused`, `blocked`, `usage_limited`,
`budget_limited`, and `complete`. While active, NAC starts one continuation
when the session becomes idle. Pending durable inbox input always goes first.
An ordinary successful turn leaves the goal active and therefore schedules the
next continuation. A failed run marks it blocked. An explicit user cancellation
accounts the partial run and pauses the goal, so cancelled work does not
immediately restart. Resume is explicit.

Each participating run is bound to the current goal generation. Creating a
goal during an already-running turn records the current token and time baseline,
so earlier work is not charged to the goal. Run settlement adds only later
billable tokens and elapsed time. Reaching an optional token budget changes the
status to `budget_limited` and prevents another continuation. Cached-read and
cache-write tokens are included because they are billable session usage; the
context-window gauge is not.

That mid-run baseline is process-local by design. If a different NAC process
currently owns the session run, goal creation returns a conflict instead of
creating an unbound generation or guessing its token baseline. Retry after the
owning run settles or use the process that owns the active run.

Continuation ownership is service-side and idempotent. A durable run claim and
the existing cross-process session-operation lease prevent concurrent starts.
On restart, NAC clears a stale claim while holding that lease and starts at most
one replacement continuation. Usage already settled before the restart remains
authoritative; model tokens from a process that died before run settlement
cannot be reconstructed and are not invented.

Direct models receive `create_goal`, `get_goal`, and `update_goal`. The creation
tool instructs the model to act only on an explicit user request and never adds
a default budget. The update tool can mark only `complete` or genuinely
`blocked`; pause, resume, clear, and limiting states remain user/system
authority. Goal operations still pass through the native prepared-tool and
permission boundary, and never alter the selected local, Podman, or SSH
execution backend.
