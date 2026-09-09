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
model_auth_issuer = "https://api.arcee.ai"
model_credential_file = "/run/secrets/nac/bootstrap.json"
model_credential_source = "managed-bootstrap"
```

Version 1 remains readable for existing deployments, but it does not enable
the controller-to-NAC upgrade control surface. Version 2 additionally requires
host_incarnation_id, managed_control_bind, managed_control_issuer, and
managed_control_jwks_file:

```toml
version = 2
logical_host_id = "21856443-8ed8-40ab-9036-72e837c99f27"
host_incarnation_id = "01JZ7W4M3X8R0Y6WJ3C2Z1Q9PV"
managed_control_bind = "0.0.0.0:3211"
managed_control_issuer = "https://nac-api.example.com"
managed_control_jwks_file = "/run/secrets/nac-control/jwks.json"
# All version 1 host/model fields remain required as shown above.
```

Port 3211 serves only the compact-JWS-authenticated managed upgrade
status/prepare/retry/supersede contract. Those routes are never registered on the
ordinary port 3210 router. The mounted controller-facing Service and
NetworkPolicy are platform responsibilities; exposing 3211 through the
user-facing ingress is unsupported. NAC reloads the public JWKS document per
request for safe key rotation and never stores or returns the raw assertion.

The JWKS mount is a public-key trust root, not ordinary runtime configuration.
In production its file and containing mount directories must be root-owned and
not group/world-writable; the final key file must not be writable. NAC opens
the resolved file atomically with `O_NOFOLLOW` and validates the opened
descriptor. A normal Kubernetes projected volume is supported: the configured
`jwks.json` leaf may use Kubernetes' relative `..data/jwks.json` symlink, whose
resolved version directory and file satisfy the same ownership/mode checks.
Other symlink layouts fail closed. An atomic root-owned regular-file projection
is also supported. The application container must not be able to replace or
chmod this trust root.

This first slice relies on compact-JWS authentication plus the private
Service/NetworkPolicy boundary. Mutual TLS is intentionally deferred to
ALL-45 and is not required by managed configuration version 2.

## Upgrade control and maintenance

Each private request carries a compact Ed25519 JWS in `Authorization: Bearer`.
NAC accepts only the versioned `nac-managed-operation+jwt` protected header,
`EdDSA`, a known unique JWKS `kid`, unpadded base64url segments, and a canonical
Ed25519 public key. The assertion lifetime may not exceed 60 seconds. `iat`,
`nbf`, and `exp` are checked with five seconds of clock skew and checked integer
arithmetic.

The signed claims bind the controller issuer, host-and-incarnation audience,
request action, logical host, host incarnation, operation ID, complete target
(release/build ID, source revision, product version, schema, and minimum
schema), actor, and beneficiary. Product versions use bounded SemVer 2 syntax;
build metadata such as `1.2.3+linux.amd64` is valid and is ignored only when
comparing forward precedence. Any body, action, key, issuer, audience, host,
incarnation, operation, target, actor, or beneficiary substitution fails
closed. The issuer is also retained as the durable origin authority for the
operation, so future configuration cannot reinterpret an existing operation.

NAC permanently binds an operation ID to that complete authority and target.
The assertion `jti` is a replay/idempotency key: retrying the same request after
a lost response returns the original durable result, while reusing it for a
different binding is rejected. Same-`jti` requests serialize through 64 fixed
lock stripes; lock files do not grow with request volume. Retained operations
and attempts each have an explicit 10,000-row fail-closed capacity. Expired
completed attempts may be pruned, but an operation ID is never made available
for a different target.

`status` reports the durable maintenance snapshot and current blockers without
closing admission. `prepare` and `retry` attempt one atomic idle-only handoff.
If any blocker exists, admission remains open and the response contains a
structured blocker list. If none exists, NAC commits `maintenance` and returns
`safe_to_stop`; it never auto-cancels work, forces shutdown, rolls back a
target, or guesses that a peer is idle.

If an accepted target cannot start, `supersede` performs an authenticated,
forward-only A-to-B recovery while the private listener is still available.
Its signed claims additionally bind A's exact operation ID and complete target.
NAC requires the same host, incarnation, authority, actor, and beneficiary,
rejects product or schema downgrades, atomically replaces the maintenance target,
and retains A's operation as a superseded tombstone. It never reopens admission;
only an exact B start can leave maintenance. Concurrent attempts from the same A
have one durable winner, and exact lost-response retries return that winner's
stored result.

When A is suspended or cannot serve the private listener, the controller may
place the same nonsecret compare-and-swap expectation in the version 2 managed
configuration before starting B:

```toml
[managed_upgrade_expectation]
adopt_unbound_previous = false
previous_operation_id = "operation-failed-a"
operation_id = "operation-corrected-b"
actor = "user:owner"
beneficiary = "tenant:host-owner"

