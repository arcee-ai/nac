# Exact-image applicability contract

ALL-503 adds verifier mechanics in `scripts/security/image_applicability.py`.
The production policy at `.github/security/image-applicability.json` has **zero
rules**. This mechanical slice does not qualify an advisory, approve evidence,
change existing source exceptions, or establish image clearance. Its executable
examples are synthetic fixtures in `test_image_applicability.py`; they are not
curl, Kerberos, or libssh2 regression receipts.

## Trust and caller responsibilities

`verify_applicability` takes normalized findings, immutable trusted-base and
candidate policy bytes, retained evidence/artifact bytes keyed by SHA-256,
independently verified observations, the exact scan identity, and a UTC clock.
The trusted base comes from a separately selected checkout. Candidate/base bytes
must be identical, including formatting, and both must contain **zero rules**.
Putting a nonempty rule in source changes the next image/source identity and
cannot approve that future image. A separately reviewed post-build policy can
be supplied only after the image and retained bundle are frozen. The caller must
authenticate that approval independently of candidate code and supply its exact
SHA-256 pin. Review metadata strings alone do not authenticate an approval.

The caller obtains observations by independently verifying the exact scanned
image and its source/package/payload/application-profile evidence. Copying a
candidate evidence record into `observations` defeats the API boundary and is
prohibited. In particular, package-name or executable-name absence cannot prove
that an affected application or renamed consumer is absent. The ALL-502 passive
collector alone does not establish semantic absence or security applicability.
Native vulnerable/fixed controls and the final filesystem/consumer analysis
remain separately required evidence before any real rule can be proposed.

The verifier only validates mechanically review-bound claims: it does not run
regressions, inspect a filesystem, fetch review state, collect an image, or
establish that a human reviewer reached the correct technical conclusion.
Production admission needs that external evidence and separate human review.

## Policy schema, version 1

The top-level object has exactly `schema_version: 1` and `rules: []`. Each rule
has exactly these fields:

| Field | Contract |
| --- | --- |
| `id` | Unique exact rule identifier. |
| `finding` | Exact `package`, `version`, `source`, and nonempty `advisories` list. Each alias must be explicitly listed; no automatic alias expansion. |
| `binding` | The complete binding below; no wildcard or omitted dimension. |
| `disposition` | Exactly `fixed` or `not_affected`. |
| `evidence_sha256` | SHA-256 of the complete reviewed evidence JSON bytes. |
| `review` | Exact `owner`, distinct `reviewer`, HTTPS `issue` and `review` references, `reviewed_at` and `expires_at`. |

Review timestamps use UTC seconds (`YYYY-MM-DDTHH:mm:ssZ`). The review must have
occurred, must not have expired, and can be valid for at most 30 days. Every rule
is validated even when the current report contains no matching finding; stale
or tampered policy inputs cannot be hidden by a scanner's changed row set.
Duplicate JSON keys, unsupported fields/schema versions, nonfinite numbers,
overlapping finding selectors, duplicate aliases and wildcard identities fail
closed. Existing exception policy format and semantics are unchanged.

The binding has exactly `image` (immutable `sha256:` engine image ID),
`source_revision` (full 40-character Git SHA), `platform` (`linux/amd64`),
`package` (exact ecosystem-qualified report identity), `installed_package`
(actual ecosystem-qualified APK identity), truthful
`package_version` and `upstream_version`, and four SHA-256 commitments:
`source_sha256`, `patches_sha256`, `payload_sha256`, and
`application_profile_sha256`. The source commit is a separate identity. The finding's version must equal one of the truthful
installed package/upstream versions. Source archive/patch/payload/profile
commitments are computed from the complete independently validated inputs,
using the collector's canonical serialization when those inputs are mappings.
The reviewed rule must bind the report identity to the installed package's
actual provenance; a synthetic upstream report identity is not a substitute
for verifying the installed package. The caller derives the explicit
scanner-coordinate to installed-APK mapping from the scanner's known query
targets and verified actual inventory, never from the candidate evidence's
claimed mapping. For example `upstream:mit/kerberos_5` and
`upstream-wolfi:krb5` bind to verified `apk:krb5-libs`; this does not authorize
other coordinates or aliases to inherit that observation.
Version 1 rejects a rule for a scanner coordinate observed on multiple installed
APKs. `upstream:haxx/curl` and `upstream-wolfi:curl` represent both `apk:curl`
and `apk:libcurl-openssl4`; proving only one payload cannot clear their shared
raw row. Each distinct APK coordinate can still be evaluated on its own evidence.

