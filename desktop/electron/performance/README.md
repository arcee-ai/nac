# Early Mac release comparison

The checked-in [13 November 2026 report](results-macos-development.md) is
historical evidence for its recorded product revisions, including `4cada76fc`.
It predates the merge of `dev` at `87e8eb6b3` for PR publication and does not
measure the current PR head. The commands below describe reproduction; a new run
must record its own exact engine, assets, source/tool identities and conditions.
Public evidence uses labeled disposable-root/host-identifier redactions while
preserving measurements and original product/tool provenance.

This owner runs a bounded development comparison of the **normal packaged**
Swift/WKWebView and Electron apps. It does not replace ALL-636/637's controlled
hardware qualification, frozen budgets or broader release gate.

Both arms must contain the byte-identical optimized `nac-web`, which embeds the
same committed production React assets. The comparator checks the engine hash
before launching either app. The existing Swift builder compiles its shell with
`-O`; Electron uses the packaged vendor runtime without DevTools or a debug port.

From the repository root, after `make setup` and the Electron package build:

```sh
NAC_MAC_SKIP_ENGINE_BUILD=1 \
NAC_MAC_ENGINE="$PWD/target/electron/NAC Electron.app/Contents/Resources/nac-web" \
NAC_MAC_OUTPUT="$PWD/target/electron-performance-swift" \
./desktop/macos/preview.sh app-build

python3 desktop/electron/performance/compare.py \
  --swift "$PWD/target/electron-performance-swift/NAC.app" \
  --electron "$PWD/target/electron/NAC Electron.app" \
  --output "$PWD/target/electron-performance-$(date +%s)" \
  --samples 5 --settle-seconds 10 --idle-seconds 10 \
  --quit-wait-seconds 180
```

The output directory must be new. The runner creates independent private
HOME/NAC_HOME/config/workspace/stores and launches through macOS LaunchServices,
passing scoped environment overrides. It never runs shell startup files or opens
a personal store. `--seed-store` accepts an already-settled **disposable fixture**
store, backed up read-only into both arms. Do not pass a personal store. Retained
project paths must still exist if the seeded workflow needs them.

The apps retain their protected Quit behavior. When the runner prints
`waiting_for_protected_quit`, a supported native UI actor must choose **Stop and
Quit** if confirmation appears. The tool does not bypass that dialog or turn
unknown activity into idle. On timeout it records failure, retains profiles and
stops further launches. Do not force-kill an engine to improve a trial.

## Measurements and limits

`samples.json` is schema version 1 and retains every trial, failed trial and
cleanup outcome. Arms alternate order between rounds. Trial zero is a fresh
store/profile; later trials are returning process-cold launches. OS caches remain
intact; there is no cache purge or claim of disk-cold launch. Both are measured
separately from the same-process hide/LaunchServices reopen proxy.

The startup boundary is the first visible layer-zero native window owned by the
exact app. **It is not composer readiness, web content readiness or actual paint.**
Warm reopen is hide/reopen of the same app incarnation, not a new engine launch
and not a measurement of native window-close semantics. The independent actual
Electron suite owns functional close/reopen and workflow assertions.

The read-only AppKit observer uses no accessibility permission, screen pixels,
input synthesis or OS settings changes. Its polling and process-launch overhead
is included in the window proxy; this is intentionally a coarse early comparator.
It captures app PID/kernel birth and exact bundle URL before any native
activation/hide/Quit request. Missing kernel identity or ambiguous instances
refuse controls. LaunchServices `launchDate` can be unavailable during registration
and is not used as a process-incarnation guard. Reopen setup first foregrounds
the exact owned app, outside its timed hide/reopen interval. The actual CG window
bounds and intersected display IDs/bounds/Retina scale/Hz are retained. A single
unambiguous display is required throughout. First-visible bounds can be a macOS
opening-animation frame (for example width1278 before1280); the launch proxy and
those raw bounds remain unchanged. Resource geometry is admitted only after the
configured10-second settle allowance, then must stay equal through idle samples
and across that arm's trials. Warm reopen still times first visibility, followed
by a separately recorded, bounded observation of the original settled geometry.
Missing displays or steady geometry drift refuse admission. Failed admission
stops new trials after ordinary cleanup; an explicit fresh run is required.

