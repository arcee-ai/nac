# Finite Linux evidence for ALL-480

This control layer adds an explicit selector to the already registered
`stable-release.yml`. Its default `heartbeat_evidence=none` preserves ordinary
push/PR/manual CI and release behavior. Only `matched-and-measure` on
`codex/all-480-linux-evidence`, with the exact published control SHA, selects the
separate reusable `workflow_call` job. Unknown modes, a different branch, stale
control SHA, changed product pins or unexpected dispatch fields fail closed.
There is no new dispatch registration, schedule, monitor, model trigger or
release publication in this lane.

The identities are deliberately distinct:

- **W:** the reviewed, published control commit on the evidence branch.
- **H/T:** product48 `48b9769453c7cb0b245d9f9b1f955ef4a880a431` /
  `b2f53563c8bebdc8322c636b74a57fac1f981086`.
- **B:** frontend `adefd79e7b43c35f98d760ffa5ff846dc8c13e32`, before the missing
  heartbeat inspection-state repair. It shares the current48 backend/store.

The source product, test assertions and generated bundles are not changed. The
six functional current48 cases already passed in Linux CI job124791211077
(165 passed/1 unrelated review-fixture skip); this lane does not rerun them.

## Future explicit invocation

After source checks, independent affected review and a separately allocated
publication/execution step, the documented branch recipe is:

```sh
gh workflow run stable-release.yml --repo arcee-ai/nac \
  --ref codex/all-480-linux-evidence \
  -f heartbeat_evidence=matched-and-measure \
  -f heartbeat_control_sha=EXACT_PUBLISHED_CONTROL_COMMIT
```

