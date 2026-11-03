# macOS local startup and development preview

This owner contains the ALL-340 disposable AppKit/WKWebView preview and the
ALL-341 private identified engine launch/control seam, and ALL-342 normal local
startup. Read the
root guide before changes. Swift owns only the window, isolated fixture, and
its exact bundled child. Rust remains the execution/persistence/permission
authority; the production React UI and HTTP/SSE client remain shared.

- Bundle `nac-web` and its existing embedded assets. No second frontend build,
  native chat client, privileged script message handler, or production bridge.
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
- Window close quits this preview, with bounded child cleanup before deleting
  its profile. Consumer close/reopen/Quit, persistent preferences, signing, and distribution
  belong to later tickets. EngineProtocol/PreviewEngine own the private bounded
  launch channel; it conveys identity, never API/permission authority.
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
