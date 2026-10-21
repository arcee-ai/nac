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
that validator directly. A candidate policy change fails; an empty policy grants
no exceptions. An exception's exact context is `managed-image`. Package identities
are Grype's `<artifact.type>:<artifact.name>` (such as `deb:openssl` or
`binary:node`), or `Go:stdlib` / `PyPI:uv` for explicit runtime checks. Source
lockfile exceptions cannot suppress image findings. Every exception still needs
its advisory, package, context, reason, owner, linked issue, and UTC expiry.

High/Critical findings block even without a fix. Lower severities remain in the
report. Unknown severity blocks conservatively because it cannot be established
below High. Tool, network, DB, input, configuration, and inventory errors return
failure separately from vulnerability blocking. No `only-fixed`, blanket runtime
exception, or blanket OS exception is used.

## Inventory and advisory coverage

Syft inventories the full image, including Debian's dpkg database. The actual
`/etc/os-release` probe must identify Debian 12/bookworm, the Syft release must
match it, and Grype must report that recognized Debian release. Unknown release
metadata fails even if Grype exits successfully with zero findings. Every package
reported by the image's dpkg probe must occur at the actual version in the SBOM.
The gate executes fixed absolute Node, Go, and uv paths inside the exact image,
with no network, no capabilities, a read-only root, and a bounded process count.
Unknown/missing version output is an error. Node must appear in Syft at the
probed version with its Node.js CPE; Grype enables CPE matching.

Syft's [binary catalog](https://oss.anchore.com/docs/capabilities/binary/) documents
Node detection, but does not document uv detection. The gate therefore queries
OSV explicitly for `Go:stdlib` and `PyPI:uv` at their probed versions, retaining
both request and response. Upstream documents [PyPI distribution of uv](https://docs.astral.sh/uv/getting-started/installation/#pypi).
This maps the upstream uv release version to the PyPI
release of the same application; it is bounded application-advisory coverage,
not a claim that every statically linked uv dependency has been inventoried.
Go's bundled stdlib is checked even when Syft does not detect the installed Go
compiler. Full image package matching remains active alongside these checks.
OSV may have no severity for Go advisories; those matches block as Unknown.
Neither tool can establish absence of undisclosed vulnerabilities.

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

Keep SBOM, all raw findings (including lower severities), policy dispositions,
runtime versions/advisories, image inspection/identity, tool/DB metadata, and
result together. `bundle.json` hashes the unchanged SBOM/runtime/identity/coverage
inputs for later rescans. Retain artifacts for 14 days; daily selection must use
only successful trusted `dev` push runs from `.github/workflows/stable-release.yml`
with the expected per-SHA artifact. PR, manual, other-workflow, failed, expired,
and incomplete evidence cannot qualify. After a qualified image has been retained,
new daily advisory findings fail/report without needing a new image build.
A new scan result is useful even when vulnerabilities block: preserve evidence
with an always-run artifact upload and visibly fail/report the job.

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
Node executable. Both vulnerable OS and Node must yield blocking advisories;
the safe fixture must pass. New advisories can make the safe fixture fail; review
and update its version/digest rather than weakening the assertion. These fixtures
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
