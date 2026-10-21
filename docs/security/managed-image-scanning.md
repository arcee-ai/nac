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

Syft inventories the full image, including Debian's dpkg database. Every package
reported by the image's dpkg probe must occur at the actual version in the SBOM.
The gate executes fixed absolute Node, Go, and uv paths inside the exact image,
with no network, no capabilities, a read-only root, and a bounded process count.
Unknown/missing version output is an error. Node must appear in Syft at the
probed version with its Node.js CPE; Grype enables CPE matching.

Syft's [binary catalog](https://oss.anchore.com/docs/capabilities/binary/) documents
Node detection, but does not document uv detection. The gate therefore queries
OSV explicitly for `Go:stdlib` and `PyPI:uv` at their probed versions, retaining
both request and response. This maps the upstream uv release version to the PyPI
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
only completed trusted `dev` push runs with the expected per-SHA artifact, never
a pull-request artifact. A failed security result remains eligible so new daily
reports continue tracking the same red baseline; incomplete bundles fail validation.
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
