# Session terminal execution, observation and control

## Decision

A human terminal belongs to the selected direct primary session and its
construction-time execution backend. Its shell, retained sanitized output and
resource leases outlive browser observation. Model execution and human input
use separate capabilities. Human launch requires service-issued intent; explicit
current-chat execution reads and revision-fenced input control use the distinct
contracts below. Human launch runs through the existing tool kernel,
canonical workspace binding, permission broker and configuration revalidation.
Approval does not change the selected backend.

Authenticated human-initiated product operations never enter the agent approval-
request lifecycle. Exact human shell submission and terminal launch use separate
non-deserializable service-issued intent capabilities through the prepared
kernel. Hard/configured Deny, canonical binding and post-policy revalidation,
session/configuration/host ownership, native preflight and selected-backend
admission remain effective. Human intent skips Ask only after policy, without
changing approval mode or saving grants. Agent opaque execution and nonempty
stdin keep ordinary authorization.

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
| PTY adaptation, literal input queue, actual geometry and lifetime leases | Core terminal manager |
| Native Local session census, retained child identity and cleanup/reaping | Shared process infrastructure |
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

Normal attach/reconnect accepts only fresh focused input and sends no automatic
bytes. The browser producer accepts public trusted keyboard, paste, composition
and pointer events; parser-generated terminal replies have no human intent.
Actual accepted-but-unconfirmed delivery freezes input until explicit recovery
acknowledgement; old bytes are never replayed. A bounded, runtime-owned recovery
cell survives view replacement and reconnect for the exact session/source
incarnation. It stores uncertainty, never input bytes. Capacity saturation keeps
new input read-only instead of evicting an unresolved failure. Acknowledging an
ended source clears the uncertainty fact without granting input. Runtime disposal
ends the cell's lifetime. This is delivery recovery, not agent permission.

Human artifacts share the session's bounded output budget, but are excluded
from model text paging and previews at artifact creation. That exclusion
survives shell exit and terminal-history eviction; knowing an artifact ID does
not admit its output to the model. Explicit selection admission is separate.

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
The `alive` status describes unresolved terminal ownership: it remains true
after shell-root exit while native process cleanup is pending, and `exit_code`
is withheld until cleanup and direct-child reaping settle. `output_complete`
still describes only collector EOF and may be true during pending cleanup.
Input and resize require cached shell-root liveness independently of this
ownership status. Inspection failures retain a live blocker and make explicit
close fail; they do not become collector output errors.

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

Local human PTYs transfer their exclusive, unreaped native child to the process
owner after successful fresh-session spawn. The unreaped leader fences its
session identifier while cleanup discovers ordinary and disowned job groups in
that owned session. Member signals use captured platform identities; scans,
signaling and waits run outside terminal observation locks. Inspection or signal
failure retains the same child, known members and lifetime leases for retry,
including after manager destruction. Cached status and maintenance snapshots do
not wait for process-table work, and incomplete cleanup cannot free capacity.
Active census prunes captured members only after their exact identity is
conclusively dead; pending ancestry obligations retain their own parent identity.
The macOS census inspects all PIDs with bookended session and unique-identity
records so changing user identity alone cannot exclude owned-session work.
Potential ownership that inspection cannot resolve remains a retryable cleanup
blocker without granting signaling authority over an uncertain PID.

New Local human launches preflight Linux pidfd support or the macOS runtime
identity-inspection and audit-token signal capability. An unavailable capability
rejects that launch without changing model-terminal or general NAC OS support.
This owner is process-local, without native PTY restoration or hard-crash
cleanup guarantees. Discovery can retain observed descendants that change
sessions; rapid descendants that clear their environment and create a new
session between scans remain an explicit containment limitation. An inherited
SSH login session never grants this native owned-session authority.

## Existing executions, deliberate reads and history

A session-scoped process registry exposes existing human PTYs, agent PTYs and
one-shot command pipes with immutable source identity, origin and representation.
Listing, opening and reconnecting observations do not launch, rerun, retain,
wake or recover work. Pipes remain log views. Cached process ownership and
collector completion are distinct: confirmed descriptor EOF can complete output
while the process remains running; losing the owner marks cleanup pending and
removes Stop independently of that EOF fact. Native root liveness fences input
and resize even when cleanup ownership remains unresolved.

The collector applies the source's immutable launch redaction policy before
retained bytes exist. PTY policy also recognizes the standard LF-to-CRLF terminal
translation of exact secret values. This is not a promise to reverse arbitrary
terminal transformations. Observer status is an immutable receipt, never current
input authority. If output expires while a frame is held, the same unexpired
observer and current owner may replay only that already-held frame until ACK or
seat expiry. A new page, observer or replacement owner cannot read expired output.

A model in the current direct primary chat may deliberately list bounded execution
metadata and read or search bounded sanitized output by execution ID through
ordinary prepared tool policy. Binding validates the current store, session,
configuration and selected backend before reading bytes. This adds no automatic
prompt injection, wake, input authority, retention or recovery. Legacy raw human
artifact IDs remain excluded from model paging and previews, including after exit
or pruning. Explicit selection admission remains separate.

