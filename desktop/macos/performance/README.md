# Mac release performance protocol v1 (ALL-353)

This directory defines a matched measurement, not a passing benchmark. Read
[the investigation report](REPORT.md) before using results. Workload sizes and
sample counts in [workloads.json](workloads.json) are experimental inputs, not
accepted performance budgets. No optimized artifact has been measured here.

## Allocated executable calibration

The manually dispatched `macos-performance.yml` and `run.py` implement a bounded
calibration stage. They do not execute the full required performance matrix.
The stored allocation has null target/harness nomination and dispatch fields;
`--calibrate` fails before launching commands until a separately approved,
committed allocation matches all three. Manual workflow default is validation
only. No workflow has been dispatched by this work.

Validate the schema, full scope, 100-input requirement and phase accounting:

```sh
python3 -B desktop/macos/performance/run.py --output /tmp/mac-perf-contract-validation
python3 -B -m unittest discover -s desktop/macos/performance -p 'test_*.py'
```

The evidence directory must be new. Calibration admission refusal also retains
an explicit attempt receipt; it never becomes an empty successful run. The
`process_usage.c` helper reads one same-user PID, brackets process identity,
and emits fixed SDK-declared resource fields. Failed reads/identity uncertainty
retain null metrics. CPU counters are retained raw with timebase metadata;
CPU percentages require runtime unit calibration. No signaling or undocumented
coalition API is added to this helper. PPID discovery is explicitly incomplete
for XPC helpers and cannot establish whole-set totals or cleanup.

`PerformanceJourneys.swift` defines `PerformanceJourneys/testCalibration` in
the existing `NACNativeUITests` module. ALL-354 alone integrates that source
using the `NAC_PERFORMANCE_SOURCE` build setting, and retains ownership of the
real Xcode project and `ci_xctest.py`. The runner checks actual generated
`.xctestrun` metadata and an actual one-test passed/unskipped xcresult; a zero-test
exit 0 is not qualification. Existing preconfigured Helper/no-auth policy is
observed before and after; no permission changes or prompts are requested.

The calibration creates one empty direct-session seed through real APIs,
orderly stops/checkpoints it, clones identical stores, and uses one dummy local
provider and the same private release engine bytes. This seed is for calibrating
public UI access, not a substitute for the 64-turn benchmark. The native arm is
an ordinary `app-build` with `LOCAL_APP`, Swift `-O`, no smoke definitions and
Rust `--release --locked`. Safari is ordinary installed Safari with a private
owned window; no WebDriver/AppleEvents preference or global setting is enabled.
Only exact newly launched app/active-window identities receive public input.

Both surfaces request 100 ASCII typing characters. Actual event receipts and
event-to-paint/frame observations are unavailable in the normal target until
separately approved observation sources exist. API scheduling, AX readiness,
and AX WebContent point dimensions remain labelled calibration observations.
They are not raw input latency, rendered frame distributions or verified CSS
viewport dimensions. Any batching/timing revision requires actual calibration
and identical versioned changes between arms; current batching remains one.

The calibration deliberately reports `measurement_ready=false` and exits 2
while required observations/full trials remain missing. It retains sanitized
JSON/JSONL/logs, a hash index, failed attempts, capped-export omissions and known
unsupported rows. Raw xcresult diagnostics, private binaries and profiles are
not uploaded. Failed profiles are preserved; success of a test runner never
proves missing XPC/process cleanup. No numerical product budget is generated.

The v2 core cap is 12,600 seconds including first-step checkout/setup, builds,
all planned phases, cleanup and export. The workflow adds a 600-second outer
upload/final-cleanup envelope and a 220-minute timeout. Per-phase values are
experiment guards. The 20 paired blocks and full required matrix remain future
measurement obligations; cold/reopen/notifications/physical energy/OS gaps are
explicit in `allocation-v2.json`. This calibration is a preparation milestone,
not ALL-353 completion or release acceptance.

