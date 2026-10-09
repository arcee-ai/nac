# Terminal selection preview foundation

The version-1 preview API validates a finite, user-supplied rendered selection.
It does not authenticate a process-log interval or ingest retained scrollback.
The actual renderer selection adapter and explicit durable submission remain
separate unfinished ALL-142 work. There is no selection UI or agent-input
submission in this foundation.

`POST /sessions/{session_id}/user-terminals/{terminal_id}/selection-preview`
uses the existing authenticated HTTP client and mutation Origin admission. The
request supplies `protocol_version: 1`, a hyphenated UUID `capture_id`, `selected_text`, and
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
time claim, and records the server's preview time separately. It writes no
server draft, inbox item, transcript entry, or model run. Output outside the
submitted selection, arriving later, or evicted from retention cannot expand it.
No command, exit status or execution authority is inferred from selected text.
Slash commands and skill references remain literal evidence.

A future local draft must keep its frozen original beside the reviewed canonical
preview. On deliberate submission, the server must normalize that original
under the same bound policy and compare the exact expected preview before
identified durable admission. It must not trust a `sanitized` flag or sanitize
the canonical preview repeatedly: fixed `[REDACTED]` replacement markers can
contain a configured secret, so masking is deliberately not assumed idempotent.
A future admission identity belongs to the existing durable inbox/append owner,
not this preview or a parallel context store. A capture ID is not yet an
admission receipt and provides no exactly-once submission guarantee.

Renderer selection, accessible local preview/dismiss/clear/Send controls,
visible idle/busy delivery choice, durable admission identity and compaction/
fork/history delivery evidence remain required before full ALL-142 acceptance.
