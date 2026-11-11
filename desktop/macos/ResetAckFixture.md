# Pending notification callback after reset

`attention_reset_ack.py` is the maintained, separately admitted actual-app case
for one outstanding mock notification-add callback across a durable native reset.
It uses the existing `AttentionJourney`, native menu/control custody and
`SemanticProvider` request mode. It does not invoke or modify the four-group
semantic journey. Importing the modules does not start an app or listener.

The case creates one isolated profile, direct session, goal-free request and
canonical occurrence. Before launch it exclusively creates its new empty store
with 0600 permissions through the validated private profile descriptor. Existing
files, symlinks and replaced/nonprivate profiles are refused without adoption,
truncation or chmod; the fixture does not change its process permission mask.
Ordinary SQLite opening then preserves private DB/WAL/SHM permissions.
It observes the exact reserved notification/checkpoint,
resets while the callback is still held, then releases that original callback.
Pending callbacks must transition **1 → 1 → 0**, present identifiers **1 → 0 → 0**;
historical adds/deliveries stay **1 → 1 → 1**. Generation advances once and the
reset revision is exactly the reserved revision plus one. An off intent flag,
flush success, failed save or missing checkpoint cannot substitute for the
original durable reset ACK.

Every sample over the full two-second monotonic window must retain off/unread0,
no receipts/frontier/cutoff, empty Dock, no observer/draining and unchanged exact
delivery identity. The file oracle requires version2/reserved before reset and
version1/no native section before release, after release and after app/engine
exit. Normal Stop and independently observed exact app/engine exit precede the
case-specific canonical readout. It must match exactly one completed direct
request with the original session/run/feed identity and no goal or extra work.

`attention_reset_readout.py` pins the private root descriptor and traverses
relative no-follow directories. Files must be owned, private, singly linked,
regular, bounded and stable across the read. The post-exit DB/WAL/SHM bytes are
copied and revalidated; SQLite opens only the artifact copies, never the source
profile. This is distinct from the other journey's eight-session/ten-occurrence
backup oracle. Website cleanup verifies the profile-derived WebKit UUID before
removing the original root. Failure retains fixture data and original owners;
cleanup never releases a held callback merely to obtain a passing count.

Portable controls run without NAC, native helpers, SDKs or network listeners:

```sh
python3 -B -m unittest discover -s desktop/macos -p 'test_attention_semantic_reset_ack.py' -v
```

They are also selected by the existing `npm run test:attention-fixtures` semantic
discovery. They use private temporary files/SQLite databases and inert native
ports to test the real oracle, readout and driver failure boundaries. Passing
these controls is source qualification only.

Actual execution requires separate host/resource admission, a fresh engine and
`preview.sh attention-build` from the exact clean committed candidate, plus an
outer owner retaining original gate/worker/process custody. The entry point is:

```text
python3 -B desktop/macos/attention_reset_ack.py APP FRESH_OUTPUT INSTANCE_OBSERVER FULL_SOURCE_REF ABSOLUTE_MONOTONIC_DEADLINE
```

The absolute deadline comes from that admitted episode's original clock,
including queue time. Entry requires more than180 seconds remaining; native
work is clipped to180 seconds and ends at least120 seconds before that deadline.
An expired clock refuses new normal work. Original unknown cleanup owners remain
retained beyond it until positively settled. No retry or successor is admitted.

This case qualifies the injected center's late add callback after reset only.
It does not hold a checkpoint callback or prove an exact crash/ACK boundary,
signed OS banners/Focus/privacy, trusted IME, minimum-OS runtime, hidden CPU or
full ALL350 acceptance. Actual native evidence remains separately required.
