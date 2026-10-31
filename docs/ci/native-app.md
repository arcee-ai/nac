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

The baseline on merge candidate `d0254106b0885b751110e8d5041d63f31d5653dd`
(PR head `329e64ac`, base `f71515d`) passed all six ALL-340 scenarios in hosted
run `41174077406`, job `124458145320`, artifact `13032293753`. Both chat captures
passed OCR and were visually inspected as readable system WKWebView images.
This qualifies that baseline on image 20261026.0455.2, not the full ticket or
the older image candidate.

The optional `ci-terminal` scenario creates
one human shell through the production New shell control, checks event-post
capability without prompting, and sends one predeclared harmless workspace-file
operation through public CoreGraphics `CGEventPostToPid`. Each paired key is
bound to this exact frontmost/key fixture window, focused xterm textarea and a
fresh unlocked console observation. Key-up always targets the same owned
process; focus loss stops input. An unfocused-terminal negative control must
reject before any key posts. The journey requires genuine DOM `isTrusted`
keydown observations, exact native workspace-file bytes, rendered terminal
output and settled production terminal termination. It never overrides trust,
uses clipboard data, changes TCC or replays uncertain input/termination. This
one ASCII typing case was unavailable on hosted merge `46b20eea1e19792607a745e48e56b4485d94728c`
(PR head `8a2c1c6c`), run `41175634167`, job `124462707944`: the app's
`CGPreflightPostEventAccess()` was false. It stopped before opening a terminal
or posting keys and reported engine reaping/profile removal. The six baseline
scenarios passed again. Required trusted-input acceptance stays failed; no
permission prompt or grant was attempted. This case does not establish
ALL-352's physical typing, IME, paste or fidelity acceptance.

The primary CI job now requires `ci-terminal-xctest`, a separate supported
XCTest keyboard path with the same exact-file/trusted-DOM/cleanup assertions.
The checked-in UI test project and shared scheme generate a real `.xctestrun`
with `xcodebuild build-for-testing`; CI validates its fixture binding, then uses
`test-without-building` with parallel testing disabled and one explicit test.
The test owns launch from the exact verified relocated `.app` URL, refuses any
existing preview instance, and checks PID incarnation, bundle URL, window and
fresh unlocked console ownership before each character. It uses the focused
terminal's public `XCUIElement.typeText`/`typeKey` APIs without clicking,
refocusing or substituting another element. The app independently guards its
terminal focus while awaiting input. The app's CoreGraphics capability remains
a separate recorded observation, including false.

Read-only preflight inspects only the existing Xcode Helper Accessibility row,
`DevToolsSecurity -status` and no-argument `automationmodetool` status. Missing
authorization stops before XCTest launch; no provisioning/grant/prompt/enable
command exists in this runner. Read-only snapshots immediately before testing
(after build) and after XCTest/cleanup compare the persistent helper grant,
developer mode and automation authentication policy. Active Automation Mode is
transient session state: disabled is allowed when existing no-auth configuration
and helper authorization are confirmed. A policy change fails qualification;
declared absence of mutation commands is not used as measured before/after proof.
Actual generated `.xcresult` identity and
sanitized `xcresulttool` summary are retained; raw result diagnostics stay
private. The first actual XCTest run (`41180828336`, job `124478157918`, artifact
`13035366792`, merge `801dffa1` / PR head `db4d3eab`) built the target, validated
the generated runner and launched the exact relocated app. Its one test failed
before any keyboard input because the smoke fixture did not open the tablet
terminal list before finding New Shell. All six baseline cases passed and
owned app/engine/profile cleanup completed, with no crash report. The receipt
observed existing helper authorization and developer mode, plus Automation Mode
disabled with authentication not required to enable it; no enable command was
issued. A smoke-only responsive-navigation repair is prepared; trusted input
qualification remains pending. This path does not establish physical keyboard,
CJK, clipboard or VoiceOver acceptance.

`CITerminal.swift` and its dispatcher/source-list hooks are smoke-only. Ordinary
preview builds and default `preview.sh smoke` keep their existing behavior;
only `NAC_MAC_CI_TERMINAL=1` requests the extra scenario. The ordinary binary's
symbol/string check also rejects CI instrumentation.

