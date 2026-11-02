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

This private P12 nomination binds product
`4b7a1f3e0bf6175a77c5ebf627fe965860e99976`, direct parent
`1cd48f95fbd239a43ef091c43b92649207fc86f5`, composed from Native
`8685729343c0ab806a9ab9cbdb5b6bf72e0c522c` and dev
`04c22a7fa1e06a72219f59f37e811813cf64cd98`. Q is the repaired immutable
nine-file supplier `ba266ba1b3bea331768d91fc8a0b2ee66b484d01`; its journey
SHA256 is `7b731b4c4f40f890fb62ed97652b9c6b480c4fda463770a9fe5a95b1f30eb4f8`.
The normal P12 package has independent genuine supplier evidence; that evidence
supplies no current Q/H SDK, AX, UI or minimum-OS qualification. P10/P11 and all
historical startup/SDK results keep their original source and consumed counters.

The H2 plus canonical Q2 observer inputs come from `observer_sources`; callers
must compile all four, retaining the original guards/receipt/custody contracts.
All four ordinary startup cases and independent R7325 remain required. R's actual
compiler/typed-protocol/source/engine/schema/integrity/retirement checks must run
under a separate Root admission; schema50 alone is insufficient. No runtime or
publication is authorized by this nomination. Functional H/Q behavior is unchanged.

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

## Normal local startup (ALL-342)

`./desktop/macos/preview.sh app-build` produces the ordinary `NAC.app` with
`LOCAL_APP`; `app-run` opens it. It starts in HOME by default, independently of
the app's location or LaunchServices cwd. `--directory` selects another existing
bootstrap directory; relative arguments resolve from HOME. `--store-path`
overrides the normal Rust configuration/track store choice. Repeated
`--command-path directory` arguments prepend explicit command locations before
the inherited PATH and standard Apple Silicon/Intel Homebrew directories.
No shell, dotfiles, global preferences or installer runs during discovery.

The exact bundled Rust engine performs bounded `__desktop-configuration`
discovery using the ordinary NAC_HOME/XDG_CONFIG_HOME/HOME and immutable build
track owners, including stable legacy-store fallback. It recovers pending
configuration publications and prepares store parents through their existing
Rust owners; it opens neither a database nor a serving lease. The subsequent
identified engine opens that exact selected store and launches workers using
its own bundled executable. Credentials remain in the existing hardened Rust
stores or inherited environment; the native app never copies or persists them.
Missing Git prevents launch with recovery guidance. Optional SSH, Podman and
MCP discovery retain their normal shared settings and chosen execution backend.

Ordinary and startup-smoke builds exclude PreviewProfile, FixtureProvider and
FixtureBootstrap definitions from their compiler inputs. The ordinary binary
also rejects disposable fixture markers during provenance verification.
`smoke-build` builds the existing disposable preview instrumentation without
launching it, allowing separate build and native/browser leases.

`startup-build` compiles `LOCAL_APP` plus `PREVIEW_SMOKE` into the separate
`NAC Startup Smoke.app`. Run `python3 -B desktop/macos/startup_smoke.py APP OUTPUT`
under the host's native/browser lease. `startup-smoke` combines those steps for
hosts without a separate lease requirement. The runner relocates the real app,
uses disposable profiles, drives the production UI in system WKWebView, and
records startup, configured Local runs, failures and bounded cleanup. Optional
command cases are selected with `NAC_STARTUP_SCENARIOS` (comma-separated
`startup-missing-ssh`, `startup-missing-podman`, `startup-missing-mcp`,
`startup-custom-mcp`). The test-only missing-command switch excludes fallback
directories only in that smoke bundle. Dummy provider results do not establish
real-vendor authentication; locked-session DOM results do not establish visible
paint or trusted OS input.

`node desktop/macos/startup_lifecycle.mjs NAC.app OUTPUT` exercises the ordinary
uninstrumented app under a native/browser lease. It identifies the unique
relocated app and exact bundled child before observing that child's loopback
listener, then verifies an actual bundled worker consumes a dummy credential
through the Rust owner. A second case holds the configuration publication lock
while the app exits and checks that its preflight child exits without creating a
database. Termination and cleanup require matching this fixture's bundle paths;
unknown ownership retains the disposable profile for inspection.

