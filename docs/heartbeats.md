# Heartbeats

An interval or calendar heartbeat returns to the same direct Local chat to check a saved
purpose. Ask the agent explicitly to schedule it, or open the chat's
**Heartbeats** panel and choose **New heartbeat**. The panel also lists schedules
from **All chats** on this serving host. SSH, Podman, delegated and managed-host
execution are not qualified for this initial feature.

## Scheduling and control

Save the instructions, cadence, finish condition and any installed skill names.
An ordinary check creates neither a goal nor another chat. Optionally bind an
already-active goal in this exact chat; paused, blocked, replaced and exhausted
goals never become active merely because a heartbeat is due.

Choose an elapsed interval, daily local time, selected weekdays, or one weekly
day. Calendar rules always save an explicit IANA timezone, such as
`America/Los_Angeles`. A new form initially captures the viewing device's zone;
review it before saving. The stored zone stays fixed when the device or server
timezone changes. Raw cron/RRULE, monthly/yearly calendars and quiet hours are
not supported.

The form previews upcoming instants both in the stored zone and UTC before
creation or an edit. Native agents use `preview_heartbeat` for the same passive
calculation, then save the returned rule/data version with `heartbeat_control`.
`read_heartbeat` returns the saved rule, exact next due and upcoming UTC/local
instants. Preview and history reads never attach, wake or schedule a chat.

Nonexistent spring-forward wall times are skipped. A repeated wall time fires
once, at its earliest UTC occurrence. Calendar cadence follows local dates, not
an assumed 24-hour elapsed interval. Editing the zone, time or day rule selects
a strictly future point of the new version and withdraws unstarted old work;
already-admitted work keeps its original rule and UTC provenance. Downtime
coalesces into one check with the actual missed UTC range and count. Resume
skips deliberately paused dates, including gaps/folds, and a backward clock
does not rewind the retained next due.

Calendar calculation uses NAC-owned pinned official IANA **2026f** data through
Jiff **0.2.38**, with the MIT license choice and only `std` enabled. No host zone
files, automatic network refresh, bundled fallback or POSIX timezone strings
participate. Every saved calendar rule retains its data version. Unknown zones,
versions or rules fail visibly. A deliberate data update must retain support
for saved versions or explicitly migrate/review affected schedules; it must not
silently reinterpret existing due identities.

Preview contains at most 16 points. Each next/previous search examines at most
366 local dates; downtime counting uses arithmetic weekday totals and at most
32,768 timezone transitions rather than replaying every missed date. Existing
history, start, concurrency and command-receipt limits below also apply to
calendar schedules. This calendar surface targets existing chats. A calendar
with a fresh-task destination is unsupported until the separate ALL-484 integration.

For an elapsed interval, the first check is due one interval after creation.
Later due points stay on that anchor. **Run now** requests a separate occurrence without moving it.
Busy chats retain one pending check per schedule, coalescing the missed range
and count; queued human input gets priority. Editing an interval starts a new
cadence/version and withdraws unstarted old work. **Pause** withdraws pending
work. **Resume** picks a future point on the retained cadence without replaying
paused time. **Stop** also requests cancellation of the exact active check.
**Delete** removes future scheduling while reporting any check already admitted;
it does not claim that active effects were cancelled.

A pending structured question defers a check without spending its occurrence or
retry allowance. After an answer is accepted, its exact reserved continuation
gets priority; the heartbeat cannot consume that response as its own input.

The server owns scheduling from startup, so closing every browser does not stop
checks. Stopping the server stops admission and uses normal run cleanup. After
an interrupted admission or execution, the schedule suspends for review with
its original receipt and run identity. Uncertain effects are never automatically
replayed. Read the evidence before editing or resuming it.

Results retain evidence and a link to their run. An unchanged result stays quiet
in the session list. Meaningful changes, completion, missing classification,
failure and human-action results remain visible until opened. A model report is
provisional: final failure, interruption or a denied action takes precedence.
Human controls do not grant future unattended tool approval; checks use current
agent policy and the backend/workspace selected for this chat.

## Limits and retained history

The initial finite operating limits are:

| Limit | Value |
| --- | --- |
| Interval | 60 seconds to 365 days |
| Host schedule inventory, including retained deletion tombstones | 100 |
| Concurrent heartbeat runs per host | 4 |
| Starts per host | 60 per trailing minute |
| Starts per schedule, including Run now | At least 15 seconds apart |
| Pending work | One coalesced occurrence per schedule |
| Retained results | 32 per schedule, plus active/pending work |
| Default checks per schedule | 1,000; configurable from 1 to 100,000 |
| Deadline per check | 300 seconds by default; 1 second to 1 hour |
| Command receipts | 4,096, plus a bounded reserve for remaining pause/stop/delete transitions |

Within the same history allowance, recent admitted starts take precedence over
newer withdrawn requests so trimming cannot erase the start-rate fences.
Only a later admitted start advances that retention window; control and
settlement timestamps cannot expire starts needed after a clock rollback.
If the wall clock falls behind the latest retained host start, heartbeat admission
waits until it catches up. Pending receipt identity and retry allowance stay intact.

