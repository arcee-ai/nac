# Same-run browser binary transport

The optional S09 candidate compiles one exact prepared browser executable and
transfers its bytes to four ordinary shards and the dedicated ALL471 proof job.
It carries no test result and supplies no permission to skip existing tests,
drift checks, proofs, native tooling, image checks or final aggregates. Measure
the full hosted path before retaining it: duplicated compilation decreases, but
a producer dependency and artifact transfer can add scheduling and wall time.

`.github/scripts/browser-binary.py` uses Python's standard library. The producer
packages a regular executable as `browser-binary.tar.gz`; the consumer streams
and verifies it without using filesystem archive-extraction APIs. Both commands
print structured JSON and can append their fields to `--github-output`.

## Producer

Use the same prepared candidate, pinned Rust installation and dev/test profile
settings as the current browser lanes. This example runs from the repository
root after checking out `CANDIDATE_SHA`. `ImageOS` and `ImageVersion` are the
hosted runner's image identity; every consumer must expect the same image.

```sh
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
export NAC_SOURCE_REVISION="$CANDIDATE_SHA"
export NAC_BUILD_TRACK=dev NAC_BUILD_ID="dev-$CANDIDATE_SHA"
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

- `artifact`: the same-attempt archive validated completely. `binary` is the
  absolute executable path; `binary_sha256` is its validated digest. Use that
  exact path for `NAC_E2E_BINARY` in all ordinary and proof selections.
- `source`: a completely valid producer artifact belongs to an earlier attempt
  of this same run/repository/candidate/profile/compiler/target. No old executable
  or hash is exposed. Restore the compatible compiler cache if desired, using
  the unchanged trusted write condition, then run the original locked source
  build with the explicit dev/debug-0/source/build-ID environment shown above.
  Use the newly built `$GITHUB_WORKSPACE/target/debug/nac-web` for the current
  attempt. Tests and proofs run again normally; no earlier quality verdict is
  reused. Recompute this binary's hash rather than using the old receipt's hash.
  The producer's recorded runner image may be older after an image rollout;
  its manifest still must match its authenticated receipt. Since these bytes
  are discarded, the fresh build uses the current runner instead.

An older attempt is a fallback reason only **after** archive existence, full
identity, digests, sizes, safe members, payloads, padding/trailer and gzip integrity
validate. Missing or corrupt old artifacts, malformed/foreign metadata and future
attempts fail. Do not use `continue-on-error`, broad error-to-source fallback,
an empty receipt, arbitrary artifact lookup or a previous green run. Rerun the
producer when an artifact has expired; an expired artifact is not silently valid.
A current-attempt runner-image mismatch also fails rather than executing a
foreign binary. The older-attempt source path never executes transported bytes.

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
the same authenticated producer bytes, and all five test jobs remain required.

## Checks and measurement boundary

```sh
python3 .github/scripts/browser-binary.test.py
```

The real CLI controls exercise valid current transport and older-attempt source
selection, malformed/foreign/future receipts, archive/payload corruption in both
attempt modes, safe member and size rules, input/output symlinks and FIFOs,
multi-chunk streams, preserved existing output and actual binary/proof binding.

Workflow controls must separately require the producer and every browser result,
correct artifact ID and anchored receipt inputs, both conditional source-build
and artifact execution paths, explicit source/build/profile environment and the
unchanged cache write boundaries. Never describe helper success as CI acceptance.
Hosted build/setup/artifact/queue/aggregation timing and cold/partial-retry runs
remain required measurements; the earlier local Darwin transfer probe does not
qualify Linux artifact transfer or the full pipeline's latency.
