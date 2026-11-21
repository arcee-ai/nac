# NAC Electron Mac development candidate

This owner loads NAC's complete existing production React workspace from its
exact bundled Rust engine. There is no Vite server or separate frontend. Rust
continues to own profiles, credentials, permission policy, execution backends,
store leases, authentication callbacks, Finder resource admission and cleanup.
The Swift app and Rune remain available.

From the repository root on Apple Silicon macOS (`$PWD` below is that checkout):

```sh
make setup
npm --prefix desktop/electron ci
cargo build --locked --release -p nac-server --bin nac-web
node desktop/electron/scripts/prepare.cjs
npm --prefix desktop/electron test
npm --prefix desktop/electron run test:e2e
NAC_ELECTRON_OUTPUT="$PWD/target/electron-review" npm --prefix desktop/electron run package
```

After preparing resources, `npm --prefix desktop/electron start` launches the
unpackaged development app with `target/release/nac-web` and
`target/electron-resources`. Optional `NAC_ELECTRON_ENGINE` and
`NAC_ELECTRON_RESOURCES` overrides must be absolute and match the prepared
identity. Packaged apps always use their bundled resources.

The package writer refuses to replace an existing app. Select a fresh output
directory with `NAC_ELECTRON_OUTPUT=/absolute/path` for another candidate.
It also rejects stale engine revision/version metadata and uncommitted runtime
inputs. Commit code and rebuild the release engine before packaging for review.
The generated app contains Electron, the exact optimized `nac-web` and its
embedded assets, native folder helper, license notices and `manifest.json`.
Build tools are needed to build, but are not runtime dependencies.

Launch the normal local profile through LaunchServices/Finder:

```sh
open "$PWD/target/electron-review/NAC Electron.app"
```

NAC uses normal `HOME`, `NAC_HOME`, XDG configuration and track-specific store
selection through Rust's desktop preflight. Finder launches do not execute shell
startup files. System paths, Homebrew paths, and explicit repeated
`--command-path /absolute/tool/directory` entries supply project tools. You may
pass `--directory` and `--store-path` explicitly. This does not grant permission,
change the selected backend, create credentials or bypass missing tools.

For a disposable review profile (never migrate personal data for testing):

```sh
review_root=$(mktemp -d /tmp/nac-electron-review.XXXXXX)
mkdir -p "$review_root/home" "$review_root/nac-home" "$review_root/workspace"
open -n --env HOME="$review_root/home" --env NAC_HOME="$review_root/nac-home" \
  --env NAC_ELECTRON_DATA_HOME="$review_root/electron-data" \
  "$PWD/target/electron-review/NAC Electron.app" \
  --args --directory "$review_root/workspace" --store-path "$review_root/store.db"
```

Close hides the retained window and engine. Dock activation and a matching
second launch reopen it. Quit asks Cancel or Stop and Quit when work is unknown;
Cancel preserves it. Stop retires the React runtime/bridges and waits for the
owned engine. The existing Rust 20-second watchdog and 23-second shell fallback
remain; a pending-cleanup message is not a claim that processes have exited.
Store contention and future schemas remain distinct errors. Retry never adopts
another engine, changes stores or replays input, and waits for the prior child.
If custody cannot prove settlement, a sandboxed cleanup status remains visible,
including before the first workspace opens. Helper exit alone never enables Retry.

Renderer crashes and failed read transports retire the old document/runtime,
streams and native capabilities, then revalidate the original retained engine
and reload the current route. Automatic recovery is bounded; Window → Reload
Workspace provides a bounded explicit retry. Engine death remains distinct and
requires the original cleanup and explicit engine Retry. Suspend/resume handling
uses the same revalidation boundary; deterministic tests do not qualify actual
system sleep/wake. A pending manual approval can be denied by Rust when its
interactive renderer disconnects. The restored workspace displays canonical
state, and queued work may then run once through Rust's ordinary scheduler.

Preferences and text drafts use the Swift-compatible private checkpoint owner,
scoped to canonical HOME, build track and Rust's canonical store. New ports and
engine incarnations do not change that scope. The native helper holds a separate
presentation lease through accepted writes and exact acknowledgments; Quit waits
for its actual drain and exit. Supported versioned Swift checkpoint bytes remain
recoverable until migration acknowledgment. Unavailable/corrupt storage uses
memory with an honest notice. Cold text appears for Review/Restore; only a
deliberate Restore fills the composer, and no draft is automatically submitted.

Background completion/decision notifications default off. Use NAC → Notifications
to enable, mute or reset the saved state. Main consumes Rust's semantic metadata
without keeping a hidden renderer busy. Delivery accounting waits for exact
durable revision acknowledgments; opt-out/reset fence pending callbacks, and a
save failure suspends delivery with status explaining that an older setting may
return. Native clicks carry only a bounded current session target through the
shared navigation guards; deferred or stale targets are discarded. If the
preload positively reports that a target owner was absent before any callback,
the original click may wait for one newer owner within its original deadline.
An invoked or uncertain callback is never replayed. Electron
reports permission as system-managed; runtime support or a show callback does
not establish a visible OS banner. Signed OS show/click/withdraw proof remains
separate qualification when unavailable in the ad-hoc development app.

