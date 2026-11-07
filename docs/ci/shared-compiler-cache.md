# S17 shared compiler dependency cache

The actual local comparison rejects one broad debug-0 cache for server,
browser and the initial four-crate workspace reader. It supports a narrower
server/browser candidate for Linux validation. This is compile-cache evidence,
not passing test coverage, a hosted cache rollout or whole-pipeline acceptance.
The candidate changes only four shared-key inputs and three reader save inputs
in the existing workflow; it adds no jobs, cache adapter or compilation shortcut.

The [portable receipt](evidence/all-582/shared-cache-strategy.json) records exact
commands, source, toolchain, environment, resources, artifact feature/profile
counts, timings, hashes and limitations. Its raw-file locators are local-only
supporting evidence, never portable build inputs.

## Actual comparison

Source: `41c9575a698dbf8ea746c2ba2c04f1bdb230900e`. Local macOS 27.0.1 ARM,
18 logical CPUs, 36 GiB RAM, Rust 1.98.0, six build jobs, incremental disabled,
dev/test debug information zero. Debug assertions and overflow checks remained
enabled in every reported artifact. The registry was warm and Cargo offline;
each initial target was empty. No provider credentials or `HOME` entered the
explicit child environment allowlist. No tests or provider calls ran.

| Compile arm | Wall seconds | CPU user + system seconds | Compiled / Fresh artifact events |
|---|---:|---:|---:|
| Server writer, target cold | 68.071 | 199.28 | 376 / 0 |
| Browser reader, target cold | 57.056 | 162.72 | 370 / 0 |
| Browser, its own pruned snapshot | 30.580 | 51.00 | 9 / 361 |
| Browser, server writer snapshot | 30.486 | 50.65 | 9 / 361 |
| Four-crate reader, target cold | 18.002 | 53.98 | 150 / 0 |
| Four-crate reader, its own pruned snapshot | 1.836 | 5.02 | 9 / 141 |
| Four-crate reader, server writer snapshot | 15.856 | 45.45 | 82 / 68 |

The writer ran `cargo test --locked -p nac-server --no-run`. The browser reader
ran `cargo build --locked -p nac-server --bin nac-web`. The other reader ran
`cargo test --locked -p nac-contracts -p nac-credential-store -p nac-managed -p nac-process --no-run`.
Each command also used `--message-format=json` for actual artifact receipts.
`--no-run` compiles test harnesses; it supplies no test verdict or doctest pass.

All arms used the **same absolute active target path**, sequentially. Each
reader first built cold, then restored its own snapshot, then the unchanged
writer snapshot. Cargo's actual
`cargo clean --locked --workspace --target-dir ACTIVE` removed workspace
outputs before snapshots. APFS copies had distinct inodes, preserved mtimes,
and passed content/immutability checks. No mutable hardlinks, source artifacts
or quality receipts were shared. Warm ordering and OS page-cache effects remain
disclosed; the 0.093-second browser difference is not a meaningful speedup claim.

Browser restores took 0.403 seconds for its own snapshot and 0.448 seconds for
the writer snapshot. Both rebuilt only nine workspace artifacts and reused
every external artifact. All three actual browser binaries had the same SHA-256
`5e77612c8455c3095795714a1282e221ec4c3c61cacef7b9b6a08e4cf445215e`.
Their actual `--version` and offline Guide output retained the full candidate
and `dev-<candidate>` build identity; those checks were outside build timings.

The four-crate shared arm rebuilt **73 additional external artifact events**,
adding 14.020 seconds and 40.43 CPU seconds. Twenty-five directly differed in
reported features/profile, including `libc`, `serde`, `futures-util` and `uuid`.
The other 48 had matching self-reported features/profile but a different
dependency/fingerprint context. The receipt retains all 73 records. A broader
feature closure is not a cache superset of narrower feature variants.

## Payload and pruning limits

The pruned writer and browser snapshots were each 887,496,276 raw bytes.
Their 3,304-file inventories matched at 3,301 paths and 99.96885% of bytes.
The differences were Rust metadata, one dep-info file and an `aws-lc-sys`
build-output log; the snapshots are not byte-identical. The four-crate snapshot
was 289,577,247 bytes, with only 61,841,829 matching writer bytes.

