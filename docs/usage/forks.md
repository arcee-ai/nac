# Conversation forks

Fork a chat from any assistant turn. The new session is independent: same workspace, model, project, immutable behavior, light model, and compaction threshold, with the transcript copied through that turn (plus trailing tool results). Billed spend stays with the source; the fork starts at zero cost so project rollups do not double-count the copied transcript.

## Dashboard

On a model reply, use **Create fork**. nac opens a new chat titled `Fork: <source title>` (capped at 120 characters). Markers on the source turn link to those forks. Dismissing a marker only removes the link; it does not delete the forked session.

The fork inherits context but not spend. The context-window gauge can still look full because the last inherited context-token reading is kept (input/output/cache/cost buckets are zeroed).

Behavior is copied, not reset. A direct (or direct-with-orchestrator) source stays that kind of top-level agent; the fork does not silently become an orchestrator.

Resend and revert work on the copied conversation: inherited messages after the system head are written to the transcript log (never-fold), not left only in the write-once blob.

Delegated sessions (traditional children and managed orchestrators) cannot be forked from this boundary. The parent owns every continuation, cancellation, deletion, and conversation derivation; the public fork route returns 404, same as an unknown id.

## HTTP

```http
POST /sessions/{session_id}/fork
Content-Type: application/json

{ "message_idx": 4 }
```

`message_idx` is the transcript index of an assistant message. Trailing tool results that belong to that turn are copied with it. Success returns `{ "session_id": "<new id>" }`.

- 400 if the index is not an assistant message or is past the transcript
- 404 if the source session is missing or is a delegated child/orchestrator
- 409 if the source has an active run or operation lease (`session is busy`)

```http
DELETE /sessions/{session_id}/forks/{fork_id}
```

Returns 204. 404 means the marker is already gone.

## Constraints

- The source must be idle.
- A fork does not clone a sandbox worktree (that is a git checkout, not a chat). Sandbox spec `worktree` is cleared; the next sandbox launch creates a fresh worktree.
- Failed persist rolls back: the new session is deleted and no `session_forks` tombstone is left.
- Forks created before the zero-spend fix (#221) are not migrated; their copied usage can still inflate project totals.