Precise separate owner requests remain: complete bounded native telemetry
retention instead of the engine's 64 KiB stderr tail, and an opt-in read-only
document/paint observation source with clock/loss/overhead receipts. Any such
target amendment needs ALL-344/common-owner agreement and a new exact nominated
target, plus matching uninstrumented controls. None of those shared files or
hooks is changed or assumed by this implementation.

## Prerequisites and reproducible preparation

From the repository root, on the allocated Mac:

```sh
python3 desktop/macos/performance/preflight.py --output /tmp/mac-perf-preflight.json
```

The output path must be new and its parent must exist. Exit 2 means NO-GO.
Only allowlisted hardware/display/console fields are retained; serial numbers,
user names, device UUIDs and the raw system profiler/ioreg payloads are discarded.
An exit 0 is prerequisite capture only. It never establishes an active renderer,
trusted input, exclusive workload conditions or acceptance. If console status
is unknown, fail closed. Do not unlock the console, enable automation, grant TCC
permissions, change accessibility/input sources, or change global settings.

Obtain an explicit immutable source nomination and exclusive run allocation
from the coordinator. On this shared host, notify the coordinator *before*
requesting `gate.py exclusive`; it reserves all three Rust slots and the browser
slot, but cannot prevent unrelated npm/compiler work outside those leases.
Record coordinator allocation plus start/end observations of competing load.
Do not kill another job. Reject contaminated blocks; retain them as failures.

Run fresh-worktree setup through the setup lease. Build within a Rust lease:

```sh
python3 /tmp/nac-35-01a18fbf/gate.py setup make setup
python3 /tmp/nac-35-01a18fbf/gate.py rust /absolute/path/to/private-build-command
```

The private build command must use `cargo build --release --locked -p nac-server
--bin nac-web`, then copy the resulting executable from the leased
`CARGO_TARGET_DIR/release/nac-web` into a private artifact directory before
releasing the lease. Do not copy or reuse a shared binary outside its lease.
Record Git head, base, clean status/diff, `Cargo.lock` digest, `rustc -Vv`, Cargo
version, selected SDK, Swift version, target, all flags, build stdout/stderr,
engine `--version` and SHA-256. Record the committed embedded asset tree with
`git rev-parse HEAD:crates/nac-server/assets/dist` and hash the asset files.
No Vite server or second frontend. Asset drift checks use the existing writer.

For the accepted preview revision, its existing overrides can bundle that
private release engine; the default `preview.sh` engine is debug:

```sh
NAC_MAC_SKIP_ENGINE_BUILD=1 NAC_MAC_ENGINE=/absolute/private/nac-web \
  NAC_MAC_OUTPUT=/absolute/private/bundle \
  python3 /tmp/nac-35-01a18fbf/gate.py browser ./desktop/macos/preview.sh build
```

Swift already uses `-O -target arm64-apple-macosx14.0`. Hash both bundle
executables, Info.plist, source list and actual linked framework/SDK identities.
Retain `codesign -dvv` output and actual signing mode; ad-hoc development is not
distribution qualification. A future nomination may change build commands;
record them exactly rather than applying moving branches to this worktree.

Builds finish before timed trials. Measurement runs only private binaries:

```sh
python3 /tmp/nac-35-01a18fbf/gate.py exclusive /absolute/path/to/pinned-run-command
```

`private-build-command` and `pinned-run-command` above are allocation-specific
inputs, **not provided full benchmark drivers**. The source baseline lacks the
raw observation hooks required below. Preflight captures system prerequisites;
`fixture.py` supplies versioned provider input. The allocated public native/browser
calibration source still needs ALL-354 project integration and a separate runtime
decision. It does not execute the complete matched measurement matrix. Do not
report this protocol or calibration as an executed full benchmark.

## Matching contract and fixture construction

Use ordinary installed Safari as baseline A, AppKit/system WKWebView as B.
Record Safari version/build and WebKit framework versions independently; same
OS alone does not prove identical engine configuration. An optional Chromium
series is a separate comparison. Never label Playwright WebKit as WKWebView.
Use separate disposable browser data and no personal tabs/extensions. If
ordinary-browser process isolation cannot be established without changing the
user's environment, request a dedicated host/profile rather than killing apps.

