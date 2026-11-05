# Selected presentation qualification

ALL-527 qualifies the exact NAC root tarball consumed by ALL-541. The package
name remains `@arcee-ai/nac-client-all-121`; presentation is its optional
`/presentation` export. A source checkout, a freshly repacked different revision,
or a source-built embedding does not identify the receiving artifact.

## Selected composition and ownership

The selected rollout includes landed ALL-525 (conversation) and ALL-521
(navigation/notifications), and ALL-522 (launch), ALL-526 (inspector return),
ALL-523 (settings/MCP), ALL-524 (managed setup). The last four exact revisions
must be recorded before final qualification. Preparation does not qualify an
unfinished slice. The publication order is
`dev -> ALL-522 -> ALL-526 -> ALL-523 -> ALL-524 -> ALL-527`; the coordinator
owns history changes and the final immediate predecessor.

| Journey or contract    | Existing owner/evidence                                           | Required composed evidence                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reasoning and answer   | ALL-525; reasoning E2E and disclosure tests                       | Live/settled/selected reading, long content and actual zoom in the final standalone and packed presentation                                              |
| Navigation and notices | ALL-521; navigation E2E, toast tests                              | Equal session IDs in separate bindings; local selection, notification dismissal and announcement; host controls unaffected                               |
| Create, model, launch  | ALL-522; setup/creation/configuration tests                       | Source/model selectors, nested overlays, invalid/pending/error/retry/cancel, one launch; continue into settings                                          |
| Settings and MCP       | ALL-523; settings/MCP/OAuth tests                                 | Saved/unsaved/error states, long rows, nested selectors, cancel/reopen and late result ownership                                                         |
| Managed setup          | ALL-524; managed presentation/policy tests                        | Unconfigured/checking/connected/denied/offline/pending/error/cleanup states using controlled external fixtures; no real cloud action                     |
| Inspector return       | ALL-526; Insights/navigation/file/terminal tests                  | Parent filter/group/segment/position and child/draft return, narrow list reactivation, streaming/refetch and failed load                                 |
| Actual packed boundary | `packed-presentation.e2e.ts`, `presentation-qualification.e2e.ts` | Two installed packed roots, same session ID, unrelated host input/router/styles, local focus/portals/inertness/IME, replacement/close and draft lifetime |
| Runtime/query/cache    | Runtime owner tests and hosted lifecycle E2E                      | Closing/replacing one binding cannot clear the sibling cache, composer, pending operation or notifications; retired reads/streams stay fenced            |
| Exports/types/assets   | Root package, normal presentation build, packed consumer          | Strict consumer declarations, optional CSS and React peers, complete asset/font/notices inventory and actual successful font requests                    |

These rows are a coverage contract, not a passing-results table. Final receipts
must link each selected result to its exact revision, command, fixture and
evidence. Product implementations remain with their named ticket owners.

Retain the instance-owned layer stack, nonmodal Radix adaptation, native controls,
markdown/math/highlighting, xterm, diff and other specialized engines. `/design`
samples document production treatments; they do not prove a complete product
journey. Unselected visual work and whole-tree dead-code/catalog retirement are
deferred. No dependency, pin, license or public API change is implied.

## Build, preserve and consume the artifact

Run `make setup` in each fresh checkout and after either lockfile changes.
Obtain the coordinator's canonical writer window before builds/drift writers,
and use its resource gate for Rust/browser work. From the repository root:

```sh
npm --prefix crates/nac-server/web run build
# Inspect and commit coherent source plus designated generated outputs first.
node crates/nac-server/web/scripts/presentation-artifact.mjs \
  --output /absolute/evidence/final-artifact
```

The receipt command packs twice, checks equal bytes and integrity, validates
exports and every declared asset/font, and preserves the root tarball plus
`artifact.json`. It refuses dirty tracked package inputs and writes evidence
outside the source checkout. It requires a clean source checkout so the named
revision cannot conceal uncommitted product changes. The receipt includes the Git revision, SHA256,
npm integrity, per-file hashes, root exports/optional peers, lockfile hash,
Node/npm/zlib/platform and complete initial-load graph inventory. It does not
build, publish or certify browser acceptance.

Run the existing production E2E lane against that same committed code candidate.
For the focused receiving-byte lane, set the preserved tarball explicitly:

```sh
NAC_PRESENTATION_TARBALL=/absolute/evidence/final-artifact/arcee-ai-nac-client-all-121-0.0.0-all-121.tgz \
NAC_PRESENTATION_TARBALL_SHA256=RECORDED_ARTIFACT_SHA256 \
  npm --prefix crates/nac-server/web run test:e2e -- \
  packed-presentation.e2e.ts presentation-qualification.e2e.ts presentation-composed.e2e.ts
```

The existing harness requires its production `nac-web` E2E binary and isolated
scripted provider. See the root Makefile and `e2e/harness.ts` for the current
binary/environment contract; setting the tarball does not replace that contract.
The packed fixture installs bytes offline in a clean consumer, uses installed
locked peers, strictly compiles its declarations, builds the consumer with Vite,
and copies the packed manifest's assets to caller-owned static storage. There
are no source UI aliases. Without `NAC_PRESENTATION_TARBALL`, it packs the
current checkout and records that tarball's SHA256/integrity. An explicitly
authorized peer compatibility run can set `NAC_PRESENTATION_PEER_ROOT`; record
the actual versions rather than claiming the entire declared semver range.

ALL-541 receives the tarball, `artifact.json`, exact selected slice manifest,
local qualification/capture receipts and rollback predecessor through an
approved durable artifact route. Verify reviewer/receiver access and the live
PR body; a local path alone is not a delivered artifact. ALL-541 owns its locked
upgrade and signed ArceeFM-hosted integration. Local fixture success does not
close that acceptance.

## Matched captures and environment evidence

Use identical seeded content, fonts, data and browser/toolchain for each
comparison. The aggregate selected rollout compares baseline
`481ee248f755461c6bee9c274963cb30ccd6b0aa` with the final composition.
The former 9ab/a0 comparisons remain historical and are not relabeled as this
refreshed baseline. The ALL-527
leaf PR compares its own changed views with its final immediate ALL-524
predecessor. Keep these comparisons separately labeled; a lower slice’s
captures do not establish a new ALL-527 visual result. Preserve each baseline’s
production assets and root tarball separately. Run the same standalone
and packed journeys at 1440, 768 and 390 CSS-pixel viewport settings, with long
titles, errors and reachable primary/cancel actions. Wait for mounted/settled
targets and `document.fonts.ready`; capture complete browser viewports without
retouching. Record physical screenshot dimensions and effective `innerWidth`,
`innerHeight`, DPR, theme and reduced-motion state. Do not label a differently
sized inner container as the whole viewport.

`session-name-zoom.ts` supplies a disposable Chromium extension using
`chrome.tabs.setZoom(tab, 2)` and verifies `getZoom() === 2`. The packed
qualification uses this helper and checks DPR and effective viewport. Capture
the viewport with `Page.captureScreenshot` and `captureBeyondViewport: false`
to avoid cropped element screenshots at real zoom. CSS `zoom`, page-scale/pinch
zoom, narrower layout or a manually changed DPR do not satisfy this check.

The product currently forces dark, including when the OS requests light.
Exercise that supported behavior; explicit light-token probes are additional
probes, never new theme support. Use reduced motion and both pointer/keyboard
journeys. Label touch emulation, synthetic composition/key events and ARIA/AX
snapshots as such. Record actual VoiceOver/NVDA, physical-device and OS-IME
smoke if available; otherwise leave those specific acceptance gaps open. The
controlled proxy/scripted provider is neither production auth nor a signed
host, real provider, paid operation or real managed deployment.

## Startup budget and rollback

Use `scripts/startup-size.mjs --json` to compare both complete static graphs
with the same Node/zlib and gzip level 9. Include app modulepreloads/static
imports and linked CSS, and presentation static imports and optional stylesheet.
List lazy chunks separately and retain their lazy boundary. An entry-file size
alone is not a startup measurement.

[ADR 0007](../architecture/0007-scoped-ui-primitives.md) records the original
unchanged baseline and pilot accounting. Carry forward the pilot, ALL-525 and
ALL-521 costs; unrelated dev changes do not consume or free migration budget.
Record remeasurement pairs/toolchain and reconcile historical figures before
comparing final growth over the frozen current-dev baseline. The cumulative ceilings remain +50 KiB JS and
+15 KiB CSS **for each graph**; the pilot's separate ceiling remains +30/+10 KiB.
Excess requires optimization or explicit scope review.

