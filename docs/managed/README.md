# Managed NAC host

Managed NAC is an additive, single-owner deployment mode. It adds GitHub App
onboarding, host-wide write-only secrets, managed readiness, and a fixed
developer image without changing ordinary local or SSH Projects. Starting
`nac-web` without `--managed-config` or `NAC_MANAGED_CONFIG` keeps the existing
unmanaged behavior.

## Trust and ownership boundary

The platform authenticates the one declared owner before traffic reaches NAC.
NAC has no second ingress authentication layer: every client that reaches the
service has owner-equivalent control. The service must therefore sit behind an
authenticated HTTPS gateway, and `NAC_ALLOWED_HOSTS` must contain the exact
stable public hostname.

The service and every local agent command share UID/GID `10001:10001`. Every
generic host secret is added to every newly spawned agent command, including
workers, traditional children, and separately launched orchestrators. An
arbitrary-shell agent can enumerate and transmit those secrets. Managed v0 is
an owner-wide trust boundary, not a per-Project or per-agent sandbox.

Platform owns the logical-host controller, gateway/SSO, stable URL, volumes,
runtime confinement, egress, host-scoped model credential, and lifecycle.
NAC owns Projects and sessions, GitHub user authorization, repository
onboarding, host secrets, command injection, and readiness. NAC does not
provision Kubernetes resources or delete repository files when a Project is
removed.

## Runtime image contract

The production definition is
[`docker/managed/Dockerfile`](../../docker/managed/Dockerfile). It is pinned to
`linux/amd64`, runs without `sudo` as `10001:10001`, uses Tini as PID 1, and
contains Git/GitHub, OpenSSH, shell/search/build utilities, Python and uv,
Node LTS/npm/Corepack, pinned Rust with rustfmt/clippy, and pinned Go.

Mount these paths with the stated ownership:

| Path | Lifetime | Contents |
| --- | --- | --- |
| `/var/lib/nac` | durable | SQLite store, imported model auth and receipt, GitHub tokens, host secrets |
| `/repositories` | durable | repository checkouts |
| `/home/nac` | durable | Git identity, caches, owner-installed tools |
| `/etc/nac/managed.toml` | read-only config | nonsecret host contract |
| `/run/secrets/nac/bootstrap.json` | read-only bootstrap | one managed Arcee credential generation; not required after import |
| configured mounted API-key file | read-only secret | compatible API-key credential source |
| `/tmp` | ephemeral writable | temporary files |
| `/run/nac` | ephemeral writable | process runtime files |

The root filesystem may be read-only. The controller or a narrowly scoped init
container must create and own mounted directories; the image never starts as
root to repair them. The entrypoint performs cheap structural checks, while
`/readyz` is the final authority.

The entrypoint starts the equivalent of:

```text
nac-web --bind 0.0.0.0:3210 --allow-remote --no-open \
  --store-path /var/lib/nac/nac.sqlite3 \
  --directory /repositories --yes \
  --managed-config /etc/nac/managed.toml
```

## Managed configuration

Version 1 uses a strict TOML document. Values below are examples; platform must
provide the actual host identity, DNS name, GitHub App client ID, model
endpoint, and credential mount. Managed Arcee bootstrap uses an ArceeFM-
allocated UUID as the stable `logical_host_id`/`managed_host_id`:

```toml
version = 1
logical_host_id = "21856443-8ed8-40ab-9036-72e837c99f27"
owner = "owner@example.com"
public_hostname = "nac-owner-01.example.com"
repository_root = "/repositories"
state_root = "/var/lib/nac"
home_root = "/home/nac"
github_client_id = "Iv1.example"
model_backend = "arcee-auth"
model_id = "trinity-large-thinking"
model_endpoint = "https://api.arcee.ai"
model_credential_file = "/run/secrets/nac/bootstrap.json"
model_credential_source = "managed-bootstrap"
```

`model_credential_source` defaults to `mounted-api-key`, preserving existing
managed configurations. That source requires an API-key backend and a nonblank,
finite regular file with no access for other users. It may be owned by
`10001:10001`, or root-owned and readable by runtime group `10001`; symlinks are
rejected. The file is mounted read-only, is not a generic host secret, and is
not copied into command environments.

`managed-bootstrap` requires `model_backend = "arcee-auth"`, the exact bootstrap
path above, and `NAC_HOME` equal to `state_root` (the image fixes both to
`/var/lib/nac`). The controller must project the single Secret key with a
Kubernetes `subPath` mount so the final path is a regular file, not a projected
volume symlink. NAC reads it with `O_NOFOLLOW`, imports under the normal Arcee
credential lock, writes the credential and a separate nonsecret receipt
atomically, then uses only writable durable state. Reconciliation may leave or
replace the input, and the mount may disappear on later starts; none can
overwrite a locally rotated credential.

The strict v1 JSON object has exactly these fields (no extras):

