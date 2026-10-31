# Dependency and CI tool maintenance

Dependabot security updates are enabled for arcee-ai/nac in repository settings.
The October 22, 2026 REST readback reported `enabled: true, paused: false`;
`allow_auto_merge` remained false. Recheck with:

```sh
gh api repos/arcee-ai/nac/automated-security-fixes
gh api repos/arcee-ai/nac --jq '{default_branch,allow_auto_merge}'
```

`.github/dependabot.yml` schedules Monday 09:00 America/Los_Angeles version
updates for Cargo, the web and release-tooling npm roots, Actions and the managed
Dockerfile. Each ecosystem/root has at most two open routine PRs: compatible
minor/patch updates form one group; unmatched major upgrades remain individual
PRs for deliberate migration review. There is no major ignore rule. Three-day
cooldowns apply only to version updates. Security updates have GitHub's separate
fixed limit of ten, are not put in routine groups, and do not wait for cooldown
or the weekly version schedule. No `target-branch` is set because dev is default.
These are configured limits, not proof of observed hosted update jobs.

The same complete current-candidate checks and human policy apply to bot PRs.
Never enable auto-merge, approve on behalf of a human, use bypass credentials, or
skip drift/security/browser/image work to land an update. CODEOWNERS and the
metadata-only reviewer workflow use the canonical verified owner roster; one
eligible non-author approval is required once the foundation ruleset is active.
See [required checks and rollout](required-pr-checks.md) for the still-separate
platform qualification/activation and Allison's deliberate PR-only override.

## Repair an update PR

Fetch the bot PR into an isolated clean checkout based on its actual head/base;
read the release notes and generated diff. Do not replace an unrelated owner's
checkout. Run `make setup` initially and after either lockfile changes.

- Cargo: inspect the bot's manifest/lockfile diff and run affected locked crate
  tests, formatting and clippy. If a targeted repair is needed, use
  `cargo update -p PACKAGE --precise VERSION`, inspect the resulting lockfile,
  then validate with locked checks. `cargo update --locked` rejects a required
  lockfile change. A major migration needs explicit scope review; do not bundle
  unrelated runtime redesign.
- npm: use `npm --prefix crates/nac-server/web ci` and
  `npm --prefix .github/scripts ci`, preserving both locked graphs.
- API drift: run `make generate-api-contract`; inspect and commit the sole-writer
  outputs together with the source/lock change. Never edit generated TS manually.
- Web/client drift: run `npm --prefix crates/nac-server/web run build`; inspect
  and commit all affected `assets/dist` and web package `dist` outputs. Run
  `make test-assets`, web tests and `make test-e2e` with production assets.
- Docker base digests: inspect the upstream manifest and select the same
  linux/amd64 platform for every Wolfi `FROM`. The static image contract
  intentionally checks the reviewed exact base digest. Update its matching
  digest literal in `scripts/test-managed-image-contract.sh` in the same repair
  commit, then run `make test-managed-image-contract` and the full native managed
  build/smoke/inventory lane. A bot-only Dockerfile bump should fail until this
  deliberate contract repair; do not remove the pinned-base assertion.
- Run the relevant required local gates and full current-head PR CI. Push the
  repair to the authorized bot branch (or a replacement reviewed PR if policy
  prevents it); keep the source PR linked. Recheck head/base, automated feedback,
  designated review requests and human approval before any landing operation.

## Action revisions and scanner/lint downloads

Every executable external `uses:` is a full upstream commit SHA with a readable
version comment. Dependabot's Actions entry maintains supported release-tag pins;
review both the SHA and comment. For a proposed `OWNER/ACTION@VERSION`, resolve
`gh api repos/OWNER/ACTION/commits/VERSION --jq .sha`, inspect its `action.yml`
and release notes, and compare with the exact update diff. Keep runtime/toolchain
selection unchanged unless the update explicitly owns that change. In particular,
`dtolnay/rust-toolchain` uses generated `stable`/`1.98.0` revisions; verify those
upstream refs manually if Dependabot does not propose them. The fixed 1.98.0
revision embeds that version in its action code. Do not substitute a stable SHA.

Checkouts all use `persist-credentials: false`. Ordinary jobs have read-only
contents; release publishing alone has contents write, and release preparation
uses explicit repository-scoped App tokens. The metadata-only reviewer needs PR
write. CLA uses a separate cla-signatures-scoped App; its GITHUB_TOKEN retains
upstream-required actions/PR/status writes for rerun/comment/status behavior.
No update bot receives these publishing tokens or a ruleset bypass grant.

