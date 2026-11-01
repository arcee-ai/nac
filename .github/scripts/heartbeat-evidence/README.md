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
Prior registered-lane branch dispatches establish that capability; acceptance
of these new inputs and this runtime remains unexecuted until an allocated run.

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
4. Run the exact existing ignored1/10/100 test once, single-threaded, with its
   original two owners and1cold+24warm scans. Require one selected pass, three
   complete finite metric rows and original1/4/4 admitted plus0/6/96 pending.
   No timing threshold, repeat, automatic repair or heavy concurrent work is added.
5. Retain raw stdout/stderr, first safe error, typed child exits/signals, fixture
   removal checks, memory/load samples, namespace settlement and artifact hashes.

Only retained child handles are signaled. No host PID/process inventory or old
PGID fallback exists. The namespace PID1 reaps orphans and fails on remaining
members; its exit retires private namespace members through the kernel. This
is a Linux namespace boundary, not universal host cleanup or Darwin qualification.
See [unshare](https://man7.org/linux/man-pages/man1/unshare.1.html) and
[PID namespace lifetime](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html).

Artifacts upload on success and failure, including the original matched PNGs,
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