## Aggregate post-build policy, version 2

Version 2 is an opt-in post-build policy shape for a scanner coordinate shared
by two or more installed APKs. It keeps the exact top-level `schema_version`
and `rules` fields and permits existing single-binding rules alongside aggregate
rules. An aggregate rule replaces `binding` with `bindings`, a sorted list of
two to sixteen complete bindings with unique `installed_package` names. Every
binding must have the same scanner
coordinate and truthful finding version, and must match the selected image,
source revision and platform. The evidence JSON uses `schema_version: 2` and
the same `bindings` list in place of its singular `binding`. The verifier
requires the rule to equal the **complete** independently observed binding
set for that coordinate. A missing, extra, changed or duplicate installed
payload fails the rule before any raw finding is dispositioned. Single-binding
rules use version-1 evidence even inside a version-2 policy; existing version-1
policies and evidence remain accepted as before.

The version-2 evidence still requires the same reviewed regression or
application-absence claim and digest-bound artifacts, except for the narrow
curl official-release proof below. A reviewer must assess whether those
controls actually cover every listed payload. This mechanical shape supplies
aggregate installed-byte binding; it supplies no per-image human decision and
no automatic approval for the currently blocked images.

An observation is exactly `{binding, observed_at}`. Its binding must equal the
rule and reviewed evidence binding and share the caller's exact scan identity.
Observations must be unique for an admitted binding. Both observations and
evidence must be less than 24 hours old and not future-dated. This is a bounded
mechanical validity limit, separate from the unchanged scanner database and
advisory freshness checks. New evidence bytes need a new reviewed commitment;
the verifier never refreshes or reapproves an old rule automatically.

## Reviewed evidence and artifacts

Version-1 evidence JSON has exactly `schema_version: 1`, `rule_id`, `binding`,
`collected_at`, `artifacts`, and `proof`; version 2 replaces `binding` with
`bindings` and uses `schema_version: 2`. Its complete raw bytes must match the
rule's `evidence_sha256`. Collection cannot postdate its recorded human review.
`artifacts` maps exact descriptive roles to SHA-256 values; every referenced
artifact must be supplied as matching immutable bytes. The verifier accepts
bytes, not filesystem paths, and does not follow or open candidate paths.

The established `fixed` regression `proof` is exactly:

```json
{"kind":"regression","vulnerable_control":"failed-as-expected","fixed_control":"passed"}
```

Artifacts must include `vulnerable_control`, `fixed_control`, and `provenance`.
These fields record claims already bound to reviewed artifacts; their presence
alone is not a proof that a real vulnerability was reproduced or corrected.

### Narrow curl official-release proof

For the exact `(upstream-wolfi:curl, 8.23.0, grype-upstream)` scanner
coordinate with the explicit `CVE-2026-92392` and
`GHSA-7jvw-75gf-2h34` aliases, a version-2 aggregate `fixed` rule may
instead use this exact proof:

```json
{"kind":"official-curl-fixed-release","fixed_version":"8.23.0","fixed_commit":"8b0744af5b1b631da5b938ca31c3f9895ad5a321"}
```

The aggregate must contain exactly `apk:curl` and `apk:libcurl-openssl4`,
each at `8.23.0-r2`, with distinct, independently observed installed payload
hashes. Both must match the pinned 8.23.0 release archive, empty package patch
set, application profile, exact image/source/platform, and retained per-package
provenance. The package recipe's `source_commit` is
`3163ec065643ba20709f190111f42c3e1fe95273`; it is distinct from the
upstream fix commit in the proof. The upstream fix is already in the release
source and is **not** claimed as a separately applied package patch.

