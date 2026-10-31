# ALL-353 investigation checkpoint

Decision: **NO-GO for local active-window measurement; investigation pending
hosted allocation.** No browser/WKWebView release distributions or numerical
budget recommendations exist yet. This checkpoint does not complete ALL-353
acceptance or clear ALL-358. No observed data supports a WebKit speed claim,
performance remediation under ALL-357, or a runtime/model cost estimate.

## Source and retained evidence

- Task: `01a190a6-f47b-75f0-abd1-f8c961e566a5`; stored native finite goal
  BLOCKED. The coordinator subsequently authorized ordinary bounded preparation
  and the narrow calibration implementation; no native-goal reset occurs.
- Repository: `/Users/allison/.codex/worktrees/08e6/allison-demo`;
  branch `codex/all-353-mac-performance`.
- Baseline: `f71515d14068592a161c17cbd53832ae1b295263`, accepted preview
  supplier, containing `6f77f6c57d66dad1c657fdad7852c4ccb148d701`.
- Captures occurred with only this directory's investigation files uncommitted;
  `dirty=true` is retained, not represented as a clean release artifact.
- [Attempt 1](evidence/local-preflight-attempt-1.json), UTC
  `2026-10-31T06:34:21.987862+00:00`: read-only preflight exit 2. Console plist
  parser expected a list, actual root was a dictionary. Console status remained
  unknown and failed closed. No workload was launched.
- [Attempt 2](evidence/local-preflight-attempt-2.json): parser handles dictionary
  and array roots; actual lock state captured. Preflight again exited 2.
  No workload was launched. Both raw sanitized attempts are retained.
- `make setup` through the required setup gate succeeded. No lockfile, production
  source, generated API/asset, startup or shared AppKit file changed.
- [v1 workloads](workloads.json), [measurement protocol](README.md), read-only
  prerequisite capture and bounded dummy local provider are owned here.
  Provider contract tests are correctness evidence only, not NAC timing samples.

## Local qualification and failed operations

| Condition | Fresh observation | Consequence |
| --- | --- | --- |
| Physical hardware | Apple M5 Max, Mac17,7, 18 CPU cores (6+12), 36 GB RAM | Qualifies only environment identity, no performance |
| OS | macOS 27.0.1, build 26A434, arm64 | No macOS 14 or 26 measurements on this host |
| Display | 3024×1964 pixels, reported 1512×982 at 120 Hz; adaptive brightness enabled | Actual painted viewport, runtime refresh and brightness not measured |
| Console | `CGSSessionScreenIsLocked=true`, on-console=true | Invalid active-window/input baseline; no unlock attempted |
| Developer tools | `/Library/Developer/CommandLineTools` | Full Xcode not selected; no installation/change attempted |
| Trace lookup | `xcrun --find xctrace`, exit 72: utility unavailable | Instruments capture unavailable with selected tools |
| Power | AC Power, `kern.hv_vmm_present=0` | No physical power, energy, thermal or wakeup measurement performed |
| Quiet allocation | None acquired for measurements | No claim of exclusive host workload conditions |

The interventions required for local active-window timing are an operator-made
usable unlocked desktop and appropriate existing tool allocation. This task
does not unlock, bypass privacy, install Xcode, change settings or request new
permissions. A locked/no-rAF renderer cannot be substituted for active paint.
No expensive release build was started before this gate was characterized.

## Required cells and current disposition

| Required result | Current evidence / missing obligation |
| --- | --- |
| Matched release source/assets/store/provider identity | Protocol and deterministic provider input defined; no matched built artifacts/store or actual UI driver run |
| Cold/warm launch and useful workspace p50/p95 | No valid samples; cold reboot repetitions unavailable |
| Warm reopen | Baseline preview closes by quitting and removes its store. Hide/re-show can be a separately labelled preview measure, not consumer close/reopen acceptance |
| 1/8 idle sessions and PTYs, active/hidden | No resource samples or actual-session fixture runs |
| Long Markdown/math/code, streaming, noisy terminal | Versioned loads defined; provider HTTP contract checked separately; UI/render/PTy run pending |
| Notifications | ALL-350 product behavior not implemented in baseline; unavailable until nominated source supplies it |
| Entire shell/render/network/GPU/backend/PTy process set | Accounting protocol defined; no complete identity census or resource trace |
| Memory/CPU/wakeups/queues/frame/input distributions | No valid NAC measurements; missing values remain unavailable, never zero |
| Attribution and bounded corrective work | Existing seams inventoried; no measured hotspot or corrective optimization justified |
| Numerical hardware-qualified budget recommendation | Withheld pending real matched distributions and observed variability; no arbitrary target proposed |
| Human budget approval and passing release candidate | Separate future decisions/qualification; neither supplied by this investigation checkpoint |

## Hosted next checkpoint

The coordinator identified an existing standard ARM macOS 26 VM with full Xcode
as a possible environment. Actual ALL-354 public XCTest ASCII terminal evidence
is now available at source/workflow `1d3d77f73c4620e69ead8a525f9950efbb57cd9f`,
tree-identical to PR head `d1154138af5de035cf1489bee40c3675f8d437c5`:
run `41182519978`, job `124482718942`, artifact `13035643282`. It records 126
trusted and zero synthetic keydown receipts, exact terminal input/output, the
focus negative, unchanged existing Helper/no-auth policy and cleanup. It proves
one smoke-case driver capability, not ordinary release timing, Safari parity,
raw frame/input distributions, IME or physical keyboard behavior. The app's
direct CG-post case remains unavailable. No permissions are granted here.

The allocated implementation now includes a manual-only contents-read workflow,
a finite release-build/calibration runner, a fixed-field read-only process
probe and the external `PerformanceJourneys/testCalibration` source. Nomination
and dispatch fields are null. The runner refuses execution without a separately
approved exact allocation, and refuses measurement readiness for missing raw
signals, XPC attribution, cleanup identity or workload repetitions. The same
empty closed-store calibration seed/engine is used for both arms; it is explicitly
not the 64-turn measurement fixture. The full required matrix remains unfinished.

Local verification covers provider HTTP and negative collection contracts,
Python parsing and C syntax only. No process probe, AppKit input, release build,
measurement, remote job, global lease or final reviewer was run from this
allocation. Actual Swift SDK/runtime verification awaits ALL-354 integration
and a separate coordinator decision. No ordinary app/shared harness source,
builder, API or generated asset was edited.

At a clean idle checkpoint, obtain explicit exact source nomination (frozen
ordinary source `66dfa1ea6dae9bd825224674026a4ff32e1e64e4` is proposed, with
ALL-341 as an ancestor), an exact ALL-354 integration commit accepting the
allocated `NAC_PERFORMANCE_SOURCE` file, exact hosted job/run allocation and
coordinator-confirmed quiet conditions. Do not consume the moving ALL-344
lifecycle or other owners' branches. Build private release artifacts,
verify source/assets/provider/fixture identity, then acquire the coordinated
exclusive measurement lane. Execute the paired workloads from README, preserving
failed cells, raw traces and provenance. Inspect observer overhead and process
attribution before deriving VM-specific numerical recommendations.

Report VM results only for that VM's observed hardware/OS/display conditions.
They cannot establish physical M5 performance or energy. Unsupported cold
launch, consumer reopen, notifications, trusted input and supported-OS cells
remain explicitly open even if VM rendering trials succeed. The finite report
can ultimately recommend NO-GO with this evidence, while stating exactly which
ALL-353 acceptance inputs were not produced. Human acceptance and downstream
release qualification remain separate.
