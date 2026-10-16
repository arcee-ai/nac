# Private passive session observation

The existing explicitly configured private fact listener additionally serves
`POST /internal/v1/managed-session-observation`, schema and purpose
`managed-session-observation.v1`. It requires the listener's actual enrolled,
pinned D-service TLS peer. The ordinary runtime fence remains closed, and the
ordinary router, maintenance listener and public OpenAPI do not expose this
operation. This addition does not enroll trust, install a platform client,
authorize a user or qualify a deployed image.

ALL-284 under ALL-121 retains platform principal/profile/host admission,
the original strong context ETag, revocation and the mediated browser GET/SSE
transport. The controller's existing location-facts dispatcher cannot call this
new operation without an explicitly implemented mapping. A configuration file
or source constructor does not prove current enrollment. First signed chat
deployment is independent.

## Request and response mapping

The request uses the existing fact listener's exact JSON/correlation headers
and original `X-NAC-Expires-At-Epoch-Ms` deadline, at most 60 seconds ahead. The
deadline is never renewed and cannot become a platform access lifetime.
Requests have no query string and must use `Content-Type: application/json`.
Forwarded Authorization, Cookie, Origin and operation-authority headers are
refused. Each JSON object is closed; duplicate, unknown or malformed fields are
refused. Correlation/session/epoch identifiers are 1..128 ASCII letters, digits,
hyphens or underscores.

```json
{
  "schema": "managed-session-observation.v1",
  "purpose": "managed-session-observation.v1",
  "request_id": "same-as-X-NAC-Request-ID",
  "target": {
    "logical_host_id": "expected-host",
    "host_incarnation_id": "expected-incarnation"
  },
  "session_id": "existing-session",
  "observation": { "kind": "events", "limit": 0 }
}
```

The target is compared to actual current Native binding under its original
cross-process replacement guard. It is not echoed as authority. Store and
replacement state must support observation. This is narrower than full runtime
Ready; no filesystem-write or shell readiness probes run.

| Platform GET | Private `observation` | Accept and successful body |
| --- | --- | --- |
| `/sessions/{id}` | `kind: "snapshot"`; optional `message_limit`, `thread_event_limit`, `include_sessions`, `include_system` | `application/json`; unchanged `SessionSnapshotResponse` |
| `/sessions/{id}/events` | `kind: "events"`; optional `cursor: {epoch_id, sequence_id}`, `limit` | `application/json`; unchanged `{boundary, events}` |
| `/sessions/{id}/events/stream` | `kind: "stream"`; optional same cursor and limit | `text/event-stream`; existing named Native SSE frames |

The paired platform cursor maps to one closed cursor object. Sequences remain
Native numeric values; no alternate string codec is selected. Event replay is
bounded to the existing default replay limit (256). `limit: 0` returns the
actual existing boundary and no events. It does not create an epoch. Snapshot
limits retain the ordinary endpoint's bounded page semantics.

The installed SDK's capture sequence is supported: events with limit zero,
then snapshot, then replay from that original boundary. Successful JSON replies
are the existing Native shapes, with no new envelope for the SDK to decode.
The response carries `Cache-Control: no-store` and the request correlation.

## Passive ownership and limits

Only a current cached `SessionService` can be observed. Missing, evicted or
configuration-stale services return 503, including after restart. They are
never attached, resumed or replaced merely to satisfy a view. This is an
explicit support limit, not an empty snapshot or invented durable event bus.
The original cached identity and current configuration version are checked
before and after projection, and before each streamed frame.

The passive projection reads existing durable shell-command rows without
reconciling abandoned commands, changing recovery, waking an inbox or acquiring
run authority. It performs no model/backend construction and no git or SSH
workspace inspection. The original required workspace shape reports
`workspace.error: "workspace inspection unavailable in passive observation"`;
unavailable enrichment is not represented as a clean workspace. Other snapshot
fields and existing optional/null meanings remain unchanged.

Workspace tree/diff/revision/git/SSH and all attach/resume/mutation operations
are unsupported and refused. Frontend workspace queries can still occur even
when an error is rendered; platform/private allowlists must deny them without
falling through to an ordinary runtime handler or inventing empty success.

Snapshot reads use the existing bounded probe-worker owner. That original
worker retains the replacement guard through all underlying reads and JSON
serialization even if its caller abandons or times out the wait. Capacity
refusal is 503. Cancellation is not a claim that underlying reads finalized.

SSE reuses Native `replay_boundary`, `replay_gap`, `session_event`,
`assistant_delta` and `lagged` framing, including original optional envelope
fields and numeric sequence semantics. It adds no retry, attachment, replay
loop or synthetic events. The SDK owns cursor acceptance, replay, reconnect
and backpressure. The connection closes on the original deadline, private
listener shutdown, missing/replaced cached owner or changed configuration.
It retains the original replacement guard until the body ends or is dropped.
The platform may close it earlier on revocation and must carry the same
original strong If-Match on each mediated connection/reconnection. Closing
observation does not settle Native work.

Malformed envelope/header/operation is 403; stale requested host/incarnation is
409; unavailable store/current owner/projection/capacity or elapsed deadline is
503. Error bodies disclose no internal diagnostics. Existing private location
facts and host metadata observation remain separate operations. No readiness
compatibility fallback or release-derived fabricated version is installed.
