# Exact question-settlement readiness in the attention fixture

The native attention integration fixture keeps its single exact question-answer
request and HTTP200 oracle. Its five-second readiness budget now waits for the
source run's real `WaitingForQuestion` selection after the ordinary continuation
selector has returned. At that point the selector holds no operation lease,
store transaction, inbox wake lock or attention lock.

`has_active_operation() == false` only describes the local active-operation
slot. It does not prove the session operation lease is available. A real held
lease can reject an answer while that slot is empty, as the existing foreign
owner characterization requires. The historical HTTP409 failures did not retain
their bodies or lease owners, so this fix does not identify their actual branch.

The question frontier is a distinct registration kind in the existing bounded,
exact store/session/run test-support registry. Registration requires the direct
question's source run and generation to match. Only actual `WaitingForQuestion`
can consume it. The existing idle publication registration still accepts only
`Idle` and `IdleUnverified`; its rejected kinds are unchanged. Drop releases only
the owned registration. Both hook implementation and exported type are absent
without test/test-support.

The fixture registers before releasing its original provider gate, waits within
the same five-second budget, releases the hook, then sends the original answer
once. The existing bounded failure body diagnostic from PR627 and every
question/source/goal/exact-once/permission/SSE assertion remain. No extra wake,
request retry, added sleep, deadline expansion or product admission change is
introduced. In particular the production selector still reconciles goal state,
promotes queued input before the question gate and retains its leased recheck;
foreign live leases still require Conflict and unchanged pending state.

New core controls cover wrong source/generation/store/session/kind, duplicate and
one-shot registration, the existing idle hook's question rejection, an actual
lease with an idle local slot, actual post-selector lease freedom, and retained
queued-input priority and source provenance. These are new test obligations,
not historical failure attribution. Local preparation only formats/parses source
and verifies exact preserved bytes: Rust compilation and actual control/server
execution must pass in current-source GNU CI before this concurrency fixup is
ready to land. Existing failing/cancelled observations remain retained. This is
a fixture correctness repair, with no optimization or cohort credit.
