# Managed image security

The image gate inventories the same immutable loaded linux/amd64 image used by
managed smoke tests. It never builds, pulls a floating image tag, or publishes.
Resolve the loaded image once with `docker image inspect --format '{{.Id}}'`;
pass that ID to smoke (`MANAGED_IMAGE_SKIP_BUILD=1`) and the security command.

```sh
python3 scripts/security/image_scan.py \
  --image sha256:<loaded-image-id> --source-revision <candidate-commit> \
  --trusted-policy <trusted-base-policy.json> \
  --candidate-policy <candidate-policy.json> --output <new-evidence-directory>
```

The policy path must come from a separately obtained trusted base checkout, not
from candidate code. The source-security layer owns the shared reviewed,
expiring exception contract and landing/rerun procedure. Image scanning consumes
that validator directly. An ordinary candidate policy change fails; an empty policy grants
no exceptions. An exception's exact context is `managed-image`. Package identities
are Grype's `<artifact.type>:<artifact.name>` (such as `deb:openssl` or
`binary:node`), or `Go:stdlib`, `Go:toolchain`, `Go:github.com/cli/cli/v2`,
`Go:github.com/git-lfs/git-lfs/v3`, or `PyPI:uv` for explicit version queries. Source
lockfile exceptions cannot suppress image findings. Every exception still needs
its advisory, package, context, reason, owner, linked issue, and UTC expiry.

Eligible stable-tag publication uses the source-owned canonical reviewed-dev
resolver and its pinned receipt. The full candidate and trusted checkouts retain
all three lockfiles for the generic validator. The image adapter verifies the
receipt against the scanned image's source revision, event/tag, repository, run,
independent policy pin, ancestry and tracked policy bytes before using grants.
Only that validated mode uses the effective reviewed policy instead of historical
tag grants: revoked grants stop applying and later reviewed recovery grants can
apply without rebuilding or changing the immutable candidate. Ordinary PR policy
equality remains strict. Standalone manual checks and main pushes select canonical
dev rather than trusting the selected branch's policy. Missing, malformed,
expired, spoofed or unavailable publication policy fails closed, with no fallback
to tag policy.
The receipt and effective policy digest are retained with security evidence.

The workflow passes `--publication-policy <receipt.json>` to the same full scan;
this is not an option to choose a policy revision or skip scanning. The local
prepublication helper forwards it only to that scanner, whose eligible-event
validation still applies. It does not implement the private beta publisher's
separate adoption and identity contract described below.

High/Critical findings block even without a fix. Lower severities remain in the
report. Unknown severity blocks conservatively because it cannot be established
below High. Tool, network, DB, input, configuration, and inventory errors return
failure separately from vulnerability blocking. No `only-fixed`, blanket runtime
exception, or blanket OS exception is used.

## Inventory and advisory coverage

Syft inventories the full image, including Debian's dpkg database. The actual
`/etc/os-release` probe must identify Debian 13/trixie (or Debian 12/bookworm
for retained historical inventories), the Syft release and codename must
match it, and Grype must report the same recognized Debian release. Unknown release
metadata fails even if Grype exits successfully with zero findings. Every package
reported by the image's dpkg probe must occur at the actual version in the SBOM.
The gate executes fixed absolute Node, Go, uv, gh, and Git LFS paths inside the exact image,
with no network, no capabilities, a read-only root, and a bounded process count.
Unknown/missing version output is an error. Node must appear in Syft at the
probed version with its Node.js CPE; Grype enables CPE matching.
gh and Git LFS must have their main Go modules inventoried at the installed
binary paths. Known SBOM versions must match the actual executable versions.
The actual application versions and Git LFS's full source revision must match
the checksum-verified release/source pins in the image's exact source revision.
Initial inventory reads that immutable commit's Dockerfile through Git, then
retains the pins in the hash-bound identity evidence. A later rescan uses those
retained pins, even when its checkout has newer tools or lacks the old commit;
it never substitutes today's Dockerfile. Missing source pins or altered bundle
bytes fail closed.

Go 1.27 omits linker settings from this trimmed build's metadata, so the source revision
comes from the executable's existing version command, not inferred SBOM fields.
Git LFS is rebuilt with a dependency overlay, so its Go main-module version
can be `UNKNOWN`/`(devel)` even though `git-lfs version` identifies the release.
The raw SBOM is retained unchanged. Mandatory OSV queries for both applications
use their probed release versions; query failures cannot become clean results.
This preserves application advisory coverage without guessing a version from
arbitrary binary strings or relying on Grype to match an unknown main module.

