# Session behaviors

Every session has one immutable persisted behavior. The web asks which behavior
to use when it creates the first chat in a project and again for every **New
chat** action. It offers **Agent** and **NAC**, preselects **Agent**, and does
not remember the previous choice. The chosen behavior is shown above the
transcript for the lifetime of the chat.

An empty-project route refreshes project and chat ownership before presenting
the required first-chat dialog. The create is also server-idempotent, so two
browser tabs that submit that required dialog concurrently converge on one
primary chat. This idempotency applies only to the required first chat; an
explicit **New chat** remains a request for another session.

The wire values are:

- `orchestrator` — NAC's established planner and worker-thread topology. It
  retains the Threads and Worksets navigation and remains the default when an
  API client or legacy database row omits `behavior`.
- `direct` — a persistent coding Agent with native file and terminal tools,
  durable goals, traditional child coding agents, and native controls for
  separate managed NAC sessions. Its primary side panel is Delegated work.
- `direct-with-orchestrator` — compatibility alias of `direct`. New chats
  no longer write this value. Existing rows keep working as Agent.

Behavior cannot be switched after creation. Start another chat to choose a
different topology. A managed orchestrator is itself an immutable
`orchestrator` session, while a traditional child inherits direct execution
internals but is recognized by its durable parent relationship. Both delegated
transcripts show their lineage and a **Back to Parent** action. Chat input is
disabled only while the current assignment is running; after settle the child
is a normal Agent or NAC. Continuation, steering, and cancellation of a
running generation remain owned by the parent workflow.

While a direct run is active, the ordinary composer remains available. **Send**
creates a durable `steer` item for the active run; **Queue Next** creates a
durable `queue` item. Pending items show their delivery mode and can be changed
or cancelled until delivery. If a steer reaches the run too late for its final
model boundary, NAC durably promotes it into successor execution rather than
dropping it.

Direct-tool approval authorizes one prepared operation on the session's already
selected execution backend; it is not a sandbox and never changes that backend.
Nested shell command bodies, unbindable redirections, and executable wrappers
are rejected when their paths cannot be authorized independently. Opaque
commands and broad shells or interpreters require explicit approval. Empty
`write_stdin` input only observes an exact process-local terminal handle;
nonempty input is a separate one-time approval because the running process may
interpret it as commands. That approval is bound to the handle's originating
session/backend and cannot create a reusable grant. Podman confinement remains
the non-bypassable filesystem and network boundary for commands that need it.
On unsandboxed Local and SSH backends, approving a broad shell, interpreter, or
opaque command authorizes trusted arbitrary code execution for that invocation.
The approval surface states this explicitly: parser-derived protected-path
denials cannot constrain code inside the approved program. Selecting Podman
preserves its stronger confinement boundary for the same invocation.
For the current portable MVP, directly parsed shell path arguments fail closed:
a pathname string cannot stay bound if another process replaces an ancestor
between authorization and OS path resolution. Use NAC's native file/search
tools, or—only when that authority is appropriate—approve broad executable
authority under the trusted-code rule above. Cargo, Git, Make, and similar
project-configured launchers are broad even when their command line contains no
path: mutable build scripts, hooks, helpers, and recipes can execute arbitrary
code. Broad and opaque approvals are invocation-only and never produce partial
remembered grants. This conservative restriction applies on every backend and
avoids presenting pathname revalidation as object-level confinement.
