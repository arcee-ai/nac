# Managed NAC v0 design notebook

Status: implementation-ready internal v0 contract  
Date: 2026-08-26  
Primary focus: changes and product decisions owned by NAC  

## Purpose

This document collects the current managed-NAC direction after the original
one-pager, the core-team discussion, and the ongoing Allison/Gerred design
conversation. It is intentionally more detailed than a one-pager. Its job is
to make the smallest coherent internal v0 concrete enough to build and
critique without implying that the first version is the eventual public
architecture.

The product mandate remains Lucas's deliberately narrow one:

> Put up something messy and basic that the team can hit and critique. The
> invariant is that someone can remotely log into a NAC instance and use it
> from a laptop or phone.

That means speed and an honest, understandable security boundary matter more
than solving every future multi-user, credential-broker, workspace-isolation,
or compute-density problem.

## How to read this document

Behavior described as v0 contract or settled behavior is approved product
direction. Items under external feasibility checks require platform,
infrastructure, or organization validation but are not invitations to redesign
the NAC behavior. Deferred items are explicitly outside v0. Reversible
mechanical details may be selected by the implementation owner only when they
preserve the stated behavior and security boundaries.

This document intentionally separates NAC product work from platform and
infrastructure work. NAC should not provision compute, implement Kubernetes
lifecycle, or own ingress merely because those systems host NAC. It does,
however, need clear contracts for the filesystem, execution backend,
credentials, and lifecycle behavior those systems expose.

## Executive summary

The settled v0 shape is:

- A user requests a persistent managed host. This is not a permanent
  one-host-per-employee entitlement, and a user may eventually be able to own
  more than one host.
- Each v0 host has one owner. Multiplayer hosts and per-action selection of a
  human credential are postponed.
- The host has a stable HTTPS URL and is reached through platform-owned gateway
  authentication. Existing platform SSO is preferred; a dedicated Google OAuth
  client is the fallback only if that contract cannot be reused.
- One logical host runs one primary NAC service with multiple ordinary NAC
  Projects and sessions.
- That service and its agent commands share one fixed non-root `linux/amd64`
  developer image at UID/GID `10001:10001`, with broad Python, Node, Rust, Go,
  Git/GitHub, shell, search, and native-build tooling but no `sudo` or nested
  container daemon.
- The host has a durable repository root, provisionally `/repositories`, and a
  durable NAC state/credential location plus persistent owner home.
- NAC offers a first-class **Connect GitHub** flow and an **Add repository**
  flow. It does not ask the user to manufacture and paste a PAT as the normal
  experience.
- The GitHub connection is a private GitHub App owned by and installed on the
  single `arcee-ai` organization for all of its repositories, using GitHub's
  device authorization flow. The resulting user token supports repository
  discovery and normal HTTPS Git clone/fetch/pull/push, but remains limited by
  the permissions of the individual user who authorized it.
- A successful clone creates an existing NAC Project whose canonical working
  directory is the cloned repository. “Workspace” is not introduced as a new
  persisted product concept for v0.
- NAC does not automatically create branches, worktrees, isolated checkouts,
  or task sandboxes as part of repository onboarding. Users and agents may use
  ordinary Git commands to manage those things.
- Generic secrets are stored locally to the managed host in NAC-owned durable
  state. Project-specific sharing policy and external systems such as Nango or
  Infisical are postponed.
- NAC state, GitHub authorization, generic secrets, Projects, sessions, and
  repositories survive process restart, pod/container restart, explicit
  stop/start, and expected node rescheduling. Logical host deletion is
  destructive.
- Platform/infra own host creation, stable routing, gateway authentication,
  compute lifecycle, durable volume attachment, and the host-scoped Arcee model
  credential.

Every newly spawned agent command receives every generic host secret, including
commands from child agents and separate orchestrator sessions. Names are not
proactively inserted into prompts, but an arbitrary-shell agent can enumerate,
read, and transmit them. V0 uses NAC's local backend in the same container and
Unix authority domain as the NAC service; this is deliberately one owner-wide
trust boundary rather than a sandbox between NAC and its agents.

## Compatibility requirement: managed onboarding is additive

Managed repository onboarding is an additive NAC capability, not a replacement
for existing Project creation. NAC must continue to run locally without a
GitHub App, a managed-host configuration, a platform login, or a conventional
repository root such as `/repositories`.

Users must remain able to create Projects through the existing NAC flow from
any supported local or SSH working directory. When GitHub integration is
configured, **Connect GitHub** and **Add repository** provide an optional
convenience path: NAC clones into a configurable default repository root and
then creates the same ordinary NAC Project used by the existing flow. Projects,
sessions, agents, permissions, and execution behavior must not acquire a
different downstream meaning based on whether the Project was created from an
existing directory or by NAC's managed clone flow.

Accordingly, missing managed-host or GitHub configuration should disable or
omit only the managed onboarding affordances. It must not prevent NAC from
starting, make the existing Project picker unusable, or silently constrain
Projects to the managed repository root.

## Product boundary and ownership

### NAC owns

- GitHub connection, status, reauthorization, and logout UX.
- Secure local persistence and refresh of the GitHub user authorization.
- Repository discovery, search, selection, branch selection, clone progress,
  clone validation, and Project creation.
- Git credential integration so ordinary command-line Git works without the
  user copying tokens into terminals or remotes.
- Git author identity setup or a clear first-use prompt.
- Host-local generic secret creation, replacement, listing without values, and
  deletion.
- The contract by which configured GitHub and generic credentials become
  usable in NAC-managed command execution.
- NAC Projects, sessions, transcripts, approvals, delegated work, compaction,
  and the broader harness functionality already being built on this branch.
- Managed-host readiness information that platform/infra can probe without
  learning secrets.
- User-facing errors for disconnected GitHub authorization, expired
  credentials, inaccessible repositories, failed clones, and unwritable
  storage.

### Platform and infrastructure own

- Requesting, creating, starting, stopping, deleting, and reporting the status
  of a logical managed host.
- Stable HTTPS routing to the logical host across compute replacement.
- Google SSO or another gateway authentication mechanism before traffic
  reaches NAC.
- Binding the authenticated platform user to the v0 host owner.
- Kubernetes, gVisor, VM, Firecracker, volume, image, and scheduling details.
- Durable volume provisioning and remounting.
- Supplying the configured NAC home/store path and repository root.
- Mounting the persistent NAC state, repository, and owner-home directories at
  the image-contract paths.
- Running the managed-NAC image with a stable runtime UID/GID and mounting the
  NAC state and repository paths writable by that identity.
- A revocable host-scoped credential for the Arcee hosted-model endpoint.
- Inference attribution, lifecycle traces, infrastructure metrics, and cost
  accounting.

### Shared contract

NAC and infra must explicitly agree on:

- The paths that are durable.
- Which user owns those paths and which command processes can access them.
- Which NAC `ExecutionBackend` is selected for managed Projects.
- How a command process obtains a current GitHub credential.
- How a command process obtains configured generic secrets.
- What survives each lifecycle event.
- What readiness means before the gateway sends a user to NAC.
- Which outbound destinations the command runtime may reach, including GitHub,
  the Arcee model endpoint, package registries, and ordinary development
  dependencies.

### Settled platform deployment shape

The internal v0 runs in `aws-dev-apps-01`. Curt has approved an
internet-facing ALB for Managed NAC there. The ALB and shared ingress/gateway
installation are infrastructure-as-code resources; individual NAC hosts are
dynamic resources and are not committed to Flux one by one.

Gerred's platform/controller boundary is:

1. A platform API creates or deletes a logical `NACInstance` custom resource.
2. A cluster controller reconciles that resource into one managed-NAC
   pod/container, one PVC, one Service, and the per-host Gateway API routing
   objects attached to the infrastructure-managed gateway.
3. The controller supplies owner identity, managed paths, runtime UID/GID,
   image reference, host-scoped model configuration, and lifecycle status.
4. Platform exposes request/start/stop/delete and the stable authenticated URL.
5. If the platform button is not ready for the first demonstration, manually
   creating the same custom resource is the accepted fallback. The custom
   resource and controller behavior, not the temporary manual action, remain
   the contract.

