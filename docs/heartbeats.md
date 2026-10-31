# Heartbeats

An interval heartbeat returns to the same direct Local chat to check a saved
purpose. Ask the agent explicitly to schedule it, or open the chat's
**Heartbeats** panel and choose **New heartbeat**. The panel also lists schedules
from **All chats** on this serving host. SSH, Podman, delegated and managed-host
execution are not qualified for this initial feature.

Save the instructions, interval, finish condition and any installed skill names.
An ordinary check creates neither a goal nor another chat. Optionally bind an
already-active goal in this exact chat; paused, blocked, replaced and exhausted
goals never become active merely because a heartbeat is due.

The first check is due one interval after creation. Later due points stay on
that anchor. **Run now** requests a separate occurrence without moving it.
Busy chats retain one pending check per schedule, coalescing the missed range
and count; queued human input gets priority. Editing an interval starts a new
cadence/version and withdraws unstarted old work. **Pause** withdraws pending
work. **Resume** picks a future point on the retained cadence without replaying
paused time. **Stop** also requests cancellation of the exact active check.
**Delete** removes future scheduling while reporting any check already admitted;
it does not claim that active effects were cancelled.

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
