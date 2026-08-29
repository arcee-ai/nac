# Managed orchestrator sessions

Every Agent session (`direct`, and the compatibility alias
`direct-with-orchestrator`) has six native controls for separate NAC
orchestrator sessions: launch, status, steer, read, wait, and cancel.
Orchestrator sessions never receive these controls and cannot create
sessions. A managed orchestrator is always created with immutable
`orchestrator` behavior, so it cannot recursively launch another
orchestrator.

Open the flow control beside the composer to start, inspect, continue, steer,
cancel, or open a managed orchestrator transcript. A new session inherits its
parent's model, backend and credentials, project, workspace, sandbox or SSH
configuration, light worker model, and compaction threshold. It starts with a
fresh transcript and plans through the existing NAC thread/workset topology;
the direct parent never receives raw thread or workset tools.

The parent's Delegated work panel lists managed orchestrators separately from
traditional coding agents, with description, type, status, and generation.
Opening a row shows its durable lineage and **Back to Parent** action. Chat
input is disabled only while the assignment is running; after settle the NAC
session is a normal chat. Use the parent's flow control for continuation,
steering, and cancellation of a running generation.

A foreground launch waits for the generation's final report. A background
launch returns immediately, then atomically queues one completion for the
parent when the run completes, fails, is cancelled, or is reconciled after a
restart. The queue is durable and exactly-once. Continuing a terminal session
starts its next generation; sending a prompt while it is running steers the
current orchestrator generation. At most four managed orchestrators may run
for one parent, and deleting the parent deletes its managed sessions.

The native controls call the same protocol-independent Rust operations used by
NAC's outgoing session-control MCP server. They do not make an HTTP or MCP
loopback request. Existing outgoing MCP names, schemas, and default
orchestrator-only session creation remain unchanged.

Parent and managed orchestrator sessions can share a checkout. Assign
non-overlapping work and respect revision conflicts: durable lifecycle and
delivery do not make simultaneous mutations safe across independent processes.
Permission approval never changes the execution backend or bypasses sandbox,
path, revision, mutation, or workspace policy.
