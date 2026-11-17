# Electron desktop owner

This directory owns the Mac development shell, exact bundled `nac-web` child,
private launch protocol, narrow native adapters and local package writer. Rust
continues to own configuration, credentials, canonical store leases, execution,
permissions, backend selection and descendant settlement. The production React
entry is loaded unchanged from the verified ephemeral loopback origin.

Keep launch identity, incarnation, store and schema checks separate from HTTP
and native bridge admission. Never attach to an existing server, select another
store, automatically retry a failed launch, replay input, or kill another owner.
`engine-launcher.c` is a narrow native custody adapter: Node owns that exact
helper; the helper retains the unreaped Rust leader, stops its reserved process
group before reap and emits settlement only after the group is absent. fd 4
carries bounded custody facts and one literal stop; Rust never inherits it.
The helper closes its fd 3 copy immediately after spawn, so actual Node parent
death still closes Rust’s launch peer immediately. Never infer descendant
settlement from Node’s automatic helper reap or signal a group after engine reap.
The inherited fd 3 is a connected Unix socket; `test/transport.test.cjs` proves
Node's platform adapter against Rust and actual parent death.

Renderer sandboxing/context isolation stay enabled, Node disabled and background
throttling enabled. Main/preload only expose existing desktop command, lifetime
and folder ports. Validate current main frame, origin and document nonce on all
native messages. File reveal remains Rust's resource-admitted operation.

The folder picker is a nested LSUIElement application with its own stable native
identity. `scripts/folder-bundle.cjs` alone writes its bundle/plist/executable for
the development resource and package writers. Node always spawns that exact
bundled executable and retains stdin-EOF cancellation and direct-child reaping;
do not replace it with LaunchServices discovery, AppleScript or generic IPC.

Mac close hides the same document and engine. Protected Quit owns one transaction;
Cancel retains work; Stop retires the document before the original engine stop.
Rust's 20-second settlement watchdog precedes the shell's 23-second fallback.
The 26-second UI wait never establishes cleanup or resends stop. Retry is explicit
and requires the prior child to be reaped. Keep Swift and Rune intact.

Unproven custody settlement stays pending. The bridge-free, sandboxed status
window must remain available even when startup never opened a workspace; never
resolve an unproven exit merely to dismiss the UI or permit Retry.

Build the release engine and run `npm run prepare:dev` before real-engine
verification (see README.md). Use `npm ci`, `npm test`, and actual Electron `npm run test:e2e`. Packaging is the
single writer under `scripts/package.cjs`; resources and manifest must bind the
exact engine/assets/source. Build artifacts, disposable profiles and recordings
remain untracked. This is a local ad-hoc development candidate, not Linux or
public release qualification.