Whether the shared gateway implementation is Envoy Gateway or agentgateway,
and the exact non-wildcard versus wildcard hostname/certificate mechanics, are
infra implementation choices provided that each host receives stable HTTPS,
owner authentication, long-lived streaming support, and no client-controlled
identity-header trust. Platform SSO is preferred. A dedicated Google OAuth
client is needed only if the existing platform SSO cannot protect this route.

NAC publishes its image from the NAC repository. The NAC repository owns the
Dockerfile and image workflow; platform IaC owns the NAC-specific ECR
repositories and GitHub Actions OIDC role. Flux/controller configuration
consumes the published image by immutable digest. The expected NAC GitHub
`dev` environment inputs are `AWS_REGION`, `OIDC_ROLE_TO_ASSUME`,
`ECR_REPOSITORY`, and `ECR_CACHE_REPOSITORY`; exact values are provided by the
applied IaC rather than embedded in NAC source.

## Host identity and access model

### Settled v0: one owner per host

The earlier idea of a shareable host produced the hardest credential question:
whose GitHub identity should be injected when different people use the same
NAC? Solving that honestly requires per-request user identity, a credential
broker, and execution isolation tied to the active human. That is a reasonable
future architecture but not a reasonable v0 prerequisite.

V0 therefore has one owning user per managed host.

This does **not** mean every employee is automatically assigned exactly one
host forever. It means a requested host has one owner and one set of human
credentials. The owner may eventually request multiple hosts. Sharing a URL or
host credential with another person is not supported as a product behavior in
v0.

This simplifies the trust statement:

> A managed NAC host acts with its owner's configured repository and secret
> authority. Any coding agent that can execute arbitrary commands on the host
> may exercise that authority.

The platform gateway proves that the request belongs to the owner before it
reaches NAC. NAC does not need to grow a second multi-user authorization model
for v0.

### Settled v0: gateway authentication is separate from GitHub

There are two unrelated logins:

1. **Opening the host**: platform-owned gateway authentication bound to the
   declared host owner.
2. **Accessing repositories**: an explicit GitHub authorization owned by NAC.

Using Google SSO to open NAC does not grant GitHub repository access. Likewise,
the GitHub connection should not be treated as the ingress security mechanism.

### Deferred multiplayer shape

A future shared host probably needs credentials fetched for the active user
and delivered only to that user's actions, rather than one personal token
living in a shared command environment. That may justify a platform connector,
Nango/Infisical, or a custom credential broker. The v0 design should keep
credential use behind a small NAC-owned interface so local storage can later be
replaced, but it should not build that broker now.

## Existing NAC concepts

### Project is already the user-facing working-directory object

NAC already persists Projects. A Project has a name and description and points
at a canonical local or SSH working directory. Sessions belong to a Project.

There is not currently a separate persisted, user-facing Workspace object.
Internally, `workspace_cwd` is the execution directory for a session; it should
not be turned into a new managed-host product noun merely because other agent
systems use “workspace.”

For this v0, use the following vocabulary:

- **Managed host**: the persistent provisioned environment.
- **Repository checkout**: an ordinary directory under `/repositories`.
- **Project**: NAC's existing persisted object pointing at a checkout or other
  selected working directory.
- **Session**: a durable NAC conversation/execution history within a Project.

### Settled behavior: one normal clone creates one Project

The simplest integrated flow is:

1. Clone one repository into `/repositories/<destination>`.
2. Create one NAC Project pointing at the repository root.
3. Open the existing first-chat/New Chat experience for that Project.

The repository remains an ordinary Git repository. A user or agent can create
branches, worktrees, nested workspaces, or additional clones through Bash if
they want a more advanced layout.

## GitHub authentication

### Settled v0: `arcee-ai` private GitHub App plus device flow

The best combined user experience, security boundary, and engineering effort
is one private GitHub App owned by the `arcee-ai` organization and installed on
that same organization for all repositories, using GitHub's device flow. All
repositories needed by managed NAC are under this single organization, so an
enterprise-owned or cross-organization App is unnecessary.

The working App configuration and v0 permission contract are:

- Private visibility, restricted to the owning `arcee-ai` organization.
- Installation on `arcee-ai` with access to all repositories.
- Device flow enabled.
- Expiring user authorization tokens enabled.
- User authorization during installation disabled; NAC initiates device flow
  when the owner chooses **Connect GitHub**.
- Webhooks disabled for v0.
- Repository `Contents: read/write`.
- Repository `Pull requests: read/write` so agents can use PR APIs and `gh pr`
  normally.
- Repository `Workflows: write` so authenticated Git pushes may include changes
  under `.github/workflows`. Local editing and committing do not require this
  permission, but GitHub rejects a token-authenticated push that modifies
  workflow definitions unless the App has this additional permission.
- No broad organization-administration permissions.

The `arcee-ai` organization installation is already complete. Individual
managed NAC users authorize it but do not install a new App for every host.

GitHub App user tokens are limited to resources accessible to both the app and
the user. Installing the App for all `arcee-ai` repositories means the
installation side of that intersection includes the whole organization; it
does not elevate the authenticating user. The resulting token can act only on
repositories and operations that the individual user could access and that the
App permissions allow. It does not grant every managed NAC user access to every
`arcee-ai` repository, bypass branch protection or rulesets, or inherit access
to unrelated personal private repositories.

Relevant GitHub documentation:

- Device flow and user access tokens:
  https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- App permissions and HTTP Git:
  https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app
- Refreshing user access tokens:
  https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens
- SAML and GitHub Apps:
  https://docs.github.com/en/enterprise-cloud@latest/apps/using-github-apps/saml-and-github-apps

### Why device flow is the v0 sweet spot

The managed host has a browser UI but a unique, dynamic hostname. A normal
GitHub OAuth web flow requires a registered callback URL and a client secret.
A central platform callback could solve that, but it introduces a platform
token broker and cross-service delivery before the prototype needs one.

Device flow instead needs only the GitHub App client ID:

1. NAC requests a device and user code.
2. NAC opens GitHub's device page and displays the eight-character user code.
3. The user authorizes the private app in GitHub.
4. NAC polls at GitHub's required interval.
5. NAC receives an eight-hour user access token and a six-month refresh token.
6. NAC persists and rotates both automatically.

For credentials created through device flow, refreshing does not require the
GitHub App client secret. The app private key and client secret therefore do
not need to be present on every managed host.

NAC already has most of this lifecycle for its Arcee and Codex browser logins:
an asynchronous login registry, verification URL/code UI, page polling,
reload-safe completion, atomic credential persistence, refresh coordination,
revocation handling, and logout. GitHub should extend that managed-auth shape
rather than invent a parallel auth subsystem.

### Settled Connect GitHub experience

The first-run and Settings experiences should expose:

- Disconnected: **Connect GitHub**.
- Connecting: browser opened, code shown with a Copy action, expiration and
  Cancel available.
- Connected: GitHub avatar/login if available, connected organization, and
  **Disconnect**.
- Expired or revoked: a clear **Reconnect GitHub** action.
- Missing SAML authorization: a targeted link to start the Arcee GitHub SAML
  session and retry.
- App not installed for Arcee: a targeted administrative error rather than an
  empty repository picker.

The flow needs to work from a phone. The code must be easily selectable and
copyable, and the user must be able to return from the GitHub browser tab to
NAC without losing the pending login state.

### Token persistence and refresh

To avoid coupling this prototype to the separately unresolved NAC database
direction, GitHub authorization uses a dedicated versioned owner-only file
under `NAC_HOME` rather than a new SQLite schema. The behavioral contract is:

- Access and refresh tokens live in that explicit durable credential file, not
  in a repository `.env`.
- The stored value is never returned through the HTTP API after login.
- Listing auth state returns only provider, user, organization, expiry, and
  health metadata.
- Writes are atomic, reject symlink targets, and use owner-only permissions.
- Concurrent refresh is serialized across tasks and NAC processes sharing the
  same store.
- Refresh occurs shortly before expiry and may retry once after an
  authentication failure.
- Refresh-token rotation atomically replaces both tokens.
- Revocation or refresh expiry removes unusable local auth and asks the user to
  reconnect.
