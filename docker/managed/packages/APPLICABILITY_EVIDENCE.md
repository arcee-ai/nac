# Passive curl and Kerberos evidence (ALL-502)

`scripts/security/image_applicability_evidence.py` adds a bounded evidence
producer and retained-export validator. It does not change the image, scanner,
policy, raw findings or advisory dispositions. The collector complements the
existing installed APK/archive/SBOM checks in `image_packages.py`; it does not
replace those checks or establish that a patch has the intended semantics.

## Inputs and reproducible collection

The caller must independently inspect the exact immutable loaded image, verify
its expected source revision and `linux/amd64` platform, then export a newly
created, never-started container from that same image ID, with no user mounts,
credentials or network access. Supply independently obtained image and container
inspection receipts. The container must identify that exact immutable image,
remain in its original never-started state, and have no binds, explicit mounts,
tmpfs or inherited volumes. Only the anonymous volumes created automatically at
the exact image-declared volume paths are allowed. Candidate-supplied inspection
JSON is not an independent identity observation. Retain the export and its
SHA256, both receipts and the exact collector/source revisions with the evidence.

The scope is explicitly `final-underlying-image-filesystem`.
[Docker export](https://docs.docker.com/reference/cli/docker/container/export/)
includes the underlying image directory when a volume covers that directory;
it excludes the mounted volume contents. Preserve NAC's six declared runtime
volumes. Record their exact sorted paths and bind them into the profile. This
profile cannot establish absence in runtime mounted volumes, later bind mounts,
or mutable workload state. Never turn an empty exported path into such a claim.

The final runtime stage records the explicitly supplied `NAC_SOURCE_REVISION`
build argument as `org.opencontainers.image.revision`. Build with the truthful
full source revision; an omitted argument remains empty. Legacy images lacking
this label fail this new collection contract and need a freshly built candidate;
the collector does not infer or fabricate a label. This metadata supplements
the scanner's independent runtime/binary source verification. A matching label
alone cannot prove that the binary or exported filesystem has that source.

Use the existing reviewed source lock from the exact image source. Obtain the
original curl/Kerberos source archives and all their listed patches through the
existing pinned source-download process. Supply only the selected files to the
collector; their actual bytes must match every locked SHA256. This command
performs no downloading and does not execute image code:

```sh
python3 scripts/security/image_applicability_evidence.py \
  --filesystem /absolute/receipts/final-filesystem.tar \
  --inspect /absolute/receipts/inspect.json \
  --container-inspect /absolute/receipts/container-inspect.json \
  --pins /absolute/exact-source/docker/managed/packages/sources.lock.json \
  --downloads /absolute/receipts/source-downloads \
  --image sha256:<exact-inspected-immutable-image-id> \
  --source-revision <exact-40-character-source-revision> \
  --output /absolute/receipts/passive-applicability
```

The three canonical JSON artifacts are:

- `filesystem.json`: all final-export files, directories, links and device/FIFO
  entries; regular-file SHA256/size and mode/owner metadata. Nothing is
  extracted. Duplicate, traversal, missing-parent, sparse, unsupported,
  truncated and nonzero trailing archive data are rejected.
- `consumers.json`: every supported native ELF file's type/machine and dynamic
  `DT_NEEDED` entries, every shebang directive, other executable files as opaque
  consumers, and conservative named sudo/ftpd paths, including links. The pinned
  Go source tree also contains non-executable foreign-architecture objects and
  intentionally malformed ELF parser fixtures. Valid native ELF files still
  receive normal `DT_NEEDED` profiling. Unsupported files in the pinned source
  fixture paths retain their first 64 header bytes and full-file hashes as
  opaque entries; no dynamic-import or non-use claim is made for them.
  Executable or misplaced ELF files fail closed when unsupported, and an
  opaque hardlink cannot escape those source fixture paths.
- `provenance.json`: immutable image/source/platform subject, export/source-lock
  hashes, actual original source/patch hashes, exact source/provenance and
  installed-payload bindings for `krb5-libs`, `curl` and `libcurl-openssl4`, both
  profile artifact hashes, declared volume paths, explicit filesystem scope,
  container-inspection hash and `application_profile_sha256`.

All artifact digests hash `canonical_json(value)`: sorted keys, compact JSON,
UTF-8 bytes and one final newline. `patches_sha256` hashes the canonical mapping
of selected patch filenames to SHA256; `payload_sha256` hashes the original
installed-payload mapping. `application_profile_sha256` hashes the canonical
mapping `{"filesystem": <filesystem SHA256>, "consumers": <consumers SHA256>,
"filesystem_scope": "final-underlying-image-filesystem",
"declared_volume_paths": <sorted image-declared paths>}`.

The Python API is `collect_evidence(export_path, *, image, source_revision,
inspected, container_inspected, pins, downloads)`, where `downloads` maps
selected names to local paths. It returns a mapping with `provenance`,
`filesystem` and `consumers`.
`validate_evidence(bundle, export_path, **same_independent_expected_inputs)`
reconstructs and compares every artifact. There is deliberately no JSON-only
completeness-validation path. A retained export must independently remain bound
to the exact image; its hashes alone cannot authenticate that association.

## Trust and acceptance limits

A full filesystem/consumer profile extends package-name absence with actual
final files and potential consumer identities. Empty named-path lists prove
only the bounded named-path observation. They cannot rule out renamed
applications, embedded code, static linkage, `dlopen`, scripts launching unknown
code or later runtime mounts. A new renamed or opaque executable changes the
profile hash even when the named lists stay empty. Human-reviewed exact-profile
qualification and independent observations remain necessary for any admission.

ALL-503 can retain these artifacts as opaque evidence commitments and pin a
reviewed profile hash. The collector does not manufacture a `not_affected`
claim, trusted rule, reviewer, approval, expiry or security clearance. Both curl
advisory aliases and all five Kerberos records remain visible in the scanner;
no candidate disposition for any of the seven records is established here.

The synthetic controls verify source/patch/payload tampering, wrong or missing
image/platform/source observations, introduced named and renamed/opaque
consumers, unsafe/truncated/incomplete exports and changed/missing artifacts.
They are contract tests. Upstream-backed vulnerable/fixed curl HTTP/2 and
Kerberos NegoEx/KRB-CRED regressions, exact combined native-image collection,
accepted advisory analysis, fresh scan/rescan and current-head CI remain
separate, unproven ALL-502 acceptance work. No unavailable upstream release,
source/license substitution or policy exception is introduced.

The opt-in local Docker control builds only an owned `FROM scratch` image with
one benign text file beneath a declared volume. It creates but never starts a
container, verifies the image/container association and actual export bytes,
and removes only that owned container, its anonymous volume and fixture image:

```sh
NAC_TEST_DOCKER_EXPORT=1 python3 -m unittest discover -s scripts/security \
  -p test_image_applicability_export.py -v
```

This proves the Docker underlying-directory behavior, not actual NAC image or
runtime-volume qualification.
