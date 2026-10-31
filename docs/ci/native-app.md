# Actual AppKit / system WKWebView CI

ALL-354 adds an actual-app job to the existing required `macos-native` reusable
workflow. Its result joins the existing native process job through the caller's
fail-closed aggregate. Public browser, API, assets, Rust and managed checks stay
required. No repository settings or publication jobs change.

The job builds the ordinary development `.app`, checks that smoke instrumentation
is absent, then builds and launches the separate smoke `.app` through macOS
LaunchServices in a relocated path containing spaces. The existing ALL-340
driver uses the shared production React UI and Rust engine, a private disposable
profile/workspace/store, ephemeral loopback ports and a local Responses fixture.
No real credentials or remote model calls are used. The native image reader
uses Apple's local Vision OCR to reject blank/loading snapshots and require the
known transcript in both streamed and persisted WKWebView captures. This reader
is a CI executable, never bundled with the application.

`desktop/macos/ci-toolchain.json` records the qualification envelope from the
official runner-images revision `102f6553849daabcbd37e321e2e224dbab45c469`:
Xcode 26.6 build 17F113, SDK 26.5, macOS 26.6.2 / 25G83, image
20261026.0455.2. `macos-26` is a moving runner label. Unexpected image, OS or
toolchain drift fails explicitly and needs qualification against the new image.
The same-head repeat `41173290903` landed on image `20261013.0424.1` and failed
that drift guard. Its official inventory at runner-images commit
`49bfbe040355338053d9ef330e4e7a1190c59714` was checked against the recorded
Xcode/SDK/OS envelope. Both exact inventory identities are now listed as
candidates; neither has passed the actual-app GUI journey yet. New image
identities still fail, and ordinary Rust/Node versions remain explicitly pinned
by setup actions regardless of the runner's defaults.
The first hosted receipt (run `41173262488`, job `124455556461`, merge candidate
`b7653271321d8b8fcfbfe71ca5c78a8eced2e4c7`) verified this envelope and recorded
Swift driver 1.148.6 / Apple Swift 6.3.3, swiftlang-6.3.3.1.3,
clang-2100.1.1.101, target arm64-apple-macosx26.0. That exact compiler identity is
now pinned. No compiler version is inferred from the Xcode version. The first
receipt failed the GUI prerequisite before building/launching the app and is
not native app acceptance.

A read-only IORegistry check requires the current runner user to own the completed
Aqua console login and the root lock observation to be explicitly false. Any
explicit true session lock flag rejects launch. The diagnostic receipt from
`41173830902` proved both optional session lock flags are absent on a hosted
on-console session, so their absence alone does not stand in for a missing GUI.
The public Quartz caller-session API must additionally confirm a console login,
AppKit must see a screen, and the frontmost bundle must be available and differ
from loginwindow. Missing/locked/unknown prerequisites fail explicitly. Absent
optional lock flags stay null in evidence; only the full rendered app journey
can qualify this environment.
Read-only CoreGraphics/AppKit diagnostics additionally record whether a Quartz
session exists, console/login state, optional lock flag, screen count and the
frontmost bundle identifier. No user names or unrelated window titles are saved.
The test never unlocks a session, modifies TCC, installs Xcode or changes login
configuration. Existing local locked-console evidence cannot qualify this job.

Evidence includes actual checked-out source SHA and dirty state separately from
PR head/base and workflow candidate SHA (normally the PR merge candidate), exact
OS/image/Xcode/SDK/Swift, Rust/Node, existing smoke binary digests, per-scenario
results, bounded logs, WKWebView/native PNGs and up to three new NACPreview crash
reports. Export masks exact inherited secret values and runner/checkout paths;
logs/JSON are capped at 256 KiB, images at 2 MiB, total at 12 MiB. Only exported
fixture evidence is uploaded, with `always()` and seven-day retention. No store,
bundle, environment dump, unrelated crash report or global process listing is
uploaded. Setup/network failure remains a failed step; absent evidence is also
an explicit artifact failure.

The driver settles the owned app/engine before fixture removal; outer CI
interruption cleanup consults only this invocation's ownership records and
validates the exact relocated executable path before using the ALL-340 cleanup
guard. Any residual process/profile fails the job. This first milestone does
not yet qualify terminal descendants or consumer lifecycle behavior.

## Scenario suppliers and incomplete acceptance

| Journey | Committed supplier / state |
| --- | --- |
| Actual launch, Create chat, partial stream, reload, local fonts/chunks | ALL-340 `f71515d14068592a161c17cbd53832ae1b295263`, `PreviewSmoke.swift` |
| Missing/exiting/hung engine, close during startup/active run | Same ALL-340 baseline; actual hosted qualification pending |
| Readable snapshots, full-Xcode/image checks, CI export | ALL-354 candidate; actual hosted qualification pending |
| Native workspace menus | ALL-346 supplier not integrated |
| Consumer close/reopen/explicit Quit | ALL-344 supplier not integrated; preview close is not consumer lifecycle |
| Shared approval | Pending exact scripted operation and actual-app journey |
| Renderer replacement | Pending supported supplier and actual-app journey |
| Trusted OS terminal input and descendant cleanup | ALL-352 supplier not integrated; DOM events cannot qualify this |

Baseline smoke is a useful first milestone, **not full ALL-354 completion**.
Continue the remaining rows against actual committed suppliers without changing
the ticket's acceptance or inventing dependencies on adjacent qualification work.

After `make setup`, portable controls run with:

```sh
python3 -B -m unittest discover -s desktop/macos -p 'test_*.py'
node --test .github/scripts/pr-checks.test.mjs
```

The hosted runner invokes `python3 -B desktop/macos/ci.py --expected-sha <SHA>
--output <new-directory>`. Use a dedicated runner, the pinned `DEVELOPER_DIR`,
and job-local `CARGO_BUILD_JOBS=4`. Shared local machines must use their supplied
admission gate; that temporary gate is not a CI dependency.
