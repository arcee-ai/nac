# Historical Mac native acceptance — 13 November 2026

The relocated historical development candidate passed the explicit live native
case in 4.0 minutes. These observations qualify the frozen source and binary
below, not a later PR head. This is native development evidence, not vendor
authentication, minimum-OS, accessibility, Linux or public distribution qualification.

This public summary is privacy-redacted: checkout-root locations are shown as
repository-relative paths. Historical source/binary hashes, fixture identities
and failed episode boundaries are unchanged. The original local packets may
contain personal paths and must be redacted before any public attachment.

Candidate identity:

- Local historical production source: `4cada76fc45235b229f02034243b09145100c1ed`.
- App: `target/electron-review-relocation/Folder With Spaces/NAC Electron.app`.
- Engine SHA-256: `3e6400da275a45c2803a3bddea8f9f984dac75d0fcf4abbff173615aee9384c7`.
- Manifest SHA-256: `565701ea52ec77c2f2952b72f65046c3ff4847812624940e01fe60a590bedc33`.
- Accepted run: `a9f0fc0b-af67-4ec9-8395-512f09a720ac`, completed at
  17:34 Pacific. Later source commits contain test controllers and documentation;
  the packaged production source remains frozen above.

## Observed behavior

The exact relocated app launched through LaunchServices with a minimal
`/usr/bin:/bin:/usr/sbin:/sbin` PATH and explicit private profile/store. Its
preparation engine had already settled and been reaped. No inspector or alternate
development executable was used for this case.

The native actor used the real File menu and addressable **NAC Folder Picker**
AppKit application to choose `Selected Folder α`, including spaces and Unicode.
The path returned to the normal React form; normal project creation succeeded.
An independent read of Rust's project record confirmed the expected name and cwd.

The normal Files/**All files** selection revealed the unique committed
`native-reveal-a9f0fc0b.txt` through Rust's admitted reveal operation. The native
actor observed that selected leaf in Finder and closed only that fixture window.

The normal MCP **Continue OAuth authorization** link opened real Chrome to the
existing local authentication double. The browser showed the callback completion
page, NAC showed **Connected**, and the external page had no NAC bridge. The
double recorded one PKCE-verified token exchange. Tokens and callback ownership
remained in Rust. The actor closed only the fixture browser tab.

Native Quit/Cancel preserved the app, followed by ordinary Stop and Quit. The
controller independently confirmed settlement for captured app, engine, custody,
Electron helper and picker process identities. It issued no extra native
Quit after the actor had exited the app. The unchanged private profile root was
removed only after this positive settlement check.

## Retained evidence and previous failures

The local raw packet is `target/electron-native-manual-Iu8gos/`: `ready.json`,
`native-observations.json`, `auth-evidence.json`, `acceptance.json` and
`cleanup.json`. The run log is `target/electron-native-final-accepted.log`.
All three independent criteria are true: `folderProjectCreated`,
`browserObserved` and `pkceSucceeded`; `cleanup_settled` is true. The captured
app/engine/custody/picker PIDs were 55425/55435/55434/55886, with kernel births in
the packet. The controller's ordinary owner suite separately has three focused
characterizations for unknown-live, PID-reuse and exit/control races.

The earlier `target/electron-native-manual-D7ySKX/` trial was explicitly aborted
when computer use could not address the unbundled picker. It is not acceptance;
the nested native application identity repaired that concrete limitation.

The same-production-source `target/electron-native-manual-9AKkga/` trial recorded
actual Edit/Select All, window close/hide, the retained app and engine, private
LaunchServices reopen with the same route, and native Quit/Cancel then Stop.
Its controller nevertheless failed: redundant project reads could race HTTP
retirement, and cleanup diagnostics masked the primary exception. The original
failed log and packet remain. The repaired controller stops those reads after
positive durable creation, retains authentication snapshots and primary errors,
and requires an independent exact census even when native control races reap.
The fresh accepted run above passed that repaired controller; the old failure
was not relabeled as a pass.

An earlier computer-use inspection elsewhere in this milestone relaunched an
exited candidate with the normal profile. No commands or prompts were submitted,
but startup store access or migration effects are unknown. This record does not
claim that every historical launch was isolated or that personal data was
unaffected. The accepted native run above used its explicitly verified private
profile; subsequent attachment required a positively live exact PID and birth,
with no post-Quit app inspection.
