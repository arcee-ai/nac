# Traditional child sessions

Traditional children are durable, fresh-context coding sessions launched by an
Agent parent (`direct` or the compatibility alias
`direct-with-orchestrator`). NAC parents cannot create them. They are separate
from NAC's orchestrator workers: a child has its own transcript and generations,
while it shares the parent's workspace and inherits the parent's model, backend,
project, sandbox or SSH configuration, and configured permission rules.
Remembered permission grants are not inherited.

When a running child needs new approval, the parent chat keeps a child-scoped
permission connection open and presents that request beside the child controls.
The child transcript remains non-composable but exposes the same approval
control. A child waits briefly for the parent UI to establish this connection;
without one, the request fails closed and the operation is not executed.

Open the people control beside the direct-session composer to start, inspect,
continue, steer, cancel, or open a child transcript. The first visible profile
is `general`. While the current assignment is idle or running it gets Agent
coding tools except spawn and `create_goal`. After that generation settles,
the child is a normal Agent: the user can type, create a goal, and spawn.

The parent's Delegated work panel shows each child's description, coding-agent
type, status, and generation. Opening a row shows the child's lineage and a
**Back to Parent** action. Chat input stays disabled only while the assignment
is running. Messages from the commissioned task stay in the transcript and
cannot be reverted. Continue, steer, and cancel a running generation from the
parent's people control.

A foreground launch waits for the generation's structured outcome. A background
launch returns its durable child ID immediately. When a background generation
settles, NAC atomically queues one completion for the parent and wakes the
parent if possible. The queue is the source of truth, so a process restart can
reconcile an abandoned generation as interrupted and deliver its outcome once.
Do not poll background children from the model; the completion arrives
automatically.

Continuing a terminal child starts its next generation with the same immutable
profile, description, parent, model/backend, and workspace. Sending a prompt to
a running child steers that generation. A parent can have at most four running
children. A running assignment cannot launch grandchildren; a settled child can.
Deleting a parent deletes only its still-running child sessions. Settled
children remain, and their parent pointer may go stale if the parent is gone.

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
