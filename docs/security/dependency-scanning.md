# Locked dependency security

The source gate uses OSV-Scanner 2.7.0, downloaded from its upstream release
with a checked-in SHA-256 for each supported host. It scans these inputs
individually on every candidate, including all locked dev/build/transitive
dependencies, no-fix and informational matches:

- `Cargo.lock`
- `crates/nac-server/web/package-lock.json`
- `.github/scripts/package-lock.json`

Every invocation explicitly passes the central
`.github/security/osv-scanner.toml`. This file contains comments only: no
OSV-level suppressions, broad package overrides, or reachability filtering.
Missing files, invalid configuration/policy, empty or mismatched inventories,
unexpected scanner versions/statuses, scanner diagnostics, malformed reports,
and network/database failures fail the gate. No package installation or build
scripts are run during scanning. The scanner is invoked with call analysis off.

OSV classifies npm bundled entries without `resolved` URLs as `LOCAL`, which
it inventories without vulnerability matching. The wrapper proves each such
entry's exact name/version from `inBundle` and its registry-resolved parent's
explicit `bundleDependencies` and integrity. It generates a small CycloneDX
inventory containing only those entries and scans it with the same pinned OSV
and explicit central configuration. The supplemental inventory must match
exactly, and findings keep the original lockfile context and hash. Raw SBOM
and scanner results are retained. Unproven local or unsupported origins fail
closed; neither a nonzero package count nor `LOCAL` inventory alone proves
complete vulnerability matching.

The reusable `source-security.yml` accepts a full 40-character `candidate-sha`.
Its default ordinary mode also requires a full `trusted-policy-sha`; PR callers
must supply the actual PR base SHA. Publication mode rejects a caller-selected
policy SHA and resolves this repository's canonical `refs/heads/dev` through
GitHub once, retaining the exact policy commit and event/run receipt.
It checks out candidate and trusted policy independently with read-only
permissions and no persisted Git credentials. Candidate code implements the
scan; policy and OSV configuration always come from the trusted checkout.
CI code changes remain subject to normal code-owner review.

The run retains raw OSV JSON/error logs, a machine-readable decision report,
input SHA-256 digests, and a concise Markdown findings table containing input,
package, advisory, installed version and available fixes. Results and candidate/
policy identities appear in the Actions summary and a 14-day artifact. Publication
reports additionally retain the verified policy source receipt. A failure
before report creation remains a failed gate with an explicit summary.

## Shared reviewed exceptions

`.github/security/exceptions.json` has exactly this shape:

```json
{
  "schema_version": 1,
  "exceptions": []
}
```

Each exception requires exactly `advisory`, `package`, `context`, `reason`,
`owner`, `linked_issue`, and `expires`. All fields are nonempty strings.
`package` is the scanner's exact `ecosystem:name`, such as `crates.io:rustls`
or `npm:handlebars`. Source `context` is exactly one of the three paths above.
Image scanning uses `managed-image` with its adapter's exact package identity
(for example `deb:openssl`, `binary:node`, `Go:stdlib`, or `PyPI:uv`). A source
exception cannot apply to an image or another lockfile. Advisory IDs match
exactly; aliases are reported, not implicitly excepted.

`reason` records why the precise risk is temporarily accepted; `owner` names
the accountable person; `linked_issue` is an HTTPS remediation issue URL.
`expires` is a valid UTC `YYYY-MM-DDTHH:mm:ssZ` timestamp strictly after the
evaluation clock. Missing/unknown fields, wildcard identities, duplicates and
any expired entry fail validation for the entire policy. Production starts
with zero exceptions; fixture policies convey no approval.

The shared `.github/scripts/security-policy.mjs` exports
`validatePolicy(document, {now})` and
`evaluateFindings(findings, policy, {now})`. Findings require exact
`advisory`, `package`, `context`; other metadata is preserved. The latter
returns `{blocking, excepted}` and attaches the matching policy entry to every
excepted finding. It revalidates expiry at evaluation time. Callers must obtain
policy from a trusted revision and reject candidate-policy changes in ordinary
and PR evaluation; the module
does not infer trust from a filename or bless candidate-authored data.

### Landing and rerunning policy

