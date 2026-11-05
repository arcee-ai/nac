# Linux server test execution

The Linux `test-server` job uses checksum-pinned cargo-nextest0.9.151 to run
individual tests in separate processes. This S12 candidate changes only that
job's runner command. The stable identity step, specialized native/mutation
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

The committed profile uses native
`leak-timeout = { period = "200ms", result = "fail" }`. The period matches the
pinned embedded default; only its verdict changes. No terminating test deadline
is added. Detected leaks fail even when the test itself exits0. Nextest cannot
detect all redirected-output descendants; existing cleanup assertions remain
mandatory. See the [official leak policy](https://nexte.st/docs/features/leaky-tests/).

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
