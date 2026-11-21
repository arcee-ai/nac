# Deterministic direct-session load

Run the bounded repository-level workload from the repository root:

```sh
make test-managed-load
```

## Direct sessions with traditional children

The offline workload starts one, two, and four direct parents, each launching a traditional child
that executes a native command. The ordered baseline keeps parent and child
model requests at explicit barriers; a four-parent concurrent case removes the
completion ordering and requires observed overlapping attachment and completion.
A separate loopback case drives the built `nac-web` candidate at all three
levels and verifies its reported build identity. The settlement activity gauge
records actual concurrent store operations;
timestamps alone are not used to infer overlap.

The direct cases check transcript and event ordering, generation-bound terminal
receipts, one delivered parent inbox item per child, recovery obligations,
SQLite integrity, process start/stop observations, and readiness probes while
model requests and settlement are in progress. Separate cases cancel a child
blocked in model I/O or a live native process tree, then reconstruct the manager
and check durable settlement. A separate case holds a SQLite write lock while an
event append for the active child reaches the busy callback and readiness remains
responsive. An injected child transcript append failure retains its failed run
marker and delivers one parent inbox item after reconstruction. The native case
verifies that the observed descendant is gone after cancellation. The nightly portability lane additionally
runs the 1/2/4 workload with owned persistence on current-thread and
multi-thread runtimes.

Direct evidence uses schema version 2 under `target/direct-load/` and
`target/persistence-load-direct/`. Each attempt first replaces stale evidence
with an `incomplete` receipt; a successful case writes its measured outcome.
The direct baseline bounds phase completion at 20 seconds and each health or
readiness probe at 5 seconds. These are liveness budgets for this fixture, not
latency targets or numeric comparisons with the older worker workload.
The evidence contains synthetic identifiers and timings, not prompts or
credentials. These local, scripted cases do not certify managed-host deployment
or production latency.

`make test-managed-fault-fixture` separately builds a feature-gated candidate
under `target/private-fault/`. Its child-read case binds a one-shot control to
the exact session, run, generation and nonce, verifies the process that reached
it, then reconstructs the server and checks one delivered completion. The
commit-ack case injects uncertainty after a real SQLite commit and checks that
replay retains exactly one prompt and receipt. Normal binaries reject private
controls; the private build is not a release artifact.

This scenario is an attribution harness, not a root-cause verdict. It keeps
browser behavior and Kubernetes/PVC behavior outside the primary fixture. Its
`LoadStoreAdapter` boundary records the current SQLite/WAL configuration and
checkpoint results. SQLite WAL remains selected after the accepted ALL-114
NO-GO; embedded and remote Turso are not supported backends. The
[persistence decision](../architecture/0004-persistence-ownership.md#selected-backend)
links the retained qualification evidence. A different backend requires new
explicit decision and qualification work. Results from experiments that change
cache lifetime, backend, or deployment shape are separate evidence and must not
be promoted into a causal claim without a focused reproducer.
