# NAC Mac development preview

ALL-340 wraps NAC's existing production workspace in AppKit and system
WKWebView. It is a disposable development fixture, with a deterministic local
Responses provider. Each launch starts empty; closing the window quits the
preview, stops its engine, and removes its data.

On Apple Silicon macOS with an Apple Swift SDK, Rust/Cargo, Node/npm and Git,
run `make setup` once in the fresh worktree, then:

```sh
./desktop/macos/preview.sh run
```

This builds the ordinary locked `nac-web` executable using its committed,
embedded production React assets and produces
`target/macos-preview/NAC Development Preview.app`. `build` produces the bundle
without opening it. Move the whole `.app` anywhere (including a path with
spaces), then open it in Finder or with `open`. The bundle requires no Vite,
Node, Python, Cargo or Rust build process to run. System Git is used only to
initialize the disposable workspace repository. No second frontend is built.

The window opens the production New Chat dialog for a seeded fixture project.
Click **Create chat**, enter any message, and click **Send**. The direct session
streams “Hello from the isolated NAC Mac preview.” Reloading the document reads
the persisted transcript. The provider never calls a real model or tools.

The app creates a unique mode-0700 temporary directory containing a separate
HOME, NAC_HOME, XDG configuration, TMPDIR, workspace Git repository and explicit
SQLite store. Only an allowlisted environment reaches the engine; inherited
credentials, managed-host configuration and personal NAC settings are excluded.
WebKit uses a nonpersistent website data store. Configuration seeding registers
only a dummy model configuration and fixture project through existing HTTP
routes; session creation and all chat/history behavior use the production UI.

The exact bundled child binds `127.0.0.1:0`, with `--directory`, `--store-path`,
`--worker-executable` and `--no-open`. A private inherited Unix socketpair reports the actual address only after bind
and store readiness. The shell verifies version, launch incarnation, compiled
product/build/source/track identity, canonical selected store and opened schema
before seeding or loading the workspace. Stdout/stderr are asynchronously drained
into a separate bounded 64 KiB diagnostic buffer; logs never establish identity.
The shell never probes or adopts port 3210.
Main-frame navigation is confined to that origin. There is no web-to-native
message bridge.

Missing/unlaunchable engine, startup exit, readiness timeout and WebKit load or
renderer failure display a native status message. Close or Cmd-Q initiates Rust
shutdown; the app waits for its child, allows the server's 20-second shutdown
watchdog, and kills the owned process group after 23 seconds if needed. It
removes the profile only after the child is reaped. If the app is killed or its private channel closes, the engine latches the same
shutdown request, including during startup. A runtime-independent 20-second cap
starts at channel loss; the existing server owns run cancellation, descendant
cleanup and persistence drain. Parent death can leave the disposable profile on
disk because AppKit cannot run its deletion callback; the smoke runner removes
only its own recorded fixture after checking engine settlement.
Watchdog diagnostics are best effort and never gate the forced-exit callback.

## Acceptance checks

An actual interactive Aqua login session is required; Chromium and Playwright
WebKit do not substitute for system WKWebView:

```sh
./desktop/macos/preview.sh smoke
```

This builds `NAC Development Preview Smoke.app` with a separate instrumented
native executable, checks the runner's process-ownership cleanup, relocates the
whole app into a temporary path with spaces and runs real AppKit/WKWebView. It
opens the bundle through macOS LaunchServices (`open -n -W -a`). It
drives the production Create chat/Send controls, observes partial streamed text,
checks local production font/chunk loads and JavaScript errors, reloads the
persisted transcript, then closes the window during another active run. Missing
engine, startup exit, runtime engine exit, close during startup and a hung
startup are negative controls. An owned decoy occupies port 3210 throughout and must receive no
requests from this smoke WebView (identified by its test-only user-agent marker).
Unrelated shared-host connections are reported separately. Keep that port free
before running this control. Fixture profiles and process termination are
checked for every scenario. Evidence JSON, logs and
PNG snapshots are written under `target/macos-preview/evidence/`.
The runner records the console lock bit and keeps locked-session DOM/lifecycle
results separate from visible-paint qualification. Fresh paint acceptance needs
an unlocked Aqua session. For a focused repair run, set
`NAC_MAC_SMOKE_SCENARIOS` to comma-separated scenario names; its summary records
`full_scenario_run: false`, and it does not replace the complete candidate run.

Smoke instrumentation exists only in builds compiled with `PREVIEW_SMOKE`.
Every later native slice extends this checked-in actual-app/WKWebView journey
for its changed user behavior and relevant startup, lifecycle, recovery, failure
and cleanup. Keep exact source/binary provenance and bounded fixture cleanup in
its evidence. ALL-354 owns broader full-Xcode CI. These scripted DOM operations
do not qualify trusted OS terminal input, notification delivery, signing,
supported-OS/hardware behavior or real-provider authentication; each owning
ticket must supply its required real-environment evidence.