CPU uses `proc_pid_rusage` cumulative user+system counters, converted from Mach
ticks with `mach_timebase_info`, normalized to one logical core over each interval.
The primary source for the clock domain is Apple's
[XNU rusage producer](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/bsd_kern.c).
The collector's conversion is checked against Python `time.process_time()` with
a bounded busy loop. Mac physical footprint comes from `ri_phys_footprint`, not
RSS, and is summed across the exact app's LaunchServices coalition plus observed
descendants. This includes detached WK WebContent/GPU/Networking and Electron
renderer/GPU/network/crash helpers, together with `nac-web`. Separate engine CPU
and per-process roles remain in the receipt. Package-idle and interrupt wakeup
counters are retained. Global WindowServer allocations are not attributed.

Membership changes or unavailable process counters mark intervals incomplete;
those trials are retained but excluded from aggregate resource comparisons.
They cannot establish a whole-app CPU budget pass. Process birth
bookends reject PID reuse. Coalition discovery, `ps` and collector launch happen
outside the candidate and their elapsed collector cost is retained; they can
still add shared-host load. No names or other apps' process metadata are saved.

The runner requests ordinary protected Quit and observes disappearance of every
captured exact app/helper/engine identity, then checks no executable from the
bundle remains. An unavailable counter is not absence: an independent complete
PID census must exclude that PID, or a valid new birth must prove replacement.
A present PID with unknown counters stays pending. It never signals a discovered
PID. A pending cleanup is a failure,
not a passing zero-CPU sample. Profiles remain as bounded disposable evidence.

## Workload comparison handoff

The early report must pair native proxy/resource results with the integrated
candidate's actual workflow evidence. Typing/streaming, long transcript/history,
and noisy terminal tests should reuse the shared scripted provider and retained
output fixtures. Electron DOM completion/rAF measurements are diagnostics, not
physical input-to-paint measurements or matched Swift latency distributions.
The normal Swift app has no production DOM automation/debug bridge. The optional
optimized instance fixture supplies the same `workspace-probe.cjs` function used
by the Electron actual-app test, without enabling debug APIs in normal bundles:

```sh
NAC_MAC_PERFORMANCE=1 NAC_MAC_SKIP_ENGINE_BUILD=1 \
NAC_MAC_ENGINE="$PWD/target/electron/NAC Electron.app/Contents/Resources/nac-web" \
NAC_MAC_OUTPUT="$PWD/target/electron-performance-swift-diagnostic" \
./desktop/macos/preview.sh instance-build
```

The canonical builder requires the engine's source revision to match current
HEAD. Rebuild the engine before this command after source commits. Its receipt
captures the opt-in `ELECTRON_PERFORMANCE` compiler flag and observer Swift source;
the result additionally records the shared JavaScript's SHA-256.

Launch this fixture with ordinary `--directory`/`--store-path` and these test-only
arguments: `--instance-scenario performance --instance-output <result.json>
--instance-control <private-existing-directory> --instance-store <canonical-store>
--instance-performance <config.json>`. Scope HOME/NAC_HOME, MODELS_DEV_URL and dummy
NAC_E2E_API_KEY to this launch. The driver owns a shared scripted provider and
queues exactly one history and one streaming response per arm. The bounded JSON
config contains `providerURL`, `historyPrompt`, `historyMarker`, `streamPrompt`,
`streamMarker`, optional `repeats` (default 5) and `inputEvents` (default 200).
Use a long history response of at least 256 KiB. No fixture sends real credentials.
`PacedProvider` wraps that same loopback provider and emits up to60 Unicode-safe
text deltas at30Hz over about2seconds before preserving its exact completion
records; non-SSE routes pass through. Actual pacing intervals are available in
`receipts`. This is an early bounded stream, not the ticket's60-second cell.

