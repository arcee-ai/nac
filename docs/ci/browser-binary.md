# Same-run browser binary transport

The S09 candidate compiles one exact prepared browser executable and transfers
its bytes to eight ordinary shards and the dedicated ALL471 proof job.
It carries no test result and supplies no permission to skip existing tests,
drift checks, proofs, native tooling, image checks or final aggregates. Measure
the full hosted path before retaining it: duplicated compilation decreases, but
a producer dependency and artifact transfer can add scheduling and wall time.

`.github/scripts/browser-binary.py` uses Python's standard library. The producer
packages a regular executable as `browser-binary.tar.gz`; the consumer streams
and verifies it without using filesystem archive-extraction APIs. Normal
consumers retain the pinned Rust runtime and explicit
`CARGO_INCREMENTAL=0`; only source-fallback consumers restore compiler caches.
Both commands print structured JSON and can append their fields to `--github-output`.

## Producer

Use the same prepared candidate, pinned Rust installation and dev/test profile
settings as the current browser lanes. This example runs from the repository
root after checking out `CANDIDATE_SHA`. `ImageOS` and `ImageVersion` are the
hosted runner's actual image identity. Every consumer supplies its own current
identity; a different image selects a fresh source build after full validation.

```sh
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0
export NAC_SOURCE_REVISION="$CANDIDATE_SHA"
export NAC_BUILD_TRACK=dev NAC_BUILD_ID="dev-$CANDIDATE_SHA"
: "${ImageOS:?missing runner OS}" "${ImageVersion:?missing runner image version}"
test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"
cargo build --locked -p nac-server --bin nac-web

python3 .github/scripts/browser-binary.py pack \
  --binary "$GITHUB_WORKSPACE/target/debug/nac-web" \
  --output-dir "$GITHUB_WORKSPACE/browser-binary-upload" \
  --source "$CANDIDATE_SHA" --repository "$GITHUB_REPOSITORY" \
  --run-id "$GITHUB_RUN_ID" --attempt "$GITHUB_RUN_ATTEMPT" \
  --target x86_64-unknown-linux-gnu --rustc "$(rustc --version)" \
  --runner-image "$ImageOS@$ImageVersion" --github-output "$GITHUB_OUTPUT"
```

The `pack` step outputs `receipt`, `archive` and `binary_sha256`. Bind the
producer job's `receipt` output to this step's actual `receipt`; never recover
the expected receipt or digests from downloaded artifact bytes. The receipt
contains the exact repository, source, workflow run/attempt, target, compiler,
runner image, fixed dev/debug-0/build identity and archive/manifest/binary
digests and sizes. It is bounded to small JSON suitable for job outputs.

Upload only the `archive` output with the existing pinned upload action, with
`compression-level: 0` because it is already gzip-compressed. Include source,
run and producer attempt in the artifact name. Export the upload action's actual
`artifact-id` as a producer job output. Retain the existing trusted-push-only
Cargo cache write condition; artifacts do not become compilation caches.

## Consumer and partial retries

Every consumer keeps the current pinned Rust installation and all other E2E
runtime tools. Download the producer's artifact ID from the current workflow run
using the existing pinned action, without a cross-run token or repository/run
override. The pinned download action supports `artifact-ids`; selecting one ID
avoids a broad name/pattern search. Set its destination to a fresh job-owned
directory and `merge-multiple: true` so the fixed tar is directly inside it.

Set `BROWSER_BINARY_RECEIPT` from the authenticated producer `needs` output,
then run the helper with expected identity from the current caller/preparation:

```sh
python3 .github/scripts/browser-binary.py consume \
  --archive "$GITHUB_WORKSPACE/browser-binary-download/browser-binary.tar.gz" \
  --output-dir "$GITHUB_WORKSPACE/browser-binary-runtime" \
  --receipt-env BROWSER_BINARY_RECEIPT \
  --source "$CANDIDATE_SHA" --repository "$GITHUB_REPOSITORY" \
  --run-id "$GITHUB_RUN_ID" --attempt "$GITHUB_RUN_ATTEMPT" \
  --target x86_64-unknown-linux-gnu --rustc "$(rustc --version)" \
  --runner-image "$ImageOS@$ImageVersion" --github-output "$GITHUB_OUTPUT"
```

The command returns one of two successful modes:

- `artifact`: the same-attempt, same-image archive validated completely. `binary` is the
  absolute executable path; `binary_sha256` is its validated digest. Use that
  exact path for `NAC_E2E_BINARY` in all ordinary and proof selections.
  `fallback_reason` is empty.
- `source`: a completely valid producer artifact belongs to an earlier attempt,
  or its runner image differs from the current consumer within this same attempt.
  Run/repository/candidate/profile/compiler/target still match. No transported executable
  or hash is exposed. Restore the compatible compiler cache if desired, using
  the unchanged trusted write condition, then run the original locked source
  build with the explicit dev/debug-0/source/build-ID environment shown above.
  Use the newly built `$GITHUB_WORKSPACE/target/debug/nac-web` for the current
  attempt. Tests and proofs run again normally; no earlier quality verdict is
  reused. Recompute this binary's hash rather than using the old receipt's hash.
  `fallback_reason` is the bounded value `older-attempt` or
  `runner-image-change` in JSON and GitHub outputs for timing disclosure. If both
  differ, `older-attempt` takes precedence. The producer's image can differ
  during a hosted rollout even within the same workflow attempt;
  its manifest still must match its authenticated receipt. Since these bytes
  are discarded, the fresh build uses the current runner instead.

