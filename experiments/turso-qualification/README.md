# ALL-114 embedded Turso qualification

This experiment has its own locked Cargo workspace. Turso 0.8.1 is an
experiment-only dependency; NAC production stays on SQLite. The checked-in
schema is the 50 schema objects exported from an actual ALL-112 synthetic
schema-v29 store, with no customer data. Store files remain untracked.

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

The `Embedded Turso qualification` PR workflow builds exact-head Linux binaries
and retains the SQLite artifacts and synthetic fixture copies. A failing
SQLite control remains a failed gate even when artifacts can be collected.
This Linux CI lane is not evidence of gVisor/PVC behavior.

The full ALL-112 `LoadStoreAdapter` currently constructs a concrete SQLite
manager. Core and worker calls remain SQLite-bound. The standalone probes do
not constitute an end-to-end Turso implementation of that harness. This is an
explicit qualification limit, not permission to change ALL-111/113 seams.

Local observation logs are under `evidence/local`. The first control passed.
The copy-output invocation then reproduced an ordered four-way transcript gap
and timed out; the next invocation passed. The failure is retained separately
and is never erased by a retry. ALL-106 root cause remains unestablished.
