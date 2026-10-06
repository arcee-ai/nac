# HTTP API

The HTTP contract is generated from the Rust handlers and types in the running `nac-web` process. To review the current state of the API, start the server, then use the live docs:

```sh
nac-web
```

With the default bind, that is [http://127.0.0.1:3210/docs](http://127.0.0.1:3210/docs) for the embedded Swagger UI and [http://127.0.0.1:3210/openapi.json](http://127.0.0.1:3210/openapi.json) for the OpenAPI 3.1 document (`GET /docs` and `GET /openapi.json` on whatever host and port you chose).

## Experimental typed client artifact

ALL-121 consumes the current typed HTTP/SSE boundary directly from an exact NAC
Git revision while ALL-122 evaluates the durable packaging decision. The
temporary package is deliberately registry-free and cannot be published:

```json
{
  "dependencies": {
    "@arcee-ai/nac-client-all-121": "https://codeload.github.com/arcee-ai/nac/tar.gz/<full-commit-sha>"
  }
}
```

Commit the consumer's `package-lock.json`; npm records the exact source URL and
archive integrity. Installing the package requires no local NAC checkout,
lifecycle script, or runtime dependency. The checked-in package exposes `NacClient`,
`NacTransport`, explicit command-admission and error contracts,
snapshot/cursor replay, `subscribeToSessionEvents`, and the auth-capable SSE
adapter seam. Its OpenAPI type subset is generated from the same Rust-owned
contract as the standalone client, and NAC's web app imports the same source
rather than maintaining a second transport.

This artifact is evidence for the one hosted journey, not a registry release or
the final package name, ownership, compatibility, or transport decision.

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

## User commands

`POST /sessions/{session_id}/user-commands` runs one shell command on the
user's authority in an idle direct primary session. The body has a
client-chosen `request_id`, a nonblank `command`, and an optional `timeout_ms`
between 1 and 3600000 (default 30000). A new admission returns 202 with the
command snapshot. The composer removes only the leading `!`, preserving the
remaining payload exactly; `\!` submits literal chat text. A command never
starts a model run.

`request_id` is the idempotency key. Re-posting the same `request_id` with the
same command and effective timeout returns 200 with the current snapshot in any
state, and never starts a second process. A different command or timeout under
the same `request_id` returns 409. While another run, compaction, or command is
active, a new `request_id` returns 409 busy and no record is written. Orchestrator
sessions return 400; unknown sessions and delegated sessions return 404.

`GET /sessions/{session_id}/user-commands/{request_id}` reads the snapshot. A
client that lost an admission response looks the command up here.
`POST .../cancel` cancels an active command owned by this process and returns
the snapshot; a terminal command is returned unchanged. Shutdown cancels active
commands.

`GET .../output` pages retained output with `stream` (`combined`, `stdout`, or
`stderr`; default `combined`), `offset`, and `limit` (1 to 65536 bytes; default
16384). Output is process-local: after a restart, or once the artifact is
evicted, the route returns 410 while the snapshot keeps its previews. Offsets
refer to original retained bytes. Redaction recognizes secrets across page
boundaries, and a crossing secret can produce a mask on each intersecting page.

Snapshots carry `state` (`admitted`, `executing`, `completed`, `timed_out`,
`cancelled`, `spawn_failed`, `rejected`, `interrupted`, or `outcome_unknown`),
exit code, wall time, cwd, stdout and stderr previews, truncation flags, the
optional `output_id`, `reason`, and timestamps. Credential values exported to
the command are redacted from previews, lookups, and output pages, including
literal values in the displayed command. Durable admission stores its redacted
command and exact payload fingerprint; the admitted executor keeps the original
payload privately and recovery never reruns it. A post-spawn execution or cleanup
failure reports `outcome_unknown`, preserving available output. Session
snapshots expose `active_user_command` and `user_commands`, message pages
attribute commands through `user_commands[].message_index`, and every
transition emits a `user_command_updated` event.

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
nac-web --bind 192.168.1.20:3210 --allow-remote --no-open \
  --mcp-oauth-callback-origin https://nac.internal.example
```

The callback origin is required for ordinary non-loopback servers. MCP OAuth
redirects are built only from this explicit HTTPS origin, never from `Host` or
forwarding headers. Managed NAC derives the same origin from its validated
`public_hostname`. Loopback servers retain the local callback listener.

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
  nac-web --bind 192.168.1.20:3210 --allow-remote --no-open \
    --mcp-oauth-callback-origin https://nac.internal.example
```

nac-web also rejects cross-origin browser control using Fetch Metadata and
Origin headers. A separately hosted trusted UI may opt in by listing its exact
origin in `NAC_ALLOWED_ORIGINS`; multiple origins are comma-separated:

```sh
NAC_ALLOWED_HOSTS=nac.internal.example \
NAC_ALLOWED_ORIGINS=https://app.example.com \
  nac-web --bind 192.168.1.20:3210 --allow-remote --no-open \
    --mcp-oauth-callback-origin https://nac.internal.example
```

Only exact `http` or `https` origins are accepted; wildcard, path, query, and
fragment entries stay denied. The opt-in enables credentialed CORS for that
browser application, including HTTP commands and SSE reads. It grants the UI
owner-equivalent NAC control, so the NAC endpoint must still sit behind an
authenticated, encrypted ingress. The origin check protects against hostile
web pages; it is not client authentication and bearer capability does not
bypass it.