Native menus use the existing React command guards and normal Edit roles. Folder
selection returns form data for Rust to revalidate. Reveal uses the existing
Rust endpoint. Deliberate HTTP(S) links open the system browser; scripted
popups and unsafe navigation are refused. Provider/MCP credentials and callback
ownership stay in Rust. Renderer Node integration is disabled, context isolation
and sandboxing are enabled, and background throttling remains enabled.

For the packaged actual-app regression lane:

```sh
NAC_ELECTRON_APP="$PWD/target/electron-review/NAC Electron.app" \
  npm --prefix desktop/electron run test:e2e
```

Tests reuse the shared scripted Responses provider and production workflow
patterns. They use only private fixture profiles. Chromium keyboard input proves
the Electron input boundary; it does not certify physical keyboard, IME,
VoiceOver or actual paint. The performance owner documents separate proxies and
whole-application accounting in [performance](performance/README.md).

For the dedicated Mac CI lane, commit the runtime/test inputs, then run from a
clean Apple Silicon checkout with an available unlocked Aqua console:

```sh
python3 -B desktop/electron/scripts/ci.py --expected-sha "$(git rev-parse HEAD)" \
  --output "$PWD/target/electron-ci-evidence"
```

Choose a new output path for each run. This runs locked setup/install, builds the
normal optimized engine, prepares resources, runs owner tests, packages the exact
source through the existing writer, then launches actual main/preload/renderer
tests with private profiles. The runner uses the existing Swift lane's read-only
GUI prerequisite; unavailable/locked console is an explicit failure. It never
requests OS permission changes. Credentials and build-flag overrides are absent
from the app environment. Renderer sandboxing and throttling remain enabled.

Ordinary admitted PRs invoke `macos-native / ARM Electron actual app`
automatically through the existing mandatory Mac workflow/aggregate. Electron
checks out `pull_request.head.sha`; other events use the admitted source SHA.
Both are recorded, so merge-candidate checks are not represented as head-app
evidence. Existing metadata-only admission and native-supplier selection remain
unchanged. Rust compiler caches are read on PRs and written only on dev/main
pushes; explicit cold-cache mode is preserved. The full source-security scan
also covers `desktop/electron/package-lock.json`.

The upload contains bounded sanitized phase logs, package/source/engine/asset
hashes, selected scenario verdicts and positive fixture/owned-child cleanup
receipts, plus observed image/OS/Xcode/SDK/compiler/runtime identities. Tool
observations retain unavailable/nonzero results; required build and GUI phases
must still succeed. This lane does not inherit Swift's WK supplier envelope.
Raw Playwright attachments, profiles/stores, screenshots, videos,
traces and all-process lists are excluded. Selected CI cases cannot pass by
skipping or retrying. The [versioned feature inventory](e2e/FEATURE-INVENTORY.md)
distinguishes covered/added scenarios, manual observations and deferred workflow
coverage, including peer-owned recovery/notification specs discovered on join.
Hosted execution is proven by that exact-head Actions run and packet, not by
workflow YAML or a local pass. Linux, physical keyboard/IME/AX, real sleep/wake,
signed notification delivery and release qualification remain separate.

The packaged test controller pauses its exact child in the Node inspector before
application startup and removes Playwright's three injected debugger arguments
from JavaScript argv. The shipped argument parser and renderer bridge are
unchanged. Tests assert `app.isPackaged` and independently check the engine and
native supervisor have exited. This controller is not included in the app.

The [development checkpoint](MAC-DEVELOPMENT-CHECKPOINT.md) and
[native acceptance record](e2e/NATIVE-ACCEPTANCE.md) describe the historical
13 November candidate, not a later PR head. Their documented launch paths are
privacy-redacted portable examples; recorded binary hashes remain unchanged.
Original local evidence packets can contain local paths. Inspect and redact
logs, screenshots and recordings before attaching them to a public PR; use
disposable fixture roots under `/tmp` for new public visual evidence.

## Dependency and distribution review

Electron is pinned to 45.3.2 and Playwright to 1.62.1 in the independent npm
lockfile. Playwright is already used by NAC's web tests and is build/test-only.
Electron's npm package and runtime use MIT licensing; bundled Chromium/Node and
other third-party notices remain in the copied runtime and accompanying notice
files. No third-party implementation was copied into NAC source. The official
runtime download uses its pinned checksum. The dependency audit had zero known
npm vulnerabilities at installation. Review this lockfile when upgrading.

This app is ad-hoc signed for local development. Signing credentials,
notarization, quarantined public download/Gatekeeper acceptance, updates,
actual system sleep/wake, signed notification show/click/withdraw, Linux acceptance
and final hardware/performance parity remain with their broader tickets. The
selected development behavior and disposable Swift-fixture compatibility do not
complete those broader tickets or retire Swift/change release policy.