`desktop/macos/ci-toolchain.json` records the qualification envelope from the
official runner-images revision `102f6553849daabcbd37e321e2e224dbab45c469`:
Xcode 26.6 build 17F113, SDK 26.5, macOS 26.6.2 / 25G83, image
20261026.0455.2. `macos-26` is a moving runner label. Unexpected image, OS or
toolchain drift fails explicitly and needs qualification against the new image.
The same-head repeat `41173290903` landed on image `20261013.0424.1` and failed
that drift guard. Its official inventory at runner-images commit
`49bfbe040355338053d9ef330e4e7a1190c59714` was checked against the recorded
Xcode/SDK/OS envelope. Both exact inventory identities are now listed as
candidates; the newer image passed the baseline described above. New image
identities still fail, and ordinary Rust/Node versions remain explicitly pinned
by setup actions regardless of the runner's defaults.
Run `41180549503`, merge `0692a14f` / PR head `1a92e0d4`, then observed a
third exact image, `20261021.0445.8`, and correctly failed before app launch.
Its official inventory at runner-images commit
[`9039987f0a4600ed0b8b67625c70583a3c825a71`](https://github.com/actions/runner-images/blob/9039987f0a4600ed0b8b67625c70583a3c825a71/images/macos/macos-26-arm64-Readme.md)
matches the same Xcode/SDK/OS envelope and is now an explicit candidate. This
does not establish GUI/XCTest acceptance on that image. Unknown image values
still fail, and the exact observed Swift compiler check remains unchanged.
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
logs/JSON are capped at 256 KiB, images at 2 MiB, total at 12 MiB. Locked setup
and fixture controls run inside the evidence supervisor so network/setup
failure retains bounded redacted logs too. Commands share a 30-minute budget,
leaving ten minutes of the job limit for owned cleanup and artifact upload. Only exported
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
| Missing/exiting/hung engine, close during startup/active run | Same ALL-340 baseline; hosted baseline passed at `d0254106` |
| Readable snapshots, full-Xcode/image checks, CI export | ALL-354 baseline `329e64ac`, hosted merge `d0254106` passed |
| Native workspace menus | ALL-346 supplier not integrated |
| Consumer close/reopen/explicit Quit | ALL-344 supplier not integrated; preview close is not consumer lifecycle |
| Shared approval | Pending exact scripted operation and actual-app journey |
| Renderer replacement | Pending supported supplier and actual-app journey |
| Trusted OS terminal input and descendant cleanup | ALL-354 `ci-terminal-xctest` candidate uses the delivered Local terminal owner; actual OS typing/cleanup qualification pending. App-owned `ci-terminal` CG capability unavailable; broader ALL-352 remains separate |

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

The trusted ASCII milestone passed at PR head `d1154138`, clean merge
`1d3d77f73c4620e69ead8a525f9950efbb57cd9f`, whose tree equals that head.
Run `41182519978`, native job `124482718942`, artifact `13035643282` records all
six baseline cases and one real XCTest case passing: 126 trusted keydowns,
zero synthetic keydowns, exact file bytes, readable terminal output, negative
focus control and terminal/app/engine/profile settlement. Actual before/after
helper authorization and tooling authentication policy were identical. App-owned
CG event-post access remained false. The coordinator independently checked the
raw terminal/chat images, image hash, result/runner and cleanup receipts. This
is one automated OS ASCII capability, not physical keyboard/IME/paste/VoiceOver
or full ALL-354 acceptance. All ordinary CI checks passed on that head.

## Exact supplier source qualification

The existing Stable release manual CI entry has an explicit `native_qualification`
choice, default `none`. `all-341-macos26` selects only the checked-in immutable
supplier `1a4f9c31f27b4656897673084f3440e05373393d`, its full 29-scenario preview
contract and the existing strict macOS 26 toolchain envelope. The optional job
runs only for manual `codex/` branch CI. Ordinary PR required jobs and all
publication/tag guards stay unchanged; a manual qualification does not authorize
publication, a tag, merge or deployment.

`all-343-macos26` adds the exact corrected instance fixture
`0d78ee389e98c0f157a8e8313446fc8006c38ec4`, using the same strict macOS 26
envelope. Its first hosted qualification failed, as detailed below. The source's
ordinary `app-build` and instrumented `instance-build` each run for exact-source
dev and stable engines, copied privately before the next track rebuild. Actual
source/mode/track, engine/native/plist hashes, normal bundle identities, excluded
preview definitions and absent ordinary smoke symbols must agree. Compiled
stable metadata is a disposable fixture; no release/publication job is enabled.

Its existing eight cases are simultaneous opens, CLI conflict, file symlink,
directory symlink, owner crash, shutdown drain, app crash/relaunch and dev/stable
coexistence. The unchanged target driver owns launches, native controls and
cleanup. A harness wrapper translates its own termination signal into a Python
interruption so the target's existing `finally` blocks can retire its exact
app incarnations and unreaped CLI handles. That phase allows 150 seconds for
cleanup within the job's remaining reserve. The outer audit only observes
matching private bundle/process identities; it never signals an evidence PID.
Failure profiles retained by the target remain explicitly reported; a passing
driver must have removed its complete private fixture tree.

Before any app launch, the exact target-built observer and source-owned console
predicate must confirm current runner/console/frontmost UID, logged-in IOKit
and Quartz sessions, explicitly unlocked root, display and non-lockscreen window
metadata. Raw absent optional lock fields remain null. The target repeats this
check at its action boundaries; every recorded state is revalidated by the exact
target predicate. Missing/locked/unknown facts fail with the raw receipt and no
fallback. The rejected `9f215ec9` observation assumption is not overridden.

All eight exact case names, source/fixture/helper hashes, ownership/reopen/store
assertions and cleanup must pass. App-crash intentionally does not repeat asset
requests; its actual replacement assertions remain required, while the exact
same dev bundle's asset bytes are checked by the other cases. Coexistence binds
each episode by track and canonical store, including its reverse episode order.
All nineteen expected frames must exist and pass case-specific on-device OCR:
fresh workspace controls, the seeded shutdown project, or native conflict and
Retry guidance. These are instrumented LOCAL_APP frames; pure ordinary builds
are not relabeled as OS paint. Human image inspection remains required.

`instance-receipts/index.json` retains complete metadata plus one structured file
per actual case/console observation and the original summary hash. This preserves
all semantic receipt fields within the existing per-file limit when the source's
monolithic summary is capped; no observation is dropped or rewritten as safe.
The total 12 MiB export limit and redaction policy remain unchanged.

The first instance run `41187334758`, native job `124496908923`, artifact
`13037268703`, used exact harness `5f91f003` and target `0d78ee38`. Clean source,
pinned toolchain/image, both dev/stable ordinary/instrumented builds and all
four recorded console boundaries passed their checks. The first simultaneous
workspace failed in the target's `readyWorkspace` check before its first
snapshot: “Production workspace was blank or failed.” Zero cases completed
and zero PNGs were captured; no instance runtime or paint acceptance follows.
The retained evidence does not contain the failed body/frame, so the cause is
unproved. Cleanup observed no private live process or crash, and retained the
failure profile under the target's policy. The index's original summary hash
precedes export redaction; the exported summary has a separate hash. A new
source-owner diagnosis and explicit nomination are required before another run.

Root inspection of the committed harness SHA, immutable target/catalog and
command policy is required before a manual instance run. The planned command
uses the existing `stable-release.yml` manual entry, non-tag
`codex/all-354-native-mac-ci` ref and `native_qualification=all-343-macos26`.
The dispatcher must first verify that ref still names the inspected harness SHA,
then check the run's actual SHA; freeze it through the run. No instance run is
dispatched by catalog preparation or ordinary PR CI.

One standard Mac job checks out the CI harness and supplier into separate sibling
directories. It verifies both exact clean Git roots, sets up both fresh checkouts,
then uses the supplier's own checked-in builder and native test driver. No harness
code is copied or compiled into the target app. Build revision/engine identity
bind to the target SHA, while workflow/harness SHA and PR context remain separate.
The target's own failure cleanup handles its native helpers; residual app, engine,
helper, descendant or profile state fails the external supervisor.

The external reader checks the target's raw WKWebView images and records positive
console observations before/after the suite, actual system WebKit/Safari builds,
and read-only event-post capability. The target's own conservative paint flag
is retained unchanged: an absent optional lock bit may leave that flag false,
while separate actual image/session evidence remains available for human review.
The coordinator must inspect the target PNGs before accepting supplier paint.

Only named source/profile records resolve; there is no arbitrary SHA, command,
paid-runner or matrix input.

`all-352-macos26` is a source-only prepared entry for terminal supplier
`24c0179f9e42a36d021a117694f098a76a3ddb80`. It checks out that exact source,
independently of PR 500's merge commit or its moving parent. Its existing
`terminal.sh` builder receives a private exact-source engine, checks normal and
ordinary-smoke exclusion, and builds only the nominated PREVIEW_SMOKE plus
TERMINAL_SMOKE app. Source/native/engine/asset hashes and the four contract
source hashes must match before launch. No source is copied into that checkout.

The shared real XCTest target adds one opt-in test for six fixed phases:
Unicode, interrupt setup, Control-C, recovery, window resize and `stty` readback.
`ci-terminal-operations.json` contains the nominated literals and limits; mutable
app readiness must match this contract and cannot supply commands. The driver
checks the exact bundle, launch epoch, PID, window, element, phase and unlocked
console before each public operation. It never replays a phase or clicks the
terminal to recover focus. Resize is one explicitly declared public XCTest
coordinate drag on the owned window corner by −160/−80 points; there is no
private frame setter or app control endpoint. The app independently proves
actual frame/PTY changes, shell bytes, controller revision, trusted events,
written receipts and negative unfocused admission.

Existing helper authorization and developer/automation policy are observed
before and after input; no permission grant is requested. Actual generated
`.xctestrun`, fixture-config hash, result tree hash and bounded result summary
remain required. Failed or missing ownership/settlement evidence retains the
relocated bundle for diagnosis instead of deleting it while its process might
remain live. Process/profile settlement is observed before successful removal.

Two post-input images require readable Unicode-output and recovery/size markers,
exact PNG hashes and independent image review. Exact Unicode bytes are proved
by the app's file/input/parser receipts; OCR does not establish Unicode fidelity.
The source matrix remains partial: this prepares one automated OS Unicode/control/
resize episode, without physical keyboard, IME, paste, full job control, masking,
VoiceOver or full terminal acceptance. Preparation, parsing and portable tests
do not establish XCTest compilation or actual input. Root inspection of exact
committed H/T and policy is required before any additional input run.

The additional `all-351-macos14` choice binds the corrected, frozen
`fa94a859b648cb36fbdcb251bfe4bc9541de3f48` fixture to a separate strict envelope:
standard ARM `macos-14`, macOS 14.8.9 / 23J631, image 20260831.0302.1,
Xcode 16.2 / 16C5032a, SDK 15.2. Its official image inventory is runner-images
commit `a574079cf338d5d04f54b82b01c6652b824b39c0`. The exact Swift compiler patch
is deliberately unset until observed; the first bounded diagnostic remains
`unqualified-swift` even if its native journeys complete. Do not fabricate a
patch version or treat the moving label as an immutable image pin.

The source's workspace builder receives the exact just-built private engine,
then its six baseline scenarios and both direct/legacy workspace scenarios run
against the same instrumented native binary. The source's manifest/projection
must agree on source/native/engine identity; all required scripted checks and cleanup must
pass. The explicitly separate external-link row may remain unavailable and keeps
that disposition; visible paint remains required. External OCR checks baseline chat, rich workspace, approval and legacy
captures. Physical input/IME/VoiceOver and product-minimum rows remain explicitly
unavailable in the unchanged source report. Exact 14.8.9 plus its observed modern
system WebKit/Safari does not establish 14.0 or original-Sonoma WebKit behavior.

This is one opt-in qualification at a time. The deprecated image retires November
2, 2026, with scheduled brownouts; availability failure is an explicit missing
environment, never a pass. Primary macOS 26 is unchanged, and no minimum product
OS is selected. `DEVELOPER_DIR` is the compiler selector; the separate
`xcode_select_default` field explains any unchanged global-default path in the
target's raw report. No global toolchain selection is modified.

The single macOS 14 diagnostic `41179611704`, native job `124474237215`, artifact
`13034552442` built exact target `fa94a859` from harness `27275a34`. It observed
Swift driver 1.115.1 / Apple Swift 6.0.3 (swiftlang-6.0.3.1.10,
clang-1600.0.30.1), system WebKit 19618.3.11.11.5 and Safari 26.6 /
19624.4.5.18.1. All six baseline cases and both source drivers passed with owned
cleanup and no crash report. Qualification still failed: projects and child
transcript images visibly contain loading placeholders, matching the target's
`visible-paint: unavailable` disposition. Rich chat and approval captures were
readable on inspection. The observed compiler is not yet a qualified pin; this
diagnostic establishes neither full workspace acceptance nor a product minimum.
