# Direct sessions

The web UI starts a persistent direct coding agent. Direct chats support native
file and terminal tools, traditional child agents, durable goals, Insights,
permissions, compaction, and Local, SSH, Podman or managed-host execution.
A session keeps its behavior after creation.

Traditional children have their own transcripts and generations and share the
parent workspace. See [child sessions](traditional-children.md).

While a direct run is active, the ordinary composer remains available. **Send**
creates a durable `steer` item for the active run; **Queue Next** creates a
durable `queue` item. Pending items show their delivery mode and can be changed
or cancelled until delivery. If a steer reaches the run too late for its final
model boundary, NAC durably promotes it into successor execution rather than
dropping it.

Direct-tool approval authorizes one prepared operation on the session's already
selected execution backend; it is not a sandbox and never changes that backend.
Nested shell command bodies, unbindable redirections, and executable wrappers
are rejected when their paths cannot be authorized independently. Agent opaque
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

Human product actions retain a separate trusted intent. In a supported direct
primary session, **New shell** and exact human `!` commands skip agent approval
requests even in Manual mode. Hard/configured Deny, authentication/ownership,
configuration and selected-backend admission still apply; agent mode and grants
remain unchanged. Ordinary shell reattach accepts fresh focused typing without
another enable step. Actual unconfirmed input freezes until explicit recovery
acknowledgement and is never replayed automatically. See [permissions](permissions.md).

Explicitly reviewed terminal selections appear as frozen **Terminal selection**
attachments in direct chat history and pending input. Expand source/capture details
to inspect provenance, or **Canonical message** to inspect the exact stored evidence.
Copied text receives no verified attachment. Forked evidence retains the original
source and grants no live terminal access. See [reviewed selections](../terminal-selection-preview.md).
