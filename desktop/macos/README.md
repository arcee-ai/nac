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
`--worker-executable` and `--no-open`. Its inherited diagnostic pipe reports the
actual address after bind; the shell never probes or adopts port 3210. This is
the existing CLI readiness seam, not a versioned identity/control protocol.
Main-frame navigation is confined to that origin. There is no web-to-native
message bridge.

Missing/unlaunchable engine, startup exit, readiness timeout and WebKit load or
renderer failure display a native status message. Close or Cmd-Q initiates Rust
shutdown; the app waits for its child, allows the server's 20-second shutdown
watchdog, and kills the owned process group after 23 seconds if needed. It
removes the profile only after the child is reaped. An OS force-kill of the app
is outside this preview's orderly-close contract and can leave temporary data;
later engine/lifecycle slices own crash recovery.

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
window lifecycle, versioned engine control, native menus/bridge, or performance.
Those have separate owners in the ALL-339 work map.