Replace the last value with W's full forty-character commit. A moved branch
fails the W/event/checkout comparison. Do not dispatch as a test of the API: it
starts real work. [GitHub documents branch selection and declared inputs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow?tool=cli),
and the [REST contract binds ref and configured inputs](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
The original full attempt [41307523898](https://github.com/arcee-ai/nac/actions/runs/41307523898)
at control `dabe739b48c0c45fc85f714ee623b8e7a23c29e4` failed the support parser's
hardcoded filtered count: the exact test passed with351 filtered, versus352
expected. Its two fresh-host custody cases and original matched captures passed;
the overall run remains failed. Twenty manifested font-cache originals were
absent from its upload, and postmeasurement checks were not reached. Those raw
outputs remain immutable. This candidate corrects the support harness only;
its changed runtime and upload path have not been executed or qualified.

## Execution and custody

One Ubuntu hosted job provisions locked dependencies and Chromium. The finite
owner validates W and the clean exact H/T/B before product work. It takes an
exclusive local evidence lock; workflow concurrency serializes this lane's
dispatches without cancellation. It launches a fresh private Linux PID/mount/
network namespace using existing `sudo`/`unshare`/`ip` capabilities. Bootstrap
permits loopback only and drops to the original runner UID/GID before compiling
or running product code. Missing capability fails; no host policy, sysctl,
package installation or network fallback is attempted by the runner.

The namespace has no external interface, and inherited vendor credentials are
omitted. Dependency installation precedes this fence; Cargo compilation inside
uses `--locked --offline`. Product and measurement binaries are copied, hashed
and retained at0700 before execution. The exact source and asset tree are checked
again after building. There is no Vite rebuild or generated product output writer.

Phases run in order under one20-minute phase budget and a21-minute enclosing
child wait, with bounded signal retirement and the job's45-minute hard limit:

1. Compile product and the existing library test executable without running it.
2. Capture B/H at1920×1200 dark, using the same fresh idle direct chat and current
   backend. The unchanged capture assertions require GET/HEAD browser proxy,
   zero model work, unchanged before/after metadata, actual404 inspection, B's
   generic state versus H's visible error, settled layout/fonts and unclipped
   text. Preserve original PNGs/traces/network logs without masking or editing.
3. Require capture/browser namespace members to settle before measurement.
4. List the full registered test inventory using `--list` on the same retained
   measurement executable; require unique names, an exact inventory summary and
   exactly one registration of the complete measurement name. Bind its hash.
   Then run the exact existing ignored1/10/100 test once, single-threaded, with its
   original two owners and1cold+24warm scans. Require one selected pass, three
   complete finite metric rows and original1/4/4 admitted plus0/6/96 pending.
   Require the filtered count to equal the actual full inventory minus that
   one selected test, rather than a count copied from another platform.
   No timing threshold, repeat, automatic repair or heavy concurrent work is added.
5. Retain raw stdout/stderr, first safe error, typed child exits/signals, fixture
   removal checks, memory/load samples, namespace settlement and artifact hashes.
   After a measurement attempt, record postmeasurement resources, fixture checks
   and final product verification even if parsing fails. Attempt each final check
   and retain its errors without replacing the original failure or retrying work.

Only retained child handles are signaled. No host PID/process inventory or old
PGID fallback exists. The namespace PID1 reaps orphans and fails on remaining
members; its exit retires private namespace members through the kernel. This
is a Linux namespace boundary, not universal host cleanup or Darwin qualification.
See [unshare](https://man7.org/linux/man-pages/man1/unshare.1.html) and
[PID namespace lifetime](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html).

Artifact retention first validates the exclusively created0700 evidence root,
bound to control/run/attempt and current UID before setup. A no-follow descriptor
walk rejects symlinks, hard links, foreign ownership, unexpected top-level or
hidden paths, sensitive file names and missing/changed producer-manifest entries.
The only allowed hidden subtree is the owned run's fontconfig cache. The upload
includes hidden originals only after this guard passes, scoped to that evidence
root; it explicitly excludes the separate unmanifested `run-build/**` compiler
cache. Original binaries remain in `run/bin`, with original logs and manifests.
A validation failure fails closed and leaves its diagnostic in the job log.
No global home, credential cache, product checkout or workspace is an upload input.

The controller-SIGKILL fixture can leave its bound socket pathname after process
death. Before cancellation, the driver retains that endpoint's device/inode,
type, ownership, link count and change time, checked against the controller's
observed bound endpoint and an open private directory descriptor. Only after
the existing retained controller/wrapper/PID1 death checks succeed does it
recheck the directory and exact no-follow entry and unlink the stale socket.
Unbound, foreign, replaced or symlink entries remain untouched and fail the
case. An already absent endpoint is recorded without another deletion. The
upload guard rejects any remaining `lifeline.sock` and all other special files;
it does not export or silently skip them. Symbolic lifecycle controls exercise
the actual driver through that upload boundary using regular placeholders,
without creating a socket, namespace or pidfd. Actual repaired runtime remains
unexecuted.

Validated artifacts upload on success and failure, including the original matched PNGs,
both retained executables, manifests and full logs. Header/dimension/hash checks
do not replace individual visual inspection: that remains pending after capture.
Hosted VM background/hypervisor competition is not controlled; samples are not
an idle-physical-host claim, cross-platform latency SLA, production-binary
throughput benchmark or live-model reliability result. The measurement uses the
existing loopback application fixture. The capture admits no model work.

## Source checks and remaining acceptance

Source/mocked checks only:

```sh
python3 -B .github/scripts/heartbeat-evidence/contract.test.py
python3 -B .github/scripts/heartbeat-evidence/runner.test.py
python3 -B .github/scripts/heartbeat-evidence/artifact_upload.test.py
python3 -B .github/scripts/heartbeat-evidence/endpoint.test.py
node --test .github/scripts/heartbeat-evidence.test.mjs
node --check .github/scripts/heartbeat-evidence/capture.mjs
make lint-workflows
make test-source-size
```

The controls prohibit actual subprocess/native/network calls in the Python
fixtures. They exercise event/pin rejection, the real libtest prefix/selection,
all metric cardinality/value checks, typed timeout/force/receipt-I/O custody,
secret omission, and the build/capture/settle/measure transition with a retained
orphan. Static workflow controls cover default routing, unchanged ordinary PR
gates, least privilege and mandatory success artifact retention.

Source checks do not prove namespace availability, original PNG pixels, actual
runtime cleanup, CI dispatch input acceptance or current measurement values.
Those require the separately allocated execution and image inspection. The
earlier Darwin observer05/06 failures and unrun native compatibility cases remain
recorded separately; this lane neither requires them universally for ALL-480 nor
substitutes for Mac-specific ALL-349/351/WK requirements. No merge is authorized.


## Calendar cost-only successor (source; execution separately admitted)

The opt-in calendar-cost mode pins product cb1f76f29302f4eafa768e6913d257b75e3ab247,
tree8681d950d2fb6c09e1e8fa488d0c9609a38b6f1a and the exact control branch
codex/all-481-linux-cost-evidence. Existing matched-and-measure/custody-check
pins, visual behavior, ownership and ordinary/default-none CI are unchanged.
Do not publish or dispatch this source until the original SAME592 affected
review and Root source acceptance. A later explicit dispatch supplies the new
control SHA using the existing two declared inputs; no product/command/selector
input is accepted. Product592 and prior1370 control refs remain untouched.

The mode runs guide-required locked setup before private namespace entry,
then builds ONLY one normal nac-server library test executable using locked
offline Cargo. It has ownfeatures[], opt0/debug2/debugassertions/overflowchecks,
normal core/managed default+openapi+test-support dependencies, and no profile,
identity, vendor or wrapper overrides. Raw compiler JSON, dependency graph,
rustc/cargo, exact source/tree/lock/manifest/measurement-source hashes and host
kernel/architecture are retained. The unique actual server artifact must be
within the owned build root, no symlink, at most1040MiB, and is copied once to0700.

The FULL list from that same retained ELF must include both exact owning
interval/Calendar ignored selectors once. All compile/copy/hash/inventory
writers finish and namespace children settle before one fresh60s quiet interval.
A sampled observer remains active through both selectors, rejecting compile/
browser/Node workers, unknown process observations, observation errors or floor
loss. Its PID/start/CPU metadata is from the private namespace, without argv or
environment. Serial job isolation is the evidence for absence of other OWNED
guest workloads; background guest services/hypervisor competition are not
controlled or silently claimed to be idle/dedicated physical hardware.

Exactly one interval invocation precedes one Calendar invocation, same ELF,
each180s, exact/ignored/nocapture/single-threaded. Require1P0F0I plus3 ordered
N1/10/100 rows each,2owners,active1/4/4,pending0/6/96,retainedN and catchup1/8.
Validate current cadence/calculation/retention schema and nullable whole-process
RSS.24sample quantile indexes12/22/23, cold-vs-preview scope, fixed order/cache,
pending mock/non-Git fixture, seven-day lateness/nonSLA limits remain intact.
No real model, Git materialization, goal-publication, Mac353 or exactMac1061
performance is measured. First failure stops later dispatch; no retry/waiver.

The existing45min job cap and20min inner/21min outer namespace ownership limits
are unchanged. New mode reserves120s at its original inner cutoff for cleanup.
Before starting quiet it must fit60s quiet+435s cases/ordinary closure+120s
cleanup; before each case retain(remainingcases*180)+75+120s. Build has a720s
maximum but is not promised to fit those reserves: slow build stops BEFORE
measurement. No deadline resets or use of historical runtimes. All phases
retain the established ordinary child receipts, namespace lifeline/pidfd
retirement, failure finalizers and guarded manifest export after writer death.

Guest resource admission is deliberately separate from laptop20GiB policy:
require actual free disk>7.75GiB (5GiBbuild forecast,1.5GiBexport bound,
256MiBfailure reserve,1GiB floor) and MemAvailable>=4GiB BEFORE Cargo. Check
the1GiB+256MiB free-disk threshold before/after phases and during quiet/cases.
The retained ELF is<=1040MiB and complete run export<=1.5GiB; run-build remains
excluded. These are forecast/admission limits, not measured current capacity
or an OS quota/disk reservation. No cache cleanup or enlarged runner is
implicitly authorized. Root must accept these explicit guest limits before
future dispatch; failure requires a separate decision, never automatic resize.

Source controls include calendar_cost.test.py in the existing Makefile target.
They prohibit real subprocess/socket/native calls, mock all runtime ports,
exercise real new parsers/runner orchestration/quiet-time arithmetic and retain
legacy cases. Node workflow checks were updated for the new fixed mode and
import file; a source-only phase that forbids Node must disclose those checks
and full workflow lint as NOT RUN, not passing. No runtime pass follows from
these pure controls. Old local attempts1/2/3, old Linux failures/supplier
identities and acceptedquiet0 remain immutable.


### COST-C1 final stable upload bound

For calendar-cost, the authoritative1.5GiB check is now at FINAL upload
admission over ALL exported regular-file bytes: outer setup/custody, run data,
producer manifests, late diagnostics and upload-validation.json itself.
Only run-build/** is excluded. The first guarded walk can stop oversize
before hashing further bulk; all passing files retain the original ownership,
no-follow, single-link, stable-hash and producer-manifest checks.

The guard accounts for its own receipt bytes to a fixed point, then writes the
receipt and revalidates the entire final tree and exact receipt hash/size.
New/changed/deleted records fail admission. No records are written afterward
inside the upload tree. Workflow step success remains mandatory for upload.
Overflow WITHHOLDS upload without pruning/deleting original failed evidence.
An undersize retired failure bundle remains eligible; legacy modes retain
their original behavior. These pure controls do not qualify a real upload.
