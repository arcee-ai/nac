# Managed orchestrator sessions

`direct-with-orchestrator` is a persistent coding-agent behavior with six extra
native controls for separate NAC orchestrator sessions: launch, status, steer,
read, wait, and cancel. Ordinary `direct` sessions keep the same 14-tool
boundary, and orchestrator sessions never receive these controls. A managed
orchestrator is always created with immutable `orchestrator` behavior, so it
cannot recursively launch another orchestrator.

The direct parent starts managed orchestrators with its launch control; ask it
to delegate the work. The web UI has no manual launch. Each one appears in the
parent's Subagents panel, where you can inspect, continue, steer, cancel, or
open its transcript. A new session inherits its parent's model, backend and
credentials, project, workspace, sandbox or SSH configuration, light worker
model, and compaction threshold. It starts with a fresh transcript and plans
through the existing NAC thread/workset topology; the direct parent never
receives raw thread or workset tools.

The parent's Subagents panel lists managed orchestrators beside traditional
coding agents, each with its own icon, and marks the ones still running.
Selecting a row previews its transcript above a composer for that orchestrator:
**Send** starts its next generation, **Steer** and **Stop** act on the running
one. **Open** goes to the orchestrator's own page, which names it a managed NAC
orchestrator, adds its Threads and Worksets panels, and returns to the parent
with **Parent chat**. That page keeps the same composer, which acts through the
parent, but its transcript has no resend, revert, fork, branch, or commit
controls.

After sending, the field becomes the draft for the next message. A pending
foreground reply does not prevent steering once the orchestrator is running.
**Stop** is a separate button; submitting an empty field never cancels a run.
Drafts stay with their selected orchestrator across navigation and same-tab
reloads.

Submitted text with failed or unconfirmed delivery is retained separately from
the next draft. A lost response does not prove the message failed: inspect the
transcript before restoring and sending it again. Recovery never sends
automatically or replaces a newer draft.

A foreground launch waits for the generation's final report. A background
launch returns immediately, then atomically records one completion for the
parent when the run completes, fails, is cancelled, or is reconciled after a
restart. Delivery is durable and exactly-once and follows the traditional child
rules: a running parent sees it at its next model boundary, otherwise it starts
one follow-up run. It is a delegated result, not a pending message, so the
parent's **Pending messages** controls never edit or cancel it. Continuing a terminal session
starts its next generation; sending a prompt while it is running steers the
current orchestrator generation. At most four managed orchestrators may run
for one parent, and deleting the parent deletes its managed sessions.
The foreground result remains tied to that generation even if a subsequent
generation has already started.

The native controls call the same protocol-independent Rust operations used by
NAC's outgoing session-control MCP server. They do not make an HTTP or MCP
loopback request. Existing outgoing MCP names, schemas, and default
orchestrator-only session creation remain unchanged.

Parent and managed orchestrator sessions can share a checkout. Assign
non-overlapping work and respect revision conflicts: durable lifecycle and
delivery do not make simultaneous mutations safe across independent processes.
Permission approval never changes the execution backend or bypasses sandbox,
path, revision, mutation, or workspace policy.