- Host deletion destroys the stored authorization with the volume.

### Repository authority boundary

The GitHub repository picker is a convenience and intent signal, not a security
boundary against arbitrary commands on the host. A GitHub App user token
normally permits the intersection of app-accessible and user-accessible
repositories. An agent with arbitrary shell access and the ability to perform
Git operations can potentially use that authority against another repository
in the same intersection.

GitHub's token exchange can restrict a user token to one `repository_id`, but
that conflicts with the desired “authenticate once, host multiple Projects”
experience. Strict per-host selected-repository scoping would require a later
broker that mints scoped installation credentials after checking the user's
access.

The recommended v0 boundary is therefore:

> A host may access `arcee-ai` repositories that its owner can access and that
> the private Managed NAC GitHub App can access. Installing the App for all
> organization repositories does not broaden the owner's underlying GitHub
> access.

### Command-line Git integration

The same GitHub App user authorization can drive normal HTTPS Git operations:

- `git clone`
- `git fetch`
- `git pull`
- `git push`

The v0 guarantee applies to HTTPS GitHub remotes. NAC does not automatically
rewrite SSH-form GitHub URLs in `.gitmodules` or existing repository
configuration, and special Git LFS behavior is not part of first-dogfood
acceptance. A repository that requires those paths may be repaired manually by
its owner or used to motivate a later deliberately scoped design; NAC does not
install surprising global `insteadOf` rules preemptively.

NAC should configure a Git credential helper scoped specifically to
`https://github.com`. When Git requests credentials, the helper obtains the
current access token through a narrow NAC credential interface, refreshing it
if required, and returns `x-access-token` as the username and the user token as
the password.

The token should not be embedded in remote URLs, Git configuration, command
arguments, or transcripts. The helper may make the credential less likely to
leak accidentally, but it cannot conceal repository authority from an
arbitrary-shell agent that is intentionally allowed to use it.

GitHub CLI uses the same GitHub App user access token produced by device flow.
For each newly spawned command, NAC refreshes that App token when required and
presents it to the `gh` executable through the environment-variable name
`GH_TOKEN`, which is the standard token-input interface understood by `gh`.
`GH_TOKEN` is not a separately created PAT and is not the repository-scoped
GitHub Actions `GITHUB_TOKEN`; it is only the delivery mechanism for the
current, user-scoped GitHub App token. The token is not exported into the NAC
server's global environment. A long-lived terminal keeps the token snapshot
with which it started; after rotation or revocation, the owner starts a fresh
command or terminal.

Git itself does not depend on the `GH_TOKEN` variable. Its credential helper
obtains the same current GitHub App user access token at credential-request
time, so ordinary HTTPS clone, fetch, pull, and push use the same authorization
without embedding the token in configuration or remotes.

### Managed-host Git permission defaults

The expanded direct-agent permission layer currently asks before most commands
on local and SSH backends. It pre-allows read-only Git operations such as
`status`, `diff`, `log`, and `show`, while operations such as `commit`, `push`,
`fetch`, `pull`, `switch`, and ordinary `checkout` require approval unless the
user remembers an appropriate grant. Hard safety policy separately blocks
destructive forms such as `git reset --hard` and `git checkout .`, as well as
raw file-tool mutation of `.git` metadata.

That is safe but may be noisy for a managed coding environment, particularly
from a phone. The integrated Add repository action is a direct user operation
and should not generate a model-tool approval. Agent-initiated Git commands
still pass through the normal permission broker.

V0 keeps the existing ask-on-first-use behavior and lets the owner choose the
existing remembered-grant option for normal Git subcommands. It does not add a
managed preallow profile or new permission semantics. This keeps authority
visible and preserves hard denials for destructive Git behavior. Dogfood may
later justify a separately reviewed default profile, but mobile convenience is
not sufficient reason to silently broaden shell authority in v0.

### Git commit identity

`git commit` does not authenticate to GitHub. It needs author name and email,
which are separate from clone/push credentials.

After GitHub connection, NAC configures a host-level default Git author. The
name comes from the public GitHub profile when present and otherwise the login.
The email defaults to GitHub's ID-plus-login noreply form, avoiding an
additional email-reading permission. Settings shows both values and allows the
owner to edit them. Ordinary repository-local Git configuration may override
the host default.

Commit signing is separate and should be deferred. Branch protection, required
reviews, and repository rules continue to apply normally to pushes.

### Disconnect, revocation, and organization SSO

**Disconnect GitHub** removes the stored access/refresh tokens and connection
metadata from this NAC host. It does not remotely revoke the user's GitHub App
authorization, because that grant may later be shared by another host owned by
the same user. The UI may link to GitHub's authorization settings, but remote
revocation is not bundled into the ordinary disconnect action in v0.

Existing checkouts and Projects remain after disconnect. Local Git work keeps
working, while fetch/pull/push, repository discovery, and `gh` operations fail
with a reconnect action until authorization is restored. Remote revocation is
detected on the next refresh or authorized request and produces the same
reconnect state.

When GitHub returns an organization SAML/SSO-specific failure or challenge,
NAC preserves local Project/repository state, shows a targeted Arcee GitHub SSO
message and authorization link when GitHub supplies one, and allows retry after
the user establishes the required session. NAC does not fall back to a PAT or
misreport the repository as nonexistent. Whether the current `arcee-ai` setup
actually exercises this path remains an external staging validation, not an
open NAC product decision.

## Repository onboarding and management

### Settled Add repository flow

The main Projects surface should include **Add repository**. The flow should:

1. Check GitHub connection health. If disconnected, lead directly into Connect
   GitHub and resume afterward.
2. List repositories accessible through the Arcee GitHub App user token.
3. Support search by repository name or `owner/name`.
4. Show private/public visibility and the owner's effective read/write
   permission.
5. Select a repository.
6. Preselect its default branch and allow selection of another existing branch.
7. Propose a safe destination beneath `/repositories`.
8. Let the user edit the NAC Project name and optionally its description.
9. Validate everything before changing disk or Project state.
10. Clone with visible progress and cancellation.
11. Create the Project only after clone success.
12. Navigate to the new Project's first-chat experience.

The clone API returns an operation identifier rather than requiring one browser
request to remain open for the entire transfer. Reopening the page recovers
live progress while the NAC process remains alive. Clone execution is not
restart-durable in v0. A restart marks the operation interrupted, removes only
staging state proven to belong to that operation, and permits a clean retry.

### Clone safety and idempotence

The implementation should borrow the useful invariants already demonstrated by
the `agentic_auxilary` reference-clone code without importing it:

- The configured repository root is canonicalized and enforced.
- A destination cannot escape the root through `..`, symlinks, or an absolute
  path.
- Concurrent clones to the same destination are serialized.
- A nonempty, non-Git destination is never overwritten.
- An existing Git repository is accepted only when its canonical remote
  identity matches the requested repository.
- SSH and HTTPS spellings of the same GitHub repository compare as one
  canonical identity where relevant.
- Authentication errors are redacted.
- A clone writes into a hidden operation-owned staging directory beneath the
  repository root. The operation records enough identity to prove ownership of
  that staging directory.
- Cancellation, failure, or startup reconciliation may remove only the staging
  directory proven to belong to that operation. No cleanup path deletes or
  empties a pre-existing destination.
- On success, NAC atomically renames the completed staging checkout to the
  validated destination on the same filesystem, then creates the Project. A
  final-destination collision fails rather than merging or overwriting.
- Project creation happens only after a usable checkout exists.

Destination defaults to a sanitized repository name under the configured root
and is editable before clone. If it already exists, NAC does not invent a
suffix, overwrite it, or guess that it is safe. The UI asks the user to choose
a different destination or use the existing ordinary Project-creation flow.
Concurrent operations reserve destinations so only one can publish.

### Settled ordinary clone and branch behavior

V0 preselects the repository's default branch and allows the owner to select
another existing branch. The checkout may use a normal branch-specific clone
or an ordinary clone followed by checkout; the observable result is an
ordinary checkout on the selected branch. NAC does not model branches as
durable objects and does not create a new branch during onboarding.

NAC should not automatically:

