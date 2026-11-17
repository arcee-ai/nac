# Temporary Chrono maintenance-risk acceptance

Allison explicitly authorized this separate scoped exception and delegated its
manual PR merge on November 17, 2026. The accountable owner is `@allisoneer`.
The exception expires at **2026-12-17T23:59:59Z** and is tracked by
[remediation issue #711](https://github.com/arcee-ai/nac/issues/711).
This is temporary risk acceptance, not a dependency repair or a claim that
Chrono is maintained. No exception renewal is authorized.

## Finding and dependency ownership

[RUSTSEC-2026-0543] marks Chrono unmaintained, lists all versions as affected,
and reports no patched version. This advisory does not describe a specific
exploit or memory-safety defect. It does not establish that Chrono is free of
other defects; those findings remain subject to the normal scanner.

The reviewed lock contains `chrono 0.4.45`, checksum
`1aa79e62e7697b8e29b513a68abacf485adcd1fe8284a4316c5ae868e6633327`.
NAC's own core already uses Jiff. Chrono remains transitive through:

- `rmcp 3.9.0`, including native timestamp/timeout types and
  `schemars 1.2.1`'s `chrono04` support;
- `oauth2 5.0.0`, enabled by supported MCP authentication, including device-code
  expiry and token introspection types.

The published [rmcp 3.10.0 manifest] still requires Chrono directly, enables
`schemars/chrono04`, and uses `oauth2 5.0`. A routine supported-parent upgrade
does not remove this finding. Removing MCP authentication or server behavior
merely to remove the package would violate supported behavior. Replacing or
forking these dependency families requires a separate dependency/license and
compatibility decision under [dependency decisions].

## Exact scope and retained controls

The policy matches exactly:

- advisory: `RUSTSEC-2026-0543`;
- package: `crates.io:chrono`;
- context: `Cargo.lock`.

The existing schema matches advisory/package/context, not a version or checksum.
The recorded version/checksum establish the reviewed graph; future graph changes
still require dependency review. Other advisories on Chrono, other packages,
other lockfiles, and `managed-image` are not excepted. Source scanning continues
to inventory all locked dependencies, including informational and no-fix matches.
Scanner errors, incomplete inventories and malformed reports still fail closed.
No OSV configuration, scanner code, required-check wiring or merge helper changes.

The original policy PR cannot trust its own exception. Its expected ordinary
source-policy rejection remains a failure; it must not be described as a green
scan. Allison's explicit authorization permits the audited manual PR merge of
this exception alone. It does not authorize merging PRs #709 or #710 or changing
repository-wide bypass permissions. After actual landing, those candidates must
refresh onto the reviewed trusted policy and obtain fresh normal scans.

## Removal and expiry

Review progress by **December 10, 2026**, ahead of the hard expiry. Prefer a
supported upstream MCP/OAuth migration that removes Chrono. Qualify MCP schemas,
timestamp serialization, timeout behavior, OAuth device-code/introspection,
supported platforms and the complete resolved dependency graph before removal.

Remove the exception once fresh normal locked scans pass without it. If the
migration cannot finish before expiry, obtain a separately authorized decision;
do not silently extend this entry. Expiry fails the entire policy closed under
the unchanged validator. Publication and managed-image security retain their
own exact-candidate requirements.

[RUSTSEC-2026-0543]: https://github.com/RustSec/advisory-db/blob/main/crates/chrono/RUSTSEC-2026-0543.md
[rmcp 3.10.0 manifest]: https://github.com/modelcontextprotocol/rust-sdk/blob/rmcp-v3.10.0/crates/rmcp/Cargo.toml
[dependency decisions]: dependency-decisions.md#future-dependency-review
