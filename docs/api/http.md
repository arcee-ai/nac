# HTTP API

The HTTP contract is generated from the Rust handlers and types in the running `nac-web` process. To review the current state of the API, start the server, then use the live docs:

```sh
nac-web
```

With the default bind, that is [http://127.0.0.1:3210/docs](http://127.0.0.1:3210/docs) for the embedded Swagger UI and [http://127.0.0.1:3210/openapi.json](http://127.0.0.1:3210/openapi.json) for the OpenAPI 3.1 document (`GET /docs` and `GET /openapi.json` on whatever host and port you chose).

## Health and SQLite capacity

`GET /health` is a readiness check for session-serving traffic. It returns
HTTP 200 with `{"status":"ok"}` only when nac-web can open the configured
SQLite store and query its required session schema. Store capacity, open, or
schema failures return HTTP 503 with `{"status":"unavailable"}`; the response
does not expose the store path or SQLite diagnostic.

SQLite connections are operation-scoped rather than owned by cached sessions.
Each nac process admits at most 32 opening or checked-out SQLite connections,
with at most four targeting the same canonical store. Capacity waits are
bounded. These limits are internal and intentionally not configurable, leaving
descriptor headroom under the common 256-descriptor process limit.

## Projects

Projects are explicit, store-scoped records exposed by `GET /projects`,
`POST /projects`, `PATCH /projects/{project_id}`, and
`DELETE /projects/{project_id}`. A project owns one canonical local directory or
one canonical directory on an SSH connection, plus a name, optional description,
and optional saved model configuration. Creation canonicalizes local paths and
verifies remote paths with the same SSH directory browse used by session launch.
Canonical location duplicates return 409. Remote errors retain their existing
classes: invalid or non-directory paths return 400, unreadable paths 403,
missing paths 404, and transport or remote-command failures 502. A create that
omits `name` derives one from the checkout's origin remote (`owner/repo`) for
local locations, and falls back to the directory name.

`POST /sessions` accepts an optional `project_id`; `GET /sessions` accepts the
same field as a filter. Selection is explicit—NAC never infers a project from
`cwd`. A project-selected create must not also send a nonblank `cwd` or SSH
location field, and an SSH project cannot use sandbox options. Each session
belongs to at most one project. Project location is immutable.

The web marks the required first chat with `first_chat: true`. This flag
requires `project_id` and is an idempotent admission: concurrent first-chat
requests for the same empty project return the same newly created primary
session. If a primary chat already exists, its snapshot is returned instead.
Ordinary **New chat** requests omit the flag and always create another session.

`POST /projects/{project_id}/sessions` assigns an already-created session, whose
`session_id` is the only body field. Membership is written once: a session that
already belongs to a project returns 409, and so does one whose working
directory and SSH tuple are not the project's location. There is no move or
historical-backfill API, so reassignment requires no membership to exist yet.

`DELETE /projects/{project_id}` releases rather than destroys. Its sessions keep
their transcripts and reappear as unassigned, and the response lists them in
`released_session_ids`. Pass `?sessions=delete` to take them down with the
project instead; they are deleted one by one before the project row goes, and
the response lists them in `deleted_session_ids`. A session that refuses to be
deleted fails the whole request with the project still standing, so the rest are
never left orphaned.

Projects carry the same presentation fields as sessions: `pinned`, `sort_order`,
and `presentation_version`. `PATCH` toggles `pinned`, which moves the project to
the end of the target pin group and bumps the version. `PUT /projects/order`
rewrites one pin group; the request must list every project in that group
exactly once and carry each current `presentation_version`, otherwise it
returns 409 rather than reordering a set that has since changed.

The selected project ID appears in session summary and detail metadata.
Project model defaults are copied into a new session, not read live. Later
project edits affect only later sessions, and resume uses the session snapshot.
Deleting a saved model configuration still referenced by a project returns
409 and retains both the configuration and its credentials.

## Direct goals

`GET /sessions/{session_id}/goal` returns the current durable goal or JSON
`null`. `POST /sessions/{session_id}/goal` creates an active generation from an
`objective` and optional positive `token_budget`. It fails while another
unfinished goal exists. `PATCH /sessions/{session_id}/goal/{goal_id}` uses
`expected_version` for optimistic concurrency and can edit `objective`, set or
clear `token_budget`, or set a user/system status. `DELETE` on the same path
takes `expected_version` and clears the goal. These endpoints reject
orchestrator sessions and delegated traditional children.

Goal responses include the generation ID, six-state status, accumulated
`tokens_used` and `time_used_ms`, optional budget, current run/continuation
claim, timestamps, and version. The API accepts `active`, `paused`, `blocked`,
`usage_limited`, and `budget_limited` as user/system status controls; users
clear rather than setting `complete`. The model's native `update_goal` tool is
the path that marks genuine completion or blockage.

Goal creation during a run owned by another NAC process returns `409 Conflict`.
The server never creates an unbound goal or guesses a cross-process mid-run
token baseline.

## Session behaviors and direct inbox

`POST /sessions` accepts `behavior` as `orchestrator`, `direct`, or
`direct-with-orchestrator`. It is persisted and immutable. Omitting it selects
`orchestrator` for compatibility. Session summaries and detail metadata expose
the value. A delegated session detail response also includes `lineage` with a
`traditional-child` or `managed-orchestrator` kind, parent and root session IDs,
and the immutable relationship description.

Direct parents expose their durable input at `GET /sessions/{session_id}/inbox`
and `POST /sessions/{session_id}/inbox`. A create body contains `delivery`
(`steer` or `queue`) and `prompt`. Pending items can change delivery through versioned
`PATCH /sessions/{session_id}/inbox/{item_id}` or be cancelled with versioned
`DELETE` on that path. A steer targets the current non-finishing run when one
exists; otherwise it participates in the same successor queue as ordinary
queued input. These routes reject orchestrator and delegated-child ownership.

## Traditional child sessions

`GET /sessions/{session_id}/children` lists the durable children of a direct
parent. `POST` on the same path starts a new `general` child or continues the
`child_session_id` in the body. The request includes the immutable short
`description`, a complete `prompt`, and optional `background` (default false).
A foreground request waits for settlement; a background request returns the
running relationship immediately.

`GET /sessions/{session_id}/children/{child_session_id}` reads one owned child.
`POST .../cancel` propagates cancellation to its active generation. Responses
include generation, run and execution mode, terminal report or failure,
workspace change and verification summaries when available, the durable parent
completion inbox ID, timestamps, and version.

These endpoints reject orchestrator parents, grandchildren, mismatched parent
ownership, changes to a child's profile or description, sandboxed sessions
without a host-backed shared workspace, and more than four simultaneously
running children per root parent.

## Managed orchestrator sessions

`GET /sessions/{session_id}/orchestrators` lists orchestrator sessions owned by
a `direct-with-orchestrator` parent. `POST` on the same path launches a new
session or continues the optional `orchestrator_session_id`. The request has an
immutable short `description`, a complete `prompt`, and optional `background`
(default false). Foreground waits for settlement; background returns the
running relationship immediately and later delivers one durable parent inbox
item.

`GET /sessions/{session_id}/orchestrators/{orchestrator_session_id}` reads one
owned relationship. `POST .../cancel` propagates cancellation to the active
generation. Responses include status, generation, run and execution mode,
terminal report or failure, completion inbox ID, timestamps, and version.

The endpoints reject every parent behavior except `direct-with-orchestrator`,
mismatched ownership, recursive control, changed descriptions, and more than
four simultaneously running managed orchestrators. Managed sessions always use
the existing `orchestrator` behavior and its worker topology.

## Remote access

Remote access delegates the authority of the local user to every client that
can reach nac-web. The API has no client authentication. Prefer keeping nac-web
on loopback behind a proxy or private-network service that authenticates
callers and encrypts traffic.

Direct non-loopback binding is an advanced option and requires an explicit
acknowledgement. Bind to one private interface rather than every interface:

```sh
nac-web --bind 192.168.1.20:3210 --allow-remote --no-open
```

Before doing this, use a firewall, mutually authenticated VPN policy, or
equivalent control to restrict the exact identities and devices that can reach
the port. Treat compromise of any permitted client as compromise of nac-web.
Binding to `0.0.0.0` or `[::]` is especially risky because it listens on every
interface, including interfaces added after startup.

An IP-literal `Host` cannot be changed through DNS rebinding, so it needs no
DNS-name allowlist entry. This does not authenticate the client. DNS names
remain subject to the rebinding guard; list each expected name in the
comma-separated `NAC_ALLOWED_HOSTS` environment variable. For example:

```sh
NAC_ALLOWED_HOSTS=nac.internal.example \
  nac-web --bind 192.168.1.20:3210 --allow-remote --no-open
```

nac-web also rejects cross-origin browser mutations using Fetch Metadata and
Origin headers. That protects against hostile web pages; it is not a substitute
for authenticating network clients.
