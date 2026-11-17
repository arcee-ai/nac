# Temporary Picomatch tooling-risk acceptance

Allison separately approved this exact high-severity tooling-risk acceptance
and delegated this PR's manual merge in the Codex chat on November 17, 2026.
This is temporary risk acceptance, not a dependency repair. The accountable
owner is `@allisoneer`; remediation is [issue #714]. The hard expiry remains
**2026-12-01T23:59:59Z**. No renewal is authorized.

## Finding and exposure

[GHSA-fc5q-39xc-vjpf] / CVE-2026-112366 describes exponential regular-expression
backtracking for single-branch repeated extglobs such as `+(*a)`. Crafted patterns
and inputs can block a Node event loop. The reviewed advisory affects versions
through 4.0.7 and has no fixed version. This is an exploitable availability
finding, unlike the separate informational Chrono maintenance notice.

The locked package is `picomatch 4.0.7`, MIT, registry integrity
`sha512-qcJu88Q2IWqJsDD529JKMdwGm/dvInW4HvQnRwiH9JtihJvzGOscDtHE3x1pBKeUOTysQ8kVmLnJ2kJu7yhcGA==`.
Reviewed web-lock SHA-256: `c2b6c7c9f9f313bcf652dc1bfcc335625d532fdd75ca50823af52e24e46abaaf`.

The lock marks this entry `dev: true`. Paths include Vite 8.3.5, Vitest 4.1.12,
Tinyglobby/Fdir and TypeScript lint tooling. It is not a production dependency
in npm's resolved graph, and NAC's React/client source does not import Picomatch.
This is a graph/exposure assessment, not proof that all build inputs are trusted
or that every shipped byte is free of this code. Repository patterns, plugins
and dependencies can still stall development, builds or CI. Existing job
boundaries limit a hung job; they do not repair regex behavior. Dev dependencies
remain fully inventoried and scanned under the existing policy.

## Alternatives investigated

At preparation, the npm registry's latest version and upstream latest release
are both 4.0.7. A supported parent upgrade cannot select a published fix because
none exists. [Upstream PR #237] proposes a repair but remains open and unmerged;
PR #194 is not a released remediation. No third-party patch, fork, package rename,
vendored implementation, license change or reachability filter is introduced.
A downstream patch or replacement needs a separately recorded dependency/license
and compatibility decision under [future dependency review].

## Exact scope and approval boundary

Only this exact tuple is excepted:

- advisory: `GHSA-fc5q-39xc-vjpf`;
- package: `npm:picomatch`;
- context: `crates/nac-server/web/package-lock.json`.

Aliases, other advisories/packages/lockfiles and `managed-image` remain blocking.
The existing matcher binds advisory/package/context, not version or checksum;
the recorded graph identifies this assessment and does not approve future graph
changes. The original Chrono entry is preserved unchanged. No scanner, validator,
OSV configuration, check requirement or merge helper changes.

The candidate cannot authorize its own exception. Ordinary source/image policy
trust checks still reject this PR's differing policy. A hypothetical evaluation
is proposal testing, never a passing normal scan. Allison's separate explicit
approval permits the delegated audited PR-only merge of this exception alone
under [the existing landing policy]. It does not authorize merging PRs #709 or
#710, broader bypass permissions, or another exception. After actual landing,
refresh those candidates onto reviewed policy and obtain fresh normal scans.

## Removal

Review upstream progress by **November 24, 2026**. Prefer a supported patched
release/parent graph; verify globs, lint, tests, builds and generated asset drift,
then run a fresh full locked scan without this exception. Remove the entry when
that passes. If the expiry arrives first, the unchanged validator fails
closed; do not extend it silently. Publication and image security remain separate.

[issue #714]: https://github.com/arcee-ai/nac/issues/714
[GHSA-fc5q-39xc-vjpf]: https://github.com/github/advisory-database/blob/8d7231bac8e52fb6f9960a3d976c5f6317a491b7/advisories/github-reviewed/2026/10/GHSA-fc5q-39xc-vjpf/GHSA-fc5q-39xc-vjpf.json
[Upstream PR #237]: https://github.com/micromatch/picomatch/pull/237
[future dependency review]: dependency-decisions.md#future-dependency-review
[the existing landing policy]: dependency-scanning.md#landing-and-rerunning-policy
