# Worker engine retirement inventory

ALL-611 moves shared infrastructure without deleting the orchestrator engine.
The cutover owner should inspect the current callers and tests before removing
any of the following:

- `agent/dag.rs`: source-thread dependency scheduling, parsed dispatch and DAG
  validation; generic partitioning, parse-result events, ordinary invocation,
  and model-order collection moved to `agent/tool_exec.rs`.
- `tools/worker_dispatch.rs`: thread-specific entries, mark, start, queue,
  close, expiry and drain remain in the legacy registry. It takes the run lock
  before the worker lock. `tools/run_admission.rs` owns direct run binding and
  `tools/run_cancellation.rs` owns nested cancellation and mutation fencing.
  Session recovery still calls the worker registry to clear legacy targets.
- `worker_credentials.rs`: worker credential channel, framing and handshake
  remain; native secret capture, exact redaction and same-UID hardening moved to
  `managed_native_credentials.rs`. Both worker and native paths still use the
  shared credential value.
- Worker construction/dispatch options, worker runtime and thread tools remain
  in `runtime/`, `worker.rs` and `tools/thread/`. Shared run contracts are now
  `SessionRunConfig`, `RuntimeSession` and `RunState::Session`; the coding tool
  definitions still serve both workers and direct children.
- `agent` current run binding and prompt commit pending state remain shared;
  neither is a worker-only steering field. `traditional_children.rs` owns a
  compatibility decoder and bounded historical direct prompt templates for
  project instruction suffixes in existing rendered transcript heads. Preserve
  them until an equivalent durable representation supports all old transcripts;
  do not remove them with the worker prompt or managed orchestration engine.

The shared matches moved or renamed by this preparation are:

| Before | Shared owner after preparation |
| --- | --- |
| `OrchestratorRunConfig`, `OrchestratorSession`, `RunState::Orchestrator`, `from_orchestrator_run_config` | `SessionRunConfig`, `RuntimeSession`, `RunState::Session`, `from_session_run_config` |
| `worker_tool_definitions`, `worker_tool_registry`, `WORKER_TOOL_NAMES` | `coding_tool_definitions`, `native_tool_registry`, `CODING_TOOL_NAMES` |
| DAG `partition_tool_calls`, `collect_parse_errors`, `sort_and_strip_index`, `spawn_non_thread_into` | `agent/tool_exec.rs` |
| `ThreadCancellation` and its state | `tools/run_cancellation.rs` as `RunCancellation` |
| `ActiveThreadRegistry` run identity, acceptance and cancellation | `tools/run_admission.rs`; worker entries remain in `WorkerDispatchRegistry` |
| `steering_dispatch_id`, `steering_append_pending` | `current_run_id`, `prompt_commit_pending` |
| `restrict_same_uid_inspection`, `capture_managed_native_credentials_from_environment`, `managed_exa_api_key`, `captured_managed_native_redactions`, and the native credential value | `managed_native_credentials.rs` |
| Rendered parent prompt suffix parsing | `InheritedProjectInstructions` in `traditional_children.rs`; retained for historical transcript heads |

Direct runtime constructs the shared run gate independently. It still attaches an
inert worker registry for compatibility with current service and tool composition;
cutover must remove that attachment and the worker-only recovery/cleanup calls.
The worker registry's `run_id` method forwards to the shared gate for legacy
thread callers; its test-only `begin_run` does the same. Remove those shims
with their callers.
Persisted topology, configuration, event, SQL and wire names remain unchanged;
their eventual migration is separate.
