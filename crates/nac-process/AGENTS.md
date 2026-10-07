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
  `terminate` keeps its exact tagged/census owner and retained Linux pidfds or
  observed start identities on failure. Reaped group IDs are cleared before
  retry so numeric group reuse cannot create a replacement target. Callers must
  keep the actual guard/child owner until cleanup succeeds; dropping an error
  does not prove quiescence. Darwin census signals only matching observed start
  identities and keeps inspection uncertainty closed. This process-local
  capability is not a durable restart receipt or reconstructed execution grant.
- Keep Linux pidfd/proc, macOS process-table, and portable fallback behavior
  explicit and tested. Platform-specific weakening requires a deliberate safety
  decision.
- This crate is infrastructure only. It does not know sessions, tools,
  permissions, Podman policy, HTTP, managed workflows, or terminal rendering.
- Bounded child/group reap failures remain errors. Group signals are best effort;
  actual owned reaps and the descendant verifier establish cleanup completion.
  Failed waits retain actual child handles; retry never reconstructs them from
  PIDs. Linux pidfd readiness distinguishes whole-process exit from reaping.

## Starting points and size exception

- `src/lib.rs` — `ProcessTreeGuard`, process-group isolation, descendant
  capture/identity, signaling, termination, retry authority, and platform
  adapters.
- `Cargo.toml` feature `test-support` exposes only deterministic failure hooks,
  including per-instance failed cleanup attempts.
- `src/cleanup_retry_tests.rs` — actual failed cleanup ownership/retry and retained
  start-identity rejection; Linux retained pidfd inspection tests need Linux.

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