- Create a worktree for every Project or session.
- Create a branch per session or agent.
- Create multiple checkouts for parallel agents.
- Merge worktrees.
- Delete branches or worktrees.
- Invent a workspace-isolation product model.

The owner or agent may use `git switch`, `git worktree`, additional clones, or
their own preferred scripts. The existing `gwt-worktree` reference is evidence
that automatic worktree management quickly expands into control-repository
discovery, tracking-branch behavior, path confinement, post-create hooks,
freshness checks, cleanup, and garbage collection. That is useful context for
deferring it.

### Existing directories and imported Projects

The host may already contain repositories created through Bash or restored on
the persistent volume. NAC already supports creating a Project from a local
working directory. A small managed-host UX for registering an existing
directory would prevent the clone flow from becoming the only way to create a
Project.

V0 ships **Clone from GitHub** without adding a duplicate managed **Use existing
directory** action. The existing Project-creation flow remains available for
known local and SSH directories. A later browse/register-existing convenience
may be added after dogfood without changing the Project model.

### Project and repository deletion

Deleting a Project does not delete its repository checkout in v0. Project
deletion removes NAC metadata and sessions according to existing NAC behavior;
filesystem deletion is a separate destructive operation that is deferred.

Otherwise a user trying to remove a Project from the sidebar could destroy
uncommitted work. A later repository-management screen may add explicit
deletion with dirty-worktree detection and strong confirmation.

## Generic host secrets

### Settled v0 scope

Generic secrets live locally in each managed NAC host for v0. They are not
project-scoped and do not require Nango, Infisical, or a platform-wide
connector service.

This is an internal dogfood compromise with an explicit trust contract:

> The host owner and arbitrary-shell agents running on the host may be able to
> use or read every host-scoped secret.

That is acceptable only because v0 has one owner per host. It would not be an
acceptable unmodified model for a multiplayer host.

### Settled Secrets UI

Settings should have a host-level Secrets surface that can:

- Add a secret with a validated environment-variable-style name and value.
- List secret names and update timestamps without returning values.
- Replace a value without first revealing the old value.
- Delete a secret.
- Explain that secrets are host-scoped and usable by agents.
- Warn on reserved NAC/platform variables.
- Show whether the secret store is healthy and persistent.

Generic secrets use a separate versioned owner-only file under `NAC_HOME`, not
a new SQLite schema, repository `.env`, Git configuration, shell history,
command transcript, or broadly persisted home directory by accident.

### Settled v0 injection and inheritance contract

The entire owner-only managed host is one credential-sharing trust domain.
Every generic host secret is injected into every newly spawned NAC-managed
agent command. This includes commands initiated by direct agents, traditional
child agents, existing orchestrator workers, and separately launched
orchestrator sessions on the same host.

Secrets are not injected into the NAC web server's global environment, the
model-provider request process merely because it is part of NAC, gateway or
infrastructure components, readiness probes, or unrelated sidecars. GitHub
authorization and the platform-issued model credential remain dedicated
integrations with their own configuration and delivery paths.

Secret names are not automatically inserted into model prompts, system
instructions, skills, or a model-visible secret inventory. They are ordinary
environment-variable names inside an authorized command process. A shell-
capable agent can run `env`, inspect process state, print a value, encode it,
or transmit it. Keeping names out of prompts reduces incidental disclosure and
prompt clutter; it does not prevent discovery by an arbitrary-shell agent.

This is the explicit security boundary:

> Any arbitrary-shell agent on the owner-only host may deliberately read and
> transmit every configured generic host secret. Permission prompts and output
> redaction reduce accidental disclosure; they do not conceal secrets from an
> agent after shell authority is granted.

Project/session selection, per-agent secret ACLs, brokered on-demand access,
and different credentials for different humans are deferred.

### Settled environment construction mechanics

V0 uses these conservative defaults without making them product-level
customization:

- Names must match `[A-Za-z_][A-Za-z0-9_]*`.
- NAC rejects names that can alter execution or impersonate a dedicated
  integration. At minimum this includes `PATH`, `HOME`, `USER`, `LOGNAME`,
  `SHELL`, `PWD`, `OLDPWD`, `TMPDIR`, `SHLVL`, `BASH_ENV`, `ENV`,
  `GIT_ASKPASS`, `SSH_ASKPASS`, `GIT_CONFIG_*`, `LD_*`, `DYLD_*`, all
  `NAC_*`, `GH_*`, and `GITHUB_*` names, plus the exact names used for the
  platform-supplied model credential. The implementation may extend this
  fail-closed reserved set when an image/runtime variable is security-critical.
- For an allowed name, the persisted host secret overrides an inherited image
  value in newly spawned agent commands. Reserved names fail validation rather
  than being silently shadowed.
- Empty values are rejected. Multiline values are allowed and preserved
  exactly; they are never rendered back through the API or UI.
- The initial limits are 128 secrets, 32 KiB per UTF-8 value, and 128 KiB total
  encoded name/value data. Exceeding a limit fails before persistence or
  command spawn. These values may be tuned downward from platform evidence
  without changing the trust model.
- A command receives an immutable environment snapshot at spawn. Retained
  terminals and already-running children keep their old values. Replacement or
  deletion affects only later command spawns; the UI explains this and offers
  no claim of retroactive revocation.
- Replacing a secret is one atomic write. Deleting removes it from durable NAC
  state and future environments. Neither operation reveals the prior value.
- Persisted state is stored atomically in an owner-only, symlink-rejecting NAC
  credential location on the encrypted persistent volume. No value is placed
  in a repository `.env`, ordinary Git configuration, shell history, HTTP
  response, or telemetry field.
- NAC masks exact nonempty secret values in structured tool errors, events,
  model-bound command results, and application logs where it controls the
  rendering path. It never promises complete redaction of arbitrary terminal
  output, substrings, transformed/encoded values, files, network traffic, or
  third-party process logs. A deliberately authorized shell agent can always
  exfiltrate a secret.

Because v0 has no sibling command container, no cross-container secret
transport exists. NAC reads durable secret state and constructs the local
child-process environment immediately before spawn.

## Execution environment and isolation

### Product intent

From the user's perspective, the managed host is one persistent environment:
Projects, files, Git state, credentials, sessions, and agents all belong to the
same logical host. NAC should not provision separate compute for a Project or
session.

### Settled v0 execution contract: one local authority domain

NAC and agent commands run in the same basic container through NAC's existing
local execution backend, under the same Unix identity. V0 does not add a
sibling command service, an SSH server inside the pod, a separate command
container, or a privilege-switching bridge between Unix users. Gerred's later
clarification confirmed that his isolation discussion concerned the deferred
M:N users-to-NAC-sessions problem, not a required v0 container split.

This is an intentional owner-only dogfood trust boundary, not isolation:

- An arbitrary-shell agent can read every file and credential interface
  available to the runtime identity, inspect other same-user processes, alter
  host-owned configuration, consume host resources, and deliberately transmit
  credentials it can access.
- An arbitrary command may interfere with or kill the NAC service. For v0 this
  is treated as the owner damaging their own host, and recovery is a service or
  pod restart against the durable volume.
- Existing permission prompts remain authorization UX; they do not create an
  OS security boundary after arbitrary shell authority is granted.

The exact execution consequences are:

- Command spawn, cancellation, process-group handling, retained output, stdin,
  and terminal paging continue to use the existing local-backend machinery.
- Live process and retained-terminal handles remain process-local. NAC or pod
  restart may mark interrupted work truthfully, but does not resurrect the OS
  process or claim the terminal is still attached.
- Managed Projects execute directly in their ordinary persistent checkout.
  Managed configuration must not silently select the Podman backend or its
  automatic per-session worktree behavior.
- Git credential helpers and GitHub CLI wrappers run as the same identity and
  may call a narrow NAC-owned credential interface that performs refresh. The
  token is not placed in remotes, arguments, transcripts, or NAC's global
  environment merely because transport is local.
- Traditional child agents, orchestrator workers, and separately launched
  orchestrator sessions on the host use the same local backend and filesystem
  authority. Their secret inheritance is defined separately by the generic-
  secret contract, but no container boundary distinguishes them.

NAC must implement:

- Managed configuration that selects the local backend and persistent Project
  checkout without changing local/default/SSH Project behavior.
- Command-environment construction at spawn time, including the GitHub helper
  and the selected generic-secret contract.
- Existing cancellation, permission, retained-output, and interruption
  semantics without adding a second execution protocol.
- Readiness checks for the configured paths, Git/tool availability, and a safe
  local command probe.

Infrastructure must supply:

- One managed-NAC container per logical host, the stable runtime UID/GID, and
  writable durable mounts for NAC state and the configured repository root.
- An image containing NAC, Git, GitHub CLI, SSH client tooling, and the agreed
  development tools.
- The managed paths and local backend selection as explicit configuration.
- Pod security, resource, network-egress, and gVisor policy. Those controls may
  transparently constrain the whole container but do not require NAC to speak
  to a separate command runtime.

Credential-independent local tests can use temporary state/repository roots,
fake GitHub/token providers, fake host secrets, and the real local backend to
verify UID/path checks, environment snapshots, cancellation, retained output,
child/orchestrator inheritance, and restart reporting. One real staging host is
still required to validate mounted-volume UID/GID, gVisor behavior, process and
pod restart, outbound Git/model access, gateway streaming, and recovery after
an agent kills NAC.

### Existing Podman worktree behavior

Current NAC Podman sandbox execution may create a throwaway per-session Git
worktree. That conflicts with the managed-v0 direction of ordinary persistent
checkouts and no automatic worktree management if managed sessions select that
backend unchanged.

The managed-host backend selection is therefore explicit: managed Projects use
the local backend directly against the persistent checkout. The managed path
does not silently select Podman or create a per-session worktree. Existing
Podman behavior remains available to existing/non-managed NAC flows and is not
changed by this contract.

## Managed runtime image contract

### Image purpose and architecture

The Managed NAC image is both the NAC application image and the coding-agent
runtime. Commands do not escape to a sibling service, so a minimal distroless
application image would produce a remotely reachable NAC that cannot do useful
repository work.

V0 therefore ships one batteries-included `linux/amd64` image. It uses a
multi-stage build and a digest-pinned Debian/Ubuntu slim runtime base; it never
uses an unpinned `latest` base. The implementation may select the exact slim
release and supported toolchain patch versions, but records and pins them so
two builds of one source revision do not silently select different major
toolchains.

The runtime includes at least:

- Bash, coreutils, find/process utilities, tar, gzip/xz, zip/unzip, and a
  functional UTF-8 locale.
- Git, GitHub CLI, OpenSSH client, CA certificates, curl, jq, ripgrep, fd, and
  rsync.
- Native build basics: compiler/binutils, `make`, `pkg-config`, CMake, and
  common TLS development headers.
- Python with venv/pip support and `uv`.
- The supported Node.js LTS line with npm and Corepack.
- A pinned Rust stable toolchain with Cargo, rustfmt, and Clippy.
- A pinned supported Go toolchain.

Java, .NET, Ruby, GPU toolchains, Docker/Podman daemons, Firecracker, and
repository-specific dependency stacks are not promised by v0. Dogfood evidence
may add another broadly useful tool; repository-specific dependencies should
normally be installed into the repository or persistent owner home rather than
turning the base image into every Arcee project at once.

### Runtime identity and mutability

The image defines a normal `nac` user and group at numeric UID/GID
`10001:10001`, with `/bin/bash` and `HOME=/home/nac`. NAC and every agent
command run as that same identity. The image contains no `sudo` path and the
pod does not grant privilege escalation or additional Linux capabilities.

This is a fixed non-root environment, not a dynamically mutable VM. The owner
and agents may install Python, Node, Rust, Go, and other user-level tools into
the persistent home or a repository environment. They cannot use `apt` to add
system packages at runtime. A missing system dependency is resolved by an
image iteration, which is acceptable for internal v0 and preserves a
reproducible starting environment.

Infra should run the root filesystem read-only where the selected toolchains
permit it. Writable state is limited to the PVC mounts plus ephemeral `/tmp`
and `/run/nac` volumes. This does not protect the owner's durable data from an
arbitrary-shell agent; it limits accidental mutation of the published image.

### Persistent and ephemeral paths

One logical host's PVC provides three durable subpaths, all owned by
`10001:10001`:

| Container path | Durable contents |
| --- | --- |
| `/var/lib/nac` | SQLite store, NAC configuration, managed auth, GitHub tokens, and generic secrets. |
| `/repositories` | Managed repository checkouts and any owner-created repository layout. |
| `/home/nac` | Host-level Git identity/configuration, user-installed tools, language caches, and ordinary owner home state. |

`/tmp` and `/run/nac` are writable ephemeral volumes and do not survive pod
replacement. Credential material that must survive is never stored only in
those paths. The controller or a narrowly scoped init container creates and
owns the PVC subdirectories before starting the non-root application; the NAC
entrypoint validates them and fails readiness rather than attempting root-level
repair.

### Controller-to-NAC bootstrap configuration

The managed container starts with `HOME=/home/nac` and
`NAC_HOME=/var/lib/nac`. The controller supplies an exact
`NAC_ALLOWED_HOSTS` value for the stable per-host DNS name; it does not use `*`
to bypass NAC's Host-header/rebinding guard.

Nonsecret managed metadata is mounted in a read-only, versioned configuration
document such as `/etc/nac/managed.toml`. It includes managed mode, logical host
ID, owner display identifier when needed by the UI, public hostname,
repository/home/state roots, GitHub App client ID, model endpoint, and the path
of the model credential file. Exact field/type names are implementation detail,
but missing or internally inconsistent required fields fail readiness without
affecting an ordinary non-managed NAC launch.

The host-scoped model credential is mounted separately as an owner-readable,
read-only Kubernetes Secret file, not as `ARCEE_API_KEY` in NAC's global
environment and not in generic host secrets. NAC's provider seam reads that
file for model requests and never adds the credential to agent command
environments. The exact mount path and rotation/reload behavior remain part of
the Scott/platform feasibility contract. GitHub's App client ID is nonsecret;
GitHub user and refresh tokens remain NAC-owned durable state under `NAC_HOME`.

### Entrypoint, signals, and probes

The container uses a small init such as `tini` as PID 1 for signal forwarding
and zombie reaping, then starts the application equivalent to:

```text
nac-web \
  --bind 0.0.0.0:3210 \
  --allow-remote \
  --no-open \
  --store-path /var/lib/nac/nac.db \
  --directory /repositories \
  --yes
```

The exact argument source may be an entrypoint script or controller-provided
arguments, but the observable contract is fixed. The image exposes TCP 3210,
does not open a local browser, and refuses to report ready if the durable paths
or local execution probe are unusable.

`GET /healthz` is a credential-free liveness check that proves the server event
loop is responsive. `GET /readyz` implements the managed readiness contract:
store open/migration complete, durable paths canonical and writable as UID
10001, required Git/runtime tools present, managed configuration structurally
valid, and a safe local-backend command probe successful. GitHub connection and
generic-secret presence are status fields, not readiness requirements.

On SIGTERM, NAC stops accepting new work, cancels or marks active runs using
its existing interruption contract, flushes durable state, and exits within
the controller's termination grace period. SIGKILL and node loss still follow
the documented recovery behavior; the image does not claim that OS processes
survive.

### Build, publication, and smoke contract

The NAC repository contains the Dockerfile and image workflow. The workflow
uses the existing RC Eval publication pattern where applicable:

- Pull requests and ordinary CI build the image and smoke-test it without
  pushing or requiring AWS credentials.
- `workflow_dispatch` can build a selected branch/ref and publish to the GitHub
  `dev` environment. This is the normal pre-merge dogfood path and avoids
  requiring local AWS credentials.
- Publication targets only `linux/amd64` for v0 and uses the platform-provided
  OIDC role, ECR repository, and registry cache.
- Tags are immutable and include the GitHub run/attempt and full source SHA.
  The workflow emits the resulting image digest; no `latest` or moving `dev`
  tag is a deployment input.
- The controller/CR pins the image digest (or an immutable SHA-derived tag plus
  verified digest). First-dogfood acceptance uses one selected digest; managed
  multi-version rollout and rollback behavior is deferred with the database-
  migration contract below.
