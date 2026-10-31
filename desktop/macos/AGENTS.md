# macOS local startup and development preview

This owner contains the ALL-340 disposable AppKit/WKWebView preview and the
ALL-341 private identified engine launch/control seam, and ALL-342 normal local
startup, ALL-343 app reopen and safe store-conflict retry, and ALL-344 close/Quit. Read the
root guide before changes. Swift owns only the window, isolated fixture, and
its exact bundled child. Rust remains the execution/persistence/permission
authority; the production React UI and HTTP/SSE client remain shared.

- Bundle `nac-web` and its existing embedded assets. No second frontend build,
  native chat client or privileged script message handler. NativeCommands owns
  the bounded UI-only page-world adapter: named actions go to shared React owners;
  web-to-native messages report only readiness/settlement, never operation authority.
- Preview builds create a private temporary HOME/NAC_HOME/workspace/store.
  `LOCAL_APP` builds use DesktopStartup and the bundled Rust preflight to reuse
  normal configuration, credential and track owners. Never seed/delete a normal
  profile. All qualification uses externally owned disposable profiles; never
  open/migrate a personal store for evidence. Read readiness only from the exact
  launched child, never attach to a fixed/default port. WebKit remains
  nonpersistent until the separately owned preference/storage slice.
- PreviewEngine accepts EngineLaunchConfiguration(cwd, store, environment).
  The PreviewProfile/provider adapter retains isolated fixture semantics.
  DesktopStartup never parses TOML, copies credential stores or executes a shell.
  Config preflight retains normal publication recovery and prepares selected
  parent directories through the Rust owner; it opens no DB or serving lease.
- The loopback provider and two configuration-seeding requests are disposable
  test infrastructure. They never operate on user stores or expose real keys.
- Window close quits the disposable preview, with bounded child cleanup before
  deleting its profile. Normal LOCAL_APP close keeps the same window/document,
  bridge, streams and owned engine; AppInstance reopens it. AppLifecycle/AppQuit
  own explicit native Cancel or Stop and Quit. The normal app's NACApplication
  owns the full synchronous
  terminate call/modal wait, rejecting nested entry even if AppKit bypasses the
  delegate. Cancel unwinds that entry before another genuine Quit is accepted.
  Preview keeps its ordinary NSApplication owner. Unknown activity requires
  confirmation; a parent run alone never proves idle. Stop retires NativeCommands
  and releases the WK document before PreviewEngine.stop. The engine retains its
  existing Rust 20-second watchdog and owned 23-second fallback. A later 26-second
  UI wait cancels a stuck termination request without another stop/signal, keeps
  the original callback and shows a truthful retired-workspace failure state.
  Persistent preferences, signing and distribution belong to later tickets.
  EngineProtocol/PreviewEngine own the private bounded
  launch channel; it conveys identity, never API/permission authority.
- `AppInstance` owns existing-window presentation, not singleton/store authority.
  Ordinary normal-app launches use LaunchServices reopening. `StoreConflictRetry`
  fences each failed child's retirement; only explicit native Retry restarts the
  pinned selected configuration through the ordinary Rust serving lease.
  Preserve PreviewApp's common private `fail(String)` funnel and the engine's
  receipt invalidation before callbacks. NativeCommands owns menus/bridge and retires through the common fail/actual-stop
  funnel. Hiding an intact window does not retire its bridge. Native Edit stays
  in the AppKit/WK responder chain; never synthesize trusted terminal intent.
- The read-only `BundleIdentity.sh` helper maps the exact bundled engine identity's track to approved
  normal bundle IDs. Preview and instance-smoke identities stay separate. Normal
  source lists and binaries exclude all preview providers and smoke definitions;
  `build-receipt.json` records the selected source list and hashes. The existing
  builder is the single app writer; packaging consumes its output.
- Keep smoke instrumentation behind `PREVIEW_SMOKE`; it may inspect/drive the
  DOM but must not become an app bridge or replace production workflows.
- Run `./desktop/macos/preview.sh smoke` on an actual Aqua macOS session and the
  existing production-embedded browser regressions. WebKit absence is an
  acceptance gap, never a pass. See README.md for prerequisites and evidence.
- Every native slice must extend and run checked-in actual-app/WKWebView E2E
  journeys for its changed user behavior and relevant startup, lifecycle,
  recovery, failure and cleanup seams. Record exact candidate source/binary
  identity and bounded fixture cleanup. Unit tests and browser emulation alone
  do not establish native acceptance. ALL-354 owns broader full-Xcode CI;
  signing, supported-OS/hardware, real provider authentication and trusted OS
  input remain the evidence obligations of their owning tickets. Scripted DOM
  interaction cannot prove those contracts.

Shared-host execution instructions supplied by the user take precedence over
local defaults. Keep all builds and use of a shared binary inside its lease.
