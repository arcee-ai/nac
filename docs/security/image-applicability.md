# Exact-image applicability contract

ALL-503 adds verifier mechanics in `scripts/security/image_applicability.py`.
The production policy at `.github/security/image-applicability.json` has **zero
rules**. This mechanical slice does not qualify an advisory, approve evidence,
change existing source exceptions, or establish image clearance. Its executable
examples are synthetic fixtures in `test_image_applicability.py`; they are not
curl, Kerberos, or libssh2 regression receipts.

## Trust and caller responsibilities

`verify_applicability` takes normalized findings, immutable trusted and candidate
policy bytes, retained evidence/artifact bytes keyed by SHA-256, independently
verified observations, the exact scan identity, and an explicit UTC clock. The
trusted bytes must come from the caller's separately selected trusted checkout.
The caller must never use a candidate-controlled path as the trusted policy.
Candidate/trusted bytes must be identical, including formatting. A policy PR can
be prepared for human review, but its proposed rules deliberately fail this
check until separately reviewed and landed through the existing policy process.
Matching strings in review metadata do not constitute actual review approval.

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

An observation is exactly `{binding, observed_at}`. Its binding must equal the
rule and reviewed evidence binding and share the caller's exact scan identity.
Observations must be unique for an admitted binding. Both observations and
evidence must be less than 24 hours old and not future-dated. This is a bounded
mechanical validity limit, separate from the unchanged scanner database and
advisory freshness checks. New evidence bytes need a new reviewed commitment;
the verifier never refreshes or reapproves an old rule automatically.

## Reviewed evidence and artifacts

Evidence JSON has exactly `schema_version: 1`, `rule_id`, `binding`,
`collected_at`, `artifacts`, and `proof`. Its complete raw bytes must match the
rule's `evidence_sha256`. Collection cannot postdate its recorded human review.
`artifacts` maps exact descriptive roles to SHA-256 values; every referenced
artifact must be supplied as matching immutable bytes. The verifier accepts
bytes, not filesystem paths, and does not follow or open candidate paths.

For `fixed`, `proof` is exactly:

```json
{"kind":"regression","vulnerable_control":"failed-as-expected","fixed_control":"passed"}
```

Artifacts must include `vulnerable_control`, `fixed_control`, and `provenance`.
These fields record claims already bound to reviewed artifacts; their presence
alone is not a proof that a real vulnerability was reproduced or corrected.

For `not_affected`, `proof` has exactly `kind: "application-absence"` and a
nonempty unique `affected_applications` list. Artifacts must include
`complete_filesystem`, `complete_consumers`, and `provenance`. Introduced or
changed executables/consumers must change the independently derived profile
commitment, invalidating the previous binding. The verifier cannot infer this
property from a caller-supplied label; the collector/integrator must establish
it from complete final-image data.

## Results and integration boundary

The result contains `schema_version`, `policy_sha256`, a deep copy of
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
remain incomplete. Production rules require a separate human-reviewed policy
PR after accepted ALL-501/ALL-502 evidence.

The standalone mechanics can be reviewed before the trusted checkout contains
the new empty policy file. Calling the verifier still requires real trusted
bytes; a missing file must not be replaced with candidate bytes or a fabricated
empty policy. If neither checkout configures the optional capability, the
integration records `inactive/capability-not-configured`. If only the candidate
contains the new empty policy, it records `inactive/trusted-policy-unavailable`.
Both states retain the original raw blocking verdict and grant zero dispositions;
neither is successful applicability verification. Candidate rules cannot
bootstrap missing trust. Missing candidate policy when trust exists, malformed
policy, candidate/trusted differences or invalid active-rule evidence fail the
scan. Empty trusted policy needs no observations and admits no records, so old
passive collection timestamps do not prevent a fresh raw vulnerability scan.
With active rules, original observation and evidence freshness stay mandatory.

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