- BuildKit registry caching, provenance, and an SBOM are enabled. ECR scanning
  and retention policy remain platform-IaC responsibilities.
- Validation runs the normal NAC gates before publication. The container smoke
  mounts temporary directories at all three persistent paths, waits for
  `/readyz`, verifies the embedded UI, creates/executes one safe local command,
  sends SIGTERM, and requires clean exit within the grace interval.

A developer may build and smoke the image locally without AWS access. Manual
local ECR pushes and long-lived AWS credentials are emergency procedures, not
part of the normal v0 contract.

## Persistence and lifecycle

### Settled lifecycle scope

The logical host, not the current pod, owns persistent identity. Infra should
mount durable storage containing at least:

- NAC's database/store and configuration.
- Managed OAuth/GitHub auth state.
- Generic host secrets.
- The repository root.
- Any host-level Git configuration needed for credentials and commit identity.
- The owner home containing user-level tool installations and ordinary coding
  configuration.

The lifecycle contract is:

| Event | Expected v0 result |
| --- | --- |
| NAC process restart | Projects, sessions, repositories, GitHub authorization, generic secrets, Git identity, and persistent home survive. Running commands are interrupted and reported truthfully; retained terminal handles are lost. |
| Container/pod restart | The same durable state and owner home return from the PVC. Live OS processes, `/tmp`, `/run/nac`, and terminals do not survive. |
| Explicit stop/start | Compute stops; volume and stable URL identity remain; start remounts and resumes. |
| Node failure/rescheduling | A new pod remounts the same PVC and logical host identity. Readiness fails rather than presenting an empty replacement host if that volume is unavailable. |
| Logical host deletion | After explicit confirmation, platform removes routing and compute, revokes the host model credential, and deletes the PVC containing NAC state, GitHub tokens, generic secrets, Projects, sessions, Git configuration, owner home, and repositories. Status remains deleting until cleanup completes. |
| Lost/corrupt volume | Recovery is not guaranteed in v0. |

Backups, snapshots, point-in-time recovery, migration between regions, and
recreation after logical deletion are deferred.

### Live process behavior

NAC can durably preserve sessions and report interrupted runs, but an arbitrary
terminal or development server is not automatically restart-durable. The UI
should not imply that every live process survives pod replacement merely
because files and sessions do.

The managed-host lifecycle should distinguish:

- Durable NAC/session/repository state.
- Process-local retained terminals and background commands.

This branch already has explicit restart-loss behavior for retained terminal
handles; managed-host UX should preserve that honesty.

### Explicitly deferred: managed upgrades and database migration policy

Multi-version managed image rollout, automatic rollback, SQLite migration
compatibility, and the broader NAC development-versus-production database
strategy are deferred for a separate design pass. Current NAC stores reject a
future schema when opened by an older binary, so choosing a rollback policy
casually would be misleading.

The first implementation slice therefore:

- Targets a fresh managed host pinned to one immutable image digest.
- Tests process/pod/stop-start/rescheduling with that same image version only.
- Uses the explicit `/var/lib/nac/nac.db` store path, isolating the managed host
  from local development and installed-production databases.
- Adds no Managed-NAC-specific SQLite migration. GitHub auth and generic
  secrets use versioned owner-only files under `NAC_HOME`; clone operation
  recovery uses operation-owned filesystem markers; Projects and sessions use
  the existing store schema.
- Does not treat `nac-web upgrade` or an in-place binary replacement as a
  managed-host workflow. Whether managed mode explicitly disables that CLI and
  how controller-driven upgrades behave are part of the deferred pass.

If implementation proves that a new SQLite migration is unavoidable for the
settled v0 behavior, work stops at that boundary and returns to human design
instead of silently defining rollout, downgrade, or recovery policy.

## Arcee model setup

Model access should be platform-owned rather than configured through the
generic Secrets UI.

At provisioning time, infra/platform should:

- Issue a revocable host-scoped model credential.
- Configure the intended Arcee hosted endpoint.
- Make at least one approved model immediately selectable or preselected.
- Attribute inference usage to the host credential.
- Rotate or revoke the credential without depending only on a NAC-reported
  UUID.

The first-run NAC experience should show hosted-model readiness but should not
ask the user to paste an Arcee API key.

V0 uses a generic managed-provider configuration seam rather than adding a
second interactive auth product. Infra may initialize NAC's existing Arcee
provider/auth configuration with the host-scoped credential so long as the
credential remains write-only, is not returned by NAC APIs/UI, and can be
rotated on disk/configuration without using the generic Secrets surface.
NAC's existing optional Arcee and Codex device-login experiences remain
available to users; managed provisioning does not remove or replace them.
Scott/platform must still define the issuance, rotation, revocation, and usage-
attribution contract for the default host credential.

## Settled end-to-end user journey

### Provisioning and first open

1. User requests a managed NAC host from the platform.
2. Platform creates the logical host, durable volume, owner binding, stable
   URL, gateway route, and host-scoped model credential.
3. Infra starts NAC with configured persistent paths and repository root.
4. Readiness confirms the NAC store and repository root are usable.
5. User opens the stable URL and passes Google SSO at the gateway.
6. NAC lands on a lightweight managed-host welcome state.

### First-run NAC state

The Projects empty state communicates three things without becoming a blocking
wizard:

- **Arcee model: Ready**
- **GitHub: Not connected — Connect GitHub**
- **Projects: None — Add repository**

Connect GitHub remains optional until the owner selects **Add repository** (and
is also available from Settings). The owner can create/register a Project
through existing NAC behavior without completing GitHub setup.

### Connect and clone

1. Owner chooses Connect GitHub.
2. NAC opens GitHub device authorization and shows the code.
3. After authorization, NAC displays the connected GitHub identity.
4. Owner chooses Add repository.
5. NAC lists accessible Arcee repositories.
6. Owner selects repository, branch, destination, and Project name.
7. NAC clones with visible progress.
8. NAC creates the Project and opens the first chat.

### Normal use

- Multiple Projects live on the same host.
- Multiple sessions and delegated NAC agents may run within one NAC service.
- Agent Git commands work through the managed credential helper.
- Every host-scoped generic secret is present in every newly spawned agent
  command according to the settled owner-wide trust contract.
- Ordinary branch and worktree management is left to the owner and agents.
- Stop/start preserves state; delete is destructive.

## NAC UI and UX surfaces

### Projects screen

- Primary **Add repository** action.
- Existing Project creation remains available.
- Repository/Project cards should distinguish checkout path from Project name.
- Git status may be useful but is not required to prove v0.
- The destructive-looking action is labeled **Remove Project**, not **Delete
  repository**, and its confirmation states the exact checkout path and that
  files there will be preserved.

### GitHub settings

- Connection state and GitHub identity.
- Connect, reconnect, and disconnect actions.
- Token expiry should generally be handled automatically rather than shown as
  a countdown.
- Targeted SAML, app-installation, permission, and revocation errors.
- No token reveal action.

### Secrets settings

- Write-only value management.
- Clear host-scoped trust warning.
- Reserved-name and invalid-name errors before saving.
- No plaintext reveal or download-all operation in v0.

### Managed-host status

Managed mode shows a compact, nonblocking readiness/status surface on the
Projects empty state and in Settings. It may use read-only metadata supplied by
environment/configuration:

- Logical host name or ID.
- Managed versus local NAC indicator.
- Repository root.
- Model readiness.
- GitHub connection health.
- Secret count, without names if the page does not need them.

The status surface does not become a platform dashboard. Compute
start/stop/delete controls remain on the platform unless there is a deliberate
later decision to embed platform controls in NAC.

### Mobile considerations

The explicit success condition includes phone access, so the v0 should verify:

- Gateway login works in a mobile browser.
- The GitHub device code is readable and copyable.
- Returning from GitHub does not lose pending state.
- Repository search and branch selection are usable without hover behavior.
- Clone progress and errors do not require a desktop-width modal.
- Project/session navigation remains usable on the existing responsive layout.

## Readiness, health, and observability

`/healthz` proves only that the server event loop responds. `/readyz` verifies,
without exposing credentials:

- NAC can open and migrate its store.
- `/var/lib/nac`, `/repositories`, and `/home/nac` exist, are canonical, have
  the expected ownership, and are writable by `10001:10001`.
- The required runtime tool inventory and expected major-version lines are
  present.
- The configured model backend is structurally present. Readiness does not make
  a billable/flaky active model request.
- The command execution backend can perform a safe probe.

GitHub connection and generic secrets should be user-visible status, not hard
readiness requirements: a new host must be openable before GitHub is connected.

Managed-host telemetry from NAC includes:

- Version and schema version.
- Logical NAC/host UUID supplied by infra.
- Project and session counts.
- Run status and aggregate lifecycle events.
- GitHub connected/disconnected/reauth-required state without identity or
  token details in general infrastructure metrics.
- Clone start/success/failure timing with repository identity treated according
  to internal telemetry policy.

Model usage attribution should remain based on the platform-issued host
credential rather than trusting NAC telemetry as the billing source of truth.

## Explicit v0 non-goals

- Multiplayer managed hosts.
- Per-human authorization inside one NAC host.
- Dynamically selecting credentials based on the person currently viewing a
  shared host.
- Platform-wide generic secrets or connected-account management.
- Nango or Infisical integration.
- Per-Project secret ACLs.
- Strict per-selected-repository credentials.
- Automatic worktree creation, merging, cleanup, or workspace isolation.
- Compute provisioning from NAC.
- Per-session pods, VMs, or Firecracker guests created by NAC.
- Backups and disaster recovery.
- Suspend/resume density optimization.
- Repository filesystem deletion through ordinary Project removal.
- Commit signing setup.
- Automatic GitHub SSH-URL rewriting and special Git LFS support.
- Managed multi-version image rollout, automatic rollback, in-place binary
  upgrade, and a final database-migration/downgrade policy.
- A desktop or native mobile client.
- External-customer authentication and tenancy semantics.

## Remaining NAC decisions

No unresolved NAC product decision above blocks implementation. Mechanical UI
placement, operation-record schemas, exact reserved-name expansion, and
readiness response encoding are deliberately left to the implementation owner
within the behavioral contracts in this document. External feasibility checks
are listed separately below.

### Deferred beyond v0

- Strict per-repository credential brokering.
- Multi-user hosts.
- Project-scoped secrets.
- Repository deletion UX.
- Automated worktrees.
- Backups.
- Idle shutdown preferences.
- External customer login.
- Platform-embedded lifecycle controls inside NAC.
- Git commit signing.
- GitHub SSH-form submodule and Git LFS integration.
- Managed image upgrade/rollback and database migration compatibility.
- General connected-account integrations.

## External feasibility checks and platform handoff

These checks do not reopen NAC product decisions. They block a complete real-
host demonstration only where noted; all NAC behavior can be implemented and
tested first with local doubles.

### Already complete

- Curt approved an internet-facing ALB for Managed NAC in
  `aws-dev-apps-01`.
- The private Managed NAC GitHub App exists, is installed for all repositories
  in the single `arcee-ai` organization, and has device flow working.
- The intended App permission set is Contents read/write, Pull Requests
  read/write, and Workflows write. Individual authorization remains scoped to
  the authenticating user's access.
- NAC and agent command execution use one container/local backend for v0; no
  sibling command service is required from infra.

### Exact questions for Gerred/platform

1. Confirm the gateway-auth contract: will existing platform SSO protect each
   stable NAC URL and bind it to the one declared owner? If not, who creates the
   dedicated Google OAuth client and what single shared callback URL will it
   use? Confirm SSE/WebSocket support, trusted identity-header replacement,
   secure cookies, same-origin behavior, and CSRF expectations.
2. Confirm the controller contract and ownership: does platform create/delete
   the `NACInstance` CR while the cluster controller owns the pod, PVC,
   Service, per-host Gateway API route, readiness/status, stop/start, finalizer,
   and destructive cleanup? Confirm manual CR creation remains the demo
   fallback, not a different architecture.
3. Confirm the concrete storage/runtime contract: one PVC supplies durable
   subpaths at `/var/lib/nac`, `/repositories`, and `/home/nac`, owned by
   `10001:10001`; `/tmp` and `/run/nac` are ephemeral writable volumes. Provide
   encrypted `ReadWriteOnce` storage, initial capacity, the `gp3` StorageClass
   name in `aws-dev-apps-01`, same-PVC rescheduling, and reclaim/finalizer
   behavior that prevents platform from reporting deletion complete while the
   PVC still exists.
4. Provide the image-publication contract: create/apply the NAC-specific ECR
   repositories and GitHub Actions OIDC role, configure the NAC repository's
   `dev` environment values for `AWS_REGION`, `OIDC_ROLE_TO_ASSUME`,
   `ECR_REPOSITORY`, and `ECR_CACHE_REPOSITORY`, confirm `arcee-flux-read` can
   consume NAC. Confirm `workflow_dispatch` from a selected branch may publish
   immutable SHA/run tags to dev ECR and expose the resulting digest to the
   controller.
5. Confirm the runtime/network contract: non-root `10001:10001`, no privilege
   escalation or added capabilities, read-only root filesystem where practical,
   gVisor, port 3210, `/healthz`, `/readyz`, SIGTERM grace period, exact hostname
   and certificate strategy, gateway/ALB health behavior, and allowed egress
   for GitHub, model endpoints, and package registries. Gerred may choose
   reversible dogfood CPU/memory requests and limits plus bounded ephemeral-
   volume sizes, but must provide them before staging.
6. Coordinate the host-scoped Arcee credential contract with Scott: issuance,
   rotation, revocation on host deletion, usage attribution, the exact NAC
   configuration seam, and whether restart rereads rotated configuration or
   requires a controlled service restart.

### GitHub organization validation

No new App, PAT, app private key, client secret, callback URL, or per-host App
installation is required. Device flow needs the existing App client ID. On one
real staging host, validate that an `arcee-ai` member can establish any required
active SAML session, enumerate only repositories that user may access, push a
branch containing a safe `.github/workflows` change in a disposable test
repository, and use `gh` to open or inspect a pull request. Failures here are
organizational feasibility/error-path evidence, not reasons to silently broaden
the App or fall back to a PAT.

### External blockers to a real staging journey

- Applied NAC ECR repositories/OIDC role and the four NAC GitHub environment
  values.
- A controller-consumable NAC image reference and Flux read access.
- Confirmed `gp3` PVC, the three durable mounts, stable `10001:10001` identity,
  encrypted `ReadWriteOnce` capacity, and ephemeral temp/run volumes.
- Controller delivery of the versioned managed config, exact
  `NAC_ALLOWED_HOSTS`, GitHub App client ID, and read-only model-credential
  file path.
- Dogfood CPU/memory and ephemeral-volume sizing plus the termination grace
  period.
- Working gateway route and owner authentication, or the explicitly chosen
  Google OAuth fallback.
- The revocable host-scoped Arcee model credential contract.
- A working `NACInstance` reconciliation path; manual CR creation is sufficient
  for the first demonstration if the platform button is late.

## Implementation handoff

### Scope

- Add optional managed-host configuration without changing default/local NAC.
- Extend NAC's existing managed-auth lifecycle with the Managed NAC GitHub App
  device flow, refresh, disconnect, repository API access, Git helper, and `gh`
  delivery.
- Add durable host-local generic-secret storage and command-spawn injection.
- Add safe repository/branch discovery and clone-to-ordinary-Project
  onboarding under a configurable repository root.
- Add the minimal Projects/Settings/readiness UI and mobile behavior described
  above.
- Add the fixed non-root batteries-included NAC image, local smoke contract,
  and GitHub Actions publication workflow that consumes platform-provided
  OIDC/ECR configuration.

### Non-goals

- No compute, Kubernetes, gateway, or platform lifecycle implementation in
  NAC.
- No multiplayer host, per-viewer credential selection, Project-scoped
  secrets, external secret broker, or strict selected-repository token broker.
- No new workspace object, automatic branch, worktree, checkout, sibling
  command container, or per-session isolation.