A candidate whose exception policy differs from its trusted PR base fails,
even when the proposed exception would otherwise suppress every match. Do not
relabel a head policy as trusted to make it green. Make policy changes in a
separate, explicitly reviewed PR with the complete risk/reason/owner/remediation
issue/expiry. Because that PR cannot authorize itself, its landing requires
Allison's deliberate audited PR-only override after human review. Agents must
never invoke that override. Then rebase/refresh the affected candidate on the
reviewed policy and rerun security and required checks. No remembered approval,
package-wide suppression, no-fix exclusion, or dev-dependency exclusion exists.

The initial foundation lands an empty policy and comment-only OSV config as
trusted bootstrap inputs. Missing trusted policy/config is an error, including
during bootstrap; there is no missing-file exemption.

## Scheduling, publication and rollout

The required PR aggregate must directly require the same-run source scan.
Publication must require a fresh source scan of the exact immutable release
candidate before any release artifacts are published. The daily workflow
resolves the current `dev` commit once and scans that SHA, retaining findings
even when the gate fails. GitHub schedules execute only when the workflow is on
the default branch; qualification must verify that deployed scheduling works.

A daily failure cannot revoke an earlier green PR result. Maintainers must
rerun stale candidates before manual merges and inspect the current security
report; this implementation does not promise a hard database-freshness bound.
Tag/GitHub Release creation in `release-please.yml` first scans the merged
release PR's immutable SHA. The locked Release Please library then builds a
publication plan for only the scanned PR and rejects missing/ambiguous matching candidates, a different
PR/SHA/version/path, or force-tag behavior before side effects. It publishes
that validated plan directly, preserving release notes and publication labels;
it does not rediscover a newer candidate between validation and creation.
An older release blocked by its own immutable scan remains unpublished and
retains its pending label; it does not block publication of a later separately
scanned release PR. The guard never tags or relabels that older unscanned plan.
`stable-release.yml` separately rescans the exact tag candidate before binary
upload. Both publication scans may use a later, separately reviewed policy from
canonical `dev`, pinned once before evaluation. This permits recovery when a new
advisory or an expired exception blocks an already-created immutable tag: land
the reviewed policy change and rerun the publication workflow. The candidate
and tag remain unchanged and receive a fresh full scan; only the pinned current
policy is effective, and malformed or expired effective policy fails closed.

Publication policy is available only to a stable tag push or the exact merged
same-repository release PR. The resolver verifies the canonical API ref/object
identity, checkout origins and commits, candidate ancestry in the policy commit,
unchanged tracked scan/policy inputs, tag identity where applicable, and a receipt
bound to the current event/run and independent resolver output. Ordinary PR,
manual and daily events cannot select this mode. Missing or unavailable policy
never falls back to candidate grants. PR equality and self-suppression protection
remain required. Preparing a release PR remains a non-publishing operation.
Do not enable production required contexts until the merged workflows emit
them and safe/vulnerable fixtures plus ordinary merge-blocking qualification
have passed. Existing repository protections and Allison's PR-only override
remain separate from the scanner.

Eric's ALL-447 dependency/runtime remediation landed in PR #399 and is inherited
without alteration. This gate adds no dependency, asset, or runtime upgrades.
The fresh [baseline](dependency-scanning-baseline.md) retains nine residual
records; separate research/remediation belongs to ALL-462. Remediation or
human-reviewed exact expiring exceptions remain prerequisites for security-green
publication and enforcement qualification. A deliberate human PR-only merge
override can land the tooling while the baseline is red; it does not clear
publication scans or qualify production activation.

## Local verification

```sh
sh .github/scripts/install-osv-scanner.sh /tmp/nac-osv-scanner
OSV_SCANNER=/tmp/nac-osv-scanner node --test \
  .github/scripts/security-policy.test.mjs .github/scripts/source-security.test.mjs
node .github/scripts/source-security.mjs \
  /absolute/candidate /absolute/trusted-base /absolute/report-directory /tmp/nac-osv-scanner
```

Without `OSV_SCANNER`, unit/process-boundary tests run and the live fixture
qualification is explicitly skipped. CI sets it to the checksum-verified
binary, exercising real safe Rust/both npm fixtures and a vulnerable fixture
at each required input path. Vulnerable npm fixtures are dev dependencies and
are parsed only, never installed or executed. Infrastructure-negative tests
also cover partial findings plus logged errors, unexpected statuses, missing
scanner, malformed reports, empty inventories, broad/malformed config,
missing/expired/malformed/PR-authored policy, and installer checksum mismatch.
