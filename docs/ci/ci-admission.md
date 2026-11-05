# Metadata admission owner: unwired production draft

This draft adds a strict standard-library owner and offline controls. It does
not change Stable, nightly, cache privileges, test scope or production behavior.
Its NEW nonprotected reusable unit is not yet called by Stable. It starts from origin/dev914782659; neither private
DIAG branch nor the nightly override is an ancestor. Parent owns workflow wiring
and external check-consumer adaptation after the APT producer is sealed.

## Authority before a PURE decision

The workflow bootstrap MUST read the original event base SHA, obtain the owner
from that immutable base, and execute THAT copy before any candidate script.
If the base lacks this owner, run FULL. Running the candidate's script and trusting
its claim that its own digest matches base is not authority. Do not install or
fetch an alternative owner on failure. The default workflow must fail to FULL
without invoking untrusted candidate code for admission.

The owner verifies its executing bytes equal the base owner blob. All workflows
and the bootstrap/cold/applicability/publication selectors and policy must have exactly the same
bytes in original base, PR head and prepared candidate. New/modified/missing
workflow or program is FULL. Hashes summarize bytes only after comparisons;
a candidate-declared hash never authorizes itself. The repository is a fresh
checkout controlled by trusted bootstrap, before candidate tests mutate files.
Git calls are fixed argv, no shell, no replacements or code execution.

Only an actual two-parent prepared merge whose parents equal original base then
original head is supported. Squash914, direct-head, missing objects, unknown
preparation, modified admission code and stale head programs remain unchanged
FULL. Never infer a merge from equal TREE or fabricate a new candidate. Changes
to this admission owner therefore receive FULL coverage until trusted landing.

## Selector interface and state machine

The original GitHub event file is data. A bounded context JSON contains exactly
the documented keys in `.github/scripts/ci-admission-contract.json`: event_name,
run_id/run_attempt as integers, candidate_sha, original ordinary policy_sha,
executing workflow_sha. There is NO caller-provided applicability or cold boolean.
No body/title or credentials are emitted. Original head/base repository IDs,
PR number, exact prepared SHA/TREE/parents, base policy, workflow, complete
workflow/program content digest, original-event cold and derived applicability enter
the v2 tuple. Current cold is not substituted for an original event during selection.

`python3 <immutable-base-copy>/ci-admission.py --event <original-event> --context
<context-json> --repository <fresh-prepared-checkout>` emits one JSON object.
Only exact mode `pure` from a successful trusted invocation can narrow work.
Parse/output/process failure is FULL in the workflow bootstrap. The owner also
returns FULL on malformed/no-follow/file-bound errors, service errors and unknown
or conflicting evidence. It is never an exit0 quality gate or old-green reader.

Opened/synchronize/reopened/ready, explicit base edits, push/manual/tag and retry
attempts are FULL. Only an edited event with known title/body change fields may
continue. Body `from` and current first-line cold marker are compared BOTH ways;
false→true and true→false are FULL, even if returning to an older admitted value.
The grammar matches the existing cold owner exactly (LF/CRLF/end; no whitespace,
quotes, fences or later example activation). A silently advanced base SHA/policy
or changed exact prepared identity cannot match an old admission tuple.

A FULL selection carries a tuple_digest only when independently canonical and
trusted. Such a full run may publish a non-required selection marker immediately
after identity preparation, before quality. Unsupported FULL runs publish no
marker. A marker's existence does not say that any tests passed or even started.
A later pure edit cannot replace a failed/pending/absent source verdict.

## Complete bounded interval; never a latest-green search

The public reader uses no Authorization token, proxy credentials, redirect or
retry. It is limited to30seconds,11requests (current metadata+2pages+8job lists),
512KiB/response and4MiB total. No calls were made during draft development.
Missing/incomplete/malformed/overlapping pages or exhausted budgets select FULL.

The original run's immutable source/branch/repository/workflow and attempt1 are
bound first. The branch-filtered Stable PR run list must contain current run and
have canonical ordered identities; same-second ordering ambiguity is FULL.
Current/future runs cannot attest an earlier event. Walk each older run in order:
matching trusted PURE observation may be traversed; the FIRST FULL must match
this exact tuple. Any unknown, retry, zero-job cancellation, missing/unstarted/
duplicate marker, changed head/repository or mismatched tuple returns FULL
immediately. No searching behind it for an older match. Hash-only rebases and
body-update runs are not ordinary cohort samples just because they have markers.

GitHub run `pull_requests` arrays are empty in retained621 metadata; the owner
does not infer PR association from them or from actors. The tuple marker binds
PR number and original source; the complete same-branch interval is deliberately
conservative for branch reuse/fork ambiguity. A foreign/unknown run on that
interval costs full work. It never gives permission to drop a record.

Run/job conclusions and statuses, quality/browser/fault/security receipts and
actors are not admission inputs. Failed, cancelled, pending and success cases
with the same valid started marker give the same selector classification. The
external consumer must still evaluate the actual full run's current checks.