For the separately authorized real-vendor case, set `NAC_STARTUP_REAL_VENDOR=1`
and `NAC_STARTUP_SCENARIOS=startup-real-arcee` when invoking the same runner.
It uses the existing ARCEE_API_KEY child-environment reference and selects a
model listed by the existing authenticated provider discovery through the
ordinary catalog UI.
It creates no key preset and verifies `arcee-api` plus the environment variable
name before sending one text-only prompt through the shared UI. The key is never
put in arguments or evidence; HOME/NAC_HOME/store remain disposable. This case
is excluded from default runs and never uses OAuth refresh or personal stores.
For selection-only repair verification, `NAC_STARTUP_VENDOR_SELECTION_ONLY=1`
stops after verifying that the session persisted the exact discovered model,
before sending any model prompt.

Every builder mode emits `Contents/Resources/build-receipt.json` with source,
compiler flags, native source hashes, engine identity and both executable
hashes. It rejects an engine from another source revision or source changes
during compilation. This is unsigned compiler provenance for the packaging
owner; signing requires a separate final artifact manifest. The local builder's
development bundle identifier is not the distribution or track identity contract.


### External AX environment preflight (source only)

`CIStartupObserver --ax-preflight CONFIG REQUEST` is an explicit one-shot
read-only diagnostic, separate from the unchanged `nac342-owner-v1` stream.
`ci_startup_owner.capture_ax_preflight` captures its bounded closed receipt
through the existing process/clock owner (10 seconds), retaining helper failure
before propagating it. Neither entry point is wired into startup qualification.
A caller must first obtain a separate finite admission and own a new disposable
ordinary app through the existing preinstalled owner; cleaned prior episodes
are never available for probing. The parent binds exact source/binary hashes,
configuration, latest kernel lifetime and sole window; helper rechecks canonical
resources/lifetime/window before and after the read. Signing status/flags and
the static app-sandbox entitlement are context only, not a claim about effective
sandbox policy. A missing signing observation is retained as unknown.

The helper calls plain `AXIsProcessTrusted()` once, never prompts or grants.
False means zero AX messaging. True permits one `AXWindows` read with the
existing one-second messaging policy, bounded type/count/PID checks and unique
root geometry from that same array. It never traverses children, reads user
text, performs actions, changes focus/value or posts input. Only closed facts
and binding digests enter its receipt; acceptance is always false. Success
proves host API availability only, never persistent CFEqual identity, picker
focus/value/ancestry, all27 guard freshness, or native four-case acceptance.

A live preflight controller is UNAPPLIED: it needs an independently reviewed
ordinary diagnostic launch owner, exact package/source/artifact prerequisites,
Root literal clock, exact-host image gate before bootstrap, attempt1/no retry,
always-retained failure evidence and existing positive cleanup. Reusing the
four-case driver would request unauthorized XCTest/input; changing that driver
or inventing a launch path is outside this source unit. Q057, all guards and
inputs, XCTest entitlements/sandbox, P10/R and the four-case matrix stay intact.

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
`7013a96f2f2fdf3046c6976e018c9bf988eebfe0` and the ordered fresh-profile cases
`paths-xctest`, then `paths-failure-xctest`. The maintained project materializer
references H's `PathJourneys.swift` and `PathPhaseObserver.swift` plus the actual
T `NativePathJourney.swift` (SHA-256
`c72c1178ba99ca82f23e264c46fb21b809934782f77060781454c42f78920e21`), with
`NATIVE_UI_TESTS`. No helper copy, standalone extraction or fabricated xctestrun
is accepted. `preview.sh app-build` and `smoke-build` remain the app writers;
their compiler-input, engine identity and output hashes are checked.

The product owner and coordinator froze this supplier on the final UI foundation
`a6098e3655119075a349a8c923ef82f37f25bee4`. The unchanged helper hash is not
runtime acceptance. Relative to the original producer, it adds `expected_path_root`
to its denial probe; its phase schema, ordered transitions and helper interface
remain unchanged. Actual picker/Finder execution and captures remain **UNRUN**.

