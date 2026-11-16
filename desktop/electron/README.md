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
notifications, complete recovery/draft migration, Linux acceptance and final
hardware/performance parity remain with their broader tickets. This owner does
not retire Swift or change release policy.
