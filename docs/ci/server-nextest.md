# Linux server test execution

The Linux `test-server` job uses checksum-pinned cargo-nextest0.9.151 to run
individual tests in separate processes. This S12 candidate changes only that
job's runner command and resource scheduling. The stable identity step, specialized native/mutation
libtest consumers, other jobs, receipts and S17 compiler-cache trust stay intact.

`.github/scripts/server-tests.py` performs these fresh obligations:

1. `cargo test --locked -p nac-server --no-run` builds the whole package,
   including default example compilation such as `export-openapi`.
2. Full-package nextest runs every runnable target with4processes, zero retries,
   no fail-fast, and the original ignored selection. There is no target/name
   filter or skip list.
3. `cargo test --locked -p nac-server --doc --no-fail-fast` runs separately,
   including after a native-test failure. Either failure keeps the job failed.

The script requires the existing debug0/incremental0 environment. It does not
change compiler-cache keys, environment hashing or workspace pruning. The pinned
Rust-cache action already exports incremental0 before its key is constructed.

## Tool and private state

`nextest_tool.py` downloads the official LinuxGNU0.9.151 release archive into a
new owned leaf. Its fixed archive size and SHA256 must match before extraction
or execution. It accepts exactly one bounded, regular `cargo-nextest` member;
paths, duplicates, symlinks and hardlinks fail. Version, release commit and GNU
target must match before the verified executable receives its final name. An
existing destination is never reused/deleted. Failure removes only the new leaf;
there is no checksum override, global installation or installer shell.

The official release archive SHA256 is
`1d4ce302b820c41f4b89c5fb9bce45f0f0c94882c1cf08fc360caf08be6e7df4`.
The [official release](https://github.com/nextest-rs/nextest/releases/tag/cargo-nextest-0.9.151)
checksum asset and GitHub asset digest agree.

A fresh0700 `RUNNER_TEMP` directory owns the tool, derived config, native store
and JUnit. The parent must be outside the workspace, Cargo target and CARGO_HOME.
The committed CI-only profile is validated exactly before a private `[store]`
override is added. Nextest writes JUnit beneath that store, never to compiler
caches. User config and inherited NEXTEST policy variables are excluded. Normal
success/failure and handled interruption clean the private directory. Failures
remain in the job log; no quality result or history is imported from a cache.
On controller cancellation, only its created command group receives TERM. After
15seconds it escalates to KILL, with a further bounded5seconds to reap. This
shutdown bound applies only after interruption and adds no test deadline.

The committed profile uses native
`leak-timeout = { period = "200ms", result = "fail" }`. The period matches the
pinned embedded default; only its verdict changes. No terminating test deadline
is added. Detected leaks fail even when the test itself exits0. Nextest cannot
detect all redirected-output descendants; existing cleanup assertions remain
mandatory. See the [official leak policy](https://nexte.st/docs/features/leaky-tests/).

## Fixed managed-control listener

Three managed-control tests start the production listener at `127.0.0.1:3211`:
`failed_listener_bind_keeps_accepted_candidate_in_maintenance`,
`every_replacement_readiness_failure_keeps_maintenance_and_diagnostics`, and
`fully_ready_replacement_accepts_only_after_both_listeners_bind`.
Their existing fixture holds a process-local mutex, which does not coordinate
separate nextest processes. The first source run of #615 retained an actual
address-in-use failure, with overlapping reported intervals for the failing
readiness test and successful listener test. The socket-owning PID was not traced.

The exact three full names belong to `managed-control-port3211`, with
`max-threads = 1`. Other tests retain the global four slots. This is a resource
assignment, never a selection filter: every test still runs. The private config
validator admits only this exact group and anchored membership override; generic
overrides, altered membership/concurrency and retry/leak/deadline changes fail.
Source-backed controls check the listener owners and distinguish recovery-only
and explicitly reserved ephemeral-listener neighbors. Production Rust, port,
assertions, real clock and deadlines stay unchanged. Port zero would violate the
managed configuration contract; reserve/drop/rebind would introduce a race.

The [failure and scheduler proof](evidence/all-582/server-listener-resource.json)
preserves the original result: 411 passed, one failed, three ignored, 93.328s;
doctests still ran. A tiny dependency-free Mac fixture with the same three names
passed all six tests under the actual pinned group. Ungrouped and max-two
test-only negatives each failed two tests with listener collisions. Three
unrelated tests overlapped the resource owner, proving four active tests remain
possible. This proves scheduler semantics, not actual NAC/GNU requalification.
It is an S12 repair and earns no additional strategy credit.

The native proof is explicit and never replaces NAC tests:

```sh
python3 .github/scripts/server-tests.test.py --listener-resource-control \
  /path/to/verified/pinned-Mac/cargo-nextest /new/owned/evidence-directory
```

## Evidence and limits

The [portable S12 record](evidence/all-582/server-nextest-strategy.json) retains
source/tool/binary identities, complete413-name Mac inventory, exact outcomes,
raw timing methodology and local-only raw locators. At sourcec34f07c56, one
ordered library comparison used the same binary: libtest4threads177.54s versus
nextest4processes87.47s,50.7% shorter. CPU increased43.77→49.70s,13.5%. Warm
caches/order and real jittered compaction backoff limit attribution; Darwin RSS
is not aggregate parallel memory. There is no whole-CI latency or compute-saving
claim, hosted compression claim, or additional strategy count.

Additional full-package strict-leak validation matched Cargo's native inventory
and executable hashes:410passed, the same3ignored, zero retries/leaks. Separate
actual doctests passed with0tests at that source. Whole-package compilation also
built the example. This is coverage evidence, not a second benchmark. Linux
current-candidate execution/version checks and whole-path results remain pending.

Focused controls run through `node --test .github/scripts/pr-server-nextest.test.mjs`
(and therefore the existing release test glob). Installer CLI corruption fails
before execution; stdlib controls cover archive shape, missing/poisoned inputs,
private-state cleanup, policy drift, full selection and failure propagation.
Parsed workflow controls reverse only S12's server input to recover the exact
ad3400565aad89834742893ad36183254b5098af workflow fingerprint, keeping all three
provenance fields and S17 single-writer policy. Other normalized workflow hashes
remain unchanged.

A real Rust control using the actual committed CI profile can be run explicitly:

```sh
CARGO=/path/to/pinned1.98/cargo python3 .github/scripts/server-tests.test.py \
  --native-tool /path/to/verified/cargo-nextest /new/owned/evidence-directory
```

It executes one ordinary pass, one assertion failure and one successful test
with an owned output-holding child. Expected outcomes are PASS/FAIL/LEAK-FAIL,
exit100, no retries, and private-store cleanup. JUnit leaked-success is an
`error`, not a `failure`; consumers must reject both. The control validates and
cleans only its own recorded child/group. Its crate never enters NAC's inventory.