Build/run produces the ordinary preview without smoke instrumentation. Smoke builds require Python 3
as a test runner; ordinary app launches do not. `NAC_MAC_OUTPUT` changes the
bundle/evidence destination. `CARGO_TARGET_DIR` is honored; `NAC_MAC_ENGINE`
and `NAC_MAC_SKIP_ENGINE_BUILD=1` let a supervising build reuse an already built
engine. Do not use those overrides to claim an unverified revision.

For ordinary embedded-browser regression with the same engine:

```sh
cargo build --locked -p nac-server --bin nac-web
preview_target="${CARGO_TARGET_DIR:-$PWD/target}"
NAC_E2E_BINARY="$preview_target/debug/nac-web" \
  npm --prefix crates/nac-server/web run test:e2e -- embedded.e2e.ts \
  --grep 'serves the production-embedded|runs a direct session'
```

Use an absolute `CARGO_TARGET_DIR` for the example above. On a shared host use its required admission wrapper
for the entire build/test journey, including use of a shared binary.

The compiler target is macOS 14, the parent's candidate minimum. Actual smoke
evidence records the host OS/SDK separately; this preview makes no claim of
macOS 14 qualification, signing/notarization, consumer installation, background
window lifecycle, native menus/bridge, or performance.
Those have separate owners in the ALL-339 work map.

## Ordinary startup supplier binding

The startup fixture and controlled-environment resolver bind exact final product
`9ec88bd3397ccca192b2e9a95b6bd9a80b4067e3`, whose direct parent is the
packaging carry `4f2a14149558271842a58c6a1591c2b6ffc61306`. Its Native boundary
is `84c25942f848eccdfa8e7c60c9bcaa37133e418a`, integrated on actual landed dev
`4b852f065e2200f46c194b4ad2c5ace3fbd766a8`. This is source nomination only;
no package/engine/app/query/runtime acceptance is inherited from historical P6c/Pff8.
Legacy P6c/Pff8/Pd443 substitutions fail admission. The default four cases and
protocol supplier remain unchanged; failed episodes and spent allocations are
not renewed.

The query supplier is `04c073bbbead6f4077da0199bacd542e45cf4e57`, with
`StartupJourneys.swift` SHA-256 `0204753ad10fe6d02045991aa8ad011f39c6142c427ecd2733eb8bbb1a90a6b1`.
All four supplier files remain immutable. The separate SDK-only receipt measured
harness `9863b7714c32ed77bd66867973de6d5b02a753f8` with historical
P `ff8c9609abf7bf7ddabe983c96ff31cf80362956` and this unchanged Q;
it proves that compiler gate only, not the current product. This updated harness
and final post-648 product have no execution receipt.
The default four cases, protocol R, future-store promise and spent runtime caps
remain unchanged; source integration does not renew an execution allocation.

## Private launch contract (ALL-341)

The builder asks the exact bundled executable for `__desktop-identity` and saves
that immutable identity as `Contents/Resources/engine-identity.json`. The shell
passes only `NAC_DESKTOP_CHANNEL_FD=3` as private launch metadata. It sends a
version-1 JSON line `hello` with a random UUID `incarnation`, expected `identity`
and canonical `store`. The engine adopts the descriptor before constructing a
manager/helper, restores CLOEXEC immediately and removes the environment marker.
All clones and the shell endpoint are CLOEXEC, so exec descendants cannot hold
either side alive. Every record, including its newline, is at most 16 KiB.

A single `ready` record repeats the version/incarnation and reports the actual
bound loopback `endpoint`, compiled `identity`, canonical opened `store` and
`schema`. A bounded constant `failed` record reports startup stage/code/message
without serializing raw errors or credentials. A `stop` record names only version
and incarnation: it cannot target a PID, external listener or another store.
Malformed control, duplicate hello and EOF fail closed by stopping this launch.
The shell rejects malformed, missing, duplicate, oversized or mismatched receipts
and displays a native failure before activating the workspace. A receipt conveys
no HTTP authentication, human-operation capability or agent approval authority.
No channel is inherited by ordinary CLI invocations, whose existing lifetime
and worker/helper dispatch remain independent.

The native consumer seam is `PreviewEngine.receipt` and the existing
`onReady(URL)`, `onFailure(String)`, `onExit(Int32)` and `stop(completion)`
callbacks. The receipt is available only for the current verified live launch;
stop, channel failure and exit retire it before notifying consumers. Its launch
UUID is distinct from the server's `NativeRuntimeScope.incarnation` and any
future WebView document/view identity. Store/schema metadata stays with the
native process owner. Future menu/navigation commands belong to the separate
document bridge owner, never this engine control channel.

