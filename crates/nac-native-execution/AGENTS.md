# Native execution adapter guide

`nac-native-execution` owns the Native compartment wire and its client/runner
adaptation. It is an outward adapter, independent of HTTP delivery. Core owns
prepared effects, current-source authority, immutable selected backend binding
and positive qualification. `nac-process` owns actual peer resources and native
child/descendant lifecycle; do not duplicate their kernel/process machinery.

## Invariants

- A wire exchange, raw transport, UID, UUID, copied binding or acknowledgement
  grants no Root/current/Ready/effect/isolation or settlement authority. Keep
  Core's positive factory closed until its actual joint resources exist.
- Preserve public v1 channel behavior. Only the private actual v2 exchange marks
  execution phase; do not add a DTO, CLI/config selector, recapture, reconnect,
  version relabel or credential/file-open/sign/decrypt/proxy RPC.
- Keep the same unique gated connection and original unique peer lifetime.
  Weak checks/denial/bindings retain no socket/pidfd. No raw descriptor escapes.
- Preserve physical frames of 4096 bytes, commands of 256 KiB with at most 4096
  arguments and 1024 environment entries, data blocks of 16 KiB, and fragments
  of 768 bytes. Closed roles/fields, bounded assembly, cumulative original flow
  windows and strict byte offsets fail permanently on malformed input.
- Continuous frame parsing survives receive cancellation. Queues are explicitly
  finite and independent per direction. Unknown or partial writes deny the real
  pair; never retry/resynchronize them. Local queue/write/ack deadlines retain
  the original trusted instant, never a remote clock or receipt-started timer.
- Buffered I/O checks actual weak peer state before polling and before success
  publication. Keep separate notification/timer registrations for split read
  and write tasks. Refusal is sticky; queued bytes are inert after denial.
- Job admission must install independent original-deadline stop ownership before
  waiting for queue capacity. A timer or denial alone is not stop/reap proof.
  Retain actual selected-driver and child/descendant cleanup across cancelled
  dispatch, dropped handles, lost response and expired caller budgets.
- Target native file I/O runs as a credential-free child, never in a trusted
  supervisor context. Construct closed commands with explicit environments and
  descriptor hygiene. Preserve prepared limits and truncation semantics; flow
  credit is separate from capture/storage/total accounting. No new defaults or
  arbitrary job/output cap may silently narrow supported Core configuration.
- Initial-import TLS/CompletedInitialImport custody and its 60-second budget are
  distinct from actual current runtime Ready/assignment owners. Never relabel,
  reopen or renew those resources into a runtime owner or a global runtime cap.

## Verification

Read neighboring tests before lifecycle, framing, state or concurrency edits.
Use locked focused tests and production Clippy, then receiving server checks.
Actual peer pidfd/half-close/UID/process/FD behavior needs Linux kernel fixtures;
codec success and synthetic source controls do not qualify a real runtime.
Keep genuine regressions and isolated fault controls revision-scoped. Public
factories, selectors and routes stay absent until actual qualification.

```sh
cargo test --locked -p nac-native-execution
cargo clippy --locked -p nac-native-execution --lib -- -D warnings
cargo test --locked -p nac-server
```

The private client now implements Core's four existing RAW methods over the
actual private v2 connection. The Linux runner executes closed explicit-env
commands through `nac-process`, including actual PTY I/O and resize. Both actors
retain original-deadline stop ownership and join their actual Native I/O tasks
plus selected-driver/child cleanup. All constructors remain private and
uninstalled; no positive Core factory, public selector or production route is
added. The original unique peer lifetime is returned unchanged to its owner.

Construction resources are explicit per transport: live job/port storage,
physical wire queue records, per-stream flow windows, transferred input capacity
and whole-result capture ceilings. Retained input queues keep their job charge;
captured vectors keep a separate charge until transfer/drop. Actual completed
process/wire/output obligations release job deadline ownership independently
from a retained closed input queue; stale closed-port operations cannot revive
that deadline. Timer wakeups recheck the actual registration before committing
expiry; cached job stop/tightening tokens are inert after settlement. Caller
waker callbacks run outside notification locks through a private proxy; retain
independent read/write wake paths. These are not a
complete allocator/RSS bound. A validated immutable Native plan computes its
capacity declaration once; production constructors require Core's matching
opaque storage hold. Pools, escaping job/capture reservations and the actual
wire task set retain that charge independently of process cleanup. Constructor
errors retain the actual selected driver and task-join owner. Only explicit
unit fixtures can select unaccounted storage; the Core `test-support` capacity
fixture cannot mint a Boundary or production host/session issuer. Never borrow
Core retention defaults as a Native cap. Production admission composition,
prepared invocation and joint Root/current/effect/isolation settlement producers
remain absent. Private same-UID Linux tests cannot qualify those producers or a
managed runtime. Do not put target execution in `nac-server`.

The isolated production join now adds a fixed `nac-execution-runner` entry and
`NativeCreateLaunch`. The serving owner retains the launch before beginning any
source/child work. The issuer retains both original Core storage holds; child
storage retains the actual original-parent connection, matching immutable plan,
and weak physical gate. Copied launch dimensions cannot issue a Core hold or
boundary. The launcher exposes no caller-supplied arguments, environment or Command. The selected
ELF is explicitly installed, no-follow, root-owned and non-writable; launch
clears environment, supplementary groups and saved identities before exec.
The actual parent relationship and pidfd are checked independently of launch
DATA. Initial-import source authority, installed activation and Linux physical
qualification remain separate prerequisites; these additions do not establish
managed runtime or hosted acceptance.