[managed_upgrade_expectation.previous_target]
release_id = "release-a"
source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
product_version = "1.2.3+failed.1"
schema_version = 25
minimum_schema_version = 0

[managed_upgrade_expectation.target]
release_id = "release-b"
source_sha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
product_version = "1.2.4+recovery.1"
schema_version = 25
minimum_schema_version = 0
```

This controller-authored field contains no credential. At startup NAC requires
B to exactly match the embedded build identity and atomically checks the durable
A binding before changing A to B. A missing, stale, substituted, or downgrade
expectation fails before ordinary store migration. The expectation does not give
NAC Kubernetes access and cannot select a deployment or execution backend.

For the one transition from a pre-control deployment, the controller may set
`adopt_unbound_previous = true`. That explicit mode is accepted only when the
schema-24 control ledger is absent or the current ledger is serving at
maintenance revision zero, with no accepted identity and no retained control
operation or attempt. In one transaction NAC creates an absent ledger,
synthesizes A's binding from the configured host, incarnation, issuer, actor,
beneficiary, and exact previous target, records A and B, and enters maintenance
for B. Any partial control schema or existing control history rejects adoption.
Live JWS supersession can never request this mode. A configured startup
expectation also rejects an absent database instead of initializing one.

Authoritative blockers include active runs and manual compactions, traditional
children and managed orchestrators, live terminal processes, pending remote
terminal cleanup, repository clones, workspace mutations, process-local HTTP
admissions, cross-process operation/resource/host leases, background model or
GitHub device logins, and another maintenance operation. Blocker scans are
nonwaiting: a contended process-local registry is itself reported as a
blocker. Dormant goals, browser connections, and already-created SSE response
bodies are not permanent blockers. A completed local terminal is tombstoned
and releases its leases while retained output remains readable. Failed remote
cleanup stays durable and blocks an upgrade across process restart until the
cleanup succeeds.

Once maintenance is committed, public recovery/static/status routes and
explicit completion/cancellation paths remain available, while every new-work
admission seam fails closed. This includes direct and orchestrated runs,
session creation and attachment, manual compaction, child/orchestrator launch,
workspace mutations, repository clones, and the full lifetime of background
login flows. Private authenticated status remains available. Maintenance is
cleared only by the exact accepted forward replacement after store
initialization, reconciliation, both listener binds, and the full managed
readiness contract (paths, runtime tools, command backend, and model
credential) succeeds.
The accepted host/incarnation/operation/target identity then fences the old
process and any same-schema process with a different build from both new work
and completion mutations.

The public NAC implementation deliberately stops at this host-side contract.
ALL-44 must supply controller-side assertion minting, operation persistence,
lost-response retry, and rollout orchestration. ALL-45 may add mutual TLS to the
private Service without weakening compact-JWS validation. ALL-42 must preserve
the same forward-only lifecycle and safe-stop evidence when wiring deployment
rollout behavior.

`model_credential_source` defaults to `mounted-api-key`, preserving existing
managed configurations. That source requires an API-key backend and a nonblank,
finite regular file with no access for other users. It may be owned by
`10001:10001`, or root-owned and readable by runtime group `10001`; symlinks are
rejected. The file is mounted read-only, is not a generic host secret, and is
not copied into command environments.

`managed-bootstrap` requires `model_backend = "arcee-auth"`, the exact bootstrap
path above, and `NAC_HOME` equal to `state_root` (the image fixes both to
`/var/lib/nac`). `model_auth_issuer` is the expected authorization-service
origin. It defaults to production (`https://api.arcee.ai`) for compatibility;
dev2 must set it explicitly to `https://api2.apps.dev.arcee.ai`. NAC accepts
only those two exact strings. This field is separate from `model_endpoint` and
is used both to double-bind a new bootstrap and to select the device-auth
service when the owner starts interactive repair without a usable stored
credential. Ordinary non-managed login continues to use production.