Actual-app acceptance also covers malformed/truncated/missing/duplicate/oversized
receipts, identity/endpoint mismatches, migration failure, startup/runtime channel
loss, abrupt parent death with helpers/terminal descendants, stale per-launch
callbacks, a write barrier held for over four seconds and the real 20-second
watchdog. The checked-in runner records source/engine/native binary identities,
exact receipts, OS/SDK, native failure snapshots and cleanup. `engine_contract.py`
adds direct binary/channel controls using the same bundled executable. These
fixtures add no production bridge and make no trusted OS input qualification.

## Fixed hosted lifecycle qualification (ALL-344)

`all-344-lifecycle-macos26` adds one closed adapter to the existing exact-supplier
lane. It pins supplier `7d8322f1d8cad25cc1aa79dc5a7a025a6719065b` and tree
`89a58b792f4b181a6d64af5dfcb5bc4d6bb24053`; the supplier must be published by its
owner before GitHub can check it out. Its normal fifteen Swift inputs, production
blobs, fixture, builder and observer are unchanged. Historical local bundle hashes
are custody evidence; fresh hosted binary hashes are checked against fresh build
receipts, rather than assumed equal across toolchains.

The root coordinator is the cross-host authority for allocation
`nac344-ordering-7e-one`. Its original three cases were blocked before dispatch
and remain unspent until separately admitted. Before the one workflow dispatch,
root must atomically reserve its durable transfer/custody record, bind the exact
published harness and supplier, and supply `lifecycle_custody` JSON. The capsule
must contain exactly the fields checked by `require_capsule`: version, allocation,
supplier/tree, harness, repository/workflow/branch, attempt 1, ordered scenarios,
all-zero prior counts, zero retry/production-repair budgets, the eight pinned
historical custody digests, and a root-reserved 64-hex admission nonce. Missing,
altered or extra fields fail closed. A lost dispatch response is reconciled by
root against the existing run, never resubmitted. This contents-read runner is
not a global replay database: root must reject reuse of a capsule on another host.

The existing macOS 26 toolchain envelope and positive hosted console guards
remain required. Setup, a private exact Rust engine, all five build-only bundle
modes and the image reader complete before any case reservation. Each case
rechecks source/build/console identity, then fsyncs its command and custody hashes
before spawn. The fixed order is `run`, `approval`, `terminal`; no case repeats,
and the first failure, interruption, unknown cleanup or incomplete critical
evidence stops all remaining cases. The case envelope is six minutes, including
the four-minute driver bound; the supervisor reserves an additional 150 seconds
for the target's cleanup and 120 seconds for upload. Budget shortage stops
before reserving the next case.

The external child installs interruption handling before executing the unchanged
supplier entry point. The supplier owns native/engine/descendant settlement.
The harness retains the supplier's bounded fixture receipt before private teardown,
binds it to the selected store, then observes exact private fixture applications,
matching private process paths and the recorded terminal descendant afterward.
A live or reused descendant PID leaves cleanup unknown. The harness never signals
native PIDs from JSON or searches by application name. Passing cases require store reacquisition, preserved transcript,
goal, approval mode and inbox identities, no grants/replay, completed duplicate
Quit/Cancel ordering and settled descendants.

Four WK workspace snapshots and one AppKit sheet snapshot per case are required.
Each original PNG is bounded, hashed before/after decoding and checked for
readability; sheets require their Cancel/Stop-and-Quit controls. Root still
inspects actual originals. These snapshots do not prove composited OS paint,
trusted keyboard/IME input or accessibility. Complete redacted critical JSON is
retained, splitting oversized receipts into indexed readable text parts with
raw/reassembled-export hashes. Database, bundle and private profile data are not
uploaded. A critical export failure is an explicit failure, not a capped pass.

Lifecycle export reserves a separate finite allowance for the exact fifteen PNG
paths: at most 2 MiB each and 30 MiB together. Actual redacted non-image payload,
including JSON split wrappers, remains bounded to 11.75 MiB; its index remains
256 KiB. The whole lifecycle envelope is 42 MiB (44,040,192 bytes). Shared export
caps and other qualifications are unchanged. Before the first reservation, the
harness records this capacity in its build manifest and checks existing payload
with 4 MiB reserved inside the non-image budget for the complete finalization
tail. Its exported slots cover the final result and ledger (256 KiB each), GUI
log and three crash snippets (256 KiB each), report (2 MiB), finalization receipt
and failure receipt (256 KiB each). The known report/build baseline must fit
128 KiB before admission; final GUI JSON is limited to 32 KiB. These lifecycle
producer bounds do not increase any shared or per-kind export cap. Every slot
charges actual UTF8/redacted bytes and JSON split wrappers. It rechecks the
reserved allowance after every case. Completed image cases must form the fixed
run/approval/terminal prefix; final success requires all fifteen original images.
Extra paths, missing successful final images or any byte overflow stop remaining cases with
unknown export acceptance and no retry. This capacity declaration is source
evidence; synthetic export-byte controls do not establish PNG validity or OCR.
Stopped failed/unknown runs and consistent unfinished dispatched prefixes export
their available original expected-path images
from dispatched cases, including earlier successful cases, with complete bounded
redacted JSON/logs. A separate failure-evidence receipt lists missing captures
and explicitly denies native acceptance. This failure export never satisfies a
successful case's exact-five or the final exact-fifteen capture requirement.
Unfinished export validates prior/active/later states and exact one-dispatch
counts without mutating or finalizing the ledger. All late writers are staged
and checked together before atomic export publication. A late producer violation
forces a failed report and retains complete bounded originals where the actual
envelope fits, or explicit incomplete failure metadata when it cannot; it never
publishes a passing report from a failed export.

