# Historical Mac development candidate — 13 November 2026

This checkpoint records the completed local Mac development milestone on
`codex/electron-macos-development`, then based on `dev` at
`7d8b9696d0fab130e120647ca6fabf001e673908`. The results below qualify the frozen
historical `4cada76f` candidate, not a later PR head or its merge with newer dev.
That later head requires refreshed build, check and visual evidence.

Personal checkout paths in these examples are privacy-redacted to portable
repository-root `$PWD` paths. Historical source/binary hashes and failed episode
boundaries are preserved. The original local packets named below are not public
upload artifacts; redact their paths and any other user data before publication.
Native acceptance, the packaged regression lane and all ten normal launch/resource
trials passed for that historical candidate, with complete owned-process
settlement. Broader release qualification remains separate.

## Candidate and launch

```sh
open "$PWD/target/electron-review/NAC Electron.app"
```

That command selects the normal local profile. For acceptance testing, use the
explicit disposable HOME/NAC_HOME/userData/store launch in [README.md](README.md).
Do not open a personal store to collect test evidence.

The ad-hoc signed arm64 bundle freezes product source at
`4cada76fc45235b229f02034243b09145100c1ed`. Later commits contain test controllers,
observers, documentation and evidence. Electron is 45.3.2, Chromium
156.0.8078.100 and bundled Node 24.22.2. The exact optimized `nac-web` includes the
production React assets; its final signed SHA-256 is
`3e6400da275a45c2803a3bddea8f9f984dac75d0fcf4abbff173615aee9384c7`.

The matching Swift arms contain those identical engine bytes. The manifest binds
all shell/assets, runtime versions, native helpers, picker Info.plist and lockfile.
Strict inside-out ad-hoc signature verification and independent hash/inventory
checks pass. The engine/helpers link only to macOS system libraries.
`target/electron-review/static-verification.json` retains that verification.

The same app was copied to
`target/electron-review-relocation/Folder With Spaces/NAC Electron.app` and launched
through LaunchServices with private configuration and only system tools on PATH.
Cargo, separately installed Node, Vite and a separately installed server are not
runtime dependencies. The earlier candidate and failed evidence remain retained.

## Working behavior

- Complete production React project/chat workspace, HTTP/SSE streaming, read
  permission, user question/answer, atomic code write, all three immutable session
  choices and their existing default, and trusted terminal input/output/resize/
  interrupt/close through Rust.
- Exact child identity/incarnation/canonical store/schema admission, connected
  Unix launch socket, explicit Retry after prior owned settlement, distinct
  occupied-store and future-schema errors, and no automatic adoption, alternative
  store, downgrade or mutation/input replay.
- Rust-owned normal configuration, credentials, permissions, selected backend,
  storage and supervision. Renderer sandbox/context isolation remain enabled,
  Node disabled and background throttling enabled. Native messages retain
  frame/origin/document admission; no generic shell/filesystem/network bridge.
- Mac window close retains the document and engine. Actual LaunchServices reopen
  restored the same app PID, engine PID, origin, selected chat and file. Mac menus
  and Edit Select All were exercised. Native Quit Cancel retained that owner;
  Stop and Quit retired the exact app/engine/custody/picker. Rust's 20-second and
  shell's 23-second allowances and truthful pending cleanup are preserved.
- Real AppKit folder selection with spaces/Unicode returned through React and was
  persisted by Rust. Finder selected the exact resource admitted by Rust. A
  deliberate link opened real Chrome, completed the local PKCE fixture through
  Rust's callback, and produced Connected in NAC. Local fixture tabs/windows were
  closed. Vendor credentials/callback ownership remain in Rust.

## Verification and evidence

- Complete packaged actual-Electron suite: **11 passed, 1 explicitly skipped
  manual-only case**, 33.6 seconds. Log:
  `target/electron-packaged-final-suite.log`. This covers coding/streaming/
  permission/question, all session creations, native menus/message rejection,
  OAuth doubles, folder cancellation, sandbox, Retry/contention/duplicate Quit,
  trusted terminal I/O and actual Electron parent-death descendant cleanup.
- Explicit full native case: **1 passed**, 4.0 minutes, against the relocated
  final bundle. `target/electron-native-manual-Iu8gos/acceptance.json` records
  independent Rust project/cwd, external-browser/PKCE and exact settlement facts;
  `native-observations.json` records the native actor's observations. Its private
  profile was removed only after positive process/root-identity checks. Log:
  `target/electron-native-final-accepted.log`. The checked-in
  [native acceptance handoff](e2e/NATIVE-ACCEPTANCE.md) records hashes and the
  accepted/failed episode boundaries.
