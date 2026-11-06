# block-buffer advisory correction and proposed exception removal

**Proposed removal; fresh scan qualification is pending.** The temporary
`GHSA-qwgh-2vcv-g2f7` acceptance for `crates.io:block-buffer` in `Cargo.lock`
expired at **2026-11-03T14:00:00Z**. Its accountable owner was `@allisoneer`.
The proposed policy removes that sole entry; it does not extend or replace it.
[ALL-496] remains open until removal and fresh complete scanning are qualified.
No passing source-policy PR, trusted landing or managed-image clearance is
claimed by this proposal.

## Exact dependency and historical finding

The reviewed lock contains only `block-buffer 0.10.4`, checksum
`3078c7629b62d3f0439517fa394996acacc5cbc91c5a20d8c658e77abd503a71`.
The [raw scan artifact] binds the original finding to source candidate
`0e5c673ea377a91569efd640b3854879c66cbc39` on post-Insights dev
`2c486741cc853e29c7ce6c0fff84acc66223e874`: all three locked inputs scanned,
one blocking match, zero exceptions, no scanner errors. This is historical
evidence, not a fresh result for the removal candidate.

The original raw advisory spelled its package `block_buffer` and declared
versions below `0.12.1` affected. The normalized table omitted a fixed version
because the spelling differed; the raw advisory identified `0.12.1` as fixed.
The interim exception used the scanner's actual finding identity,
`crates.io:block-buffer`.

## Corrected upstream range

The [reviewed GitHub advisory] and [OSV record] now identify the affected
interval as **`>=0.11.0, <0.12.1`**. The retained official OSV JSON has
`introduced: 0.11.0`, `fixed: 0.12.1`, modification time
`2026-10-30T15:45:11.580215361Z`, and SHA-256
`347d0624dc0fc4dcfc669a8498aab5200725831b2dffd6f2e14237b97f53dfb4`.
Its `block_buffer` spelling corresponds to Cargo's `block-buffer` identity;
scanner matching and the wrapper's exact finding identity remain unchanged.
No name rewrite, version filtering or scanner patch is proposed.

Locked `0.10.4` is outside that corrected interval. Corrected upstream data
therefore provides a removal route without a dependency or parent upgrade for
this advisory, subject to fresh pinned-scanner confirmation. This does not
clear other advisories or establish general memory safety. A stale database,
new finding or scanner/coverage error must remain a failed qualification.

## Historical applicability evidence and limits

The [maintainer advisory] describes a callback overwriting a cursor stored
inside the data block, followed by a caught panic and reuse. Its
[accepted repair] adds reset guards around callbacks in that inline layout.

The [exact 0.10.4 upstream source], identified by the published crate's
`.cargo_vcs_info.json`, stores the buffer and `pos: u8` separately.
`digest_blocks` writes the data buffer; `get_pos` reads the separate field.
There is no `ReadBuffer` type. The analogous generator method builds a
temporary block before publishing it. This supported an overbroad affected
range for this version, rather than invalidating the advisory itself.

An independent locked/offline debug reproduction exercised all 256 byte
values in the advisory's compression-panic sequence. Position stayed at 2,
and the subsequent digest produced the expected block. An analogous
generator-panic sequence preserved position 0. [The investigation] records
the original source and test provenance. Miri was unavailable; these checks
do not prove the absence of unrelated memory-safety or hashing defects.

`digest 0.10.7` requires `block-buffer 0.10`. Replacing it with `0.12.1`
is not a compatible lockfile bump. A parent-upgrade alternative would require
coordinated SHA-2 and OAuth/RMCP compatibility qualification; the corrected
range makes that alternative unnecessary for this advisory if fresh scanning
confirms applicability. The proposed removal changes no dependency graph.

## Expiry and proposed qualification

The policy format matches exactly **advisory + package + context**, without
a version constraint. The interim acceptance was justified only for the
reviewed version and checksum. Other advisories, packages, lockfiles and
`managed-image` were never included. Production expiry still fails the entire
policy closed; it is the recorded cause of the November 3 source/image policy
failures. Those failures remain failures, not cancelled or passing checks.
No extension, renewal, reachability waiver or broader exclusion is proposed.

Before permanent removal is called complete, retain the corrected upstream
record and exact source/policy/lockfile identities, run existing security
contracts with the checksum-verified OSV-Scanner 2.7.0 and live safe/vulnerable
fixtures, and obtain fresh complete reports for all three locked inputs.
The normal wrapper must retain bundled-npm supplemental coverage, zero
blocking findings, zero exceptions and no scanner/coverage errors. Every other
finding remains subject to the unchanged gate. No fresh scanner or contract
test result is claimed by this document update.

The earlier interim verification checked one match excepted, neighboring
identities still blocking, exact-expiry rejection and policy trust. Those
historical results remain attributed to the interim candidate. Existing tests
use their own policies; the retained-image rescan test has an isolated empty
policy fixture. Removal requires no production-clock fixture adjustment and
must not weaken expiry, exact-context, publication or managed-image tests.

## Human landing and downstream verification

The [existing reviewed-policy boundary] remains effective for deletions as
well as additions. A candidate cannot authorize its own policy difference.
With the expired trusted base, validation fails at that expiry before policy
equality can be evaluated; otherwise a differing candidate policy is rejected.
Neither expected rejection is a green source check. Do not relabel the candidate
policy as trusted or use publication mode for an ordinary policy PR.

Landing requires separate human review and Allison's deliberate audited
PR-only override. **Agents must never invoke that override.** After actual
reviewed landing, dependent candidates must rebase or refresh onto the new
trusted policy and pass fresh normal all-three-input scans and required CI.
The removal candidate and affected managed-image path also need their actual
fresh required checks; source applicability alone clears no image finding.
ALL-496 must not be closed from the doc/range evidence or an expected policy-PR
failure alone. No upstream messages have been sent by this work.

[ALL-496]: https://linear.app/arcee/issue/ALL-496/resolve-block-buffer-advisory-applicability-and-remove-the-temporary
[raw scan artifact]: https://github.com/arcee-ai/nac/actions/runs/40446997021/artifacts/12708587530
[maintainer advisory]: https://github.com/RustCrypto/utils/security/advisories/GHSA-qwgh-2vcv-g2f7
[reviewed GitHub advisory]: https://github.com/advisories/GHSA-qwgh-2vcv-g2f7
[OSV record]: https://osv.dev/vulnerability/GHSA-qwgh-2vcv-g2f7
[accepted repair]: https://github.com/RustCrypto/utils/pull/1487
[exact 0.10.4 upstream source]: https://github.com/RustCrypto/utils/blob/6d35952d3d3b124bc1049ad6fb406b42b1ce4bfe/block-buffer/src/lib.rs
[The investigation]: https://github.com/arcee-ai/nac/pull/420#issuecomment-6433444720
[existing reviewed-policy boundary]: dependency-scanning.md#landing-and-rerunning-policy