The controller must project the single Secret key with a
Kubernetes `subPath` mount so the final path is a regular file, not a projected
volume symlink. NAC reads it with `O_NOFOLLOW`, imports under the normal Arcee
credential lock, writes the credential and a separate nonsecret receipt
atomically, then uses only writable durable state. Reconciliation may leave or
replace the input, and the mount may disappear on later starts; none can
overwrite a locally rotated credential.

The strict v2 JSON object has exactly these fields (no extras):

```json
{
  "version": 2,
  "bootstrap_id": "4712bc5e-30d5-421a-b416-8291d9f7d8f9",
  "managed_host_id": "21856443-8ed8-40ab-9036-72e837c99f27",
  "client_id": "managed-nac",
  "access_token": "<secret>",
  "refresh_token": "<secret>",
  "access_token_expires_at": "2030-01-02T03:04:05Z",
  "token_type": "bearer",
  "inference_base_url": "https://api.arcee.ai",
  "auth_issuer": "https://api.arcee.ai",
  "organization_id": "<nonsecret Arcee organization id>",
  "workspace": "<nonsecret workspace name>"
}
```

`auth_issuer` is persisted with the rotating credential and is the only input
used to choose `/app/v1/device/refresh`. NAC never derives it from
`inference_base_url`, the configured model endpoint, a request host, client ID,
or token claims. Strict v1 bootstrap remains accepted only with production
issuer semantics, and stored credentials written before this field existed
also default to production. A dev2 grant delivered in v1 cannot be identified
safely and must be revoked and reissued as v2.

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
`arcee-auth` use and managed repair. Managed configuration selects the expected
production or dev2 authorization service even when the durable credential is
missing or invalid; its `nac-cli` credential cannot impersonate a managed
bootstrap generation.

ArceeFM alone mints and revokes the grant. For v2, ArceeFM must populate
`auth_issuer` from a dedicated trusted deployment setting rather than from the
inference URL. The controller/nac-api must carry `model_auth_issuer` in managed
configuration and transport strict v1/v2 bootstrap JSON opaquely; any private
schema or fixture validation must accept the v2 field without copying secrets
into CR spec/status, API responses, or logs. NAC receives no Kubernetes,
service-account, or provisioning credential and exposes no bootstrap HTTP
endpoint. The grant authorizes all Arcee models entitled to its organization;
`model_id` remains only the independent deployment default. GitHub access and
refresh tokens remain owner-only NAC state and are never returned by status
APIs.

The web model picker discovers that complete entitled model list through NAC;
the browser sends only the exact configured backend and endpoint, while NAC
reads and applies the credential server-side. Selecting another entitled model
does not rewrite `managed.toml` or the mounted secret. It writes a revisioned
session settings override into the durable SQLite store, and resume continues
to use that stored override ahead of the deployment default. A missing
credential, different backend or endpoint, or explicit environment selector
fails closed.

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
  reports exact product, build, track, full source revision, supported/opened
  schema, schema-owned minimum migratable version, and sanitized
  migration/maintenance state alongside counts, GitHub state, and readiness
  details without credential values.
- A managed process, including a version-2 control configuration, that cannot
  safely preflight or initialize its store starts a recovery-only diagnostic
  router without migrating or opening an incompatible database. It remains
  unready with `maintenance_state` set to `recovery-only` until restart, even if
  another process repairs the store; work routes are never admitted by that
  process.

Channel switching is intentionally unsupported in NAC, ArceeFM/RCFM, nac-api,
and the CRD. A future product decision must define it before implementation.

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
`dev`, and manually dispatched candidates without registry credentials or
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

The publisher must pass `NAC_BUILD_TRACK=beta`, the immutable beta build ID,
and the exact full source revision as Docker build arguments. Public CI uses
the `dev` track; the stable binary archive workflow embeds `stable`.

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
