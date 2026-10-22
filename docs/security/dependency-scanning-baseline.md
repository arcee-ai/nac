# Source baseline after ALL-447: October 21, 2026

Locked inputs inherited from merged dev `750126375a946df1694cda299eb6f0cf732e3fbb`
([ALL-447 / PR #399](https://github.com/arcee-ai/nac/pull/399)).
Trusted policy/configuration: foundation `48091cd4ade89c3c2904f576c2813377750828b4`.
Scanned at 2026-10-22T00:24:20.314Z with checksum-verified OSV-Scanner 2.7.0.

All three inputs completed with zero scanner/coverage errors: **nine blocking
advisory records, zero exceptions**. Six are Rust records and three are web npm;
release-tooling npm has no matches. This is failed security evidence, not an
exception approval or a clean bill.

| Input | Packages | Supplemental bundled identities | SHA-256 |
| --- | --- | --- | --- |
| Cargo.lock | 406 | 0 | fd6695c4e4abf32a7893bf49032f90439a2bc0b7dbc34dd247c3e3b69abfe060 |
| crates/nac-server/web/package-lock.json | 652 | 6 | 6c4f19fa68d65090c5e2df2fc46b890a0294578db6f43d3859fe7ea2990501e8 |
| .github/scripts/package-lock.json | 162 | 0 | 58e18777f8864382bdf326a22057be4a7a2388acff8df50a82fc5304be00df4b |

The six bundled web npm identities classified as LOCAL by native OSV extraction
were proven against their locked registry parent and queried with the exact
CycloneDX supplement. Original lockfiles and report contexts were preserved.

| Input | Package | Installed | Advisory | Fixed versions reported |
| --- | --- | --- | --- | --- |
| Cargo.lock | crates.io:paste | 1.0.15 | RUSTSEC-2024-0436 | none reported |
| Cargo.lock | crates.io:serial | 0.4.0 | RUSTSEC-2017-0008 | none reported |
| Cargo.lock | crates.io:unsafe-libyaml | 0.2.11 | RUSTSEC-2024-0449 | none reported |
| Cargo.lock | crates.io:zip | 3.0.0 | RUSTSEC-2026-0367 | 9.0.0 |
| Cargo.lock | crates.io:zip | 3.0.0 | RUSTSEC-2026-0368 | 9.0.0 |
| Cargo.lock | crates.io:zip | 3.0.0 | RUSTSEC-2026-0369 | 9.0.0 |
| crates/nac-server/web/package-lock.json | npm:braces | 3.0.3 | GHSA-vfj7-8cjw-p6xm | none reported |
| crates/nac-server/web/package-lock.json | npm:katex | 0.16.47 | GHSA-238p-pmpm-9mq7 | 0.18.2 |
| crates/nac-server/web/package-lock.json | npm:postcss-selector-parser | 6.1.4 | GHSA-rj75-hqrm-r3gf | 7.1.6 |

Eric’s ALL-447 changes are merged and inherited without alteration. These
residuals are separate from that landed remediation. [ALL-462](https://linear.app/arcee/issue/ALL-462)
is the separate research/options and remediation layer; this CI layer chooses
no replacement or upgrade and approves no exception.

The earlier dev `1c9ccccae2202a74ade42f20cad220f279a7dde8` scan had 57 records.
That historical inventory is retained in the [pre-remediation snapshot](https://github.com/arcee-ai/nac/blob/00dcd69d0e9f17d13ce01fc28f93fa6fd5d47361/docs/security/dependency-scanning-baseline.md).
It is superseded for the current stack by this nine-record scan.

Ordinary source security and publication checks remain red until the residual
inventory is remediated or separately reviewed exact expiring exceptions land.
A deliberate human PR-only merge override is a separate decision; it does not
clear publication scans or qualify production activation. Safe deployed
merge/schedule/prepublication qualification remains rollout acceptance work.
