# Nightly native Rust portability

`nightly-portability.yml` runs at 10:23 UTC daily on default `dev`, and accepts
manual dispatches. It also runs on PR changes to this workflow, its runner,
inventory, controls or this guide, so lane changes get hosted qualification.
It is separate from the required PR aggregate. Ordinary PR coverage, source
security, managed-image infrastructure and human review gates stay effective.
GitHub schedules require the workflow on the default branch; a PR run or a
fixture testing schedule syntax does not prove deployed scheduling.

The lane reuses the landed native PR setup: actual `macos-26` Darwin ARM64,
the supported Rust 1.98.0 and Node 24.22.1 profile, pinned cache/checkout
actions, no checkout credentials and a separate cache key. It runs `make setup` before verification. The candidate is
the immutable event SHA (PR test merge, scheduled default head or dispatched
ref resolved by GitHub); both checkout and runner verify it. No moving branch
is resolved between phases.

After setup on a native ARM Mac, run:

```sh
PORTABILITY_OUTPUT=/tmp/nac-portability-manual make test-nightly-portability
python3 .github/scripts/nightly-portability.test.py
```

Use a fresh evidence directory for each invocation. `CARGO` is supported by the
Makefile and runner. The command runs `cargo test --workspace --locked` with all
seven crates, all default library/binary/integration/doc tests and default
features. This is broader native coverage than the required process/credential
suites and twelve core terminal cases. It does not add an all-features or
OS/browser matrix. Default ignored cases remain ignored during that phase.

## Reviewed ignored inventory

The exact names, package, disposition, reason and required capabilities live in
[the inventory](../../.github/scripts/nightly-portability.json). All thirteen
ignored tests discovered by the native workspace harness must match that file;
new, renamed or removed entries fail before any selected execution. Review the
owning test and its nearest AGENTS guide before changing that inventory.

| Selection / owner | Cases | Capabilities and reason |
|---|---:|---|
| Included: core `tools::discovery::tests` local fake-SSH parity and no-external-search tests | 2 | Local executable shims, system OpenSSH `sftp-server`, no remote connection or credentials. Both mutate process PATH. |
| Included: server `tests::persistence_load` owned-store multi-thread and current-thread variants | 2 | Built `nac-web` worker, scripted local provider, SQLite and local processes. These exercise serving-store ownership and executor variants omitted by legacy managed-load. |
| Already covered: server `tests::managed_load::managed_load_scenario` | 1 | Required `test-workspace` invokes `make test-managed-load`; managed quality also runs it. Not duplicated as a nightly ignored selection. |
| Excluded: core `agent::live_tests` | 2 | Paid/live provider API key and network calls. |
| Excluded: process admission, core projection and Responses SSE latency benchmarks | 3 | Manual quiet-host timing qualification. |
| Excluded: terminal external OpenSSH | 1 | External host/key/port; distinct from included local fake-SSH discovery fixture. |
| Explicit coverage gap: discovery Podman parity and terminal Podman output | 2 | Running Podman machine and configured sandbox image are not provisioned on this native hosted runner. Not executed or passed; managed Docker smoke does not establish these backend contracts. |

Each included ignored case runs in its own harness process, with exact filter,
`--ignored --exact --test-threads=1`; commands run sequentially after the default
suite. The runner verifies the exact success line, rejecting zero-test or
still-ignored results. There is no blanket include-ignored invocation and no
retry. A missing SFTP server, worker, inventory or failed command fails the lane.

## Evidence, cancellation and qualification

The 14-day artifact name includes candidate SHA, run ID and attempt. It contains
`report.json`, `summary.md`, the hashed inventory, actual platform/architecture,
Rust/Cargo identities, cache-hit state, phase commands, exit codes, timings and
separate logs. Owned persistence JSON evidence is uploaded alongside it. Cache
hits are not called cold compiles. Compile and test times are separate; the
runner does not double the suite to manufacture warm evidence.

Only test execution uses a canonical invocation-specific temporary directory;
compiler caches remain outside it. SIGINT/SIGTERM and command timeouts terminate
the active owned process group, including descendants, then retain failure or
cancellation reports. Before removing the fixture directory, the runner records
remaining files, fails on process commands referencing that exact private path,
and attempts to kill those owned leaked PIDs. It removes owned temporary files
on success and failure. This is bounded invocation cleanup, not a system-wide
claim that every detached process identity is observable. Abrupt SIGKILL/host
loss may prevent final reports; missing evidence is not success. Hosted runner
teardown is the final isolation boundary.

Seven controls cover stale evidence rejection, inventory drift, exact-selection
failure, the full serialized command plan, allowlist scope, real Rust first-attempt failure and cancellation of an actual parent/child
process behind a readiness barrier. The Rust fixture lives in its own temporary
directory, mutates no repository source and never overlaps the workspace suite.
To demonstrate a failing full runner receipt manually:

```sh
python3 .github/scripts/nightly-portability.py \
  --expected-sha "$(git rev-parse HEAD)" --seed-failure \
  --output /tmp/nac-portability-intentional-failure
```

Expected exit: 1; `portability_seeded_failure` exits 101 exactly once and later
suites do not start. In hosted manual dispatch, `seed-failure=true` provides the
same intentionally red qualification; do not retry it into a pass. The control
suite separately verifies that expected failure and returns success.

## Triage and rollout acceptance

On failure, inspect the summary's exact command/log, candidate and run attempt;
assign to the subsystem owner in root AGENTS (core discovery, server persistence,
or the crate whose default test failed). Infrastructure/setup/capability or
inventory-drift failures belong to this CI lane. File/link the concrete failure
and artifact in ALL-457 or a focused follow-up. Diagnose before rerunning; retain
the first failure and never increase retries/timeouts or exclude a case merely
to obtain green. Cancel from Actions or SIGTERM locally; cancellation is not a
passing test result. No schedule silently changes another required PR status.

The job has a 60-minute bound, one native runner per invocation, one first test
pass and no retries. Report runner seconds and actual hosted job duration plus
GitHub billable usage when exposed; monetary cost depends on the account's
runner contract and is not inferred from a local runtime.

Before calling deployment acceptance complete, retain one actual manual native
run and one actual `schedule` event after normal human review/landing; verify
both exact candidate/artifact bindings, suite results, runtime and available
billing receipt. Verify a manual seeded red run and cancellation/cleanup logs.
PR/native local/control evidence is useful prelanding evidence, but cannot
certify the future deployed schedule. Missing permission to dispatch or read
billing is an explicit access gap with a maintainer follow-up. No merge or
production setting change is authorized by this guide.
