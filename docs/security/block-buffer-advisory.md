# Temporary block-buffer advisory exception

This is a temporary, evidence-backed acceptance of
`GHSA-qwgh-2vcv-g2f7` for `crates.io:block-buffer` in `Cargo.lock`.
The accountable owner is `@allisoneer`; it expires at
**2026-11-03T14:00:00Z**. [ALL-496] tracks permanent resolution and removal.
It does not clear managed-image findings or establish general memory safety.

## Exact dependency and finding

The reviewed lock contains `block-buffer 0.10.4`, checksum
`3078c7629b62d3f0439517fa394996acacc5cbc91c5a20d8c658e77abd503a71`.
The [raw scan artifact] binds the original finding to source candidate
`0e5c673ea377a91569efd640b3854879c66cbc39` on post-Insights dev
`2c486741cc853e29c7ce6c0fff84acc66223e874`: all three locked inputs scanned,
one blocking match, zero exceptions, no scanner errors.

The raw advisory spells its package `block_buffer` and declares versions
below `0.12.1` affected. The normalized table omits a fixed version because
the spelling differs; the raw advisory does identify `0.12.1` as fixed.
The exception uses the scanner's actual finding identity,
`crates.io:block-buffer`.

## Applicability evidence and limits

The [maintainer advisory] describes a callback overwriting a cursor stored
inside the data block, followed by a caught panic and reuse. Its
[accepted repair] adds reset guards around callbacks in that inline layout.

The [exact 0.10.4 upstream source], identified by the published crate's
`.cargo_vcs_info.json`, stores the buffer and `pos: u8` separately.
`digest_blocks` writes the data buffer; `get_pos` reads the separate field.
There is no `ReadBuffer` type. The analogous generator method builds a
temporary block before publishing it. This supports an overbroad affected
range for this version, rather than invalidating the advisory itself.

An independent locked/offline debug reproduction exercised all 256 byte
values in the advisory's compression-panic sequence. Position stayed at 2,
and the subsequent digest produced the expected block. An analogous
generator-panic sequence preserved position 0. [The investigation] records
the original source and test provenance. Miri was unavailable; these checks
do not prove the absence of unrelated memory-safety or hashing defects.

`digest 0.10.7` requires `block-buffer 0.10`. Replacing it with `0.12.1`
is not a compatible lockfile bump. A permanent parent upgrade needs
coordinated SHA-2 and OAuth/RMCP compatibility qualification.

## Scope, expiry and removal

The existing policy format matches exactly **advisory + package + context**;
it does not constrain the package version. This acceptance is justified only
for the reviewed version and checksum. Reassess any dependency change before
relying on it. Other advisories, packages, lockfiles and `managed-image`
remain outside the exception. Expiry fails the entire policy closed.

Before expiry, resolve the affected-range discrepancy or qualify a supported
dependency upgrade, remove this one entry, and retain a fresh complete source
scan that passes without it. ALL-496 remains open after the interim exception
lands. Any extension requires a new explicit reviewed decision; there is no
automatic renewal. No upstream messages have been sent by this work.

## Landing and verification

The [existing reviewed-policy boundary] remains effective. A PR cannot
authorize its own exception: scanning against trusted dev must reject this
policy difference. That expected rejection is not a passing source check.
The documented landing path requires separate human review and Allison's
audited PR-only override; agents must never invoke that override. Once landed,
dependent candidates must rebase onto the trusted policy and pass fresh scans.

Verification uses the existing security-policy, source-security and publication
contract tests, plus the retained raw finding to check this exact candidate:
one match is excepted; neighboring advisory/package/context findings remain
blocking; evaluation at the exact expiry rejects the policy. No scanner,
workflow, dependency, trusted-source rule or managed-image exception changes.

[ALL-496]: https://linear.app/arcee/issue/ALL-496/resolve-block-buffer-advisory-applicability-and-remove-the-temporary
[raw scan artifact]: https://github.com/arcee-ai/nac/actions/runs/40446997021/artifacts/12708587530
[maintainer advisory]: https://github.com/RustCrypto/utils/security/advisories/GHSA-qwgh-2vcv-g2f7
[accepted repair]: https://github.com/RustCrypto/utils/pull/1487
[exact 0.10.4 upstream source]: https://github.com/RustCrypto/utils/blob/6d35952d3d3b124bc1049ad6fb406b42b1ce4bfe/block-buffer/src/lib.rs
[The investigation]: https://github.com/arcee-ai/nac/pull/420#issuecomment-6433444720
[existing reviewed-policy boundary]: dependency-scanning.md#landing-and-rerunning-policy
