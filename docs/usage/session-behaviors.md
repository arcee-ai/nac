# Session behaviors

Every session has one immutable persisted behavior. The shipped web UI defaults
to a persistent direct coding agent: every creation entrypoint sends explicit
`behavior: "direct"`, and orchestration choices, Threads/Worksets, managed
orchestrator controls, mode badges, and unused light-model controls are hidden.
Direct Files/History, traditional children, permissions, goals, queueing,
compaction, tool results, and local/SSH/sandbox/managed execution remain available.
Hidden light-model settings and saved presets are preserved; direct light-model
execution remains deferred.

To restore the established three-mode UI, start the same binary with
`NAC_ORCHESTRATION=1`. Exactly `1` enables orchestration; `0` or an unset variable
selects direct-only presentation. Aliases such as `true` and `enabled`, blank
values, whitespace, and other values fail closed with a startup and browser
configuration diagnostic. Change the environment, restart nac-web, and reload
the browser. No frontend rebuild is required. The server captures this setting
when it builds its router and exposes it through `GET /ui-config`; endpoint-aware
clients consume the same typed bootstrap. Creation is unavailable while that
endpoint's configuration is loading or failed, with an explicit retry on failure.
Vite development previews proxy the same route to the configured API server.

With orchestration enabled, the web asks which behavior to use for each first
and New Chat action, preselects **NAC orchestrator** on each modal opening, and
shows the chosen mode above the transcript. Existing orchestrator/hybrid/managed
sessions keep their IDs, data, behavior, and lineage. Direct-only navigation
excludes them; deep links show an unavailable view with **New direct chat**.
Enabling orchestration restores access. This presentation setting changes no
tool authorization, backend, inbound MCP exposure, or legacy REST defaults.

An empty-project route refreshes project and chat ownership before presenting
the required first-chat dialog. Concurrent required-first-chat submissions
converge on one primary chat. Direct-only UI additionally sends the additive
`first_chat_same_behavior: true` so a legacy session created during that race
cannot become its result. Omitted/false retains the existing API semantics of
returning the newest primary session regardless of behavior. Projects containing
only hidden legacy sessions use ordinary New Chat creation (`first_chat: false`)
instead. Explicit New Chat always remains a request for another session.

The wire values are:

- `orchestrator` — NAC's established planner and worker-thread topology. It
  retains the Threads and Worksets navigation and remains the default when an
  API client or legacy database row omits `behavior`.
- `direct` — a persistent coding agent with native file and terminal tools,
  durable goals, and traditional child coding agents. Its primary side panel is
  Delegated work rather than empty orchestrator Threads or Worksets.
- `direct-with-orchestrator` — the same direct coding agent plus native controls
  for separate managed NAC orchestrator sessions. Delegated work keeps
  traditional coding agents and managed orchestrators in distinct sections.

Behavior cannot be switched after creation. Start another chat to choose a
different topology. A managed orchestrator is itself an immutable
`orchestrator` session, while a traditional child inherits direct execution
internals but is recognized by its durable parent relationship. Both delegated
transcripts show their lineage and a **Back to Parent** action. They are
read-only in the web MVP: continuation, steering, and cancellation remain owned
by the parent workflow, and a traditional child cannot create an autonomous
goal.

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