- Same-artifact Edit/window-close/LaunchServices-reopen observations are retained
  in `target/electron-native-manual-9AKkga/native-observations.json`. That earlier
  controller run failed a shutdown-observation race; it was never relabeled a
  test pass. The test-only repair has three cleanup characterization cases, and
  the complete native case was rerun successfully. The earlier unbundled-picker
  trial remains an explicit partial/aborted attempt.
- Final focused owner tests: **26 passed**, 23.7 seconds, including the real
  UnixStream/parent-death and 23-second custody fallback. Real bundled picker
  identity/EOF/reap integration passes. Ten focused Markdown/ModelMessage tests
  pass. `make test-assets` passes
  Rust/OpenAPI drift, web lint/typecheck, canonical rebuild and asset drift.
  Final formatting and source-size checks pass. Logs remain under
  `target/electron-owner-final-integration.log`,
  `target/electron-repository-assets-check.log` and `target/electron-final-*`.
- One bounded independent source/artifact review resolved packaging-provenance
  and process-measurement absence findings. The same reviewer narrowly rechecked
  the picker/fade changes with no supported material finding and closed the
  finite milestone's evidence gates. No further review cycle is required.
- Final independent executable-path census found no owned executable, fixture
  helper, descendant or unresolved candidate. Signatures and all manifest-bound
  engine/shell/asset/helper hashes remained unchanged. Evidence:
  `target/electron-review/final-closure-20261114T015558Z/closure.md`.

No personal-data migration, OS setting change, unrelated-process termination,
merge, push, PR, tag, deployment, public publication or Slack report is part of
this milestone.

## Early release performance

See the [performance report](performance/results-macos-development.md), structured
summary and raw accepted/excluded records. These are bounded development
measurements, not frozen hardware-qualified budgets or full Swift parity.

The retained-animation regression was traced to Chromium layerization of a
finished opacity animation on a roughly 167,000-pixel-tall transcript layer.
Removing its parent transform alone did not repair it. The shared CSS repair
preserves the same 150 ms 0-to-1 fade and all text/accessibility, while allowing
finished animation ownership to end. Canonical rebuilt packages, with no test
style override, reduced Electron input proxy p95 from about 60 ms to 8.6 ms
(9.2 ms p99); matching Swift measured 18 ms p95. Both use the identical seeded
workload, physical display/backing geometry and native foreground guards.

All 120 scroll-jump samples remain: the canonical paired Electron p95 is 33.5 ms
with initial-entry spikes up to 279.7 ms, compared with Swift 18 ms / 127 ms.
Electron's settled cadence is about 8.3 ms; the initial tail is not trimmed or
called a parity pass. Large-history opening, paced streaming and terminal
pressure/control distributions remain in the report. DOM/rAF and HTTP proxies
are not actual paint or physical-keystroke latency.

Normal-package launch/reopen/whole-app CPU/physical footprint samples use exact
process births, coalition/descendant accounting and independent cleanup. First
visible native-window latency includes different startup ordering: Swift shows
its placeholder before the engine is ready, while Electron waits for verified
engine readiness. It is not a matched first-useful-composer or paint endpoint.
The report retains power/display/cache conditions and every failed observer
attempt, including transient macOS opening geometry versus settled geometry.

Five final interleaved pairs measured median/p95 native-window launch of
351/355 ms Swift and 593/660 ms Electron, and retained hide/reopen of 148/155 ms
and 152/158 ms. Whole-app idle CPU medians were 0.665% and 0.637% of one core;
physical footprints were 167.79 and 259.82 MiB, a 92.03 MiB increase. These
10-second samples after 10 seconds settling use the same built-in Retina display
and AC conditions. They are early distributions, not the broader ticket's long
idle/paint/hardware certification or a frozen-budget pass.

## Review limits and broader tickets

Linux, qualified minimum OS/hardware, full crash/draft migration, notifications,
updates, public signing/notarization/Gatekeeper distribution, real vendor sign-in,
physical keyboard/IME/VoiceOver qualification, controlled paint/energy timelines,
long soak and final performance certification remain separate. Swift and Rune
remain intact. No broader Linear ticket is marked Done from this Mac acceptance.

An earlier computer-use inspection automatically relaunched an exited candidate
with the default HOME/profile. It was stopped through ordinary protected Quit;
no prompts or commands were submitted. Automatic startup store access or
migration effects are **unknown**. The personal database was not inspected to
manufacture proof of non-access. Subsequent UI attachment required a positively
observed live private fixture, with no post-Quit app inspection. Obsolete pre-fix
private test helpers were separately identified by kernel birth/loaded image and
zombie-only custody, retired individually, and checked by a complete executable-
path census; no unrelated process was signaled.