Replacing two such server/browser target snapshots with one models a 50% raw
target-byte reduction. Replacing all three models 57%, but the four-crate
recompile and 3.06-times larger restore payload reject that broad group.
These are **uncompressed target-only models**, not measured GitHub compressed
occupancy, transfer, eviction, cost or pipeline savings.

Cargo clean is a pruning model, not the exact pinned cache action. The action
uses an external-package allowlist from all-features metadata, removes root
Rust metadata and non-cache profile files, and also handles registry/Git/bin
paths. This trial retained one unchanged registry and compared target copies
only. APFS cloning is not Actions archive extraction or network transfer.
All newly owned target/snapshot copies were removed after receipts. Observed
phase-boundary added bytes peaked at 3.59 GB, with at least 40.51 GB host free;
the old owned target and other owners' evidence were not cleaned.

## Narrow adaptation boundary

Only `test-server` may write the shared server/browser namespace. Its
existing main/dev **push-only** `save-if` stays exact; browser-binary and the
proof/shard source-fallback caches use the quoted string `save-if: "false"`.
Keep four-crate/core/lint/frontend/managed/release/native/container namespaces
independent. Keep the original parallel graph, defaults, features, profiles,
runtime installation, mandatory compilation/tests/proofs and fallback rules.

The pinned action's [`shared-key` replaces both manual `key` and job suffix](https://github.com/Swatinem/rust-cache/blob/c19371144df3bb44fab255c43d04cbc2ab54d1c4/src/config.ts).
The candidate uses `server-browser-linux-gnu-debug0-v1` for this family only and retains the
original cold-control `prefix-key` nonce and default OS/architecture, Rust,
environment and manifest hashes. Do not normalize unrelated environments to
force hits. Its [restore path exports `CARGO_INCREMENTAL=0` before deriving keys](https://github.com/Swatinem/rust-cache/blob/c19371144df3bb44fab255c43d04cbc2ab54d1c4/src/restore.ts),
so the server's implicit value already matches browser jobs' explicit zero.

Retained Linux run `41958708860`, attempt one, printed matching
`a7860c54-055f132a` environment/manifest suffixes for server job `127019824981`,
producer `127019824900`, proof `127020977270` and shard job `127020977325`.
This confirms key compatibility without weakening hashes; it does not establish
Linux shared-snapshot coverage or a cache hit.

There are four logical role keys, not nine matrix-specific caches. Same-image
artifact consumers skip the compiler cache, so ordinary runs commonly use only
the server and producer entries; proof/shard entries matter during source
fallback. At most three role keys per matching tuple would be eliminated.

The read-only cache inventory had 63 entries occupying 10,717,790,847 reported
stored bytes. Historical server/browser entries totaled 1,251,997,183 bytes,
but used the older `8c9843e5` environment. No participating `a7860c54` entry
existed. New-profile compressed capacity savings therefore remain unknown.
The separate storage-limit endpoint still reports `max_cache_size_gb: 10`.
Its [API documentation](https://docs.github.com/en/rest/actions/cache#set-github-actions-cache-storage-limit-for-a-repository)
describes gigabytes; exact byte headroom is not inferred from that value.
The retained historical adaptation record's conditional 10-GiB calculation
is not measured headroom. A new namespace can overlap old entries and cause
eviction before reducing occupancy.
Do not delete old caches or raise limits to manufacture a result.

New-namespace PRs start cold until an ordinary successful trusted landing seeds
it. Parallel readers do not wait for writer publication. Exact entries remain
frozen: readers cannot merge missing variants, and an exact-hit writer does not
refresh them. Preserve failure-cache defaults and the trusted writer guard.
Runner rollouts may split installed-toolchain/environment hashes and cause
cold bursts; S09's executable identity and image fallback remain separate.

A narrow Linux candidate is implemented for review and hosted measurement.
Initial cold, seeded restore, actual compressed bytes, eviction and whole-path
results still need measurement. No additional strategy, hosted result or
ALL-582 qualification credit is manufactured by this refinement.

Parsed controls require exactly these four roles, one unchanged trusted writer,
read-only consumers, unchanged default commands/profiles and fallback guards.
They reject broadened roles/writes, disabled hashing, workspace-output caching,
failure caching, altered flags and cold-prefix drift. The cold-control test
evaluates read-only save inputs across actual event/ref cases. Its stable
workflow fingerprint is intentionally updated; reversing only these S17 cache
inputs must reproduce the old fingerprint, and the other four workflows retain
their original fingerprints.