An accepted Stop retains its exact-run cancellation request through later edits
or deletion until that occurrence settles. Delete alone does not cancel a run.
Withdrawing unstarted checks does not turn an earlier unchanged result into unread
activity; later ordinary runs and actionable results still remain visible.

Deleting a schedule retains its tombstone and original command responses so a
lost acknowledgement can be retried safely. Capacity exhaustion requires human
review; deletion does not erase those identities. The panel freezes an uncertain
request until **Retry same request** reconciles it. A definite rejection allows
reviewing the latest schedule before issuing another command.

Token allowances stop subsequent admission after settled usage reaches the
allowance, or when usage is unknown. In-flight tokens are not a fabricated final
charge. A running check can overrun a token allowance before its final sample is
known. Deadlines use monotonic elapsed time and request exact-run cancellation;
process cleanup may finish after the deadline. History and usage retain those
facts rather than claiming immediate rollback or a hard provider-token cutoff.

## Historical measurements

Measured on October 30, 2026 at revision `8b91042c` on an Apple M5 Max (arm64),
under the shared exclusive Rust/browser lease:

| Stored schedules | Runnable chats | Admitted / pending | Cold scan, ms | Warm p95, ms | Maximum initial admission lateness, ms | DB + WAL + SHM, KiB | Process RSS before / active, KiB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1 / 0 | 48.25 | 7.60 | 52 | 564 | 22,896 / 46,640 |
| 10 | 4 | 4 / 6 | 153.56 | 12.14 | 179 | 624 | 49,600 / 54,304 |
| 100 | 4 | 4 / 96 | 163.63 | 13.69 | 440 | 900 | 54,320 / 55,264 |

Repeated on October 31, 2026 at the admission-watermark repair `b49ed3cc`,
using the same fixture and Apple M5 Max (arm64), with all Rust, browser and
setup leases held exclusively. The copied test binary was built from that
exact revision; the measurement passed and left no fixture roots.

| Stored schedules | Runnable chats | Admitted / pending | Cold scan, ms | Warm p95, ms | Maximum initial admission lateness, ms | DB + WAL + SHM, KiB | Process RSS before / active, KiB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1 / 0 | 49.80 | 9.76 | 57 | 564 | 22,816 / 46,752 |
| 10 | 4 | 4 / 6 | 157.42 | 13.89 | 182 | 620 | 49,568 / 54,064 |
| 100 | 4 | 4 / 96 | 155.15 | 12.20 | 409 | 900 | 54,080 / 54,960 |

A separately authorized hosted Linux/debug run on November 2, 2026 (UTC),
[41507785062, attempt 1](https://github.com/arcee-ai/nac/actions/runs/41507785062/job/125491404146),
used control `1370c66b56ff4305fb899ab38f8937c8fb44fbe6` and product
`48b9769453c7cb0b245d9f9b1f955ef4a880a431` (tree
`b2f53563c8bebdc8322c636b74a57fac1f981086`). The same retained test executable
listed 352 registered tests; only one exact ignored measurement ran, covering
1/10/100 schedules and two scheduler owners.

| Stored schedules | Runnable chats | Admitted / pending | Cold scan, ms | Warm p95, ms | Maximum initial admission lateness, ms | DB + WAL + SHM, KiB | Process RSS before / active, KiB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1 / 0 | 91.325 | 16.213 | 92 | 564 | 63,312 / 92,404 |
| 10 | 4 | 4 / 6 | 315.876 | 18.763 | 369 | 624 | 93,716 / 99,212 |
| 100 | 4 | 4 / 96 | 351.993 | 19.612 | 956 | 900 | 99,340 / 101,200 |

Fresh namespace custody checks, postmeasurement resource/fixture/source checks,
the complete 180-file export (including 20 new hidden font-cache files), and
namespace retirement passed. The earlier
[41307523898](https://github.com/arcee-ai/nac/actions/runs/41307523898) remains
failed: its upload omitted 20 manifested font-cache originals and its
postmeasurement checks were not reached. The later export does not recover
those missing originals or relabel that failed run.

These are historical product48 fixture observations, not current-dev timings.
Current question/admission and calendar overhead is unmeasured. Hosted VM
competition was not controlled; this result establishes neither an SLA nor
physical-host exclusivity, live-vendor reliability, WKWebView/OS delivery or
security qualification. The recorded execution allocation is consumed; this
documentation does not authorize another benchmark.

The ignored test
`heartbeat_scheduler_measure_1_10_100_with_two_owners_and_bounded_chat_contention`
runs two independent scheduler owners against one isolated fixture store and
real Local admission. A hanging HTTP model keeps the bounded runs active while
24 warm scans exercise contention. The fixture uses a non-Git workspace and
initially eligible due points; RSS is for the entire test process, retained
across the three cases. These numbers measure this bounded fixture rather than
provider throughput or long-running history growth.

The live scheduler scans every second and skips timer backlog. Startup, ordinary
chat work, workspace conflicts, approval/readiness gates and host capacity can
add lateness. A busy chat keeps one coalesced pending receipt; its lateness grows
while the conflict persists. The 60-second supported minimum interval is not a
promise of execution at an exact wall-clock instant.