Both modes emit bounded `producer_runner_image` and `consumer_runner_image`
fields from the validated receipt and current caller identity. Retain these
actual `ImageOS@ImageVersion` values alongside the fallback reason; setup's
Runner Image metadata need not equal the shell environment's version string.
The pre-download consumer guard also prints only these two public runner values
after its nonempty checks, so even a later admission failure retains them.

An older attempt or different valid image is a fallback reason only **after** archive existence, full
identity, digests, sizes, safe members, payloads, padding/trailer and gzip integrity
validate. Missing or corrupt artifacts, malformed/foreign metadata and future
attempts fail. Do not use `continue-on-error`, broad error-to-source fallback,
an empty receipt, arbitrary artifact lookup or a previous green run. Rerun the
producer when an artifact has expired; an expired artifact is not silently valid.
The source path never exposes or executes transported bytes. A different image
does not waive any other identity or integrity requirement, and malformed image
identities still fail. Only a same-image current artifact can become executable.

The proof upload name includes the current source, workflow run and consumer
attempt as described in [the sharding contract](browser-sharding.md). A retained
attempt-one producer may select fresh source compilation for a proof rerun on
attempt two; that attempt uploads its own distinct proof artifact without
overwriting or deleting attempt one's evidence. Pinned upload v4
[fails on an existing name unless overwrite is enabled](https://github.com/actions/upload-artifact/blob/ea165f8d65b6e75b540449e92b4886f43607fa02/README.md#usage).
Workflows in already-created runs retain their original source-only naming;
qualify the new workflow source before a controlled proof rerun. Repository
search found no consumer downloading these proof artifacts by name. Consumers
outside the repository are unknown and must select the explicit run/attempt
name; no external compatibility is asserted. Historical receipts keep their
original names.

The output directory must be new. Existing directories, symlinked leaves or an
immediate symlinked parent are rejected and preserved. Archive inputs must be
regular non-symlink files. Only `manifest.json` followed by `nac-web` is admitted;
links, special files, extension headers, duplicate/extra/reordered members,
traversal paths and privileged modes fail. Binary reads are streamed and bounded
to 512MiB; receipt/manifest JSON is bounded to 4KiB. An executable is exposed only
after full validation succeeds. The helper never executes transported bytes.

## Bind mandatory actual goal proof to the chosen binary

Run the unchanged ALL471 journeys using the chosen `NAC_E2E_BINARY`, then run
the existing full proof collector. After that collector succeeds and before
uploading its bounded receipts, add this extra binding check:

```sh
python3 .github/scripts/browser-proof.py \
  --root "$NAC_E2E_ARTIFACTS" --source "$CANDIDATE_SHA"
python3 .github/scripts/browser-binary.py verify-proof \
  --binary "$NAC_E2E_BINARY" --source "$CANDIDATE_SHA" \
  --proof-dir "$NAC_E2E_ARTIFACTS/all471-goal-proof-artifact"
```

`verify-proof` computes the actual selected executable's hash and requires G1's
initial/restarted identities and G2's identity to name that same absolute path,
full source and hash. This works for both verified artifact and fresh-source
fallback modes. It supplements the full original collector; it cannot substitute
for its goal/accounting/native-call/cleanup validation. Ordinary shards consume
the same authenticated producer bytes, and all nine consumer test instances
remain required.

## Implemented workflow and measurement boundary

`browser-binary` is required by both browser consumers, the browser join and the
explicit final required-job contract. Consumers select the producer's actual
artifact ID, validate its anchored receipt and full bytes, then run the unchanged
selections. They also await the independently required native-package producer;
its separate archive authority never admits an executable. A matching current artifact avoids compilation/cache duplication;
a fully validated older attempt or different runner image runs the original
locked source build. Parsed workflow negative controls
cover these edges, exact identity/profile inputs, trusted cache writes and proof
binding. The native eight-shard inventory is a refinement of S02, not another
strategy: all eight ordinary selections are nonempty and their union with the
two dedicated proofs exactly covers the same 205 tests. No browser assertion,
worker setting, retry or clock changed.

Run focused controls:

```sh
python3 .github/scripts/browser-binary.test.py
node --test .github/scripts/pr-browser-binary.test.mjs .github/scripts/pr-browser-sharding.test.mjs
```

The real CLI controls exercise valid current transport and source selection for
older attempts and same-attempt image changes. Negative admission controls are
also exercised with a valid different consumer image: malformed,
foreign and future receipts, archive/payload corruption, safe member and size
rules, input/output symlinks and FIFOs,
multi-chunk streams, preserved existing output and actual binary/proof binding.

Workflow controls must separately require the producer and every browser result,
correct artifact ID and anchored receipt inputs, both conditional source-build
and artifact execution paths, explicit source/build/profile environment and the
unchanged cache write boundaries. Never describe helper success as CI acceptance.
Hosted build/setup/artifact/queue/aggregation timing and cold/partial-retry runs
remain required measurements; the earlier local Darwin transfer probe does not
qualify Linux artifact transfer or the full pipeline's latency.

The first hosted S09 run [41954973930](https://github.com/arcee-ai/nac/actions/runs/41954973930)
failed closed on an actual same-attempt hosted-image rollout. Its producer built
successfully; consumers on a different image rejected the receipt before tests
could run. [The retained failure receipt](evidence/all-582/browser-binary-image-rollout.json)
records exact prepared source, producer/consumer images and per-job outcomes.
This repair validates and discards those bytes before choosing the existing
source-build path. The failed run remains failed, and a full successful hosted
transport/fallback pipeline remains unqualified. This is an S09 refinement,
not a separate optimization strategy or a latency-success claim.
