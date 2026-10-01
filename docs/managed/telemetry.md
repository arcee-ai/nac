# Managed NAC operational telemetry

Managed NAC can emit bounded JSON Lines diagnostics to stderr by setting
`NAC_TELEMETRY=stderr`. The default is disabled. `NAC_TELEMETRY_BUFFER` selects
the in-process export queue capacity and is clamped to 1–4096 entries (default
1024). `NAC_TELEMETRY_SCENARIO` may contain at most 64 ASCII letters, digits,
`.`, `_`, or `-`; invalid values are omitted.

This instrumentation provides attribution evidence. It does not choose a store
engine or establish the cause of a durability or resource incident.

## Safety and export behavior

The producer path uses bounded `try_send`; it never awaits the exporter. A
stalled, failed, or disconnected exporter drops observations after the queue
fills and cannot delay agent, store, or HTTP work. Export errors are counted in
the recorder and are not returned to application code. Disabled telemetry has
no exporter thread and does not change store, agent, process, or HTTP results.

The schema has no fields for prompts, transcripts, tool arguments or results,
credentials, repository data, SQL text, SQL parameters, paths, or error
messages. Session, run, and host identifiers are emitted only as fixed
16-character one-way correlation digests. Generation is numeric. Child PID is
a diagnostic field, never a metric-series dimension. Route values come from
Axum's matched route pattern or a fixed route class, never from the raw URI.

SQLite statement profiling classifies only `BEGIN`, `COMMIT`, and
`PRAGMA wal_checkpoint` prefixes and immediately discards the SQL callback
value. All other SQL, including expanded bound parameters, is ignored. SQLite
errors retain numeric primary and extended codes without their messages.

## Names and ownership

| Name | Kind | Bounded dimensions | Owner |
| --- | --- | --- | --- |
| `nac.store.operation.duration` | span | operation, outcome, engine, error codes | `nac-core::store` |
| `nac.store.connection.active` | gauge | process/store scope, engine | `nac-core::store::schema` |
| `nac.persistence.queue.active` | gauge | engine | `nac-core::telemetry` observed in-flight persistence operations |
| `nac.runtime.activity.active` | gauge | orchestrator/worker/child-process | `nac-core::agent` and process call sites |
| `nac.runtime.child_process` | diagnostic | started/stopped; PID as a non-series field | `nac-core` process call sites |
| `nac.runtime.resource.sample` | gauge | engine; correlation digests are exemplars, not series dimensions | `nac-core::telemetry` |
| `nac.http.request.duration` | span | matched route pattern, outcome | `nac-server::delivery` |

`nac.store.operation.duration` uses these exact operation values:

- `connection_acquire`, `transaction`, `commit`, `checkpoint`, `retry`, and
  `readiness` for SQLite access and probes;
- `transcript_append`, `event_persistence`, and `worker_episode_commit` for
  durable execution history;
- `managed_monitor_poll`, `recovery`, and `terminal_settlement` for managed
  lifecycle attribution.

Every event includes bounded build ID, source revision, store engine, journal
mode, and schema version. Managed server events also include the host digest.
When available at the owning seam, session/run digests, generation, and
scenario are included. CPU time uses process `getrusage` for NAC itself. On
Linux, child CPU and resident memory samples use the child's `/proc/<pid>/stat`
and `statm` records; other platforms omit child resource fields they cannot
supply. Resource samples always carry the observed process PID as a non-series
diagnostic field.

## Budgets and deterministic evidence

- Export queue: at most 4096 observations, with no unbounded retry queue.
- Metric series: name + fixed operation/activity/outcome + matched route +
  engine. Correlation digests, build identity, generation, scenario, and PID
  are event correlation fields rather than series dimensions.
- Route cardinality: bounded by the assembled router plus fixed fallback
  classes; raw URI segments never become route labels.
- Disabled producer overhead: the deterministic test budget is below 100 µs
  per attempted observation over 20,000 observations.
- Stalled-exporter producer overhead: 10,000 attempted observations complete
  within one second while the exporter is deliberately blocked.

The in-memory exporter is the deterministic test adapter. The
four-orchestrator fixture runs four producer threads concurrently, proves the
active count reaches four, emits store, readiness-route, and resource
observations for four generations, and proves they join on the same bounded
correlation fields. It also serializes the result and checks prompt,
transcript, tool, credential, repository, and SQL-parameter canaries are absent.

SQLite WAL remains selected after the accepted ALL-114 NO-GO; embedded and
remote Turso are not supported backends. The
[persistence decision](../architecture/0004-persistence-ownership.md#selected-backend)
links the retained qualification evidence. The event schema keeps
`store_engine`, `journal_mode`, and numeric error identity explicit for
attribution. A different backend requires new explicit decision and
qualification work.
