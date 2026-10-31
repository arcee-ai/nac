# External public XCTest terminal contract

This is an opt-in fixture contract, not an actual input qualification receipt.
ALL-354 owns the shared XCTest project, launcher, workflow and existing-helper
prerequisite observations. The coordinator nominates immutable harness (H) and
terminal (T) revisions before any launch/input run. Never substitute an app's
CoreGraphics permission for the external XCTest helper's existing access.

Build T with both `PREVIEW_SMOKE` and `TERMINAL_SMOKE`, preserving the ordinary
and normal binary exclusion checks. The driver launches the exact verified
relocated bundle URL with `--smoke-scenario terminal-xctest` and the existing
`--smoke-output` destination. Preserve H/T source hashes, actual built tree and
dirty state, native/engine hashes and version, asset hashes, generated Xcode
runner/result receipts, OS/toolchain/display and before/after prerequisite
observations. The app scenario needs no new shared build/dispatch hook.

The driver retains its existing exact bundle/PID/launch-date/window and unlocked
console checks before every public XCTest operation. It addresses exactly one
`Terminal input` accessibility element; it never clicks/refocuses after the
initial fixture setup, falls back to another target, or changes privacy policy.
The app separately checks its captured NSWindow/window number, bundle and
launch, profile/engine PID, active/focused/visible state, console ownership and
explicit lock flags throughout each phase. It polls the exact live terminal
and human controller/revision through read-only production endpoints. Identity,
focus, revision or deadline changes fail the episode; there is no retry/replay.

The app's atomic evidence record contains `terminal_xctest_identity` (schema 1)
with app PID/launch epoch/bundle path/window number, engine PID, session and
terminal ID, controller revision and informational app event-post access.
`terminal_xctest_phase` contains schema, monotonically increasing sequence,
name, state (`ready`, `verified`, `finished`), operation and target identities.
Each phase has a 60-second limit (10 seconds for Control-C); the whole input
journey has 240 seconds. The verified receipt retains each phase's elapsed time.

| Sequence | Name | Fixed public operation | App's independent completion evidence |
| --- | --- | --- | --- |
| 1 | unicode | Type `TerminalFixture.unicodeCommand`, then Return | Exact UTF-8 `Ω中🙂` in initially absent `wk-xctest-unicode.txt`; current screen-tree marker and production parser ACK |
| 2 | interrupt-arm | Type `TerminalFixture.interruptCommand`, then Return | Exact `RUNNING` file and current running marker/ACK while foreground sleep is active |
| 3 | interrupt | Control-C | Exact `INT` trap file, sleep exit status `130`, and interrupted marker/ACK within 10 seconds |
| 4 | recovery | Type `TerminalFixture.recoveryCommand`, then Return | Exact `RECOVERED` file and marker/ACK from a fresh command in the same live shell |
| 5 | resize | Resize the exact window by width −160 and height −80 points | Native frame within 2 points of target and changed production terminal geometry; zero input bytes/keys |
| 6 | size-readback | Type `TerminalFixture.sizeCommand`, then Return | Shell `stty size` file agrees with exact terminal API rows/columns and current size marker/ACK |

The four complete command strings live in `TerminalFixture.swift`; the driver
must compare its nominated literals with each phase's operation before acting.
Do not execute arbitrary commands supplied by mutable readiness evidence.
Command echoes cannot match the full contiguous output markers. Receipt files
must initially be absent and are read with no-follow, regular-file, owner,
single-link and 4 KiB bounds. Only fixed harmless fixture contents are expected.

The driver performs each declared operation once, then waits for the next
sequence or terminal `finished` state. There is no driver-to-app acknowledgement
file, command channel or input API. An external acknowledgement grants no
authority and cannot make the app advance. The app requires exact input-byte
count deltas, successful production `written` receipts, actual trusted key
events and zero synthetic events before recording a verified phase. Event
metadata is bounded and contains no typed/pasted event data. The initial
unfocused negative control checks the app guard without posting any keys.

Completed phase records remain in `terminal_xctest_phases`; normal preview
window close then performs the existing engine/profile cleanup. The external
driver still verifies `passed`, `engine_reaped`, `profile_removed` and absence
of surviving owned processes/profile on every exit path. It retains the same
read-only persistent authorization-policy comparison before/after input.

Only actual successful nominated episodes may supply the
`trusted-mac-keyboard-unicode` and `resize-pty-readback` matrix checks.
`xctest-ctrl-c-recovery` is supplemental; the broader `ctrl-c-job-control` row
remains unqualified. Physical keyboard, real CJK IME, native Edit-menu paste,
VoiceOver, selection, uncertain-write recovery, controller-source fencing,
registered masking and renderer-crash requirements remain separate. Snapshots
are retained for visual inspection; parser/screen-tree evidence alone never
qualifies visible paint. The full ALL-352 matrix stays false while any required
row is missing, failed or unavailable.
