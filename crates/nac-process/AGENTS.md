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
- `src/native_pty.rs` and `src/native_pty/` — exclusive fresh native Local PTY
  child ownership, cached observations, retained cleanup retries and platform
  identity adapters. Callers transfer an unreaped child after native `setsid`;
  inherited remote sessions never gain this authority. Child adapters expose
  only PID and final reap: portable-pty's kill method can itself reap and must
  never release the owner's `WNOWAIT` fence early.
- `Cargo.toml` feature `test-support` exposes deterministic failure hooks and
  opaque exact-identity teardown for disposable process fixtures. It grants no
  production discovery or signaling authority to callers.

Native human PTY admission preflights identity capabilities without raising the
global/model OS requirement. Linux uses pidfds. macOS runtime-resolves atomic
audit-token signaling and validates bookended private unique-ID/public short-BSD
records. All-PID discovery filters session/parent evidence before acquiring
signaling authority; UID changes never silently remove owned-session candidates.
Unknown/denied owned candidates and ambiguous SID failures retain cleanup
obligations. Positively unrelated inaccessible records do not grant authority or
poison cleanup. A one-off SID failure with unresolvable historical membership
can retain an obligation until that original identity dies; later different SID
alone is not exclusion proof. Keep actual UID-transition runtime qualification
explicitly separate from same-UID/fault tests. Retain unique ID across exec
before refreshing its identity version. No
raw descendant PID signal fallback is allowed when those capabilities fail.
Private ABI/runtime qualification is explicit, not a claimed stable OS floor.
macOS census generations may share complete acquisitions only for roots registered
before acquisition and verified with unreaped-child/private unique-ID bookends.
Each root consumes a generation once in the same polling epoch; cleanup always
requests fresh acquisition. Enumeration stays fresh and pending/error
interpretation, pruning and signaling remain owner-local. Positive rows retain
the original immediate capture metadata before a short-lived parent can be
reaped during batching; owners alone turn that witness into authority. Never
substitute a TTL or negative PID/SID/PPID hint for the root/identity proof.
Aligned polling only shortens the existing 50/250 ms sleep. Keep the
permission-neutral unique-ID/short-BSD/SID inspection sequence and its identity,
exec-version, birth-parent, PPID and SID bookends intact.
Active census releases only conclusively dead exact members after discovering
children; failed capture retains the original parent capability independently.
No finite live-member cap may forget ownership. Session census reaches observed
separate job groups after leader exit; it does
not guarantee adoption of rapid fork/new-session/environment-clearing escapes.
Support changes for that residual limit require a deliberate safety decision.

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
