# ALL-114 decision packet: NO-GO for embedded Turso adoption

Prepared 2026-09-30 for Allison. [ALL-114](https://linear.app/arcee/issue/ALL-114/qualify-embedded-turso-as-the-managed-nac-persistence-backend),
[PR #310](https://github.com/arcee-ai/nac/pull/310),
[coordination thread](https://arceeai.slack.com/archives/C0C5D23H46A/p1790794180915929).

Keep Managed NAC on SQLite WAL. The measured managed store-stage workload
showed no performance benefit from ordinary embedded Turso; direct copied-store
MVCC writes failed; io_uring could not initialize in the current gVisor runtime.
Full NAC conformance on Turso is unproved. This packet qualifies the candidate
and records a NO-GO recommendation; Allison owns acceptance. It does not adopt
an engine, enable ALL-115, merge a PR, or establish the cause of ALL-106.

## Scope and provenance

Production source baseline is dev `34e10bf77e9cfea1a208c1c9bf13b0659224b458`,
including ALL-112 #307 (merge `7790b720a250963cefcaf5505529b6a3487ccfa4`).
The experiment is an independent, unpublished Cargo workspace pinned to
`turso = 0.8.1` and `turso_core = 0.8.1`, default features disabled, syscall I/O
selected explicitly, with a separately compiled `uring` feature. It uses no
Turso Cloud endpoint or credentials. NAC's dependency graph and production
transcript/worker seams remain unchanged.

The accepted schema at this baseline is v29: 50 SQL schema objects exported
from a real ALL-112 synthetic store. `schema-v29.sql` SHA-256 is
`f72dba2b2b0bdf5cbfd642b8321eaa8f6c0bfe99bb00daec1817706bbbb34678`.
The fixture export uses `VACUUM INTO` after full scenario assertions and
shutdown, so committed WAL state is included. Each engine receives a new file
or separate copied file. No engine is given a live NAC store or customer data.
ALL-111's proposed schema v30 replay receipts and ALL-113's proposed worker
dispatch contract are separate review candidates, not accepted inputs here.
Any future adoption must qualify their final accepted schema and contracts.

The actual managed matrix ran code `f49494033e4a4d3815fa10f204107292407f3fac`
from [Linux artifact run 36766251401](https://github.com/arcee-ai/nac/actions/runs/36766251401).
The original probe binary hash was
`8e02d120187369831a4f774658cb8ffb7f8d1a3608d73f3b3e19c8d447c9b966`;
after removing debug information in the disposable pod, the executed binary
hash was `4e6f7b0f1563485d58fe8dbd1d284ab3afeb47225fc2795ba7e6cb494a189ed2`.
The driver records binary/schema/fixture hashes, exit status, stderr, and
watchdog outcomes for every lane, including failures. It never retries a lane.
The retained [managed matrix](evidence/managed/store-matrix-f4949403.json) hash
is `dbfeec1bc73609ab5d5e06d1a363bc90b96ec591a3d76f7a0056493edb880b5a`.
Later instrumentation or fixture changes do not retroactively change this
measurement's source revision.

## Actual managed runtime

Preflight inspected live Flux sources and current infrastructure, rather than
using the stale historical checkout: infrastructure `main@6e2d88b5`, controller
`main@e39a0da3`. No redundant GitOps promotion was made. With explicit disposable
development testing authorization, the experiment created only namespace
`all114-qualification`, pod `qualification`, a dedicated 20Gi RWO gp3 PVC,
and a deny-all NetworkPolicy. Existing owner/customer NACInstances and PVCs
were untouched.

The pod used RuntimeClass `gvisor`/handler `runsc`, managed node selection and
toleration, UID/GID 10001, read-only root, RuntimeDefault seccomp, no capabilities,
no privilege escalation, no service-account token, requests 1 CPU/2Gi and limits
4 CPUs/8Gi. The pinned accepted image digest was
`sha256:e892906bd07771950846c832758952fbfb388b299f433b5fb9c97fea8a813f0a`.
The PVC used `managed-nac-gp3`, EBS CSI, encryption, ext4, WaitForFirstConsumer,
and Delete reclamation. Inside gVisor the PVC reports a 9p mount; the underlying
storage remains EBS/ext4. Linux binaries built on Ubuntu 22.04 ran with Debian
glibc 2.36. This is actual sandbox/PVC evidence, not CI Linux evidence relabeled
as managed execution.

`io_uring_setup` failed with `not supported (host kernel version 4.19.0-gvisor)`.
That is gVisor's virtual kernel version; it does not mean the host kernel is
4.19. Platform inspection found runsc `release-20260817.0` without io_uring
flags. The [matching upstream flags](https://github.com/google/gvisor/blob/release-20260817.0/runsc/config/flags.go)
default io_uring off and describe it as test-only. No sandbox flags, seccomp,
host runtime, or production RuntimeClass were weakened. Ordinary syscall I/O
is a separately measured alternative, not a silent fallback for this failure.

## Workload and correctness gates

The same deterministic seed 168886546 and SQL operations are used for 1/2/4
logical orchestrators: parent/child/session/thread admission, generation CAS,
32 transcript transactions per child with canonical event/message JSON and a
fixed 192-character payload suffix, settlement, worker episode commit/rollback,
and completion inbox delivery. There are 32/64/128 measured append transactions.
No external model, retries, or timing sleeps are used in this store-stage matrix.

Each passing lane checks transcript count, unique positions, contiguous maximum,
stale generation rejection, revision CAS, no duplicated inbox delivery, worker
rollback, foreign-key enforcement, direct `foreign_key_check`, `quick_check`,
checkpoint, and reopen. A synchronized subprocess commits one revision update,
starts an uncommitted update, signals READY, then is killed and reaped; reopen
must retain only the committed update and reject a repeated expected-revision
mutation. This is process-crash evidence, not a power-loss durability proof.

The append phase uses one connection in fixed round-robin order. It exercises
`BEGIN CONCURRENT` in MVCC and separately characterizes a competing writer's
same-row conflict. It does **not** measure unconstrained parallel writers or
Turso's group-commit throughput advantage. The 1/2/4 labels represent logical
workload size, not 1/2/4 concurrently writing connections. Do not generalize
these timings to a concurrent MVCC scalability claim. The [upstream 0.8 release](https://turso.tech/blog/turso-0.8.0)
describes materially different concurrent workloads; those published gains are
not NAC measurements.

SQLite uses WAL, synchronous FULL, foreign keys enabled and a 5-second busy
timeout. Turso's fresh probe reports synchronous=2 and foreign_keys=1, and uses
its ordinary WAL or explicit MVCC journal mode. The competing writer probe
intentionally exposes different contention semantics: SQLite waits about 5s,
ordinary Turso reports locked promptly, MVCC reports a write-write conflict.
**Total lane elapsed time is not a performance comparison** because of that
SQLite timeout. Compare the append transaction phase below instead.

| Engine | Fresh 1/2/4 gates | Copied 1/2/4 gates | Managed append p95 range |
| --- | --- | --- | --- |
| SQLite WAL | pass/pass/pass | pass/pass/pass | 3.259–3.556ms |
| Turso syscall WAL | pass/pass/pass | pass/pass/pass | 3.880–4.179ms |
| Turso syscall MVCC | pass/pass/pass | fail/fail/fail | 6.831–6.997ms, fresh only |
| Turso io_uring | unavailable/unavailable/unavailable | unavailable/unavailable/unavailable | no valid measurement |

Ordinary Turso had higher append p95 than its corresponding SQLite lane in all
six comparisons (about 12–26%). Native-fresh MVCC was about twice the SQLite
append latency under this sequential contract. These are one bounded run per
lane, with small samples and a shared development node/PVC. They demonstrate
no measured benefit in this workload, not a universal engine ranking or
statistical significance.

## CPU, memory, storage, startup and application limits

The driver records process CPU from `wait4`, including setup, gates and lock
characterization, not just appends. In milliseconds, fresh 1/2/4 totals were
SQLite 50/60/130, ordinary Turso 110/170/250, MVCC 210/350/570; copied totals
were SQLite 130/110/120 and ordinary Turso 140/220/310. gVisor accounting is
coarse (roughly 10ms ticks), so these small totals are directional evidence,
not precise per-transaction CPU costs. Every successful lane reported the
same 86,593,536-byte peak RSS; virtualized high-water accounting does not
distinguish engine memory usage here. No memory advantage is claimed.

After checkpoint/crash/reopen, fresh SQLite database files were 360/372/404KiB;
ordinary Turso 376/388/420KiB plus a 4,152-byte WAL; MVCC 380/392/424KiB plus
a 255-byte log and zero-byte WAL. Copied ordinary files matched SQLite database
sizes, with a 4,152-byte WAL remaining. Checkpoint returned rows `[0,0,0]` in
passing lanes. File sizes are bounded fixture outcomes, not sustained WAL
growth, write amplification, large-PVC capacity, or long-run checkpoint tests.

The Linux experiment binary is about 60MiB after debug stripping, containing
both engines and probe code. No Turso-enabled NAC application image was built;
therefore image delta, application startup latency, Turso readiness/health
under load, and full process topology are **unmeasured adoption gates**. The
managed base image and worker are unchanged. A native Linux NAC worker help
invocation started successfully, and the existing serving-store ownership
test rejected a second manager and allowed restart on the managed PVC. Neither
proves a Turso implementation of NAC's OS ownership/fencing contract.

ALL-112's full adapter still returns a concrete SQLite SessionManager; core,
worker and assertions call SQLite APIs directly. The SQL probes do not prove
full orchestrator/worker lifecycle, lease cancellation, ambiguous dispatch,
completion/recovery, or canonical transcript contract conformance on Turso.
The subset also lacks session-event cursor mutations, timed lease renewal and
expiry, and the application's actual cancellation/claim machinery; generation
and revision CAS probes are not substitutes for those behaviors.
An engine switch must retain the path-backed seam and final ALL-111/113
contracts. Production defaults were not changed to manufacture that evidence.

## Full SQLite controls and retained failures

The first local full 1/2/4 fixture and six fault lanes passed. A subsequent
local ordered four-way invocation failed with `expected start idx 1, found 2`
and a completion-order timeout. The next copy invocation passed. Both success
and the exact failure are retained under [local evidence](evidence/local),
including full failure log SHA-256
`55907ed2f3f1a6f30577c8242da71670c5003a379ad92d02bf9db7928b13bbf4`.
The separate unconstrained settlement probe's passing outcome means only
`completed_without_reproduction` for that run. No retry erases a correctness
failure or establishes the ALL-106 cause.

Initial managed full-control attempts had missing compiled workspace Git
metadata, then Git safe-directory ownership errors. Those setup failures and
one exit 139 are retained and cannot be classified as database faults. After
correcting workspace metadata and native worker prerequisites, the worker
emitted all five expected events and exited 0, but the fixture timed out before
managed Completed. The denied external Smithery catalog warmup was present
in the logs. Independent coordinator inspection found contiguous transcript
through index 3, terminal disposition completed and relationship still running
around the 20-second deadline. This is a harness/runtime prerequisite diagnosis,
not an engine-causality finding. A wrapper diagnostic is labeled separately
because it changes the process topology. The exact fixture Git tree was then
made fully tracked (`7952570af366d9f2e147bdda6f095b8877cb8c42`).

The final fixture adds only a test-compiled preload of the embedded catalog,
so catalog refresh does not require external networking during qualification.
Its final local/managed results are recorded in the verification addendum;
prior failed invocations remain independently retained.

## Compatibility and rejected alternatives

* Ordinary Turso loads current DDL and copied rows, and passes the bounded
  mutation/reopen gates. Compatibility over this SQL subset is not full NAC
  compatibility or permission for shared SQLite/Turso writers.
* The table-valued `pragma_foreign_key_check` query is unsupported. Direct
  `PRAGMA foreign_key_check` works in the probes; adapting diagnostics would be
  a deliberate compatibility substitute requiring full-store validation.
* Enabling MVCC on a copied SQLite fixture and inserting thread events fails
  with `missing backing table for sequence
  __turso_internal_autoincrement_thread_events`. It fails for all copied 1/2/4
  lanes locally and on managed PVC. Native Turso DDL creates working backing
  state. Direct copied-file MVCC activation is rejected; a separately designed,
  identity-preserving logical conversion would need qualification.
* Current managed io_uring is unavailable. Enabling experimental runsc flags,
  relaxing seccomp, or moving customer workloads to runc is rejected as an
  adoption prerequisite inferred from a benchmark.
* Turso Cloud is outside scope. Replacing leases, retries, run identity or
  worker topology to suit an engine is rejected. ALL-111/113 solve their owned
  persistence contracts independently of this experiment.

## Restore, rollback and any future GO prerequisites

This PR requires no production restore or rollback: it changes experiment/test
artifacts only. Disposable pod/PVC removal must follow copying/hashing evidence.
For a future conversion, retain the original SQLite store and all required
WAL/sidecars via a verified consistent backup while the serving process and
workers are quiesced. Acquire the existing exclusive ownership contract; never
allow two engines to write the same store. Convert into a **new** target, keep
session/run/thread/relationship identities and transcript bytes unchanged, and
verify schema, row counts, canonical transcript positions, foreign keys,
integrity, revisions, leases, inboxes, episodes and restart behavior before
switching an explicit versioned engine manifest.

SQLite must not reopen a Turso MVCC-mutated file as an assumed rollback.
Rollback means restoring the untouched verified SQLite backup under the
matching SQLite application version. Writes after cutover require a separately
qualified reverse logical conversion or an explicitly accepted recovery-point
loss; neither exists in this packet. Exercise restore before adoption, including
PVC permissions, ownership/restart, sidecars, checksums and backup retention.

A future GO needs current final schema and ALL-111/113 contracts; a complete
engine-neutral application adapter; fresh/copied conversion and actual managed
1/2/4 lifecycle/fault conformance; true concurrent MVCC contention workloads;
repeated controlled performance, CPU/RSS and health/readiness evidence; crash,
durability, long-run WAL/checkpoint and restore coverage; compatible image/startup
measurements; and an explicit security/runtime decision if io_uring is required.
The missing gates and observed failures are sufficient for NO-GO now. Continue
current SQLite ownership/transcript/worker work without treating an engine
change as the established ALL-106 remedy.