Ordinary PR/push/release guards, permissions and the other named qualifications
are preserved. A manual stable workflow also starts its existing ordinary CI jobs
on their isolated standard hosts; this adapter does not reroute them. Publication
and the actual hosted admission require separate root decisions. Source controls
and compilation alone do not qualify any lifecycle case or complete ALL-344/354.

### ALL-347 path adapter (source contract; native qualification pending)

`all-347-paths-macos26` selects only product
`528b7986f1abbf7e47228d15a48c0492af2c0669` and the ordered fresh-profile cases
`paths-xctest`, then `paths-failure-xctest`. The maintained project materializer
references H's `PathJourneys.swift` and `PathPhaseObserver.swift` plus the actual
T `NativePathJourney.swift` (SHA-256
`c72c1178ba99ca82f23e264c46fb21b809934782f77060781454c42f78920e21`), with
`NATIVE_UI_TESTS`. No helper copy, standalone extraction or fabricated xctestrun
is accepted. `preview.sh app-build` and `smoke-build` remain the app writers;
their compiler-input, engine identity and output hashes are checked.

The later `ci.py --qualification all-347-paths-macos26 --expected-sha <H>
--source-root <canonical-T-checkout> --output <absent-private-output>` invocation
also needs an explicit `NAC_PATHS_CUSTODY` capsule from ROOT's separately reviewed
source/host/custody allocation and `CARGO_BUILD_JOBS=2`. The bounded capsule binds
version 1, H, T, both ordered cases, `source_preflight=true`,
`native_eligibility=true`, one allocation ID, original start/deadline epochs
(maximum 2700 seconds), and zero retries. Exclusive `.consumed` creation prevents
reusing it. The maintained manual selector transports the optional `paths_custody` JSON
through `macos-qualification.yml`; its path-only step validates the original
contract and writes those exact bytes into a fresh private runner directory,
then sets `NAC_PATHS_CUSTODY` for the existing CLI. Missing, stale, foreign or
reused handoffs fail closed. The runner creates no eligibility or deadline,
and hosted rerun attempts are rejected. Selecting or transporting this contract
does not itself allocate a run. Local/hosted envelope qualification remains an
independent prerequisite; no SDK, TCC, toolchain or settings changes are implied.

The actor reads only H's predeclared private app JSON through a no-follow regular
file descriptor, permits atomic inode replacement and identical rereads, and
rejects mutated, skipped, backward or foreign phases. Normal phases are ready0,
document-reloaded1 (one successor UUID), folder-moved2, folder-restored3,
reveal-observed4; failure is ready0 then failure-panel-observed1 on the initial
document. Authorization before helper input checks exact app/engine bytes,
launch/start identity, owner/window, current document/phase, unlocked same-user
console and unchanged existing helper/developer/automation policy. It never
activates Finder, sends Finder input or claims Finder close authority.

Named original PNGs bind chooser/Unicode, replacement form, moved-folder error,
successful session/Files and Finder's unique selected leaf; the failure case
retains its pending panel. Actual readable paint and non-occlusion review is
mandatory and cannot be replaced by AX labels, PNG framing, OCR or app receipts.
Each PNG is at most 2 MiB; the existing exporter retains at most 12 MiB total,
with complete essential JSON (256 KiB each) before verbose diagnostics. Missing
proof preserves relocated roots. Case finalization always attempts the existing
H cleanup owner independently of SDK collection failure. Known Finder residual
windows stay open and explicit. The original B499-2 disappearance repair stays
owned by `settle_apps`; this adapter does not duplicate it.

Portable source controls run with
`python3 -B -m unittest discover -s desktop/macos -p 'test_ci_paths*.py' -v`
and are discovered by the existing workflow-lint job. They establish no compiled
XCTest import/target, sandbox readability, trusted input, actual chooser/Finder,
minimum-OS or complete ALL-354/ALL-347 acceptance. Those gates remain **UNRUN**
until a separate frozen-source native allocation.
