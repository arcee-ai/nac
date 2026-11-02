# Shared workspace qualification (ALL-351)

This test-only suite uses the ALL-340 AppKit preview, bundled production
`nac-web`, system WKWebView, and the existing React/Effect/HTTP/SSE owners.
It adds no production endpoint, bridge, frontend, provider credentials or
user-store access. Every launch has its own disposable profile and Git repository.

`inventory.json` is the complete feature inventory. Product routes come from
`src/App.tsx` and `src/app/lib/routes.ts`: projects, project entry, and session
Insights/Subagents/Files/Terminal/Worksets/History. Legacy Threads resolves to
Insights; invalid panels redirect through the existing behavior policy.
Provider/settings/MCP/goals/approvals remain overlays in those routes.
The design route remains orchestration-gated. Terminal protocol/trusted-input
qualification belongs to ALL-352.

## Build and run

Run `make setup` in the fresh worktree. On this shared host use the coordinator's
admission gate. Build and copy a private executable while holding the Rust
lease, then consume only that copy in the browser lease. For example, from the
repository root (the gate's location is specific to this coordination session):

```sh
python3 /tmp/nac-35-01a18fbf/gate.py setup make setup
python3 /tmp/nac-35-01a18fbf/gate.py rust /bin/bash -c '
  cargo build --locked -p nac-server --bin nac-web &&
  mkdir -p target/all-351 &&
  cp "$CARGO_TARGET_DIR/debug/nac-web" target/all-351/nac-web &&
  NAC_MAC_ENGINE="$PWD/target/all-351/nac-web" ./desktop/macos/workspace.sh
'
python3 /tmp/nac-35-01a18fbf/gate.py browser python3 -B \
  desktop/macos/smoke.py \
  "target/all-351/candidate/NAC Development Preview.app" \
  target/all-351/candidate-baseline-smoke
python3 /tmp/nac-35-01a18fbf/gate.py browser python3 -B \
  desktop/macos/workspace.py run \
  "target/all-351/candidate/NAC Development Preview.app" \
  target/all-351/candidate-workspace \
  --baseline target/all-351/candidate-baseline-smoke/summary.json
```

Use a fresh output directory for each run. `--scenario workspace-direct` or
`--scenario workspace-legacy` selects a focused rerun; absent rows remain
unavailable. The runner relocates the complete bundle into a path with spaces,
launches it through LaunchServices, retains per-feature failure details and
snapshots, and uses the existing ownership-checked cleanup on failure/timeout.
Each automatic scenario has a five-minute outer limit. Read `matrix.json`/`matrix.md`,
raw scenario JSON and logs together. A successful process exit does not mean
full ticket acceptance.

The build manifest retains source revision, tracked diff hash, individual Swift
source hashes, embedded asset tree, native/engine SHA-256, engine build identity,
compiler target and actual OS/SDK. The runner rejects changed sources or binaries.
A macOS 14 compilation target never establishes macOS 14 runtime support.
Lifecycle results are accepted only from the same clean source head, native and
engine hashes, exact OS/build and all six distinct baseline scenarios. A launcher
failure or unconfirmed native cleanup cannot inherit an otherwise passing result.
The runner records screen-lock state and the prior frontmost PID/bundle ID.
The owned fixture gets one normal activation in an unlocked session; it never
repeatedly takes focus back after a user switch. Prior focus is restored only
if the fixture remains frontmost. A locked session cannot qualify visible paint.

For the startup regression, append `--scenario workspace-direct --slow-start`
with a fresh output directory. Only the relocated test bundle gets a 23-second
pre-exec wrapper around its exact source-built engine. The wrapper and real
engine hashes are recorded separately. This reproduces the former 20-second
fixture-gate failure while preserving the preview's 30-second engine watchdog;
it does not change the engine protocol, selected backend or ordinary app.

## Evidence boundaries

Normal workspace captures wait for the exact requested project card or session
and expected transcript text, no conversation loader, nonzero geometry and
fully visible ancestor styles. They then observe fresh frames and use
`afterScreenUpdates`, retaining before/after readiness and PNG hashes. A route
hash, sidebar label or read-only chrome alone cannot qualify a capture. On the
existing bounded deadline the diagnostic PNG and failure remain; styles and
pass flags are never forced. This boundary was exposed by the first actual
macOS 14 episode; its original failed qualification remains separate evidence.

`python3 -B -m unittest discover -s desktop/macos -p 'test_*.py'` includes the
exact JavaScript capture probe's negative/positive DOM checks, using the locked
web JSDOM dependency. Their geometry is explicitly modeled; they do not replace
the required actual WKWebView captures or operator observations.

All automatic interactions are **scripted DOM in actual system WKWebView**.
Synthetic composition/keyboard events qualify only their named characterization
row. They never qualify physical keyboard input, real CJK composition, system
clipboard or VoiceOver. The matrix keeps these requirements visible and leaves
the minimum OS unselected. Every feature is present on both the macOS 14
candidate and execution-OS axes, including unavailable rows.

The local provider supplies deterministic text/tool calls; no real vendor
authentication/schema acceptance is claimed. Goals exercised with it do not
replace the separate ALL-422 nullable goal-schema supplier. Delegated sessions
are explicitly seeded through existing production endpoints, then navigated
through the production Subagents/Open/Parent controls. That fixture setup is
simulated product input and grants no synthetic human authority. MCP's production
Test connection launches `/bin/sh` on an owned profile-local JSON-RPC fixture,
discovers its one inert tool, then saves the configuration disabled. The fixture
only returns static initialization/tool-list metadata; OAuth and live remote
providers need separate evidence.
SSH/Podman execution is not exercised by this Local fixture; those optional
backend gaps remain explicit in the report alongside ALL-352 terminal evidence.

The automatic asset check records loopback production font/chunk/MathJax
requests and JavaScript errors. It does not change the host's network settings.
External-link native handoff, actual offline-host operation, signing and
Gatekeeper are never inferred from a rendered anchor or a screenshot.

## Required real-environment follow-up

Run the same built production workspace on an actual macOS 14 environment and a
current OS, recording OS/build, source/native/engine identity and raw observations.
If macOS 14 fails, repair supported owners or present the compatibility decision;
do not choose a different minimum merely because that OS is available.

An operator must use a real Mac keyboard/input method and VoiceOver on the
actual fixture: navigate project/chat/configuration/MCP/goal and approval
controls, type and select multiline CJK text, press Enter while composing,
confirm no premature send, select rendered prose/table/code, copy and paste,
follow internal/external links, traverse nested overlays and verify announced
roles/names/focus return. Record exact actions, observed results, OS/input method
and artifact identities. Do not label scripted events as these observations.

In an unlocked console, append `--scenario workspace-manual` to the runner
command using a fresh evidence directory. The fixture creates one direct chat,
stages the rich response, records `manual_stage_ready`, then stops scripting
the UI for up to 15 minutes. Use its production controls for the operator checks
and close its window when finished. Sending `WK_APPROVAL` requests an owned
external fixture read through the real permission broker. No physical-input
pass is generated automatically: closing the manual fixture leaves its automatic
`passed` flag false, and operator observations must accompany its raw identity
and cleanup receipts. This is deliberate, not a failed claim of human evidence.

Do not enable accessibility permissions, VoiceOver, input sources or global
preferences automatically. Preserve the user's current interaction. If any
automated fixture later writes the pasteboard, retain its previous representations
only in process memory, never log their contents, and restore only while the
pasteboard's change count is still fixture-owned; never overwrite a newer copy.
Missing required environments/operator evidence remains an acceptance gate.

No full ALL-351 acceptance or review readiness is established by this guide.
ALL-341 engine/control/lifetime, ALL-346 bridge, ALL-352 terminal and ALL-354
broader CI remain separate owners. An integrated supplier refresh requires
fresh affected native evidence.