Recent execution history separates bounded process-local metadata and retained
output from durable exact-command outcomes. Evicted metadata, expired output and
process-local loss after restart are stated honestly; absence cannot prove a
historical process outcome. Durable command previews remain independent. A shell
terminal's continuous stream does not invent command boundaries. History reads
and its UI consume passive availability and do not reconcile command journals.
Reopening history is explicitly read-only even when its ID still refers to a live
source; retained state remains factual, while input, resize, Stop and control
handoff are suppressed.

## Explicit input controller

Only qualified Local direct-primary human PTYs and already-retained agent PTYs
can share input. Pipes, foreground non-retained agent executions, ended sources
and lost/replaced handles cannot gain sharing authority. Handoff neither retains
nor converts an execution, changes its lifetime, nor selects another backend.

One logical controller and monotonically checked decimal revision bind input to
an exact process incarnation. Explicit give, reclaim and recovery acknowledgement
compare the expected revision and advance it, including same-controller actions.
Private service-issued human control intent skips Ask only after deterministic
Deny and binding checks; granting ongoing human input additionally checks input
Deny. Giving control to the agent grants no model-policy bypass. Model stdin
captures its private ticket before ordinary prepared policy, revalidates after
approval and fences again at physical writer admission. Queued and future stale
packets are rejected. Human bytes remain literal; model key-token parsing retains
its established behavior.

Already-active bytes cannot be retracted. The server exposes in-flight or unknown
delivery honestly and freezes fresh shared input until deliberate acknowledgement
can succeed. Revision or source replacement discards queued browser bytes without
replay. Browser activation binds source, live/history mode, current capabilities
and controller revision, while preserving the runtime-owned uncertainty cell.
An immutable pending output frame cannot enable input. Untouched revision-one
human input preserves the initial browser recovery contract; legacy unversioned
input is rejected after an explicit controller transition.

## Compatibility and extension

Existing model terminal behavior, preview cursors and public session vocabulary
remain unchanged. The common foundation supports Local direct primary sessions.
SSH terminal fidelity and managed-host admission are separate successors;
neither approval nor this protocol selects a fallback backend. Managed support
must compose its own readiness, ownership, maintenance and credential boundaries
before enabling launch or input. Browser renderer adoption remains a separate
dependency and license decision.

## Explicit selection evidence

Selection preview accepts bounded user-supplied rendered text, not an
authenticated retained-output interval. It applies the source's immutable launch
redaction policy after plain-text normalization, including normalized forms of
control-bearing secret values. Original and canonical preview text are distinct:
masking is not assumed idempotent. Preview has no durable draft or model effect;
submission revalidates the original against the exact expected preview.

An explicitly submitted selection uses the existing identified durable inbox
admission and literal delivery owners. Its immutable identity binds the exact
canonical selected text, optional accompanying literal text, source/capture
metadata and initial send/queue/exact-run steer choice. A receipt-first replay
checks current session/host access and immutable intent, reports current status,
and never creates another admission or wakes a model. Only the creator may wake;
reconciling a lost local acknowledgment preserves that authority only after a
positively successful commit. A matching receipt after an unknown COMMIT failure
cannot prove creator ownership, since rolled-back integer allocations can be
reused. Ordinary inbox input keeps its established preparation behavior.

Genuine identified inbox delivery stamps an optional typed attribution on its
canonical transcript-log wrapper in the same transaction as the exact User
message and delivered status. A copied prefix or JSON lookalike receives no
annotation. Legacy Message variants and canonical User bytes remain unchanged.
Visible history returns exact typed references by absolute canonical index,
including the system head. Included fork prefixes copy verified attribution
without rebinding its original source, copying inbox records, or granting a
terminal capability. Excluded prefixes carry no references.

Canonical history retains every attribution. Compaction recomputes a streaming
count/hash over the covered canonical prefix and keeps at most four recent
exact references in a versioned metadata-only manifest. The manifest is at most
4 KiB and shares the available replacement budget with the generated summary;
optional references are removed whole before rejecting an oversized result.
Selection-only summary requests reserve the exact minimum manifest and wrapper
before stating the remaining UTF-8 summary budget. A noncompliant oversized
summary is rejected without truncation. When even minimum framing plus a
nonempty summary cannot fit, the existing explicit SummaryRejected outcome
occurs before a model request and the normal run keeps its canonical view.
The explicit omitted-reference count says older identities remain in canonical
history; the digest cannot reconstruct them. Model-written narrative cannot
supply or rebind this deterministic metadata. Checkpoints, source validation and
context samples bind the typed attribution. Normal no-selection prompts,
checkpoint versions and provider projections keep their existing defaults.

The browser keeps explicit local capture, preview, submit and cancel under the
selection feature owner. Frozen attachments show typed canonical attribution;
copied prefixes and JSON lookalikes cannot manufacture provenance. Filtered
System rows must retain their original canonical positions when joining evidence,
including paged and forked history. Neither attachment display nor a retained
historical source grants current input or live terminal authority.
