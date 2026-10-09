# Human terminal execution and observation

## Decision

A human terminal belongs to the selected direct primary session and its
construction-time execution backend. Its shell, retained sanitized output and
resource leases outlive browser observation. Model execution and human input
use separate capabilities: the model registry cannot launch, preview or type
into a human terminal. Human launch runs through the existing tool kernel,
canonical workspace binding, permission broker and configuration revalidation.
Approval does not change the selected backend.

Use a versioned HTTP pull protocol for browser observation, through the native
typed client. Each observer holds at most one sanitized frame until the renderer
acknowledges processing it. This supplies explicit backpressure using the
existing endpoint, authentication, request cancellation and browser admission
boundaries. It does not require a second WebSocket authentication or transport
owner. A finite read waits at most one second; acknowledgement uses POST so
Origin and Fetch Metadata mutation checks apply.

## Ownership

| Responsibility | Owner |
| --- | --- |
| Backend selection, policy, launch authorization, configuration fencing | Core session service and tool kernel |
| PTY process, literal input queue, actual geometry, descendant cleanup | Core terminal manager |
| Exact-value streaming redaction before retained output is appended | Command environment snapshot and PTY collector |
| Process identity and bounded completed-shell history | Core terminal manager |
| Scoped observer seats, pending frame, acknowledgement cursor | Server terminal observation application |
| Versioned DTOs, decimal cursor strings, HTTP status mapping | Server delivery |
| Endpoint, credentials, cancellation, observation and renderer completion ordering | Native typed client |
| Renderer, focus, geometry measurement and human interaction | Browser terminal feature |

The core output page is raw sanitized bytes. No delivery layer converts them to
text or interprets key names. The input capability accepts literal bytes with a
16 KiB limit and a bounded worker queue; a queue-full rejection is distinct from
accepted delivery whose completion could not be confirmed. Neither outcome
authorizes automatically replaying input. Launch authorizes continuing human
interaction, rather than treating Enter as a per-command permission decision.

## Observation and lifetime

Observers bind a session, a current process handle and a negotiated page size
of at most 64 KiB. The server admits at most four observers per terminal and
32 per server owner. Seats expire after 30 seconds without a request; attach
reclaims expired seats. A second concurrent read receives a bounded busy
response instead of joining a request queue.

A frame awaiting acknowledgement is immutable, including its process and
collector status. An exact acknowledgement advances only that observer's
cursor. Repeating the last accepted acknowledgement permits recovery from a
lost HTTP reply without advancing twice. Cursors are decimal strings on the
wire, preserving the complete unsigned 64-bit range in JavaScript. Shell exit
and output collection completion remain separate facts. Completion is sampled
before paging so confirmed EOF includes the collector's committed final append.

Retention gaps carry no bytes. The renderer must reset before acknowledging a
gap and then consume the retained tail; silently joining the tail to an old
screen is forbidden. A replacement observer likewise starts a fresh replay
after an explicit renderer reset. A parser callback, rather than receipt of the
HTTP response, determines when a data frame may be acknowledged.

Detaching, request cancellation, browser navigation and observer expiry release
observation only. Explicit terminal termination uses the existing session-bound
terminal lifecycle operation. Terminal handles contain the manager's process
identity and are never reused for a new process, including when bounded launch
history expires. Restart leaves old observers and terminal handles unavailable;
this protocol does not claim durable PTY recovery or save a transcript in the
conversation.

Graceful server shutdown explicitly settles session-owned terminals after model
operations finish and before persistence drains. Observer or client clones cannot
defer that settlement to object destruction. Failed remote cleanup retains its
ownership and retries within the existing complete-shutdown watchdog; the store
is not drained while cleanup still needs its durable authority.

## Compatibility and extension

Existing model terminal behavior, preview cursors and public session vocabulary
remain unchanged. The common foundation supports Local direct primary sessions.
SSH terminal fidelity and managed-host admission are separate successors;
neither approval nor this protocol selects a fallback backend. Managed support
must compose its own readiness, ownership, maintenance and credential boundaries
before enabling launch or input. Browser renderer adoption remains a separate
dependency and license decision.
