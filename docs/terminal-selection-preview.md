# Reviewed terminal selections

The version-1 preview API validates a finite, user-supplied rendered selection.
It does not authenticate a process-log interval or ingest retained scrollback.
An explicit identified submission endpoint admits reviewed evidence to the
existing durable inbox. In a direct primary chat, open the Terminal panel, select
visible text, and choose **Review selected text**. The pane captures the actual
xterm selection at that explicit action; it never reads the clipboard or shares
the rest of the output.

`POST /sessions/{session_id}/user-terminals/{terminal_id}/selection-preview`
uses the existing authenticated HTTP client and mutation Origin admission. The
request supplies `protocol_version: 1`, a hyphenated UUID `capture_id`, `selected_text`, an optional literal `user_text`, and
an optional decimal-string `client_capture_time_ms`. The capture identity and
time are client claims; they grant no execution or session authority.

The server requires an existing cached direct-primary service and the exact
human terminal incarnation belonging to it. It never attaches/resumes a session
or wakes durable work to render a preview. Unknown, wrong-session, old-owner and
pruned sources have the same opaque unavailable response. An exited terminal
remains a valid source while its existing bounded completed record remains.
Its immutable launch secret patterns accompany that record and are discarded
with it; they are not serialized, persisted or fetched from current credentials.

Normalization converts CRLF and CR to LF, preserves LF/TAB, and removes other
Unicode control characters (`char::is_control`). This is plain-text projection,
not VT escape interpretation or screen reconstruction. The exact same projection
is applied privately to launch secret patterns, retaining both raw and projected
patterns for masking. This covers values assembled by removed controls and
control-bearing credential values. Both input and final output must fit 32 KiB
of UTF-8 and 8,192 Unicode scalar values. Whitespace-only results and over-limit
results are rejected. There is no silent truncation.

The response attributes `user_supplied_rendered_selection` to the authoritative
session, terminal and process owner, provides canonical text and byte/scalar
counts, reports control/line-ending transformations, repeats the optional client
time claim, and records the server's preview time separately. Preview writes no
server draft, inbox item, transcript entry, or model run. Output outside the
submitted selection, arriving later, or evicted from retention cannot expand it.
No command, exit status or execution authority is inferred from selected text.
Slash commands and skill references remain literal evidence.

A local draft keeps the frozen originals beside the reviewed canonical selection
and optional accompanying text. `POST .../selection-submissions` submits one
explicit intent with a stable `admission_id`, capture/source owner, originals,
exact expected canonical fields, and an explicit delivery choice. Original text
is re-normalized under the retained launch policy before first admission. It is
never durably stored or included in the fingerprint. The server does not trust
a `sanitized` flag or re-mask canonical text: fixed `[REDACTED]` markers can
contain configured patterns, so masking is not assumed idempotent.

Migration 33 adds nullable admission identity/digest to the existing inbox and a
session-scoped unique index. Legacy inbox records and APIs keep their serialized
shape. The immutable digest binds reviewed canonical text, source/capture claims
and original delivery choice. A typed JSON evidence envelope preserves leading
and trailing text boundaries despite the outer inbox trim. Selected and user
text remain literal, including slash, skill and MCP-looking tokens.

`send` requires an idle local session, its cross-process operation lease, and no
older pending inbox work. `queue` follows existing FIFO semantics, including
starting while idle. `steer` binds an exact non-finishing local run; accepted late
steers retain existing successor promotion. Receipt status/current delivery are
separate from immutable accepted intent. Existing revision-checked delivery
edits and cancellation preserve its content and fingerprint.

Matching scoped receipts are reconciled before checking ephemeral source
liveness, so a lost reply can be reconciled after prune/restart. Reconciliation
retains current session/host access checks and never attaches, wakes, creates a
run, resurrects cancelled work or re-delivers. New identities require the exact
cached source and matching preview. No automatic HTTP retry is performed: keep
the same identity for deliberate reconciliation after uncertainty. Bounded owned
admission jobs retain lifecycle/host/work guards through commit and creator-only
wake even if the HTTP request disconnects. The request wire body is limited to
256 KiB; original and canonical fields each retain the stated text bounds.

The review is a local, immutable capture. Its original selected text stays in the
private controller until submission or dismissal; it is not stored in a browser
cache, server draft or parallel context store. Only the server-normalized preview
is displayed. Optional accompanying literal text requires **Update preview**
before sending. **Dismiss review** and **Clear selection review** discard an
unsent draft without waking an agent. Changing the terminal display or receiving
more output does not replace a capture already being reviewed.

The dialog offers idle Send, FIFO Queue and an explicit displayed-run Steer.
Choosing Steer freezes that exact run ID. A changed run disables that choice until
the user explicitly selects the displayed run or another delivery option. An
exited source can remain valid in bounded history; a currently unavailable source
disables a new send. An unconfirmed submission freezes the identity and full
reviewed intent. **Retry same submission** performs deliberate reconciliation;
there is no automatic retry or silent retargeting. Dismissing an unconfirmed
submission does not cancel work the server may have accepted.

Canonical history retains every exact attribution verified by the identified
inbox-delivery transaction. Included fork prefixes copy those annotations with
the original source identities; forks do not copy pending inbox work, receipts or
terminal capabilities. Plain or copied lookalike evidence text grants no typed
attribution. The message bytes and old unannotated records keep their existing
shape.

Compaction keeps a metadata-only manifest with at most four exact recent source
references, a streaming count/digest and an explicit omitted-reference notice.
The digest cannot reconstruct older identities. Canonical history retains them;
the finite model context does not promise that every old identity remains visible.
Summary and manifest share the available budget, optional references are omitted
whole, and checkpoint/source validation binds the manifest to genuine canonical
annotations. Ordinary chats with no selection keep their existing defaults.
Selected terminal output and accompanying text remain untrusted user evidence,
never tool authorization or automatic approval.
