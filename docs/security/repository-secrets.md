# Repository secret detection and response

GitHub secret scanning and push protection are enabled for public
`arcee-ai/nac`. Push protection rejects supported credential patterns before an
ordinary Git push reaches the repository; secret scanning also examines existing
history and supported GitHub collaboration surfaces. Coverage depends on the
[supported provider patterns](https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns).
A successful push does not prove that arbitrary credentials are absent.

## Observed settings and ownership

On October 22, 2026 (Pacific time), an authorized repository administrator enabled
secret scanning, push protection and delegated bypass. The
[redacted before/request/after receipt](../ci/evidence/2026-10-22-secret-protection.json)
records the actual repository API changes and authenticated UI readback.

The bypass list contains only the existing `@arcee-ai/security` team (11763569),
in GitHub's `ALWAYS` / **Always allow** mode. This grants per-secret bypass and
request-review authority; it does **not** exempt that team's pushes from scanning.
No `EXEMPT` actor, all-writers role, bot exemption or organization policy was
added. GitHub organization owners and security managers retain their implicit
[bypass authority](https://docs.github.com/en/code-security/concepts/secret-security/delegated-bypass).
The UI reads **Specific roles or teams**, with exactly one actor, **Security**.
Do not use an empty reviewer list: the UI requires at least one actor.

Alert triage starts with Allison (`@allisoneer`), whose existing repository admin
access was verified. Other repository/organization administrators and security
managers can access alerts through GitHub's existing access rules. Bypass
requests route to the selected Security team. A credential's provider/account
owner handles revocation and replacement; the triaging administrator records that
owner in the restricted alert discussion and follows through to resolution.
Aleksiej (`@Cecocho`) and Eric (`@ericlau98`) retain their existing write/reviewer
roles; CODEOWNERS review status alone does not give them secret-alert access.

Use [NAC's secret-scanning alert list](https://github.com/arcee-ai/nac/security/secret-scanning)
as the durable triage queue and
[the settings page](https://github.com/arcee-ai/nac/settings/security_analysis)
to inspect effective bypass/access configuration. Personal notification settings
control email/web delivery. Delivery to a particular inbox was not tested; do not
assume that CODEOWNERS, PR-review requests or a passing CI job delivers a secret
alert. The current token cannot list organization security-manager teams or
custom repository roles (`admin:org` scope required); no extra scope was requested.
No additional alert-access grants or notification preference changes were made.

The initial Git/PR/issues/discussions backfills completed after enablement; the
redacted alert listing was empty at capture time. This is an observation, not a
historical leak audit or a guarantee about later pushes. Validity checks, generic
patterns, AI detection and delegated alert dismissal remain disabled. No custom
pattern or exclusion file was added. Concurrent dependency-maintenance settings
belong to ALL-453; they are not changed by the requests in this receipt.

## Real credential: revoke, replace, remove

1. Open the restricted alert or push rejection and identify the provider, account
   owner, affected service and commits. Record alert number, SHA/path and response
   status, never the credential value. Do not copy historical secret contents into
   a public ticket, PR, artifact or support transcript.
2. Treat a real exposed credential as compromised. Have its provider/account
   owner revoke it immediately and examine provider audit logs for unauthorized
   use. Coordinate a replacement with the smallest repository/resource scope and
   lifetime that the affected service needs. Store it in the approved secret
   store or GitHub Actions secret; update consumers and verify they work before
   closing the incident. Deleting a file or resolving an alert does not revoke a
   credential.
3. For a blocked, unpublished push, edit every commit that contains the value.
   Amend the latest commit or interactively rebase earlier unpublished commits,
   staging only intended paths and preserving unrelated work. A later deletion
   commit leaves the offending earlier commit in the push and remains blocked.
   Retry the clean branch without requesting a bypass for a real credential.
4. For material already on GitHub, rotate first. Remove current copies and
   coordinate any shared-history cleanup with maintainers under
   [GitHub's sensitive-data removal procedure](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
   Forks, clones, cached views, PR refs and retained logs/artifacts may still hold
   copies. Do not force-push protected/shared history as a routine alert fix.
5. In the restricted alert, record revocation/replacement verification and the
   cleanup disposition. Resolve with the accurate reason (for example `revoked`)
   after provider confirmation. Unknown/inactive validity does not by itself
   establish safety. Follow
   [GitHub's remediation guidance](https://docs.github.com/en/code-security/tutorials/remediate-leaked-secrets/remediating-a-leaked-secret).

## False positive or intentional inert test pattern

Prefer changing examples to placeholders or constructing dummy values at test
runtime. Confirm the value was never issued, or otherwise obtain evidence that
it is inert. If unsure, follow the real-credential procedure.

For an unavoidable inert pattern, follow the URL in that push's rejection and
submit a request with the minimum metadata and an explanation. The selected
Security team reviews it; organization owners/security managers keep GitHub's
implicit reviewer powers. Use `false_positive` for an unissued lookalike and
`used_in_tests` for an intentional test credential, as appropriate. Record the
specific alert/commit and rationale privately. Do not choose `will_fix_later` for
a live exposed credential, disable protection, add broad exclusions, or exempt
an actor to get a push through.

An authorized bypass reviewer still needs to perform the specific-secret bypass;
`ALWAYS` does not mean every future push skips scanning. GitHub's REST
[per-secret bypass endpoint](https://docs.github.com/en/rest/secret-scanning/secret-scanning#create-a-push-protection-bypass)
requires the original author and the rejected secret's placeholder ID. The
fixture receipt records an expiring retry window; inspect the returned expiry
rather than assuming a permanent actor grant. Once approved and pushed, the
same approved secret may remain allowed in later commits; a different secret
requires its own decision. Inspect the resulting alert and resolution rather
than treating a successful retry as proof that scanning was disabled.

## Release credentials and PR merge override

The existing release flow keeps `RELEASE_PLEASE_APP_PRIVATE_KEY` in a repository
Actions secret, with `RELEASE_PLEASE_APP_ID` in a variable. It mints tokens for
repository `nac` with only Contents, Pull requests and Issues write permissions.
`stable-release.yml` uses the job's GitHub token for archive upload. These
runtime credentials authenticate operations; their values must never be written
to tracked files. Enabling push protection does not require an automation
exemption or a PAT replacement. Preserve the scoped App and the
[two deliberate release decisions](../usage/releases.md).

The live secret/variable **names** were checked without reading values. Existing
release-policy/publication tests verify the scoped-token configuration and
fail-closed release plan. The fixture also pushes clean workflow-shaped content
containing secret **references**, verifying that references are not treated as
credential values. No real release, App-key rotation or publication was triggered
for this qualification; successful historical release runs predate this change
and cannot certify a post-change live release.

Push protection and PR rulesets are independent. Allison's deliberate,
PR-specific merge override does not grant secret-scanning bypass or remove a
push-time block. Leave secret protection enabled when handling a PR override.
The required CI/designated-review ruleset's separate rollout status and the
eligible reviewers `allisoneer` / `Cecocho` / `ericlau98` remain governed by
[required PR checks](../ci/required-pr-checks.md). One eligible non-author approval
and deliberate human merge handling remain required; this change grants no
merge authority or foundation-ruleset activation.

## Safe qualification and limits

Allison authorized a disposable repository after initial fixture discovery.
[The fixture](https://github.com/allisoneer/nac-secret-protection-fixture-all459)
contains only locally generated, never-issued synthetic patterns. No credential
was minted or obtained from a provider. No synthetic secret was pushed to NAC.
The [redacted qualification receipt](../ci/evidence/2026-10-22-secret-fixture.json)
records exact commits, settings, rejection output and the alert URL:

| Control | Observed result |
| --- | --- |
| Stripe test-key lookalike, protected Git push | GH013 rejection naming Stripe Test API Secret Key; remote branch absent |
| Specific unissued value, `false_positive` bypass | Expiring bypass accepted; exact same commit pushed; alert resolved as false positive with bypass flag |
| Distinct second Stripe test-key lookalike | GH013 rejection after first bypass; no permanent actor exemption |
| Clean commit | Push succeeds with protection still enabled |
| Clean release workflow references | Push succeeds without any credential value or automation exemption |
| Duffel test lookalike, initial control | Not blocked; not counted as detection evidence (GitHub's public-pattern data marks it non-public) |

The personal public fixture supports provider scanning and per-secret bypass,
but not organization delegated-bypass routing. The ordinary-actor request /
Security-team approval journey in an organization-owned fixture remains untested;
production settings were read back, not exercised with test secrets. Email
delivery and an actual post-change stable release remain unobserved. Preserve
these limits when reporting ALL-459 acceptance; the fixture does not certify all
GitHub secret patterns, organization policy, PR merge bypass, or release delivery.
