# Verification addendum

This addendum records verification separately from the engine decision and
retains earlier failures. [DECISION.md](DECISION.md) defines each evidence scope.

## Local final fixture and code checks

`make setup` was rerun after the experiment lockfile changed. Repository
formatting and lint passed. The full nac-server suite passed: 212 library,
25 binary, two source contract and one stable contract tests; the managed
scenario remains intentionally ignored by the ordinary suite and is run below.
Source-size guard passed after staging the packet and evidence.

The test-only embedded catalog preload was compiled into the final local
fixture. `NAC_MANAGED_LOAD_COPY_STORE_DIR=... make test-managed-load` passed the
full 1/2/4 ordered scenarios, slow-I/O and six fault lanes in 15.45 seconds,
with no registry request. The separate unconstrained settlement outcome was
`completed_without_reproduction`, not proof that the earlier transcript gap
cannot recur. [Final local artifacts](evidence/local/offline) retain all output.
An initial invocation inside the filesystem sandbox failed to bind the
loopback deterministic model; the authorized invocation succeeded outside it.
That prerequisite failure is not database evidence.

The separate locked experiment passed formatting and Clippy with warnings
denied locally; Linux CI compiles real io_uring and checks its code path.
Changes to the probe after the managed f4949403 measurements are explicitly
separate: process CPU instrumentation, schema DDL failure propagation and the
review fixes below. None changes the previously retained measurement receipt.

## One bounded independent review

One independent reviewer inspected the candidate including bdc5e69a's code,
decision and evidence against dev. It found two P2 issues, both fixed:

* Unknown probe modes could silently select syscall I/O. The probe now rejects
  an unsupported mode before opening/creating any store. A `syscal` negative
  invocation returned nonzero and created no file.
* Checkpoint errors or busy/incomplete results could still yield a passing
  workload result. The workload now propagates SQL errors and requires complete
  TRUNCATE checkpoint rows `[0,0,0]`. A held-reader SQLite negative control
  returned nonzero with `checkpoint busy or incomplete` and emitted no passing
  JSON. A fresh one-orchestrator SQLite positive lane passed checkpoint,
  synchronized process crash, reopen and retry rejection.

[Review-fix receipts](evidence/review) retain both controls. Every successful
managed f4949403 checkpoint was already `[0,0,0]`, so the review correction
does not invalidate the retained matrix. No other actionable findings were
reported. This was the authorized single review pass; no iterative review
cycle was opened.

## Linux source revisions

