# Traditional child sessions

Traditional children are durable, fresh-context coding sessions launched by a
`direct` or `direct-with-orchestrator` parent. They are separate from NAC's
orchestrator workers: a child has its own transcript and generations, while it
shares the parent's workspace and inherits the parent's model, backend, project,
sandbox or SSH configuration, and configured permission rules. Remembered
permission grants are not inherited.

Open the people control beside the direct-session composer to start, inspect,
continue, steer, cancel, or open a child transcript. The first visible profile
is `general`. It exposes exactly `read`, `write`, `edit`, `glob`, `grep`,
`exec_command`, `write_stdin`, and `read_command_output`; it cannot create goals,
launch another child, or control orchestrator sessions.

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
