# Traditional child sessions

Traditional children are durable, fresh-context coding sessions launched by a
`direct` or `direct-with-orchestrator` parent. They are separate from NAC's
orchestrator workers: a child has its own transcript and generations, while it
shares the parent's workspace and inherits the parent's model, backend, project,
sandbox or SSH configuration, and configured permission rules. Remembered
permission grants are not inherited.

When a running child needs new approval, the parent chat keeps a child-scoped
permission connection open and presents that request beside the child controls.
The child page exposes the same approval control beside its existing-session
composer. A child waits briefly for the parent UI to establish this connection;
without one, the request fails closed and the operation is not executed.
The parent's approval mode — **Manual** by default, **Approve all**, or
**Approve for me** — governs the parent and all of its traditional children.
Approval answers only requests that reach each child's broker after configured
and hard denials; remembered grants remain child-local.
Managed orchestrators are a separate topology and do not inherit the mode.

In **Approve for me** mode, the child's permissions dialog retains blocked
reviews even after the child finishes. **Authorize retry** routes through the
owning parent and authorizes one matching child action to be reviewed again;
it does not change the inherited mode or create a remembered grant. A running
child receives a steer for its current generation. A terminal child starts a
new background generation, whose completion is delivered to the parent through
the usual durable completion inbox. Recent reviews and retry authorizations
exist only in the current server process; a restart does not recreate them.

The parent agent starts children with its subagent tool; ask it to delegate
work. The web UI has no manual launch. Children appear in the parent's Subagents
panel, where you can inspect, continue, steer, cancel, or open each one. The
first visible profile is `general`. It exposes exactly `read`, `write`, `edit`,
`glob`, `grep`, `exec_command`, `write_stdin`, and `read_command_output`; it
cannot create goals, launch another child, or control orchestrator sessions.

The parent's Subagents panel lists each child by description, with the coding-
agent icon, and marks the ones still running. Selecting a row previews its
transcript above a composer for that child: **Send** continues a finished child,
**Steer** and **Stop** act on the running generation. **Open** goes to the
child's own page, which names it a traditional coding agent and returns to the
parent with **Parent chat**. That page keeps the same composer, which acts
through the parent, but its transcript has none of a primary chat's history
controls: no resend, revert, fork, goal, branch, or commit. Child goal ownership
is rejected by the service as well as hidden by the UI.

After sending, the field becomes the draft for the next message. A pending
foreground reply does not prevent steering once the child is running. **Stop**
is a separate button; submitting an empty field never cancels a run. Drafts stay
with their selected child across navigation and same-tab reloads.

If delivery fails or its response is lost, the submitted text is retained
separately from the next draft. An unconfirmed message may already have reached
the child: check its transcript before restoring and sending it again. Recovery
never sends automatically or replaces a newer draft.

A foreground launch waits for the generation's structured outcome. A background
launch returns its durable child ID immediately. When a background generation
settles, NAC atomically queues one completion for the parent and wakes the
parent if possible. The queue is the source of truth, so a process restart can
reconcile an abandoned generation as interrupted and deliver its outcome once.
Do not poll background children from the model; the completion arrives
automatically.
The foreground result remains tied to that generation even if a subsequent
generation has already started.

Continuing a terminal child starts its next generation with the same immutable
profile, description, parent, model/backend, and workspace. Sending a prompt to
a running child steers that generation. A parent can have at most four running
children, and the nesting limit is one: children cannot launch grandchildren.
Deleting a parent deletes its child sessions as well.

Parent and child coding tools using the same local checkout share a process-local
read/write gate, which serializes tool-level mutations while allowing discovery
reads to overlap. Retained/background processes can continue after the launch
tool returns, so callers should still avoid assigning overlapping mutations to
independent children. Coordination is process-local; separate NAC processes
must not be used to mutate the same checkout concurrently.

Sandboxed children require a host-backed workspace mount. A sandbox without one
is rejected because it cannot share durable files safely. Approval never changes
the selected execution backend or bypasses sandbox, path, revision, or mutation
policy.