The result reaches `performance-ready` with a `performance` record; write the
control directory's `finish` file to let the original fixture enter ordinary
protected Quit. The current-view/receipt fence remains active before and after
the observation. Terminal pressure writes at least 266,240 bytes per repetition;
resize and interrupt use authenticated HTTP operations and wait for actual PTY
status/visual markers; close waits for both process and collector settlement.
These do not establish physical terminal keyboard delivery. Synthetic composer
events, transcript opening/scrolling and terminal markers are DOM/next-rAF
proxies; streaming mutation intervals include React and fixture observation cost.
Both shells execute the same bounded probe; record its overhead and keep these
diagnostic receipts separate from normal-package resource/window timings.

Native foreground is an admission fact. Playwright can emulate DOM focus while
the actual native window is inactive; `document.hasFocus()` alone is insufficient.
The focused probe records the current textarea, document visibility and viewport/
DPR. Its Swift wrapper additionally requires NSApp active/key-window state at
entry and exit, with no resign-active, resign-key or hide notifications during
the cell. The Electron executor independently guards actual native focus and
disables DOM focus emulation for timing admission. Both arms record their actual
window display/backing scale; `system_profiler` hardware inventory cannot replace
the actual target display. A locked console or lost native focus refuses the
cell. Never unlock by changing OS privacy/security settings or treat rejected
cells as a performance pass.

Proposed ticket budgets remain calibration targets: composer process-cold p95
3s, warm 1.5s, input p95 100ms/p99 250ms, ordinary tail p95 500ms; total idle CPU
2% of one core and baseline+0.5pp; Mac footprint 750MiB and WK+250MiB. Native-window
timings cannot pass the composer/input budgets. A demonstrated material regression
requires repair or an explicit review limitation; a small/noisy sample never
freezes budgets or proves parity. ALL-636/637 retain controlled power/display,
minimum hardware, adequate sample counts, real paint/input, hidden/minimized
cells, navigation growth, long soak, Linux and final parity certification.


The actual-app executor `desktop/electron/e2e/performance.spec.ts` supports an
explicit native observation gate with `NAC_ELECTRON_FOREGROUND_GATE=1` or
`NAC_SWIFT_FOREGROUND_GATE=1`. It writes `target/{electron,swift}-foreground-ready.json`
with the exact live PID, private directory and gate path. An authorized native
actor verifies that identity, attaches/raises the window, then creates only that
private gate file. Swift validates that its gate and ready paths are siblings of
the private configuration. Native activation happens before timing; no UI actor
interacts during the probe. Electron additionally records accessibility support
before/start/end and change events; `NAC_PERFORMANCE_EXPECT_AX=false` asserts an
observed mode without forcing accessibility off.

`performance-attribution.spec.ts` is opt-in with
`NAC_ELECTRON_PERFORMANCE_ATTRIBUTION=1`. Its default diagnostic captures bounded
CPU/trace data. `NAC_PERFORMANCE_NATIVE_LAYER=1` instead captures up to 200 current
layers/reasons plus a two-second native renderer sample with a 60-second completion
bound. Exact process-birth bookends and native accessibility/focus/display guards
remain active. Profiling adds overhead; failures and partial captures are retained
in unique `target/electron-performance-attribution-*` directories and never pass
budget gates. Stripped nearest-export names are not exact native symbols.

The executor's `NAC_PERFORMANCE_COMPOSITING_CONTROL=1` and
`NAC_PERFORMANCE_FILL_CONTROL=1` are diagnostic CSS hypotheses only; each report
records the override. They must be off for canonical candidate acceptance. The
first was rejected; the second identified completed opacity-animation retention
while preserving the existing 150 ms fade. No generic graphics-disabling flag or
accessibility override is part of the tooling or product.
