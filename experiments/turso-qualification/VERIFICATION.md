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

The later d8eb0aa5 qualification run
[36773860118](https://github.com/arcee-ai/nac/actions/runs/36773860118) failed its
default-20s Linux SQLite control after emitting 1/2 artifacts. The four-way lane
logged `database disk image is malformed`, then timed out waiting for worker
requests (test 27.99s, exit101; make exit2). [Exact SQLite step output](evidence/ci/d8eb0aa5-sqlite-control-failure.log)
and [provenance](evidence/ci/d8eb0aa5-provenance.json) are retained. This is a
Linux full-control failure, not a gVisor result or an established engine cause.
That revision did not upload the failing temporary store, so its corruption
state cannot be retrospectively verified. The CI watcher also encountered a
GitHub TLS handshake timeout; that transport interruption is separate from
the actual failed correctness gate. Later source updates or passes do not
erase either observation.

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

## Authorized extended diagnostic

After the original control and disposable cleanup were retained, Allison asked
whether extending the timeout could obtain full results. One fresh managed run
at 90 seconds per phase was authorized. The override is test-only, default 20s,
parsed once and immutable per fixture process, bounded to 1..=90 seconds and
fails closed before fixture startup for invalid/zero/out-of-range/non-Unicode
values. Focused parsing coverage checks default/valid bounds and invalid,
negative, fractional, whitespace and overflow inputs. Successful scenario and
fault metadata include timeout milliseconds and a diagnostic override flag.
The separate unconstrained settlement probe's five-second limit is unchanged.

The original 20s managed FAIL remains the acceptance outcome. A longer pass
would measure eventual settlement/latency, not a healthy managed acceptance.
The diagnostic is one run only; any phase reaching 90s ends it without a higher
timeout or a second review cycle.

### One-run result: eventual completion, not healthy acceptance

The diagnostic used source 1786551c from successful exact Linux run
[36775220795](https://github.com/arcee-ai/nac/actions/runs/36775220795).
Original and executed binary hashes are in [binary receipt](evidence/managed/extended/binary-hashes.log),
and Git tree `b92abbe8224e2e5869083294d1cbaf40a41237a9` matched the fully tracked
compiled workspace. Live infrastructure/controller refs remained
6e2d88b5/e39a0da3, with unchanged runsc/security/storage contracts. The new
20Gi PVC was `pvc-244a9697-0b97-4c5f-8e3c-2820dab68c4f` on node
`ip-10-9-157-216.us-east-2.compute.internal`. This was a fresh store/device and
a different node than the original control; it is not a controlled hardware
comparison of timeout values.

The native test ran **once** with 90s phases, an outer 600s watchdog and a
two-second diagnostic /proc sampler. It exited 0 after 124.083s; no phase hit
90s, and no watchdog kill occurred. [Native log](evidence/managed/extended/extended-control.log)
and [whole-run receipt](evidence/managed/extended/extended-control-receipt.json)
retain the exact configuration/outcome. The final process snapshot showed
only pod sleep plus the inspecting shell/ps, with no remaining fixture/worker.

| Diagnostic lane | Elapsed | Observed disposition |
| --- | --- | --- |
| Ordered 1 | 21.305s | completed; one completion inbox |
| Ordered 2 | 22.021s | both completed; two completion inboxes |
| Ordered 4 | 24.183s | all completed; four completion inboxes |
| Slow-I/O 1 | 21.193s | completed |
| Unconstrained 4 | 21.925s | unsettled run reproduced; then three cancelled, one completed |
| Combined injected faults | 11.457s | all fixture assertions completed |

The separate unconstrained probe retained its original five-second settlement
limit. Its outcome is `reproduced_unsettled_managed_run_then_cancelled`, with
`settlement_timeout_recovered=true`; cancellation/recovery is not a clean
unconstrained acceptance pass. All four completion inboxes were ultimately
recorded. Ordered transcript/event/episode/inbox counts, generation/recovery,
foreign-key/integrity and checkpoint assertions passed within the diagnostic
limit. Fault receipts include 75ms held writer/71 busy callbacks/86ms append
wait, trigger-induced append failure with one completion, injected monitor
failure recovered to completed, worker interruption cancelled with matched
started/stopped PID, and manager interruption/restart recovered as interrupted.
Those are the fixture's specified injected outcomes, not absent errors.

All ordered barrier probes returned 200: healthz 236–291us, readyz
9.205–24.253ms. Four-way event persistence p50/p95/max was
5.314/12.209/12.999ms; monitor poll p95/max 3.185/17.093ms; terminal settlement
6.907–11.873ms. Ordered checkpoints were not busy, all frames cleared, around
1.2–1.4ms. Maximum active connections/queue reached 2/2, 2/2 and 4/4 at 1/2/4;
the unconstrained probe queue reached 5. No telemetry export was dropped or
reported failed. These are component-fixture route/probe measurements, not
Kubernetes liveness/readiness traffic against a serving production image.

The whole diagnostic's virtualized wait4 accounting reported 131.25s user plus
14.63s system CPU and 203,694,080-byte peak RSS. There are 62 raw /proc samples.
CPU is whole-fixture accounting, not per-operation CPU; telemetry's CPU maxima
are cumulative across this test process, so per-lane maxima are not independent
lane costs. gVisor /proc child lists can expose thread aliases sharing RSS;
do not sum them or treat every listed entry as an independent worker process.
Use the fixture's matched process start/stop telemetry for worker counts. Mock
models, the test binary, telemetry export and sampler differ from a serving
production NAC image. No production resource budget pass or engine CPU/memory
ranking is inferred from this diagnostic.

[Six metadata files](evidence/managed/extended/managed-load) record selected
90,000ms limits and diagnostic flags. Four consistent synthetic store copies,
the log/receipt and samples were copied locally; [artifact archive manifest](evidence/managed/extended/artifacts-archive.json)
and [metadata archive manifest](evidence/managed/extended/metadata-archive.json)
retain hashes/recovery paths. Local default20s fixture passed in 14.41s,
full server suite passed 213 library tests plus binary/contracts, and four
invalid real-entry environment configurations were rejected before fixture
startup. [Default/negative receipts](evidence/local/timeout-default) retain those
checks. No production timeouts changed and no second review was performed.

After verifying metadata/log/sample hashes and all four consistent store copies
against the local archive, the fresh diagnostic namespace/PVC was deleted.
Namespace and exact PV `pvc-244a9697-0b97-4c5f-8e3c-2820dab68c4f` were verified
absent. [Second cleanup receipt](evidence/managed/extended/cleanup.json) records
this scoped removal. No cloud PVC is retained; local synthetic archives and
the tracked diagnostics remain recoverable. The one-run limit was respected.