Both arms use the **same engine bytes and embedded assets**, model
configuration, local provider script, immutable seed recipe and viewport.
Construct a disposable local Git workspace, dummy-only model configuration and
project using existing APIs, then direct sessions via ordinary UI/API contracts.
Generate 64 user/assistant pairs from the literal templates in workloads.json,
indexes 0..63; repeat each formatted assistant block 16 times. Seed by running
the local scripted provider through real session operations, then orderly stop
and checkpoint the store. Hash the closed store and fixture files. Never write
SQLite internals or share one live serving-store lease across arms.

Each trial gets its own restore from that closed seed, isolated HOME/NAC_HOME,
workspace and browser storage, with identical approved path mapping and no
real model credentials/network. Record a normalized logical seed digest when
paths or generated session IDs differ, plus each actual store digest and ID
mapping. Browser and native must navigate to the same logical workspace state.
Do not compare the browser New Chat dialog with an already populated native
conversation. Measure fixture preparation separately from product startup.

Run the owned external provider in a disposable fixture directory:

```sh
python3 desktop/macos/performance/fixture.py --mode transcript --evidence /tmp/mac-perf-seed-provider.jsonl
python3 desktop/macos/performance/fixture.py --mode stream --evidence /tmp/mac-perf-stream-provider.jsonl
```

These are alternative long-running processes; each binds an ephemeral loopback
port and prints its `base_url`. Point only the disposable NAC model configuration
at that URL with model `gpt-5.6-sol` and a dummy key. Transcript mode admits
exactly 64 sequential prompts from the manifest; streaming mode admits one
`MAC_PERF_V1_STREAM` prompt. Wrong sequence or exhausted plan returns 409 without
replay. Stop only the provider PID created for the trial after completion or a
recorded failure. These commands alone neither seed a NAC store nor measure UI.

The scripted provider emits the 256 specified deltas at 50 ms scheduled
intervals followed by the tail, existing Responses completion events and fixed
usage. Record actual send times, received SSE order/count/bytes and completion;
late timers are observations, not exact pacing by assertion. The current
FixtureProvider's two small deltas separated by 1.5 seconds do not implement
this workload. Its provider runs on the AppKit main queue; retain that attribution
or use the same external provider process in both arms so provider timing does
not masquerade as shell cost. Model dollars/tokens/remote latency are separate
and unmeasured; synthetic usage is never a model-cost estimate.

Launch 1 or 8 direct idle sessions, each with one actual Local PTY through the
existing human terminal workflow. Record session, terminal and process identities,
shell argv/environment and observed counts. Do not grant agent input or replay
uncertain input. For noisy output, an explicit fixture shell command writes
20 batches/s for 30 s, 32 lines/batch, 128 ASCII bytes/line including LF, with
monotonic line numbers and padding; record requested and actual emitted bytes,
terminal ONLCR translation, retained tail, gaps and last sequence. Nominal source
load is 81,920 bytes/s and 2,457,600 bytes total, before terminal translation.
The generator must be pinned and its source/digest retained before trial one.
Copy `terminal.py` and workloads.json together into the disposable workspace,
then explicitly run in the owned human PTY (no model/tool input replay):

```sh
python3 /absolute/fixture/terminal.py --evidence /absolute/fixture/noisy-producer.jsonl
```

It emits 19,200 numbered padded lines. Its evidence reports producer bytes and
write completion timestamps, not renderer drain or visible paint. A blocked
write can extend the nominal duration; retain the lateness and final total.

## Trial sequence and clocks

Fix both content viewports at 1280×800 points; record CSS viewport, device scale,
physical display mode, actual refresh, HDR, power source, low-power/thermal state
and brightness setting without modifying global settings. Require unlocked
console, visible active window, progressing rAF and an independent visible
paint witness. A DOM mutation, snapshot or double-rAF is insufficient to prove
pixels reached the display. Record active/focused/occluded state continuously.