OSV pins/checksums live in `.github/scripts/install-osv-scanner.sh`; Syft/Grype
pins live in `scripts/security/image-tools.json`. Download the exact upstream
release asset and its published digest/checksum, compare before execution, and
update the version plus every supported platform digest together. Exercise the
installer and actual safe/vulnerable scanner qualification, including corrupt
checksum and scanner/infrastructure failures. Workflow/shell lint tool pins are
owned by the lint lane; preserve the same version+verified-digest discipline.

## Manual Node, Go and uv archives

Docker Dependabot maintains `FROM` references, not these ARG version/checksum
pairs in `docker/managed/Dockerfile`. A maintainer or authorized agent must open a
normal PR for them. PR #405 owns the separate uv CA incident bump; do not duplicate
that work. For each selected version, download into a fresh temporary directory:

```sh
# Replace VERSION with the reviewed release; these are linux/amd64 image assets.
curl --fail --location -o node.tar.xz https://nodejs.org/dist/vVERSION/node-vVERSION-linux-x64.tar.xz
curl --fail --location -o SHASUMS256.txt https://nodejs.org/dist/vVERSION/SHASUMS256.txt
# Compare the exact filename's published SHA256 with: shasum -a 256 node.tar.xz
curl --fail --location -o go.tar.gz https://go.dev/dl/goVERSION.linux-amd64.tar.gz
curl --fail --location -o go-downloads.json 'https://go.dev/dl/?mode=json&include=all'
# Find goVERSION.linux-amd64.tar.gz's sha256 in the official JSON, then hash it.
curl --fail --location -o uv.tar.gz https://github.com/astral-sh/uv/releases/download/VERSION/uv-x86_64-unknown-linux-gnu.tar.gz
curl --fail --location -o uv.sha256 https://github.com/astral-sh/uv/releases/download/VERSION/uv-x86_64-unknown-linux-gnu.tar.gz.sha256
# Compare upstream checksum (or GitHub release asset digest) with the local hash.
shasum -a 256 node.tar.xz go.tar.gz uv.tar.gz
```

Verify Node's signed SHASUMS against its published release keys when available;
for uv also inspect `gh api repos/astral-sh/uv/releases/tags/VERSION` asset
`digest`. Stop on a missing/mismatched digest; never copy a digest from an
unreviewed PR. Update NODE_VERSION/NODE_SHA256, GO_VERSION/GO_SHA256 or
UV_VERSION/UV_SHA256 atomically. Keep the Dockerfile's pre-execution `sha256sum
-c` checks. Update the static image version assertions in
`scripts/test-managed-image-contract.sh` and affected runtime-inventory fixtures;
Go upgrades also require inspecting the gh/LFS embedded Go identities. Do not
alter truthful source/build provenance to satisfy a scanner.

Run `make test-managed-image-contract`, image policy/inventory tests, native
`make managed-image` and `make test-managed-image`, then the exact-image inventory
and advisory qualification in required CI. Confirm installed versions from the
actual image. A local emulated build is not native acceptance. Image findings
and the Rust-toolchain coverage gap remain advisory/deferred under ALL-452/461;
scanner, missing evidence and infrastructure failures still fail. This procedure
does not claim to fix those gaps or authorize publication.

## Hosted acceptance after landing

Without merging this config, a hosted Dependabot version job cannot exercise it.
After normal human approval/landing, use Dependency graph → Dependabot → Recent
update jobs to inspect the parsed config and trigger each ecosystem/root. Retain
job and PR URLs for Cargo, both npm roots, an Action SHA and a base-image digest.
Verify group membership, individual majors, cap behavior and default eligible
review requests. For a real advisory, retain alert/PR timestamps proving prompt
security delivery without cooldown. Do not introduce vulnerabilities in NAC to
manufacture this evidence. On a web-changing update, retain rebuilt asset diffs,
`make test-assets`/browser results and the human-reviewed PR. Local policy tests
are regression controls; they do not substitute for these hosted observations.

References: [supported options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference),
[Action updates](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/auto-update-actions),
[security-update API](https://docs.github.com/en/rest/repos/repos#enable-dependabot-security-updates),
[Node release verification](https://github.com/nodejs/node#verifying-binaries),
[Go downloads](https://go.dev/dl/), [uv releases](https://github.com/astral-sh/uv/releases).