`scripts/presentation-budget.mjs` extracts only committed generated artifacts
into temporary directories and runs the same current graph reader and Node/zlib
on every pair, without checking out or building another branch. Supply a
reviewed external JSON array of exactly three inherited pairs, with `ticket`,
`baseline` and `candidate` fields for ALL-520, ALL-525 and ALL-521. Add the final
selected range once through the command arguments:

```sh
node crates/nac-server/web/scripts/presentation-budget.mjs \
  --baseline 481ee248f755461c6bee9c274963cb30ccd6b0aa \
  --candidate FINAL_COMPOSITION_SHA \
  --stages /absolute/evidence/reviewed-inherited-pairs.json \
  --output /absolute/evidence/cumulative-budget.json
```

The receipt records full hashes/graphs, non-startup JavaScript inventory,
measurement-script hash, every exact pair, stage deltas and cumulative ceilings.
The command fails if the cumulative budget is exceeded. It cannot determine
whether a chosen historical pair includes unrelated source changes; reconcile
that choice with ADR 0007 and the original receipts rather than treating the
sum alone as proof. This is a size check, not a timing benchmark.

Final readiness also requires the exact code candidate's web types/lint/format/
tests/build, generated API and asset drift, source-size, production E2E and any
affected server checks, current-head CI/BugBot findings, one coordinator-supplied
bounded independent review and its affected repair verification, and accessible
matched captures. Report unavailable evidence separately from passes. Human
design acceptance, code-owner approval and merge remain separate.

Rollback pins the consumer to the recorded previous qualified tarball/integrity
and matching asset directory, then replaces/closes affected frontend runtimes
through the existing consumer lifecycle. A source rollback reverts the selected
slice and its unmerged code dependents to the verified predecessor under the
coordinator's history ownership. No data migration is required. Do not mix old
font/assets with new package bytes or claim a registry/deployment operation.

## Finite composed qualification cases

The harness defines 18 candidate cases with one worker and no automatic retry:
three existing packed/standalone font-style cases, three two-instance native
width cases, two actual tab-zoom cases (1440→720 and 390→195), one CSS-opt-in
case, one retired-response/timer/shortcut case, and eight composed cases
(standalone and installed packed consumer × 1440/768/390/195).

`presentation-composed.e2e.ts` uses the actual embedded production app for the
standalone path. The packed path installs the explicitly preserved root tarball;
its unrelated Right view and caller controls retain their original route and
unsent drafts while Left creates a Project/chat, receives scripted reasoning,
changes/cancels settings and MCP rows, inspects controlled managed readiness,
preserves a newer secret draft, cancels a controlled clone, and returns through
the actual inspector parent/child context. Delayed/denied/error cases record
request attempts separately from accepted operations. Managed/OAuth/clone
responses are controlled external boundaries, never live infrastructure or
producer identity. All model traffic targets the local ScriptedProvider.

The normal zoom helper's existing prepare-page callback is retained. Its optional
viewport argument creates the 390px context before actual `tabs.setZoom(2)`;
assertions verify `getZoom`, effective width195 and DPR2. No CSS zoom, fake DPR,
manual focus rescue, or narrower-container substitution establishes that result.

Before execution, the coordinator must freeze the final supplier/leaf source,
coherent normal outputs and exact default producer. Supply `NAC_E2E_BINARY` with
the preserved binary. The composed receipt compares real `/product-context`
build identity to the source HEAD (or an explicitly recorded
`NAC_QUALIFICATION_SOURCE_REVISION` contract), then records the actual package
SHA/integrity, peers, native viewport and sanitized request ledger. The mocked
managed status is never used as producer identity. Inert Playwright `--list` and
static/helper passes establish discovery/source readiness only.

Keep `KEEP_E2E=1`, unique `NAC_E2E_ARTIFACTS` and a distinct
`NAC_E2E_CLEANUP_ID`. Release held replies/provider gates in `finally`, close
zoom contexts and both native roots, stop proxy upstream requests/listeners,
and verify descendant processes/ports/streams and leases are gone. Preserve
original failed attempts and report unrun cases separately. These cases remain
UNQUALIFIED until admitted against the final actual artifact; no screenshot,
helper test or historical supplier pass changes that status.

