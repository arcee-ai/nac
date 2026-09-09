# NAC releases

NAC is one product with two distribution tracks: beta and stable. `dev` is the
only active development branch. Verified `dev` commits may be published as
private beta images by the private managed-controller repository, while stable
releases are explicitly selected from `dev`. NAC does not have preview,
nightly, or standing release-candidate channels.

Stable release preparation uses one Release Please PR targeting `dev`. The
repository-level `simple` strategy owns root [`version.txt`](../../version.txt)
and [`CHANGELOG.md`](../../CHANGELOG.md); internal Cargo crate versions remain
independent implementation metadata. Merging the Release Please PR is the
human stable-release approval and creates the canonical `vX.Y.Z` tag and
GitHub Release. The release workflow tests and packages that exact source and
uploads its binary archives to the existing release. Publication runs only
from the tag-push workflow stored in that tagged commit. The workflow fetches
`origin/dev` and rejects a tag whose commit is not an ancestor of that branch,
even when its `version.txt` matches.

Before 1.0, `fix:` squash titles produce a patch, while `feat:` and breaking
changes produce a minor release. Pull requests should use Conventional
Commit-compatible squash titles such as `fix(store): reject future schemas` or
`feat(managed): report build identity`. A maintainer may use Release Please's
documented release override when history needs an explicit correction.

Release Please requires a narrowly installed GitHub App with repository-only
Contents and Pull requests write access. The repository variable
`RELEASE_PLEASE_APP_ID` and secret `RELEASE_PLEASE_APP_PRIVATE_KEY` provide its
identity. Public NAC must not receive a personal access token, AWS credential,
or access to the private beta publisher.

Until the repository default branch contains this tag-only publication
workflow, an administrator must disable the legacy default-branch Release
workflow before installing the App or approving the first stable Release
Please PR. This prevents a GitHub `release` event from running the obsolete
default-branch publication definition. Keep it disabled until the tag-only
workflow is also present on the default branch; do not treat a future default
branch transition as implicit.

`nac-web upgrade --pre-release` is retained only as a command-line
compatibility parser and returns an explicit unsupported error. NAC does not
discover or install RC, nightly, preview, or other prerelease artifacts.

Beta image publication and its moving discovery alias remain entirely outside
this repository. This repository never publishes an image, and neither beta
publication nor a stable release restarts a managed host.
