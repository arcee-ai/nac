# HTTP API

Server and session lifecycle:

- `GET /health`
- `GET /store`
- `GET /sessions`
- `POST /sessions`
- `PUT /sessions/order`
- `GET /sessions/{session_id}`
- `DELETE /sessions/{session_id}`
- `PUT /sessions/{session_id}/presentation`

Conversation and runs:

- `GET /sessions/{session_id}/messages`
- `GET /sessions/{session_id}/threads/{thread_name}/events`
- `POST /sessions/{session_id}/runs`
- `POST /sessions/{session_id}/compact`
- `POST /sessions/{session_id}/steering`
- `POST /sessions/{session_id}/threads/{thread_name}/steering`
- `GET /sessions/{session_id}/events?after_sequence_id=0`
- `GET /sessions/{session_id}/events/stream?after_sequence_id=0`
- `POST /sessions/{session_id}/cancel-active-run`

Session settings:

- `GET /sessions/{session_id}/config`
- `PATCH /sessions/{session_id}/config`

Workspace, for browsing what a session changed. In a git checkout every run also freezes the tree as a revision under `refs/nac/revisions/*`, staged through a private index so the user's own index is never touched, which keeps earlier runs inspectable. Capture is a convenience: a workspace nac cannot capture still finishes its runs normally:

- `GET /sessions/{session_id}/workspace/diff`
- `GET /sessions/{session_id}/workspace/files`
- `GET /sessions/{session_id}/workspace/file`
- `GET /sessions/{session_id}/workspace/branches`
- `POST /sessions/{session_id}/workspace/branches`
- `GET /sessions/{session_id}/workspace/revisions`
- `GET /sessions/{session_id}/workspace/revisions/{revision_id}/changes`

Launch support, used by the new-session form. Saved model configurations live in the store; `POST /providers/models` forwards a key once to list the models it may use and never stores it, while `/model-configs/from-file` resolves an on-disk configuration the same way a session launch would:

- `GET /fs/browse`
- `POST /sessions/launch-defaults`
- `POST /providers/models`
- `GET /model-configs`
- `POST /model-configs`
- `POST /model-configs/from-file`
- `DELETE /model-configs/{config_id}`
- `POST /model-configs/{config_id}/models`

Stored credentials are write-only over HTTP: a caller may add, replace, or drop a key, but the value is never echoed back — only a suffix long enough to tell two keys apart:

- `GET /credentials`
- `PUT /credentials/{name}`
- `DELETE /credentials/{name}`

`nac-web` binds only to IPv4/IPv6 loopback and has no built-in authentication. Requests are refused unless the `Host` header names a loopback address or `localhost`, which blocks DNS rebinding; `Origin`, `Sec-Fetch-Site`, and CSRF are still not enforced. Tunnels and reverse proxies can expose the loopback listener remotely; their public name must be listed in `NAC_ALLOWED_HOSTS` (comma-separated, `*` disables the check), and whatever fronts the server must provide strong authentication before forwarding traffic to `nac-web`. Anyone able to reach the server is trusted.

## Session Events

Snapshot messages can be bounded with `message_limit`; only then does snapshot `include_system=true` affect the selected page and add `message_page`/`message_cycle`. `GET .../messages` pages backward with `before` and `limit` (and accepts `include_system`), while thread events page with `before_id` and `limit` and return `next_before_id`. Persisted snapshot and initial thread-event-page baselines carry `thread_event_boundary: {epoch_id, sequence_id}`; merge only later envelopes from the same epoch. SSE first reports `{epoch_id, replay_boundary_sequence_id}` and supports sequence replay within that epoch. Finite responses may be gzip-compressed; SSE is never compressed.

The store schema is version 6 and upgrades forward. Back up each store before upgrading; v6 stores must not be opened with older binaries or downgraded. Do not use mixed-version writers against one store. Parent binaries and custom worker executables must use matching releases; mixed versions are unsupported because the required `--dispatch-id` worker protocol is version-coupled. Operational tool telemetry is intentionally lossy: full tool arguments, tool results, and log/error text are omitted or sanitized before persistence and streaming. The deliberate exception is `key_arg_preview`: each tool call persists and streams a short (roughly 120-character) human-readable snippet of its key argument — the path for file tools, the command for `exec_command`, the input for `write_stdin` — so the dashboard can show what a call is doing. Snapshots, SSE, and thread-event APIs may still carry conversation or assistant content and remain sensitive, as do canonical message APIs. Snapshot metadata omits extra-header values; `GET /sessions/{session_id}/config` is the authoritative, sensitive repair view.
