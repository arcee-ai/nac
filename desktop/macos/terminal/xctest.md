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

## Passive phase diagnostics

`terminal_xctest_diagnostics_v1` is additive fixture evidence. It does not change
the existing phase schema, six operations, literal bytes, focus, proof predicates
or 60/10/240-second limits. Only the doubly gated terminal smoke binary installs
it, in the disposable owned main document. No product endpoint or input hook is
added. Direct xterm onKey/IME and private client-pump admission remain unknown.

Each native record binds an episode/phase to app launch, bundle, exact window,
engine/profile, session, terminal and controller revision. The page observation
also captures the existing `data-nac-runtime` root and exact textarea identity,
with a document UUID. A replaced/disconnected root, textarea, document or runtime
retires that observation; it cannot adopt another target. Requests capture their
original phase, so late outcomes cannot enter a replacement phase's counters.
Legacy counters and the original admission/proof checks remain separate.

Native `dispatch-uptime-ns` values are decimal strings. They bracket the original
wall-clock anchors and record nominal monotonic deadlines, ready emission and
the ready callback's return interval. The governing `Date` deadlines remain
unchanged. Callback return is not proof of durable file publication or the time
the external driver read readiness. Document `performance` timestamps and
XCTest-relative time are separate domains; no clock conversion is inferred.

Baseline counters accompany ready. Existing polling caches bounded diagnostics;
on failure the app retains the last completed sample, its age, evaluated predicate
verdicts and the original error. It performs no new JS await, input drain or
network read after failure/deadline. File verdicts distinguish absent, exact,
mismatched and unexamined contents; ACK and current-screen predicates remain
separate and preserve their original short circuit. Fetch-written is not shell
interpretation, file proof, visible paint or native input acceptance.

The observer retains only allowed metadata: aggregate trust/type/timing counts,
64 input outcome rows, 128 DOM metadata rows and fixed-reference prefix mismatch
positions. No unexpected bytes, key/data, textarea/clipboard contents, headers,
credentials, error bodies or file contents are exported. Matching is incremental
across UTF-8/batch boundaries and never changes bytes or dispatches requests.
The original fetch receives identical arguments and returns its original Promise,
Response and errors; observation faults cannot replace them.

All hot-path work stays in memory, with no per-key disk/console/network/crypto.
Detailed rings cross the existing JS polling boundary at most once a second,
plus the existing before/after calls; their age is reported separately. Native
projection roundtrip intervals and aggregate observer work are measured, not
claimed to be incremental overhead. A handler interval over 2 ms or total over
20 ms marks measurement degraded. Dropped rows, unavailable observations and
overflow make capture incomplete. Snapshots are capped at 64 KiB per phase,
six phases/384 KiB total; failed serialization emits a bounded unavailable row.
An immutable native cutoff cannot be updated by a late page callback. Its failure
record does not claim JS cleanup or all outstanding requests have completed.

Node VM and Foundation-only Swift source harnesses exercise retention, clocks,
retirement, fetch identity, UTF-8/privacy and bounds. They do not run the app,
engine, browser or public input driver and cannot qualify an actual native row.