Collect 20 paired blocks per workload, alternating A/B then B/A. Retain order,
all attempted repetitions, exclusions and causes. Fresh-profile warm-cache
launch, existing-store warm launch, and first launch after reboot are distinct.
Only call a trial **cold after reboot** after an operator-authorized reboot of
the dedicated host; rebooting shared hosts/cache purges are not authorized.
If 20 independent cold pairs are unavailable, report that cell incomplete; do
not combine them with warm trials or claim a reliable cold p95 from one sample.

In each launch trial, record monotonic timestamps for invocation, process start,
Rust bind/readiness, seeded-data ready, navigation, first useful workspace paint
and successful fresh composer interaction. First useful workspace means loaded
fixture session list, selected transcript, fonts and enabled composer with no
blocking overlay. Network ready and navigation finished are separate milestones.
Use one monotonic host clock for process/signpost timing; preserve JS timeOrigin
and clock synchronization uncertainty for cross-process comparisons.

For each arm/block, cover these cells separately:

| Cell | Procedure and required observation |
| --- | --- |
| Launch | Cold-after-reboot, fresh profile/warm caches, existing-store warm; first useful paint and interaction |
| Reopen | Close then Dock reopen without engine restart; engine identity and useful paint. Unsupported preview lifecycle is unavailable |
| Idle 1 / 8 | Settle each session/PTy configuration, then observe 120 s active and 120 s hidden; no streams/model runs |
| Long transcript | Load all 64 pairs, scroll top→bottom→top over 10 s each way with pinned driver; collect frame gaps, input and resource data |
| Streaming | Empty conversation then prescribed 256-delta response; time provider→transport→visible text, queue peaks and final drain |
| Terminal | Prescribed noisy output with 120×36 terminal; record parser/ACK backlog, retention and input echo alongside resources |
| Notifications | Hide window, complete one local run, record native delivery and presentation, click to reopen; retain permission/delivery failures |

Perform 100 trusted OS input events per block during long transcript, streaming
and noisy terminal. Measure composer event→visible glyph and terminal key→echo
separately; record event source and dropped/timeout counts (5 s observation
deadline, not a budget). Never dispatch synthetic events to qualify trusted
input. Existing denied/unavailable CGEvent/XCTest paths remain unavailable until
an authorized route exists. Do not change permissions. Hidden-window rAF suspension
is expected to differ; do not compare hidden gaps against active frame latency.

Close/terminate only owned fixtures using normal lifecycle, wait for model/PTy
settlement, store drain, child reaping and helper exit. Keep cleanup failures in
the denominator and preserve the owned profile for diagnosis if cleanup fails.

## Process accounting and supported instrumentation

Retain a PID **and process start identity** census before launch, during startup,
every second, on lifecycle changes and after cleanup. Classify: native/Safari
shell, every WebContent renderer, GPU, networking/helper, nac-web, workers,
provider, each PTY shell and descendants. Include startup and short-lived children
using process-lifecycle tracing. PPID traversal alone misses LaunchServices/XPC
helpers and reparenting. Bind helpers using process/coalition trace attribution
to this dedicated app/profile; do not guess ownership from a global executable
name. A shared/unattributed helper makes whole-set accounting incomplete.
Exclude driver/collector from the app sum but record their CPU/memory overhead.

| Signal | Existing seam/tool and limit |
| --- | --- |
| CPU / memory | Instruments Time Profiler/Allocations or macOS process tools with explicit PID identities; telemetry/resource.rs samples only the current Rust process |
| Physical footprint | Instruments/VM Tracker or footprint for every attributed process; retain private/shared/compressed detail. Sum RSS only as sum-RSS, not unique physical footprint |
| Wakeups / energy | Instruments System Trace/Energy instruments where supported; powermetrics may require privileges, which this task cannot acquire. Never substitute CPU for wakeups or VM energy for physical power |
| Startup/native paint | Proposed opt-in native signposts for invocation/readiness/navigation/paint/window state; absent at baseline. OS paint/input trace must validate the witness |
| Rendering | Bounded document-start rAF/resource/visibility/input observations on optimized assets, with capped buffer/loss count; observer affects results and needs matched disabled controls |
| Transport | Network instrument and existing HTTP-duration telemetry, SSE connection/count/bytes; retain clock bounds and delivered sequence |
| Backend queues | `NAC_TELEMETRY=stderr`, bounded exporter and final export receipts in nac-core telemetry/export.rs; persistence wait/execution/admission/capacity from telemetry.rs |
| Terminal queue | Existing pull/ACK protocol, retained-output gaps, input uncertainty and bounded admission; no browser receipt-as-render-completion shortcut (ADR 0006) |
| Dev counters | `perfDebug.ts` is DEV-gated; absent production counters are **not zero renders** |

