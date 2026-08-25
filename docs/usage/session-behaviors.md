# Session behaviors

Every session has one immutable persisted behavior. The web asks which behavior
to use when it creates the first chat in a project and again for every **New
chat** action. It preselects **NAC orchestrator** each time and does not remember
the previous choice. The chosen behavior is shown above the transcript for the
lifetime of the chat.

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
