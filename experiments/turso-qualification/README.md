# ALL-114 embedded Turso qualification

This experiment has its own locked Cargo workspace. Turso 0.8.1 is an
experiment-only dependency; NAC production stays on SQLite. The checked-in
schema is the 50 schema objects exported from an actual ALL-112 synthetic
schema-v29 store, with no customer data. Store files remain untracked.

Read [DECISION.md](DECISION.md) for the NO-GO recommendation, actual managed
evidence, compatibility failures, residual risks and restore prerequisites.

Build the probe:

```sh
CARGO_TARGET_DIR=target/all114-probe cargo build --locked \
  --manifest-path experiments/turso-qualification/Cargo.toml
```

On Linux add `--features uring` to compile the real io_uring implementation.
Select `probe uring` explicitly; unsupported I/O fails instead of falling back
or weakening the sandbox.

Run `make test-managed-load` for the full SQLite server/session/worker control.
Optionally set `NAC_MANAGED_LOAD_COPY_STORE_DIR` to an empty directory. The
fixture exports consistent copies using `VACUUM INTO` after assertions pass.
An existing destination fails closed. Never give Turso a live NAC store.

Use `schema NEW_DB COPIED_FIXTURE` to export the current schema and create an
empty SQLite schema control. Use `probe syscall|mvcc|uring DISPOSABLE_DB [DDL]`
to test a new Turso store from DDL or a separate copy of the synthetic fixture.
The mode probe emits JSON compatibility observations, not an adoption verdict.

Run the separate-file matrix with an empty output destination:

```sh
python3 experiments/turso-qualification/run_matrix.py \
  --binary target/all114-probe/debug/nac-turso-qualification \
  --fixtures /absolute/path/to/synthetic-copies \
  --output /absolute/path/to/new-output-directory
```

This is a store-stage SQL contract with sequential round-robin appends,
1/2/4 logical workload sizes, contention and process-crash gates. It is not
an end-to-end NAC Turso adapter or concurrent-writer throughput benchmark.
Each lane has a 45-second watchdog; failed lanes remain in matrix.json.
The Linux build additionally runs isolated Clippy with warnings denied.

The `Embedded Turso qualification` PR workflow builds exact-head Linux binaries
and retains the SQLite artifacts and synthetic fixture copies. A failing
SQLite control remains a failed gate even when artifacts can be collected.
This Linux CI lane is not evidence of gVisor/PVC behavior.

For a managed reproduction, first obtain development-test authorization and
inspect the live reconciler ref, RuntimeClass, storage class and managed pod
security contract. Use `managed-pod.yaml` only in a fresh disposable namespace;
abort if its namespace/PVC already belongs to another run. Copy the exact-head
CI artifact and record original hashes before optionally stripping debug data.
Archive that exact Git source revision into `/home/runner/work/nac/nac` (the
Linux fixture's compiled workspace path), initialize a fully tracked Git tree,
and verify its tree hash against the source revision. Copy synthetic fixture
stores and schema into the dedicated PVC.

Run the native test binary with `NAC_MANAGED_LOAD_WORKER` set to the artifact's
native nac-web, `TMPDIR=/data/tmp`, and `NAC_MANAGED_LOAD_COPY_STORE_DIR` set to
a new directory. The invocation is
`nac-server-test tests::managed_load::managed_load_scenario --ignored --exact --nocapture --test-threads=1`.
Use Git's `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=safe.directory`, and
`GIT_CONFIG_VALUE_0=/home/runner/work/nac/nac` for this exact disposable path;
the model fixture clears HOME, so a home-based safe-directory setting is not
sufficient. The test-only embedded catalog makes this fixture offline.
Allison authorized one longer diagnostic with
`NAC_MANAGED_LOAD_PHASE_TIMEOUT_SECONDS=90`. This test-only override is parsed
once, immutable for the fixture process, capped at 90 seconds, and rejects
invalid/zero/out-of-range values before starting the fixture. Its default remains
20 seconds; metadata records both the selected limit and diagnostic flag.
An extended result does not replace the retained 20-second acceptance failure.
Run it once in fresh disposable resources and stop if any phase reaches 90s;
do not increase the limit or alter production timeouts. The separate unconstrained
settlement probe retains its original five-second diagnostic threshold.
Run `run_matrix.py` against the PVC with separate output files. Copy all JSON,
logs, source/binary/schema/fixture hashes and runtime receipts out before
deleting only the named disposable namespace/PVC. Raw stores are synthetic;
retain local consistent copies if needed, never switch them into a serving host.

The full ALL-112 `LoadStoreAdapter` currently constructs a concrete SQLite
manager. Core and worker calls remain SQLite-bound. The standalone probes do
not constitute an end-to-end Turso implementation of that harness. This is an
explicit qualification limit, not permission to change ALL-111/113 seams.

Local observation logs are under `evidence/local`. The first control passed.
The copy-output invocation then reproduced an ordered four-way transcript gap
and timed out; the next invocation passed. The failure is retained separately
and is never erased by a retry. ALL-106 root cause remains unestablished.
