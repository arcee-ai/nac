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

The final offline test fixture Linux binary is being built from bdc5e69a in
run [36770538600](https://github.com/arcee-ai/nac/actions/runs/36770538600).
Final managed control and cleanup receipts are appended after execution and
preservation. Exact PR-head CI status is recorded on ALL-114 at handoff;
successful prior heads are never substituted for that gate.
