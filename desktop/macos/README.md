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

Every builder mode emits `Contents/Resources/build-receipt.json` with source,
compiler flags, native source hashes, engine identity and both executable
hashes. It rejects an engine from another source revision or source changes
during compilation. This is unsigned compiler provenance for the packaging
owner; signing requires a separate final artifact manifest. The local builder's
development bundle identifier is not the distribution or track identity contract.