Exact-head f4949403 CI passed all applicable checks, including qualification
run [36766251401](https://github.com/arcee-ai/nac/actions/runs/36766251401),
stable build/test/lint and managed image contract/build/quality checks.
That run supplied the actual managed store-stage probe binary.

The offline test fixture Linux binary was built from bdc5e69a in
run [36770538600](https://github.com/arcee-ai/nac/actions/runs/36770538600).
That run passed its full Linux SQLite control and built the actual io_uring
probe, then failed because its Rust toolchain lacked the Clippy component.
The workflow now explicitly installs rustfmt and clippy. The uploaded binary
has valid source provenance, but this failed run is not a green CI gate.
Repaired qualification run [36771861738](https://github.com/arcee-ai/nac/actions/runs/36771861738)
on ae661b83 passed the full Linux SQLite control, probe build, formatting and
Clippy including io_uring. Exact PR-head CI status is recorded on ALL-114 at handoff;
successful prior heads are never substituted for that gate.

## Single final offline managed full control: FAIL

The native worker and test binary from bdc5e69a were installed in a new `/data/offline`
directory in the existing disposable gVisor/PVC pod. Source tree
`51525ac7fe8a1942365743b27037b03b0d3cdd85` exactly matched the compiled source;
the tree was fully tracked. Original/stripped SHA-256 values are retained in
[binary receipt](evidence/managed/offline/all114-offline-managed-binaries.log).
The final fixture source and production worker source are unchanged in the
later review/workflow/evidence commits. The bdc5e69a job's missing-Clippy failure
is separately classified above; it is never counted as a passing CI gate.

The exact invocation used `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=safe.directory`,
`GIT_CONFIG_VALUE_0=/home/runner/work/nac/nac`, `TMPDIR=/data/tmp`,
`NAC_MANAGED_LOAD_WORKER=/data/offline/debug/nac-web`, and
`NAC_MANAGED_LOAD_COPY_STORE_DIR=/data/offline-fixtures`, then:

```sh
/data/offline/debug/nac-server-test tests::managed_load::managed_load_scenario \
  --ignored --exact --nocapture --test-threads=1
```

It exited 101 after 20.95s in the one-orchestrator lane while waiting for
managed Completed. It made no registry request. No 2/4 or full managed fault
lane was reached, so they are unqualified. [Exact log](evidence/managed/offline/all114-managed-sqlite-offline-final.log)
and [read-only diagnostic](evidence/managed/offline/all114-offline-final-diagnostic.json)
retain the failure and final state:

* Session `all112-1-0a110112-0`, run
  `6ddc079d-ca94-4891-a66a-c28df378609a`, generation 1.
* Worker assistant_message and run_finished persisted at 20:24:22 UTC.
  Thread_finished persisted at 20:24:42 UTC with exit_code 0 and timed_out false.
  One worker episode persisted with status ok.
* Orchestrator transcript indices 0/1 persisted at 20:24:22, 2/3 at 20:24:42;
  indices were contiguous. Session response duration was 20,324ms.
* After teardown, recovery status was active with terminal_disposition completed;
  managed relation status was running/version 1 and completion_inbox_id null.
* Schema v29, quick_check ok and no foreign-key violations. Database SHA-256
  `594beaf09c0ac3659bfb04910783c63c8f7aa761e7a76f17d46fabfe55e81341`.
* No test/worker process remained; the command-name-only process snapshot showed
  pod sleep and the inspecting ps command. Pod/container logs were empty because
  the test's stdout/stderr were redirected to the retained log.
* Advisory run/workspace lock files were retained and empty after teardown.
  They do not prove who held an OS lock at the timeout. No stronger process-exit
  acknowledgement trace was captured than the durable thread_finished event.

The prior fully tracked native registry-timeout control is retained in
[comparison diagnostic](evidence/managed/offline/prior-registry-diagnostic.json):
worker run_finished at 19:59:57 and thread_finished at 20:00:16, response duration
20,332ms, with the same completed terminal disposition/running relation boundary.
Removing the host registry request did not eliminate the observed delay. Neither
comparison establishes a cause in SQLite, Turso, gVisor, topology or scheduling.

The failed fixture panics before draining its in-memory telemetry/exporting the
successful-run metadata, so historical per-operation CPU/RSS, probe samples,
queue measurements and process acknowledgement timing beyond these persisted
events are unavailable. Post-run pod limits or resource samples cannot substitute
for them. The completed store-stage matrix's CPU/latency measurements remain
independent. This residual belongs in ALL-116/117 investigation and strengthens
the application coverage NO-GO; it does not invalidate the completed engine SQL
matrix or establish the originating incident's cause.

## Preservation and recoverability

The complete matrix files were copied to
`/private/tmp/all114-managed-store-matrix-raw.tar.gz`, hash
`d3ee2e96dbe61a4c6a79e346618d4bf4104e0fb515b2109ab3e49391857493db`.
[Archive manifest](evidence/managed/raw-store-archive.json) retains hashes for
100 synthetic database/sidecar/stdout/stderr files. The complete failed offline
store and lock files were separately archived; its [manifest](evidence/managed/offline/raw-control-archive.json)
records the local recovery path and hashes. Raw synthetic stores remain untracked;
the decision, exact diagnostics and measurement JSON remain durable in the PR.
Temporary local archives are convenience recovery, not long-term production
backups; synthetic stores can be recreated from pinned source/DDL/fixture export.
The prior registry-timeout store is also preserved in a separately hashed local
archive with [manifest](evidence/managed/offline/prior-control-archive.json),
verified against its diagnostic database hash before cleanup.

After copying and verifying these archives and tracked receipt sources,
`all114-qualification` was deleted. Namespace and the exact experiment PV
`pvc-9339747b-709b-421f-81eb-890dc9583385` were verified absent; the PVC was
removed with the namespace. The storage class uses Delete reclamation, so
no recoverable cloud PVC is retained. [Cleanup receipt](evidence/managed/cleanup.json)
records the scoped removal. Recovery of these synthetic test stores is from
the retained local archives or reproduction; no production backup is involved.
[Evidence manifest](evidence/manifest.json) hashes every retained receipt.
