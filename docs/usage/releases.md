# NAC releases

NAC is one product with two distribution tracks: beta and stable. `dev` is the
only active development branch. Verified `dev` commits may be published as
private beta images by the private managed-controller repository, while stable
releases are explicitly selected from `dev`. NAC does not have preview,
nightly, or standing release-candidate channels.

Stable releases require two separate maintainer decisions. First, a maintainer
explicitly runs **Prepare stable release** from the Actions page, selects
`dev`, and supplies the full commit SHA currently at the tip of `dev`. The
workflow rejects any other ref, abbreviated or mismatched SHA. After minting
the repository-scoped GitHub App token, it revalidates `dev` and pins the
selected commit to the internal `release-preparation-source` branch. Release
Please calculates and writes its one PR against that stable source. The
workflow retargets the PR to `dev` only while `dev` still names the selected
commit, and checks again afterward; if `dev` moved during finalization, the PR
returns to the internal source branch and the run fails closed. This
preparation mode cannot create a tag or GitHub Release. Ordinary pushes and
pull requests do not prepare releases. Closing the prepared PR also leaves it
closed: subsequent development does not recreate it until a maintainer
explicitly runs preparation again. The internal source branch is an
implementation detail, not a release channel.

Second, a maintainer reviews and merges that generated Release Please PR. Only
the merge of the same-repository
`release-please--branches--release-preparation-source--components--nac` branch
selects Release Please's publication mode, which cannot create another release
PR and creates the canonical `vX.Y.Z` tag and GitHub Release. The maintainer
never constructs or pushes the tag manually.

The repository-level `simple` strategy owns root
[`version.txt`](../../version.txt) and [`CHANGELOG.md`](../../CHANGELOG.md);
internal Cargo crate versions remain independent implementation metadata and
never appear in public protocol or provider identity. Root `version.txt` is
injected at build time into the server, shared MCP registration, and provider
user-agent surfaces. The separate `stable-release.yml` tag-push workflow tests
and packages the exact tagged source and uploads its binary archives to the
existing release. It fetches `origin/dev` and rejects a tag whose commit is not
an ancestor of that branch, even when its `version.txt` matches.

Before 1.0, `fix:` squash titles produce a patch, while `feat:` and breaking
changes produce a minor release. Pull requests should use Conventional
Commit-compatible squash titles such as `fix(store): reject future schemas` or
`feat(managed): report build identity`. A maintainer may use Release Please's
documented release override when history needs an explicit correction.

Release Please requires a narrowly installed GitHub App with repository-only
Contents, Pull requests, and Issues write access. Issues write access lets
Release Please maintain its `autorelease: pending` lifecycle label. The
repository variable `RELEASE_PLEASE_APP_ID` and secret
`RELEASE_PLEASE_APP_PRIVATE_KEY` provide its identity. Public NAC must not
receive a personal access token, AWS credential, or access to the private beta
publisher. GitHub only accepts `workflow_dispatch` for a workflow present on
the default branch. NAC's existing default branch is `dev`; the preparation
workflow therefore becomes available after this workflow change reaches
`dev`, without a default-branch transition.

The first rollout is an explicit transition between two distinct workflow
paths. Follow this order:

1. Merge the foundation PR into `dev`, making
   `.github/workflows/stable-release.yml` available on the release source
   branch. Do not install or enable Release Please first.
2. From a trusted checkout of that `dev` commit, run
   `.github/scripts/stable-release-rollout.sh --apply arcee-ai/nac` with an
   administrator-authenticated `gh`. The script verifies the new workflow file
   on `dev`, resolves its distinct Actions registration, and requires that
   registration to be `active` before it disables the legacy default-branch
   `release.yml`. It then reads the legacy workflow state back and requires
   `disabled_manually`.
3. Only after the script succeeds, install/configure the Release Please App.
   A maintainer may then explicitly run **Prepare stable release** for the
   first stable PR.

Disabling `release.yml` cannot disable the new publisher because
`stable-release.yml` has a different GitHub Actions workflow identity. The
checked-in release-policy test rejects reintroduction of the legacy path,
`release` events, schedules, or prerelease inputs. No default-branch transition
is assumed.

`nac-web upgrade --pre-release` is retained only as a command-line
compatibility parser and returns an explicit unsupported error. NAC does not
discover or install RC, nightly, preview, or other prerelease artifacts.

Beta image publication and its moving discovery alias remain entirely outside
this repository. This repository never publishes an image, and neither beta
publication nor a stable release restarts a managed host.