The later `ci.py --qualification all-347-paths-macos26 --expected-sha <H>
--source-root <canonical-T-checkout> --output <absent-private-output>` invocation
also needs an explicit `NAC_PATHS_CUSTODY` capsule from ROOT's separately reviewed
source/host/custody allocation and `CARGO_BUILD_JOBS=2`. The bounded capsule binds
version 1, H, T, both ordered cases, `source_preflight=true`,
`native_eligibility=true`, one allocation ID, original start/deadline epochs
(maximum 2340 queue-inclusive seconds), and zero retries. Exclusive `.consumed` creation prevents
reusing it. The maintained manual selector transports the optional `paths_custody` JSON
through `macos-qualification.yml`. The additional native-only dispatcher uses
`native-qualification=all-347-paths-macos26` and `native-paths-custody`; it validates
the original capsule on an Ubuntu admission job before requesting a Mac. Ordinary
CI and the legacy underscore input remain separate, unchanged interfaces. Its
skipped aggregate has a distinct name and cannot supply `Required PR checks`.
Both actual path xcodebuild calls use the shared runner environment filter,
removing ambient managed configuration, tokens and API keys while preserving
selected Xcode/SDK, private fixture and locale plumbing. The path-only step validates the original
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

The path clock uses one original ROOT allocation started before its one exact
dispatch, at most2340s including queues. ROOT’s operation ledger must bind the
actual repository/ref/H/run/firstattempt and exact original capsule bytes; local
`.consumed` is not cross-run replay evidence. `native_eligibility=true` expresses
conditional ROOT authorization; actual clean source/toolchain/console/policy
checks before input remain mandatory. It does not attest to a future host.

Under the existing synchronized-UTC engineering premise, a declared60s allowance
shortens the ROOT deadline once; it is not measured skew evidence. C' is the
earlier of that conservative conversion and H's original import+1800s deadline.
Work/collection ends C'-600, cleanup C'-120 and retention C'. Build1200s and
sharedcases900s only shorten those fixed bounds. Clock discontinuity, expiry or
unknown cleanup latches failure, retains relocated bundles and permits only
independent bounded cleanup/retention; it never renews a case or grants input.

## ALL-343 capture evidence contract (source only)

`ci_instance_capture_contract.py` projects the already admitted T34
(`34f8ed0d4f82d4df50553f8faa27765e61f03e57`) preparation receipt into canonical
`nac343-public-resource-v1` bytes. The H caller supplies independently retained
target/H source pins and manifest/preparation SHA-256 values. T remains the
owner of full live artifact validation and exclusive preparation consumption.
The resource contains the fixed 19-point roster, run/preparation identity and
public dev/stable bundle spellings, identifiers and binary hashes. It contains
no store, configuration, observer, request, release or control-file paths. Its
SHA-256 is kept outside the resource, avoiding a self-referential digest.

`ci_instance_capture_attachments.collect` accepts only an existing private,
owned export directory, the resource, host-retained T record bytes and an
independent selected-result origin. Its `nac343-selected-export-v1` index is an
H-normalized contract, **not an implemented xcresulttool format adapter**. A
future adapter must establish the actual result-bundle inventory hash, exact
test identifier/URL, result and resource binding before constructing that index.
Every index row names one flat metadata/PNG pair and its SHA-256 values. Public
`nac343-public-capture-v1` metadata binds equal closed AX phases before/after,
the public app URL spelling, declared geometry/scale and PNG bytes/hash. H joins
each pair to its retained T configuration/request/private fence and diagnostic,
and all eight complete case records to the T summary/run. Notification hints
have no input or authority in this interface. No T path is reopened; successful
T fixture deletion does not prevent collection from retained attestations.

The collector reads without following links, pins directory/file generations,
rejects aliases, wrong owners, special files and changed records, and enforces
32 KiB records, 256 KiB aggregate text, 2 MiB individual PNGs and 12 MiB aggregate
images (including supplied diagnostic bytes). It writes nothing. On failure,
`CollectionError.partial` preserves the unambiguous validated prefix and its
metadata/PNG bytes in memory; the caller owns any durable retention. Interrupts
and unexpected errors retain their original type with `instance_capture_partial`
attached. Close failures cannot replace a primary failure. Rejected payload
bytes are excluded. Original export files remain untouched.

`structurally_complete` establishes only this finite join. PNG signature/hash
and declared geometry checks do not decode images or prove actual OS window
geometry, visibility, OCR or paint. Complete semantic records are hashed and
joined; the existing `ci_instances.require_cases` engine/assets/console/cleanup
gate is still required. No actor, controller, generated XCTest target, SDK
adapter or qualification entry invokes these modules. Full-Xcode/pinned OS,
trusted desktop input, clock admission, actual 8-case/19-frame qualification
and independent acceptance remain separate gates.

These 38 portable synthetic controls also run in the Stable release
`workflow-lint` job on each PR (no SDK, app, engine or network):

```sh
python3 -B -m unittest discover -s desktop/macos -p 'test_ci_instance_capture_*.py' -v
```