Syft's [binary catalog](https://oss.anchore.com/docs/capabilities/binary/) documents
Node detection, but does not document uv detection. The gate therefore queries
OSV explicitly for `Go:stdlib`, `Go:toolchain`, both Go application module paths,
and `PyPI:uv` at their probed versions, retaining
both request and response. Upstream documents [PyPI distribution of uv](https://docs.astral.sh/uv/getting-started/installation/#pypi).
This maps the upstream uv release version to the PyPI
release of the same application; it is bounded application-advisory coverage,
not a claim that every statically linked uv dependency has been inventoried.
Go's bundled stdlib and compiler/toolchain advisories are both checked at the
probed Go version, even when Syft does not detect the installed compiler. Full image package matching remains active alongside these checks.
OSV may have no severity for Go advisories; those matches block as Unknown.
Neither tool can establish absence of undisclosed vulnerabilities.
Live qualification includes Git LFS 3.6.0/3.8.0 and gh 2.0.0/2.103.0 queries
against known [GO-2025-3390](https://pkg.go.dev/vuln/GO-2025-3390) and
[GO-2024-3269](https://pkg.go.dev/vuln/GO-2024-3269) vulnerable/fixed boundaries,
alongside the runtime controls.

`image-tools.json` pins Syft/Grype versions and release archive SHA-256 values.
The installer verifies archive bytes on every use and extracts only the named
executable. It records executable digests. No installation script is fetched or
executed. Supported scanner hosts are Linux amd64 CI and macOS arm64 local QA;
the managed image remains linux/amd64.

Grype DB update must succeed for each scan. Its own age/hash validation remains
enabled; the gate independently measures DB build age before and after scanning
and requires 0..24 hours. It hashes the actual DB file and rejects concurrent DB
replacement. Retained metadata records the upstream DB build time, schema,
measured age, source, and local digest. Download time is not DB freshness.

## Evidence and rescanning

The workflow first runs `--inventory-only` on the tested immutable image. This
validates the actual runtime probes and one Syft inventory, writes the hashed
bundle, and records `status: inventoried` with `security_verdict: false`. A
separate required security step consumes that bundle with the full fresh scan;
inventory success cannot satisfy the aggregate gate or publication receipt.
Legacy bundles without gh/Git LFS probes or retained source pins remain errors.
Requalification requires fresh inventory of the exact loaded supported image
and its immutable source commit; neither current Dockerfile pins nor edited
bundle metadata can upgrade legacy evidence. If that image/source is unavailable,
the rescan remains an error until supported inventory is available. This legacy
boundary is separate from rescanning a complete retained bundle after the
checkout's tool pins advance, which does not require the old source object.

The per-SHA artifact retains `inventory/` independently of `security/`, so a later
scanner installation, DB, or advisory failure cannot discard the validated raw
inputs. Keep all raw findings (including lower severities), policy dispositions,
runtime versions/advisories, image inspection/identity, tool/DB metadata, and
result together. `bundle.json` hashes the unchanged SBOM/runtime/identity/coverage
inputs for later rescans. Artifact upload always runs, with 14-day retention.

Daily selection uses only trusted `dev` push runs from
`.github/workflows/stable-release.yml` and the exact completed
`managed / build-smoke` job's successful `Inventory the exact tested image`
step. The security verdict and unrelated workflow results can be red. Select the
newest qualifying inventory, then require its unique expected per-SHA artifact,
`inventory/` layout, source identity, and input hashes. Missing, expired,
unavailable, or corrupt selected evidence fails; it never falls back to an older
green image. PR, manual, foreign, expired, and failed/skipped/cancelled inventory
steps cannot qualify. Fresh findings against a retained red image remain red
without a new image build. Preserve findings/errors and visibly fail/report the
fresh scan.

```sh
python3 scripts/security/image_scan.py --bundle <trusted-retained-bundle> \
  --image sha256:<same-loaded-image-id> --source-revision <original-commit> \
  --trusted-policy <current-trusted-policy.json> \
  --candidate-policy <same-current-trusted-policy.json> --output <new-rescan-directory>
```

Rescanning verifies the retained inputs, updates the DB, and refreshes runtime
advisories without rebuilding or requiring the old image in Docker. It does not
retroactively revoke an old green PR result. Rerun stale PR candidates before
manual merges. The image publication process must rerun this gate against the
exact local image ID immediately before tagging/pushing that same ID.
`image_prepublication.py` supplies that boundary: it reruns existing smoke on the
ID with builds disabled, invokes this scanner, and emits a publication-gate
receipt only on success. Use the same scanner CLI arguments. It never publishes; failure
prevents publication regardless of a human PR-only merge override. Public NAC
workflows currently do not publish managed images; external publication wiring
must consume the gate rather than treating a previous PR result as a fresh pass.

## Qualification and rollout

Run deterministic negative tests with:

```sh
python3 -m unittest discover -s scripts/security -p 'test_*.py'
node --test scripts/security/image-policy.test.mjs
```

Run live tool/advisory fixtures with:

```sh
python3 scripts/security/image_qualify.py --output <new-fixture-evidence> \
  --tool-cache <cache> --db-cache <database-cache>
```

Live fixtures scan real checksum-verified Node executables and minimal dpkg
records with the real pinned tools/current DB; they never execute the vulnerable
Node executable. The vulnerable OS/Node and Go stdlib/toolchain/uv controls must match their
specific known blocking advisories; fixed controls must not match those same
advisories. Other newly published fixture advisories are retained and reported
as fixture drift, so old test binaries cannot block an already-fixed candidate.
The actual image gate still evaluates every finding at the full severity threshold;
control scoping never suppresses candidate findings or scanner/network failures. These fixtures
do not replace real managed image inventory/smoke evidence.

Before production gate activation, collect a fresh actual image baseline and
remediate findings or land explicitly reviewed narrow expiring exceptions.
ALL-447 remains Eric's dependency/runtime remediation, not an automatically
approved exception or an authorization to overlap his changes. Keep unresolved
runtime coverage and external publication qualification visible; never describe
an incomplete scan or an unqualified baseline as clean.

## Private beta publisher adoption prerequisite

Read-only inspection on 2026-10-21 found `managed-nac-controller` clean at
`8f9b0caab2e0add6ffc2b547c413f7752dc1eddc`. Its
`.github/workflows/nac-runtime-container.yml` is the actual private publisher.
It builds once into an isolated local registry, selects the linux/amd64 manifest,
pulls that digest, runs an adapted copy of NAC smoke with beta and exact release
identity/schema assertions, and later promotes a verified OCI transit bundle to
ECR. The NAC workflow/helper alone does **not** enforce that existing publisher.
Changing that repository or exercising ECR publication requires separate scope.

The source-owned scanner supports that beta path: it checks the actual NAC
binary revision and runtime inventory without assuming a `dev` build track.
Keep the controller's beta smoke and its exact build ID/source/version/schema
and image-label assertions. Resolve `docker image inspect "$VERIFIED_IMAGE"`
to the local immutable `.Id`, run its existing beta smoke on that ID, then call:

```sh
python3 .build/nac/scripts/security/image_scan.py \
  --image "$local_image_id" --source-revision "$SOURCE_SHA" \
  --trusted-policy "$trusted_policy" \
  --candidate-policy .build/nac/.github/security/exceptions.json \
  --output image-security-evidence
```

This must run in the unprivileged `verify-image` lane after the existing beta
smoke, before the transit bundle is accepted. Bind its image inspection
`repo_digests`/platform to `VERIFIED_IMAGE` and the controller's selected manifest;
retain its SBOM/runtime/identity bundle and findings with the checksummed transit
evidence. The local `image_prepublication.py` convenience wrapper reruns the
unmodified **dev** smoke and must not replace the controller's beta smoke.

The publisher supports `new`, recovered `transit`, and already-existing release
paths. Add an unprivileged fresh rescan of the retained security bundle for every
path before publication/promotion, binding the result to the exact manifest,
source, current trusted policy, and measured DB/runtime-advisory timestamps.
Require that result before ECR writes/accepted-release evidence, and preserve the
controller's rule that the credentialed publication job does not execute NAC or
untrusted transit code. An old accepted SBOM or old green source check does not
substitute for this fresh gate. No extra image build is needed.

Controller adoption, transit/recovery-path negative qualification, and actual
publication blocking remain external acceptance gaps until that separately
reviewed controller change lands and is qualified. This PR neither activates
private enforcement nor claims a failed publication scan can be bypassed through
Allison's PR-only merge override.