The baseline PreviewProfile explicitly forces telemetry disabled, so inherited
`NAC_TELEMETRY=stderr` does not enable it. Coordinate any profiling-only profile
override with its single writer. Do not enable it silently or change production
defaults. No new HTTP/profile endpoint or generic profiler framework is needed.
Before shared edits, nominate a source list and agree the bounded opt-in hook
locations with their owners. ALL-342 owns normal startup/Profile/preview.sh;
ALL-354 owns the AppKit driver. None are modified by this package.

One-second CPU samples use delta cumulative user+system CPU time / delta wall
time, expressed as core-percent (100%=one busy core); publish both per-process
and group totals. Do not sum unrelated percent conventions or lifetime averages.
Wakeups distinguish timer and interrupt wakeups; unavailable counters stay null.
Record queue peak/capacity/rejections, overflow/loss and wait distributions.
Event-triggered depth gauges are not uniform time samples; use event-weighted
distributions or time-weight only when holding intervals are known. Existing
capacity limits are correctness constraints, not newly accepted speed budgets.

## Raw results, analysis and budget decision

Retain `identity.json`, preflight, workload manifest/hash, closed-seed recipe/hash,
source/build logs, exact run command, per-trial `processes.jsonl`, timing/input/
frame/SSE/terminal/telemetry JSONL, native trace, collector version/flags, cleanup
receipt and `attempts.jsonl`. Each row needs schema, trial/block/arm/workload,
window state, monotonic time/clock, PID/start identity, metric/unit/value or null
plus unavailable reason. Bound raw buffers and record loss; missing export final
receipt does not establish losslessness. Retain failed/partial trials.

Keep raw instrument traces in the task's controlled evidence directory: they
can contain local paths or content even with dummy data. Publish only reviewed
sanitized exports and reproducible source. No authenticated traffic, full process
environments, personal store, credentials or device serials in Git/PR. Generate
an SHA-256 evidence index and state raw retention location/access separately.

For each complete cell report n attempted/valid/failed, duration, unit, p50/p95,
min/max and paired B−A deltas with spread. Use nearest-rank percentile
`sorted(x)[ceil(p*n)-1]` (p=.5 or .95); never substitute zeros for failures.
Report timeout rate and censored observations separately; a p95 over survivors
alone must say so. Per-frame events are correlated: first summarize each trial,
then report the distribution across trials; do not inflate n by pooling frames.
Retain raw event distributions as well. No unsupported cross-hardware pooling.

Attribute a hotspot only with converging evidence: native signpost/time profile
for shell, JS/render/compositor traces for rendering, HTTP/SSE phases for
transport, Rust telemetry/profile for backend. A paired resource delta without
such attribution is whole-system overhead with uncertainty. Distinguish the
AppKit-hosted fixture provider from actual application shell work. Disable
profiling in paired controls to quantify observer overhead before setting budgets.

For Allison's decision, produce one row per hardware/OS/display/power class and
workload with measured browser/native distributions, observation uncertainty,
proposed startup/idle/core-CPU/footprint/wakeups/input/stream drain ceiling,
observed headroom and user tradeoff. Explain the numeric choice from observed
tails, baseline cost and controlled repeat variability; do not choose arbitrary
constants or automatically approve a regression. Until these measurements
exist, numeric recommendation is **withheld**. Human acceptance, candidate
passing those accepted budgets and ALL-358 release qualification are separate
obligations. Only measured failures against accepted budgets can scope ALL-357.
