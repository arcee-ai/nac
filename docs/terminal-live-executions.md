# Watching existing executions

In a direct primary chat, the Terminal panel lists the chat's human shells,
agent PTYs, agent pipe commands, and exact human `!` commands. The source picker
shows their origin and process status. The selected source also shows its working
directory, backend and output-collection status.

| Source | Display | Human controls | Lifetime |
| --- | --- | --- | --- |
| Human shell | Interactive terminal | Literal input, resize and Close shell | Session-owned shell, independent of model runs and browser attachment |
| Agent PTY | Existing terminal renderer | Observation and supported Stop | Existing model command; only explicit model retention lets it survive direct run settlement |
| Agent pipe | Literal text log | Observation and supported Stop | Existing noninteractive command with closed stdin and its original deadline |
| Human `!` command | Literal text log | Observation and supported Stop | Existing exact command admission; busy rejection and durable outcome rules still apply |

Selecting, focusing, reconnecting or leaving a source does not launch it again,
retain it, extend its deadline, create a shell or start a model turn. **New shell**
is a separate intentional launch. Stop targets the selected execution rather
than stopping unrelated terminals or the whole model run. Agent executions are
initially read-only to humans; shared PTY control is a separate capability.

Unconfirmed human input remains frozen when switching sources or remounting the
panel. Acknowledgement clears that delivery uncertainty without retrying bytes;
it enables fresh typing only while the selected source has connected live input.

A settled process and a completed collector are separate facts. Output can still
be arriving after process settlement. Cleanup can remain unresolved even after
collector EOF; the pane reports cleanup pending rather than claiming that the
execution has settled. Read-only pipes never become interactive PTYs.

A legacy agent PTY can report cleanup pending after its root exits while its
original owner still holds unreaped process or terminal resources. Viewing
does not reap or kill that owner. Stop remains available; the final exit code
appears after explicit owner cleanup.

Output is sanitized under the private environment policy captured when the
execution launches, before it enters shared bounded retention or live delivery.
The PTY policy also captures the standard LF-to-CRLF output form of each value.
Changing credentials affects new executions. Existing output is not masked again
when replayed, paged or rendered; replacement markers are canonical output.
Pipe sanitization checks each stream and their observed combined order while
retaining stdout/stderr identity. A stalled secret prefix can cause conservative
masking when the finite sanitizer buffer fills. Only confirmed EOF flushes a
safe incomplete suffix; read failures discard uncertain pending bytes.

PTY output retains terminal byte semantics. Pipe logs are inert text: terminal
control characters are shown as escapes, invalid UTF-8 is displayed safely,
and output cannot create HTML elements or links. The browser's text log is bounded.

Independent observers use the existing finite ACK protocol. Each seat holds one
immutable frame until the renderer finishes processing it. Pages are at most
64 KiB, waits at most one second, and cursor strings preserve the full unsigned
64-bit range. Four observers per source and 32 per server owner are admitted;
idle seats expire after 30 seconds. Retention gaps reset the display before
replaying the retained tail. Detach and request cancellation release observation
without terminating an execution.

A valid observer seat keeps its already-delivered unacknowledged page through
source eviction until ACK or seat expiry. This supports receipt recovery; an
expired source still denies new observers and new pages.

Catalog and observation reads use cached session owners and existing process
records. They do not attach/resume sessions, reconcile the shell journal, acquire
the model mutex, advance model preview cursors or restore expired output. Browser
reads require a session-bound execution handle; a raw output artifact ID is not
a browser capability. Wrong-session, expired and previous-owner handles have the
same opaque unavailable response.

Full process/output ownership remains process-local. Restart does not restore
these executions or their full logs. Durable human-command outcomes retain their
existing separate history. This slice preserves direct-primary, authentication,
Origin/Fetch Metadata, ownership/configuration, managed-host and backend gates.
Human Local PTY support does not enable human SSH or Podman terminals. Remote
and hosted qualification remain separate coverage lanes.