- No runtime `sudo`, root package installation, nested Docker/Podman daemon,
  devcontainer composition, or repository-specific image generation.
- No automatic rewriting of GitHub SSH remotes/submodules, special Git LFS
  integration, managed multi-version rollout/rollback, in-place self-upgrade,
  or new Managed-NAC-specific SQLite migration.
- No repository deletion through Project removal, backups, disaster recovery,
  commit signing, or restart-durable OS processes.
- No redesign of existing NAC Projects, orchestrator behavior, SSH/local/
  Podman flows, or the broader permission system.
- No direct-agent `web_search`/`web_fetch` permission design; only the generic
  configuration/credential seams needed by other work.

### Behavioral contracts

- Missing managed/GitHub configuration leaves existing NAC fully usable.
- One logical host has one owner, one NAC service, and multiple ordinary
  Projects/sessions.
- Managed commands use the local backend and same Unix authority domain.
- The runtime is one `linux/amd64` non-root developer image at UID/GID
  `10001:10001`, with broad Python/Node/Rust/Go and standard coding tools,
  persistent NAC/repository/home mounts, and no runtime system-package install.
- GitHub device flow yields the App's user access/refresh tokens. NAC refreshes
  them; HTTPS Git uses a scoped refreshing credential helper and `gh` receives
  the same current App token through its standard `GH_TOKEN` input. SSH-form
  submodule rewriting and special Git LFS support are deferred.
- Clone selects an existing branch, writes only to an operation-owned staging
  directory, atomically publishes to an unused destination, and creates the
  ordinary Project last.
- Every generic host secret is injected into every newly spawned agent command
  across direct, child, worker, and child-orchestrator execution. Running
  processes retain their old snapshot. Names are not placed in prompts.
- Ask-on-first-use and remembered grants remain the Git command authorization
  behavior. Hard denials remain unchanged.
- Removing a Project preserves its checkout. Logical-host deletion destroys
  the PVC and revokes the host model credential.
- Durable state survives process restart, pod restart, stop/start, and
  same-volume rescheduling. Live OS processes and retained-terminal handles do
  not.

### NAC/infra boundary

NAC owns application credentials, Project/repository onboarding, command-
environment construction, local execution behavior, readiness checks, and
managed UI. Infra owns the logical-host CR/controller, image registry and
deployment, stable routing and owner authentication, pod/container policy,
PVC lifecycle, stable UID/GID, egress, and model credential. Neither side
quietly implements the other's lifecycle responsibilities.

### Dependency-ordered implementation packages

Use one integration owner for persisted file formats, generated frontend
assets, and final verification. Read-only research/review may run in parallel.
This slice does not introduce a new SQLite migration.

1. **Managed configuration and credential seams**: optional managed-host
   configuration document, `NAC_HOME`, exact allowed-host configuration,
   repository/home/state roots, logical host metadata, GitHub client ID,
   file-backed model-provider credential interface, owner-only versioned auth/
   secret files, redaction hooks, and test doubles.
2. **Command environment construction**: one spawn-time builder shared by
   direct agents, child agents, workers, and launched orchestrators; protected
   names; secret snapshots; current GitHub App token delivery to `gh`.
3. **Generic secrets**: durable CRUD, validation/limits/reserved names, UI/API
   write-only semantics, restart behavior, and structured-output redaction.
4. **GitHub managed auth**: device login, polling, persistence, serialized
   refresh rotation, reconnect/disconnect, identity metadata, SAML/revocation
   errors, repository/branch discovery, credential helper, and Git identity.
5. **Repository operations**: canonical root confinement, destination
   reservation, operation-owned staging, cancellation/startup cleanup, atomic
   publish, Project-last transaction, progress API, and local/SSH compatibility
   regressions.
6. **Managed UI and readiness**: Projects empty-state onboarding, Settings
   panels, compact host status, mobile device/branch/clone flows, removal
   wording, and credential-free readiness.
7. **Image and delivery integration**: pinned multi-stage Dockerfile, fixed
   `10001:10001` user, broad toolchains, persistent/ephemeral path contract,
   PID-1 and SIGTERM behavior, `/healthz` and `/readyz`, local smoke,
   `workflow_dispatch` dev publication, immutable tags/digests, SBOM,
   provenance, generated assets, and deployment documentation.
8. **Integrated verification**: full existing NAC gates, production assets,
   credential-independent E2E, and the staging journey below.

### Credential-independent test plan

- Run every store/config test under temporary roots with no developer home or
  real credentials visible.
- Use a fake GitHub HTTP service for device codes, polling intervals, access/
  refresh rotation, expiry, revocation, SAML errors, repository pagination, and
  branch discovery.
- Use a fake `git` credential consumer to prove the helper returns the current
  App token only for `https://github.com`, refreshes when needed, and never
  writes the token to remote URLs, config, arguments, API responses, or logs.
- Use a fake `gh` executable to assert that a newly spawned command receives
  the current App user token through `GH_TOKEN`, while NAC's server environment
  and unrelated readiness processes do not.
- Use local bare Git repositories to test default/non-default branch clone,
  cancellation, destination races, restart interruption, stale staging
  cleanup, symlink/path escape, collisions, mismatched remotes, and Project-
  last creation without network access.
- Test generic-secret CRUD, reserved names, empty/multiline/limit behavior,
  exact spawn snapshots, all agent topologies, replacement/deletion, restart,
  and best-effort structured redaction without asserting impossible secrecy
  from arbitrary shell output.
- Reopen the same durable store/repository roots across simulated process/pod/
  stop-start events and assert state survives while live terminal handles are
  marked lost.
- Exercise laptop- and phone-width UI flows with mocked providers, and run all
  existing local/SSH/Podman/Project/orchestrator compatibility tests.
- Build the production image without AWS credentials; mount temporary
  state/repositories/home plus ephemeral temp/run paths; assert UID/GID,
  required tool inventory, read-only-root compatibility, readiness, embedded
  assets, safe local execution, SIGTERM settlement, and clean exit.

### Real staging acceptance journey

1. Publish an immutable `linux/amd64` NAC image from the implementation branch,
   record its digest, and create one owner-bound `NACInstance` in
   `aws-dev-apps-01`, through the platform button or the identical manual CR.
2. Open its stable authenticated URL from a laptop and phone; verify streaming,
   reconnect, cookies, and responsive Projects navigation.
3. Confirm an Arcee hosted model works without the owner pasting a model key.
4. Connect the Managed NAC GitHub App through device flow with no PAT, survive
   the phone browser round trip, and confirm the displayed GitHub identity.
5. Select an accessible private `arcee-ai` repository and non-default branch,
   using ordinary HTTPS Git without required SSH-form submodules or Git LFS;
   clone it under `/repositories`, and create an ordinary Project.
6. Read, edit, and test through a direct session. Commit with the configured
   identity; fetch and push through ordinary `git`; run `gh repo view` and
   create/inspect a pull request. In a disposable repository/branch, validate a
   push containing a safe `.github/workflows` change.
7. Add a generic multiline secret. Verify a fresh direct command, traditional
   child, orchestrator worker, and launched orchestrator can use it; verify the
   UI/API never reveals its value. Acknowledge that arbitrary shell can print
   it.
8. Start a retained terminal, then restart NAC. Verify durable state returns,
   the terminal is reported lost, Git still works, `gh` gets a refreshed token,
   and a fresh command sees the secret.
9. Restart the pod/container, stop/start the logical host, and force expected
   rescheduling. Each time verify the same PVC, Projects, sessions,
   repositories, persistent owner home/user-installed tool, GitHub connection,
   Git identity, and generic secrets return; verify `/tmp` does not.
10. Remove a Project and verify its checkout remains. Re-register it through
    the existing Project flow.
11. Explicitly delete the logical host. Verify routing and compute disappear,
    the host model credential is revoked, the PVC is deleted, and platform does
    not report deletion complete while durable resources remain.

Completion of this finite journey proves the messy internal v0 Lucas requested.
Backups, recovery from a lost/corrupt PVC, remote GitHub grant revocation,
restart-durable terminals, GitHub SSH/LFS edge handling, multi-version image
upgrade/rollback, database migration policy, and recreation after deletion
remain explicitly outside acceptance.