The ALL-541 receiving contract remains Backlog and does not name an alternate
peer matrix. Qualify NAC's installed locked peers first, preserve exact tarball,
asset tree, receipts and rollback pin, and verify the eventual receiver's access.
An ArceeFM locked upgrade and signed deployed-host acceptance belong to ALL-541;
this harness does not implement or contact that product.

## Matched frontend capture cells

The strict runtime entry remains the same three files and 18 cases. A separate
`presentation-capture.e2e.ts` entry defines six candidate design cells, eight
aggregate baseline cells, six immediate-parent design baseline cells, or one
immediate-parent packed390 Settings-draft cell. These are capture observations,
not additional passing runtime qualification results. Together with runtime18,
the final plan has 39 cells; inert registration must show 18/6/8/6/1 separately.
The planned checkpoint inventory is 63 runtime images, six candidate design
images, 26 aggregate baseline attempts, six owning design baseline attempts and
one owning Settings baseline attempt: at most 102 unique checkpoint images and
33 matched comparisons. Framework failure
artifacts are retained separately. An unreachable baseline stays unmatched.

The aggregate label is D481ee→final; the owning label is repaired immediate
ALL-524→final. Aggregate cells capture launch pending, settings draft, managed
secret settlement and the selected inspector view at1440/768/390 in standalone
and installed packed form, plus settings at actual390→195 tab zoom in both.
The six owning design cells use real orchestration-enabled fresh harnesses.
Their common anchor is the existing Reasoning successor: actual Buttons on
baseline, actual QualificationSection on candidate. Runtime18 stays unchanged.
The separate `owning-527-modal-baseline` role requires purpose
`contained-settings` and orchestration0. It captures only packed390 Settings
draft on the final repaired ALL-524 package/frontend over the same final API.
It seeds the project/session/reading through the local fixture API, shares the
owned working folder, preserves the Right/host drafts, and uses the public
Settings controls, selected fields and Context limit focus of runtime18's
Settings-draft frame. It stops before Save. Reuse that existing final after
frame; do not run an additional candidate cell or baseline Rust producer.
Historical efb/d8 negative diagnostic frames have older Settings footer code
and cannot replace this immediate-parent comparison. The earlier v2 plan and
negative diagnostic evidence remain separate immutable records.

Set `NAC_PRESENTATION_BASELINE_MANIFEST` to a sealed JSON with `role`
(`aggregate-D`, `owning-527-baseline`, `owning-527-final` or
`owning-527-modal-baseline`), `frontendSource`,
`apiSource`, `apiBinarySha256`, and `package:{path,sha256,integrity}`. Baselines
also require `frontend:{directory,mapPath,mapSha256}` with the complete normal
frontend map using relative file keys and mode/size/SHA256 rows. Unknown or
changed assets abort; no final frontend fallback supplies a missing baseline.
Only the actual API bootstrap binding is injected into preserved HTML, with
its hash recorded separately from the baseline template. Package source and
frontend source never rename the independently verified final API source.
Keep `NAC_QUALIFICATION_SOURCE_REVISION` pinned to that API, not the baseline.

Use the same preserved `NAC_E2E_BINARY`, explicit tarball/SHA environment and
unique artifact/cleanup markers as the runtime lane. Run the new file with
`--grep 'capture-only aggregate-D '` (eight cells),
`--grep 'capture-only owning-527 baseline '` (six), or
`--grep 'capture-only owning-527 final '` (six). Use
`--grep 'capture-only owning-527 modal-baseline '` for the single packed390
Settings baseline with its explicit role/purpose manifest. Verify nonzero inert registration
before execution; file-prefixed Playwright titles preclude a start-anchored
filter. `NAC_PRESENTATION_MATCHED_WORKSPACE_ROOT` selects an exclusively owned,
canonical real fixture root shared sequentially across matched roles, keeping
the visible Git path identical. Its `.nac-all527-owned` regular marker must contain
that canonical root plus a newline. No screenshot path masking establishes parity.

Baseline captures use public controls and record erased newer drafts without
repairing the view. Inspector selection is labeled view-only; no old return
journey is claimed from a directly selected status view.
Whole viewport PNG dimensions, actual theme/zoom/fonts, ARIA and action traces
remain attached. ALL-541 receiver access, signed acceptance and the previous
actually qualified rollback artifact stay pending until their own evidence.