## Always-invoked unit and independently bound PURE pointer

The always-invoked tiny `.github/workflows/ci-admission.yml` has a trusted-base
identity job followed by a nonprotected marker job. Its caller ID/name MUST be
`ci-admission`. PURE still invokes this unit; it never invokes a quality child.
The unit has no caller inputs. It reads the ORIGINAL event/GitHub run context,
checks out github.sha, obtains the bootstrap with `git show <original-base>:...`,
and executes only that base copy. The base bootstrap validates repository/base
identity, compares its bytes to BASE, then executes a temporary BASE owner copy.
Missing programs produce unchanged FULL/no marker. No candidate script supplies
an authority boolean. The unit/bootstrap bytes are part of the authority set.

Provider Jobs AND Checks names, INCLUDING caller prefix, are exactly:

- FULL: `ci-admission / NAC full admission v2 <tuple_digest>`
- PURE: `ci-admission / NAC metadata observation v2 <observation_digest>`
- Other nonmarkers: `ci-admission / NAC admission identity` and unavailable marker
  `ci-admission / NAC admission unavailable`; neither authorizes coalescing.

The observation digest is lowercase SHA256 over UTF-8 compact ensure_ascii JSON
`[2,tuple_digest,FULL_run_id,1]`, separators comma/colon with NO whitespace. The
run ID is a positive safe JSON integer (<=9007199254740991), attempt is integer1.
The tuple itself begins integer2. The external consumer independently walks the
complete interval to the FIRST matching FULL, then computes this digest and
checks every intervening and final PURE marker against it. It never trusts a
stdout pointer, and a PURE hash pointing behind a newer FULL cannot pass.

Every historical marker and externally accepted final PURE must have exactly
ONE provider referenced_workflows entry for this unit, with exact fields:
`path=arcee-ai/nac/.github/workflows/ci-admission.yml@<prepared_sha>`,
`sha=<prepared_sha>`, `ref=refs/pull/<PRnumber>/merge`. Read immutable Git objects
at that provider-attested SHA and compare unit/bootstrap/program/policy/all
workflow bytes against original BASE and PR head. Missing/duplicate/mismatched/
unknown attestation is FULL or hold. Self-declared digests are insufficient.
Current selector need not assume the reference appears while its own unit starts;
the external consumer MUST verify the final run's provider attestation.

The retained621 FULL provider metadata proves this referenced_workflows shape;
the closed DIAG screen proves caller prefixes/dynamic names/anonymous Jobs and
Checks primitives. No new run was made to test this unit. Its early-attestation
visibility is not a correctness dependency; final unit-specific provider evidence
and normal source validation remain pending publication, with unknowns held.

## Managed and cold derivation by the external owner

Managed applicability is derived from COMPLETE `git diff --no-renames --name-only
-z <original-base> <prepared> --` paths. Decode/size/truncation errors are FULL.
Read `.github/scripts/ci-admission-applicability.json` from immutable BASE; its
version1 prefixes/exact names match BASE `managedApplicable`, and its
pr_checks_sha256 MUST equal SHA256 of the complete BASE pr-checks.mjs bytes.
The policy itself must match head/prepared. The Python owner uses this policy;
controls compare it to the existing actual Node function. External owner computes
the same complete paths/policy, never accepts selector/prepare booleans as authority.

For current applicability/freshness, external owner uses current PR head/base/
repositories/ref, provider-attested prepared parents/TREE/source and current
body's exact cold-marker flag to recompute the same tuple. Historic tuple inputs
came from immutable original GITHUB_EVENT_PATH; current mutable body cannot
reconstruct `changes.body.from` or replace historic input. The trusted attested
program enforces both original transition directions. Unknown/missing original
provenance or intervening work holds/FULL, never a backwards green search.

## M3 machine contract and remaining gates

The adjacent JSON contract defines names, output fields, read bounds and consumer
requirements. A PURE result contains no required source contexts and names
a compact independent binding to the latest matching FULL run/attempt and tuple.
The stdout pointer is diagnostic only. It
is not a passed quality receipt. Full required contexts are the existing aggregate,
source-security scan and ARM native context. The parent-owned tool must verify
owner/run/attempt/tuple and absence of all three names in BOTH pure Jobs/Checks,
then evaluate the original full run without replacing any failure/pending/absent
verdict. Unknown newer work blocks. The installed extension is not patched here.

The private provider screen proved manual dynamic names/public reads only. It
proved neither PR current-source semantics nor production bootstrap/queue rules.
Production is blocked on root's APT handoff, trusted-base bootstrap, exact graph
and naming wiring, M3 consumer integration and ONE code acceptance review. No
coalescing is published; no new strategy/cohort credit. The goal remains open.

Local controls: the adjacent owner/bootstrap Python tests and unit parsed/actual
applicability Node controls exercise real tiny
Git objects plus offline identity, authority, cold, partial-history and no-auth
negatives; no Cargo, server, browser, image, API traffic or CI execution.