```json
{
  "version": 1,
  "bootstrap_id": "4712bc5e-30d5-421a-b416-8291d9f7d8f9",
  "managed_host_id": "21856443-8ed8-40ab-9036-72e837c99f27",
  "client_id": "managed-nac",
  "access_token": "<secret>",
  "refresh_token": "<secret>",
  "access_token_expires_at": "2030-01-02T03:04:05Z",
  "token_type": "bearer",
  "inference_base_url": "https://api.arcee.ai",
  "organization_id": "<nonsecret Arcee organization id>",
  "workspace": "<nonsecret workspace name>"
}
```

Both IDs are UUIDs with distinct meanings: `managed_host_id` is the stable
ArceeFM business identity and must equal `logical_host_id`; `bootstrap_id`
identifies one credential generation. A durable receipt consumes that
generation even when an existing valid or corrupt credential is preserved.
NAC never replays it and never automatically replaces any existing canonical
credential. Preservation receipts are deliberately not ready: managed catalog,
session creation, and resume require an `imported` receipt and a stored
`managed-nac` credential whose retained host and bootstrap IDs match that
receipt exactly. Receipt and credential are checked together under the normal
Arcee lock. A crash after the credential write but before its receipt is
repaired from nonsecret provenance on retry without rewriting the credential.
Local logout or provider revocation removes the usable credential while the
receipt remains a tombstone, so the managed profile fails closed. The existing
interactive **Sign in with Arcee** flow remains available for ordinary
`arcee-auth` use or after an operator deliberately changes credential source;
its `nac-cli` credential cannot impersonate a managed bootstrap generation.

ArceeFM alone mints and revokes the grant. NAC receives no Kubernetes,
service-account, or provisioning credential and exposes no bootstrap HTTP
endpoint. The grant authorizes all Arcee models entitled to its organization;
`model_id` remains only the independent deployment default. GitHub access and
refresh tokens remain owner-only NAC state and are never returned by status
APIs.

Managed v0 does not claim isolation from a fully compromised NAC process: that
process must read and use its model credential. A stronger boundary would need
a separate credential-injecting broker.

## Probes and shutdown

- `GET /healthz` proves only that the server event loop responds. It is always
  credential-free and does not touch external services.
- `GET /readyz` checks the store, exact durable paths and ownership, durable
  bound model credential/receipt provenance (or the compatible mounted API key),
  required tool inventory, and an environment-cleared safe local-command probe.
  It makes no live model request and does not require a consumed bootstrap
  mount. GitHub connection and generic-secret presence are intentionally not
  readiness requirements.
- `GET /managed/status` is owner-facing and exists only in managed mode. It
  reports host/version/schema metadata, counts, GitHub state, and readiness
  details without credential values.

Tini forwards SIGTERM. NAC performs graceful HTTP shutdown and asks every
locally owned active run to cancel through its durable interruption path. The
cleanup attempt is bounded; an abrupt loss is reconciled as interrupted by the
existing recovery path on the next start.

## Local build and smoke

Static image/workflow checks do not need a container runtime:

```sh
make test-managed-image-contract
```

With Docker or Podman available:

```sh
make test-managed-image MANAGED_IMAGE=nac-managed:local
```

Use `make managed-image` when only a local build is wanted. The smoke target
builds before testing unless `MANAGED_IMAGE_SKIP_BUILD=1` is supplied for an
already-built image.

The smoke builds the exact `linux/amd64` image, first proves that a fresh host
cannot become ready without its bootstrap mount, initializes a fake strict
bootstrap, runs with a read-only root, waits for health/readiness, checks the
tool inventory and non-root identity, and verifies that status and logs do not
leak its canary tokens. It then models a rotated durable token, reconciles the
original bootstrap without overwriting that state, kills the container
abruptly, and proves the same durable host becomes ready with no bootstrap
mount. It never contacts a real GitHub App, model endpoint, ArceeFM, or AWS
account.

## Image CI and publication ownership

`.github/workflows/managed-image.yml` builds and smokes pull-request, `main`,
and manually dispatched candidates without registry credentials or
publication. Every lane checks out the triggering commit, builds the exact
`linux/amd64` image with `push: false`, and runs the source-owned smoke
contract. The public NAC repository has no AWS identity, ECR configuration,
package-write permission, or image publish job.

Private Managed NAC publication is owned by
`arcee-ai/managed-nac-controller`. Its reviewed workflow checks out an exact
full NAC commit, builds this repository's canonical Dockerfile, runs this
repository's smoke contract, and publishes the accepted image to private ECR
inside that repository's AWS/OIDC trust boundary. Neither repository triggers
the other or shares publishing credentials. Deployment selects the resulting
private image by immutable digest.

## First dogfood and external gaps

Automated tests use local GitHub/Git doubles and production-embedded browser
API doubles. A real staging demonstration additionally requires a private
runtime image published from the reviewed NAC commit, the controller and PVC
contract, gateway owner authentication, allowed egress, stable hostname, and
revocable Arcee managed grant. On staging, validate one server-minted
bootstrap, fail-closed logout or revocation behavior, and the independent
interactive fallback after an explicit credential-source change, plus
repository and branch discovery, clone, HTTPS Git push (including a safe
workflow-file change in a disposable repository), `gh` use, process/pod
restart, and same-volume rescheduling. Those external checks do not weaken or
replace the local NAC contracts.
