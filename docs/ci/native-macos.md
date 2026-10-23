# Native macOS process and credential PR coverage

`stable-release.yml` calls `macos-native.yml` at its exact prepared candidate on
all PRs and normal release/dev CI events. `macos-native` is a direct required
aggregate dependency; failure, cancellation, missing or skipped work fails closed.
The runner must actually be Darwin ARM64 (`macos-26`), independently of the
existing ARM release build. Linux workspace/core, browser, generated API/assets,
source-security and managed coverage remain required.

Run the same focused portable coverage locally after `make setup`:

```sh
python3 .github/scripts/native-regressions.py --output /tmp/nac-native-evidence
```

On an otherwise idle native ARM Mac, also qualify the Darwin behavior control:

```sh
python3 .github/scripts/native-regressions.py --require-macos-arm --seed-macos --output /tmp/nac-native-evidence
```

The lane runs all default `nac-process` and `nac-credential-store` tests and the
12 exact `nac-core` harness names maintained in `native-regressions.py`. A removed
or renamed selection fails before execution. Core coverage includes ordinary and
disowned separate process groups after natural exit, explicit close and manager
drop, immediate exit/output settlement, cleanup failure with retained leases,
output-drain settlement, concurrent admission, one-shot background descendants
and inherited pipes, cancellation side effects and both PTY cleanup regressions.
The process suite exercises real macOS unique identities, audit-token signaling,
exec-version refresh, process census and descendant cancellation. Credential tests
exercise no-follow reads/writes/locks, private mode 0600, denied broader access,
atomic replacement, failure cleanup and contention. The existing ignored manual
quiet-host admission benchmark remains ignored; no provider, SSH credential,
container or browser tests are added to this lane. UID-transition runtime
qualification is outside these same-UID/fault suites.

Each invocation uses a dedicated canonical temporary directory (resolving macOS
`/var` aliases). Before removing it, the runner rejects leftover files and process
commands referencing it; native PTY fixtures additionally assert captured exact
identities are dead. These checks concern owned fixtures, not a system-wide claim
about unrelated processes. No credential values or complete host process list
are retained.

Evidence artifacts contain candidate identity, actual OS/architecture, runner
image, `rustc -Vv`, Cargo version, cache-hit state, compile times, and separate
first/warm test timings and logs. The fixed second pass measures warm behavior;
a failed first pass stops immediately. A cache miss is cold compilation evidence;
a cache hit must not be described as cold. This avoids doubling a full macOS
web/browser matrix. Hosted cold and warm receipts are linked from the PR/ticket.

The optional safe Darwin control temporarily changes only status classification
in this worktree: statuses 1–4 incorrectly become dead. Its exact existing
macOS-only test must fail with the classification assertion. The source is
restored in `finally`, byte-verified, and the same test must then pass. It does
not spawn or signal a process and adds no production fault hook. Do not run that
option concurrently with other Cargo commands in the same worktree. The workflow
retains its expected failing log separately from normal successful suites.

Adding this required lane does not activate repository rulesets or supply human
approval. The designated reviewer and deliberate human override policy in
[required-pr-checks.md](required-pr-checks.md) is unchanged.