The evidence record must contain exactly five artifact roles:
`official_advisory` (the pinned [curl security metadata](https://curl.se/docs/CVE-2026-92392.json)),
`official_alias` (the pinned [GitHub advisory alias](https://github.com/advisories/GHSA-7jvw-75gf-2h34)),
`official_fix` (the pinned [upstream fix patch](https://github.com/curl/curl/commit/8b0744af5b1b631da5b938ca31c3f9895ad5a321.patch)),
`release_archive` (the pinned
[curl 8.23.0 release](https://curl.se/download/curl-8.23.0.tar.xz)), and
`provenance`. The verifier compares exact artifact digests embedded in the
reviewed source code, checks the advisory's fixed version and commit, and
checks the GitHub alias-to-CVE bridge. It extracts exactly
`curl-8.23.0/lib/multi.c`, checks its fixed SHA-256 and cleanup order, then
reverses the exact upstream patch with zero fuzz and checks the old source hash
and ordering. It parses retained provenance to compare both APK payload,
source, patch-set, profile, image, source revision and platform commitments.
Any changed upstream artifact requires a source-code pin update and review;
changed image evidence requires a new independent post-build review.

This is fixed-release and source-order evidence. The loopback HTTP/2 reset
attempts did not produce a behavioral fixed-versus-reversed differential, so
this path does **not** claim a reproduced use-after-free regression. Matching
installed payload hashes establishes the identity of the reviewed APK bytes;
it does **not** establish a reproducible source-to-binary build on its own.
The independent reviewer must assess whether the official fixed release,
source control, package provenance and exact-image payload evidence suffice
for these two findings. The empty source policy grants no disposition.
Admission still requires a separately authenticated, currently active,
independently reviewed post-build approval for the exact image; no version-only
or source-order-only candidate assertion can approve it.

For `not_affected`, `proof` has exactly `kind: "application-absence"` and a
nonempty unique `affected_applications` list. Artifacts must include
`complete_filesystem`, `complete_consumers`, and `provenance`. Introduced or
changed executables/consumers must change the independently derived profile
commitment, invalidating the previous binding. The verifier cannot infer this
property from a caller-supplied label; the collector/integrator must establish
it from complete final-image data.

## Results and integration boundary

The result contains `schema_version`, the effective `policy_sha256`,
`candidate_policy_sha256`, `approval_mode` (`none` or `post-build`), a deep copy of
`raw_findings`, separate `dispositions`, and `unresolved_indexes`. Each
disposition records the raw finding index, rule ID, `fixed`/`not_affected`,
canonical rule digest, and exact evidence digest. Duplicate raw rows keep their
separate indexes. Unlisted aliases and changed sources/packages/versions remain
unresolved. The input is never mutated and no finding severity is rewritten.

The caller retains the original raw report bytes unchanged, writes a separate
applicability receipt, and explicitly reconciles dispositions with the existing
blocking/reporting/exception result. The receipt is not itself a whole-image
pass: inventory, full scan, database/feed freshness, unchanged-image rescan,
source policy, strict reporter, and publisher checks still apply. Empty rules
produce no dispositions and leave every raw index unresolved.

`image_scan.py` joins this contract through `image_applicability_gate.py`.
It retains `findings.json` and the shared `policy-result.json` unchanged, then
writes separate `applicability-result.json` and `decision.json` receipts. The
decision binds both input files and the applicability receipt by SHA-256 and
records each remaining blocking raw index. The reporter verifies the complete
index partition, source row multiset, exact subject and receipt hashes before
accepting the scanner's effective count. Source exceptions, severity,
database/feed freshness and scanner error behavior stay effective.

The native CI image-inventory step and source-owned prepublication adapter
request `--collect-applicability`. This creates an unstarted, network-disabled,
read-only container from the exact scanned image ID; exports its underlying
filesystem directly to a retained tar; inspects that same image and container;
and removes only that owned container and its anonymous volumes. Source archives
and patches use exact source-lock URLs and hashes. No image is started for this
collection, and no volume-content or runtime-absence claim is made. See
`docker/managed/packages/APPLICABILITY_EVIDENCE.md`.

Schema-v3 inventory bundles retain the full tar, inspection/context receipts,
three passive profiles and original source/patch bytes alongside every existing
schema-v2 Rust/runtime/SBOM input. Extra names are deterministic flat names
derived from validated exact pins. Missing, unexpected or altered inputs fail.
An unchanged-bundle rescan reconstructs the complete passive profile from the
retained tar and source bytes using its original collection timestamp; it never
relabels old evidence as freshly observed. Schema-v2 inventory remains readable
and supplies no applicability observations.

New collection emits schema-v4/context-2 with an explicitly versioned libssh2
provenance capability. It adds the locked libssh2 source, Debian/supplier patch
bytes, both original local downstream fixes retained in the export, and exact
installed record/payload bindings. Schema-v3 replay keeps its original source
set and curl/Kerberos observations; identical V4 inputs retain those observations
and add `apk:libssh2`, `upstream:libssh2/libssh2` and `upstream-wolfi:libssh2`, each
bound to the installed `apk:libssh2`. No arbitrary alias inference occurs.
This passive support creates no production disposition: all raw libssh2 findings
remain unresolved. Unsupported rules or missing qualified inputs fail closed.
Actual native V4 image qualification, the
separately reviewed private-publisher scanner pin and beta/recovery acceptance
remain incomplete. Production dispositions require independent per-image
review after accepted ALL-501/ALL-502 evidence.

The standalone mechanics can be reviewed before the trusted checkout contains
the new empty policy file. Calling the verifier still requires real trusted
bytes; a missing file must not be replaced with candidate bytes or a fabricated
empty policy. If neither checkout configures the optional capability, the
integration records `inactive/capability-not-configured`. If only the candidate
contains the new empty policy, it records `inactive/trusted-policy-unavailable`.
Both states retain the original raw blocking verdict and grant zero dispositions;
neither is successful applicability verification. Candidate rules cannot
bootstrap missing trust. Missing candidate policy when trust exists, malformed
policy, candidate/trusted differences, source-embedded nonempty rules or invalid
active-rule evidence fail the
scan. Empty trusted policy needs no observations and admits no records, so old
passive collection timestamps do not prevent a fresh raw vulnerability scan.
With active rules, original observation and evidence freshness stay mandatory.

## Post-build per-image approval and activation

The initial native PR or dev-push scan retains an immutable image ID and a
complete versioned inventory bundle. It uses only the empty source policy and
therefore cannot admit a finding. An independent trusted reviewer may later
approve a policy bound to **that exact image and source revision**, storing its
bytes and digest-named evidence outside the candidate repository and retained
bundle. The subsequent scan uses `--bundle` with the same image ID and source
revision; it does not rebuild or change the synthetic merge revision:

```sh
python3 scripts/security/image_scan.py \
  --bundle /trusted/retained/inventory --image "sha256:..." \
  --source-revision "<40-character source SHA>" \
  --trusted-policy /trusted/base/.github/security/exceptions.json \
  --candidate-policy .github/security/exceptions.json \
  --trusted-applicability-policy /trusted/base/.github/security/image-applicability.json \
  --candidate-applicability-policy .github/security/image-applicability.json \
  --reviewed-image-approval /trusted/approvals/exact-image.json \
  --reviewed-image-approval-sha256 "<independently pinned SHA-256>" \
  --reviewed-image-evidence /trusted/approvals/image-applicability-evidence \
  --output /trusted/retained/rescan
```

All three `--reviewed-image-*` arguments are required together. The approval
and evidence paths must resolve outside the candidate source and retained
bundle. The approval must have at least one rule, its bytes must match the
independent digest pin, and every rule must pass the existing exact binding and
review/evidence validation. The scanner keeps raw findings and the existing
source-policy result byte-identical; `decision.json` remains schema 1. The
applicability receipt records the effective approval digest separately from the
empty candidate-policy digest. Missing approval leaves all findings unresolved;
invalid approval fails closed. The source review can land without accepting any
vulnerability claim.
Older schema-1 receipts without the new provenance fields remain readable only
when they admit zero findings; a legacy admission cannot prove post-build review.

The caller-supplied digest pin proves byte equality, **not approval authority**.
This CLI validates approved bytes but cannot establish who reviewed them. The
production caller must retrieve a **currently active** approval from a
separately protected store, verify actor/review authority and its digest, and
deny a revoked or missing approval. A retained approval alone cannot prove it
is still active. A trusted post-build job must re-evaluate the retained bundle
with a fresh vulnerability database and publish a status on the exact PR/image
identity that repository protections can require. Neither a protected approval
store nor such a status publisher is configured in this repository today; the
current source-owned PR workflow intentionally supplies no approval. Until
those external trust and check-publication contracts are provisioned and beta
recovery uses the same frozen bytes, a blocked native result stays blocked.
The 24-hour observation/evidence limit remains in force; rescan never relabels
old collection timestamps as fresh. If the frozen OCI image is still available,
it may be loaded by immutable ID and independently re-inventoried to obtain
new evidence without rebuilding; new evidence bytes need a new human review.
The source-only [approval intake prototype](image-approval-intake.md) specifies
the additional protected-branch, artifact and dedicated App status contract;
it is not an activated production approval path.

## Focused verification

```sh
python3 -m unittest discover -s scripts/security -p test_image_applicability.py
```

The tests exercise empty-policy preservation, synthetic fixed/absence claims,
explicit aliases and duplicate rows, changed source/patch/payload/profile,
introduced executable/consumer evidence, wrong image/source/platform, missing
or tampered artifacts, stale evidence, review expiry, malformed inputs and
candidate self-authorization. They do not substitute for actual regression
qualification or a current native image/security run.
