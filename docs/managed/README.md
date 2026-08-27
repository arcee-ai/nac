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
| `/var/lib/nac` | durable | SQLite store, managed auth, GitHub tokens, host secrets |
| `/repositories` | durable | repository checkouts |
| `/home/nac` | durable | Git identity, caches, owner-installed tools |
| `/etc/nac/managed.toml` | read-only config | nonsecret host contract |
| configured model credential file | read-only secret | host-scoped model credential |
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
endpoint, and credential mount.

```toml
version = 1
logical_host_id = "nac-owner-01"
owner = "owner@example.com"
public_hostname = "nac-owner-01.example.com"
repository_root = "/repositories"
state_root = "/var/lib/nac"
home_root = "/home/nac"
github_client_id = "Iv1.example"
model_backend = "arcee-api"
model_id = "trinity-large-thinking"
model_endpoint = "https://models.example.com/v1"
model_credential_file = "/var/lib/nac/model-credential"
model_credential_environment_names = ["ARCEE_API_KEY"]
```

The model credential file must be a nonblank, finite regular file with no access
for other users. It may be owned by `10001:10001`, or root-owned and readable by
runtime group `10001` for a Kubernetes Secret projection; symlinks are rejected.
It is mounted read-only and is not a generic host secret
and is not copied into command environments. GitHub access and refresh tokens
remain owner-only NAC state and are never returned by the status APIs.

## Probes and shutdown

- `GET /healthz` proves only that the server event loop responds. It is always
  credential-free and does not touch external services.
- `GET /readyz` checks the store, exact mounted paths and ownership, model
  credential structure, required tool inventory, and an environment-cleared
  safe local-command probe. GitHub connection and generic-secret presence are
  intentionally not readiness requirements.
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

The smoke builds the exact `linux/amd64` image, initializes credential-free
fake managed inputs, runs with a read-only root, waits for health/readiness,
checks the tool inventory and non-root identity, verifies that status does not
leak its canary credential, sends SIGTERM and requires exit zero, then restarts
with the same volumes and proves durable files remain. It never contacts a real
GitHub App, model endpoint, or AWS account.

## Publication

`.github/workflows/managed-image.yml` builds and smokes pull-request and main
candidates without AWS credentials or publication. A manual dispatch accepts
an exact ref and publishes only after the same smoke to the GitHub `dev`
environment. Configure these environment values:

- variable `AWS_REGION`
- secret `OIDC_ROLE_TO_ASSUME`
- variable `ECR_REPOSITORY`
- variable `ECR_CACHE_REPOSITORY`

Publication uses GitHub OIDC, a registry BuildKit cache, maximum provenance,
and an SBOM. The tag includes the full candidate SHA, workflow run ID, and
attempt; the workflow emits the digest and creates no moving `latest` or `dev`
application tag. Platform must deploy by immutable digest.

## First dogfood and external gaps

Automated tests use local GitHub/Git doubles and production-embedded browser
API doubles. A real staging demonstration additionally requires the
platform-owned ECR/OIDC inputs, controller and PVC contract, gateway owner
authentication, allowed egress, stable hostname, and revocable Arcee model
credential. On staging, validate one real device authorization, repository and
branch discovery, clone, HTTPS Git push (including a safe workflow-file change
in a disposable repository), `gh` use, process/pod restart, and same-volume
rescheduling. Those external checks do not weaken or replace the local NAC
contracts.
