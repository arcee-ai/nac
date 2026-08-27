# nac-process guide

`nac-process` is the shared infrastructure owner for supervised child-process
trees. It isolates process groups, captures descendants, terminates/reaps them
across cancellation and leader-exit races, and verifies retained process
identity on supported operating systems.

## Invariants and dependency restrictions

- Cancellation must cover descendants that escape the original process group,
  remain PID-reuse safe where platform identity permits, bound grace periods,
  and always reap the leader.
- Cleanup authority survives partial inspection failures according to the
  existing retry contract; do not silently declare an unknown tree gone.
- Keep Linux pidfd/proc, macOS process-table, and portable fallback behavior
  explicit and tested. Platform-specific weakening requires a deliberate safety
  decision.
- This crate is infrastructure only. It does not know sessions, tools,
  permissions, Podman policy, HTTP, managed workflows, or terminal rendering.

## Starting points and size exception

- `src/lib.rs` — `ProcessTreeGuard`, process-group isolation, descendant
  capture/identity, signaling, termination, retry authority, and platform
  adapters.
- `Cargo.toml` feature `test-support` exposes only deterministic failure hooks.

`src/lib.rs` deliberately exceeds 800 lines because the cross-platform
termination algorithm and its shared authority state must remain auditable as
one safety owner. Callers compose the guard; do not add domain-specific spawn
configuration or output retention here.

## Verification

```sh
make crate-check CRATE=nac-process
make crate-test CRATE=nac-process
cargo test --locked -p nac-core terminal
```

Process-table tests may need OS-level inspection permission. Report a confined
permission failure and rerun authoritatively rather than treating it as a code
failure.

## Generated artifacts and placement mistakes

This crate owns no generated artifacts. Do not duplicate descendant traversal
in terminals, workers, or managed Git; do not move authorization/sandbox
decisions into the process guard; do not replace identity checks with raw PID
assumptions.
