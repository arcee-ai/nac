# WKWebView terminal qualification (ALL-352)

This fixture runs the existing production terminal inside the actual AppKit
preview and system WKWebView. It uses pinned xterm 6.0.0, the existing Effect
lifetime, runtime-free client, HTTP observation protocol and Rust Local owner.
It does not change production terminal behavior or create an input bridge.

The production **Create chat** and **New shell** controls create an isolated
Local shell. Before launch, the fixture writes `.bashrc` into that preview's
private HOME. Startup and a bounded file rendezvous producer emit deterministic
Unicode, split output, alternate-screen sequences, OSC52/query sequences and a
12 MiB retention overflow. These are fixture-generated output, never human input.
The synthetic key/paste/composition negative control must issue zero input POSTs.
The startup fixture holds an incomplete UTF-8 scalar and an incomplete CSI
sequence until the actual production observer ACKs each prefix's frame. Only
then does the driver release the continuation through a bounded file rendezvous.
This prevents stdout coalescing from manufacturing a split-frame parser pass.
Transport observations are bounded metadata; typed or pasted contents are not
recorded. OSC write attempts are counted and suppressed without reading or
changing the system clipboard.

## Reproduce

Run `make setup` through the shared setup gate in every fresh worktree. Build the
exact current `nac-web` inside the shared Rust lease and copy it into a private
path before releasing the lease. The build embeds the committed production
assets; do not reuse a shared target executable after releasing its lease.

With `NAC_MAC_ENGINE` pointing at that private executable and `NAC_MAC_OUTPUT`
pointing at a private output folder, run under the single browser/AppKit lease:

```sh
./desktop/macos/terminal.sh
python3 -B desktop/macos/terminal.py run \
  "$NAC_MAC_OUTPUT/NAC Development Preview.app" FRESH_EVIDENCE_DIRECTORY
```

`terminal.sh` builds three native artifacts: normal preview, ordinary
`PREVIEW_SMOKE`, and the terminal fixture with both `PREVIEW_SMOKE` and
`TERMINAL_SMOKE`. It checks that terminal instrumentation is absent from the
first two. `preview.sh smoke` includes the terminal sources only when
`NAC_MAC_TERMINAL_SMOKE=1`. Ordinary workspace and CI smoke builds do not need the
terminal sources. The terminal runner refuses a changed source/native/engine
identity after build capture.

The actual bundle is relocated to a private path with spaces and opened through
LaunchServices. The inherited workspace runner supplies isolated startup and
identity-checked bounded process/profile cleanup. It records the prior frontmost
application and strongest explicit console lock observation. This output fixture
posts no CoreGraphics events, prompts for no TCC access, and changes no input
source or global preference. A locked console remains locked.

Use `--scenario terminal-output` for the output suite. The
`terminal-renderer-failure` scenario records the missing exact-owned public
WebContent crash seam as unavailable; it does not simulate a crash and claim
recovery. Existing ALL-340 startup/failure/close acceptance remains reproducible
with `desktop/macos/smoke.py` on the same instrumented bundle.

On an already unlocked authorized Mac, `--scenario terminal-manual` stages the
same deterministic shell for up to 180 seconds. Its smoke-only native **Edit**
menu uses ordinary Copy/Paste/Select All responder-chain actions; the fixture
never invokes those actions or reads/writes the system clipboard automatically.
A real operator can click the terminal input area, type fixture-only commands, exercise CJK composition and
Edit-menu paste, resize, use a pager/job control, then choose **Edit → Finish
terminal capture**. The fixture records bounded content-free event provenance,
input/control counts and a snapshot before normal cleanup. It refuses staging
while locked/inactive/occluded and never retries activation or requests TCC.
This mode collects evidence; event counts alone cannot certify exact PTY bytes,
IME correctness or full ALL-352 acceptance. Do not enter real credentials.

The separately owned ALL-354 public XCTest driver can consume the opt-in
`terminal-xctest` app scenario after coordinator nomination of exact harness and
terminal sources. Its [phase contract](xctest.md) fixes Unicode, foreground
Ctrl-C recovery and native resize/readback operations. The app only publishes
readiness and independently observes results; it never posts keys, accepts
external commands or consumes acknowledgements as authority. The existing
XCTest helper's read-only before/after prerequisite observations remain the
driver owner's responsibility. App CoreGraphics event-post access is recorded,
not required or assumed. The ordinary terminal runner does not dispatch XCTest.
This source contract alone supplies no new actual-WK acceptance evidence.

## Evidence contract

Each fresh output folder contains per-scenario JSON/logs, console and relocation
records, diagnostic WK snapshots when capture succeeds, `matrix.json`,
`matrix.txt`, and `sha256.json`. The build receipt records source HEAD/base,
tracked diff and native source hashes, embedded asset tree, exact engine/native
binary hashes and version, compile flags, OS/build, SDK, developer directory and
available Xcode information. Resources loaded by the actual WK document are
recorded in the native episode. Xcode absence includes its failed operation and
diagnostic. Selected/enabled input-source preferences are read without mutation;
native window/screen bounds and backing scale are recorded without hardware
serials. These facts never imply that a real IME interaction occurred.

The current xterm accessibility **screen tree** establishes decoded parser
output; its historical live region is excluded. A screen-tree pass is not a
paint pass. Snapshots record fresh animation-frame and window-occlusion facts.
A blank or occluded snapshot never qualifies visible rendering.

Every required ALL-352 acceptance row remains present. Exit zero means the
scripted characterization and bounded cleanup succeeded; only
`matrix.json.accepted` describes full qualification. It remains false while any
required row is failed or unavailable. Local characterization, SSH and Podman
coverage are reported separately. Missing infrastructure never counts as pass.

The unmanaged preview has no managed command-environment snapshot. A model
provider key is not a terminal masking pattern. Therefore this fixture does not
claim exact-value masking acceptance merely by printing a synthetic provider
key; the required masking row remains unavailable until the real redaction
owner supplies an isolated launch snapshot. Existing collector, selection and
native managed-redaction tests are supplier evidence, not a WK substitute.

## Remaining real-environment contract

Acceptance still needs an unlocked authorized Mac session with real keyboard,
CJK IME and native responder-chain Edit-menu paste. Preserve genuine `isTrusted`
provenance and exact written bytes for Unicode/bracketed paste, Ctrl-C, alternate
screen, job control and resize. Never replace that evidence with DOM events,
Playwright WebKit, Chromium, a direct input API or a patched trust gate.

Consume the coordinator-nominated immutable ALL-354 public XCTest driver for
its qualified narrow ASCII case and nominated terminal phases; this slice does
not duplicate the harness or promote ASCII into Unicode/IME/paste qualification. The remaining
matrix also requires accepted-but-uncertain input freeze/explicit recovery with
no replay, current controller revisions, history read-only behavior, selection
attribution and masking, exact renderer-crash/replay-gap lifecycle, sustained
noise/input/cancel queue bounds, and visible paint. The ALL-340 preview ends on
window close; consumer close/reopen and crash recovery must consume their real
lifecycle owners rather than inventing an alternative app lifecycle here.

Verification while iterating:

```sh
python3 -B -m unittest discover -s desktop/macos -p 'test_*.py'
xcrun swiftc -swift-version 5 -target arm64-apple-macosx14.0 \
  -D PREVIEW_SMOKE -D TERMINAL_SMOKE -typecheck desktop/macos/*.swift
make test-source-size
```

Full ALL-352 acceptance, current-head review readiness, human approval, merge,
and ticket closure are separate facts. This fixture does not authorize any of
them by assertion.
