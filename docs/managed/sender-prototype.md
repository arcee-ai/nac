# Separate sender experiment

This bounded experiment exercises native NAC inference without giving the NAC
process, tools or workers a provider key. It does not install a production
sender, enrollment factory, listener, configuration mode or canonical wire.
Normal builds compile out the experimental forwarding client and private grant
frame. Existing startup, managed v1/v2/v3 import and local/OAuth behavior remain
unchanged.

The production source addition is an inward read-only
`ManagedHostExecutionObserver` port. Trusted composition can provide a separately
authenticated nonsecret observation for an exact binding. Its unconfigured
implementation denies. `ManagedHostExecutionAuthority` retains its shared sticky
denial and observation-revision semantics, including across clones and client
reconstruction under the same enrolled grant. This
constructor is not authentication, enrollment or proof.

## Fixture and evidence boundary

The optional Docker target includes the native core test binary over an explicitly
selected managed image. NAC and its commands remain UID10001. A separate fixture
sender runs UID10002 with no capabilities. Its private authority volume contains
bootstrap, durable store, issuer records and a randomly generated synthetic key;
it is separate from NAC's state, home and repository mounts. Public socket/status
files live in a UID10002-owned directory that UID10001 cannot replace. No secret
is built into the image or assigned to `ModelClient::api_key`.

The root fixture initializer supplies one-use, expiring enrollment records through
private pipes. The fixture verifier checks full binding, serving lifetime, native
incarnation and permitted operation against those records, then binds the
memory-only grant to the actual native process. UID, PID and socket possession
alone never authorize a request. This is an explicitly synthetic issuer, not an
accepted native enrollment mechanism. Current production inputs remain missing.

The native client uses one fixed Unix HTTP forwarding endpoint. Only the sender
loads the provider key and attaches it to an owned loopback provider stub. The
native request builder, JSON parser and SSE fold actually execute. The fixture
buffers a bounded upstream body before exact-value redaction; it does not
qualify production incremental streaming or its redaction/backpressure policy.
The private worker channel passes a fixture grant after MCP construction with
its existing peer checks, close-on-exec descriptor and non-dumpable Linux process
safeguards. It passes no provider key. This does not activate the experiment in
ordinary hidden-worker startup.

The probe checks unenrolled/spoofed/reused identity denial; native buffered/SSE
forwarding; terminal/MCP inability to read or replace authority/bootstrap;
ordinary SQLite, native write/read, home/repository, retained output and PTY use;
private worker forwarding; one upstream call on HTTP failure, lost response and
broken pre-delta SSE; sticky native model/tool cutoff after synthetic restoration;
restart tombstones; wrong-predecessor/active-slot CAS denial; generation2 repair,
missing-delivery duplicate and successor receipt/restart. Fixture control is a
separate private UID10002 endpoint solely for the test harness; it is not a
product repair receiver. The application repair boundary has separate
current-authority, lock-wait expiry, lost-response and departure-ordering tests.

## Run the bounded proof

Prepare the worktree with `make setup`. Build a local canonical `build` stage and
managed runtime image from the selected source using
`docker/managed/Dockerfile`. Both local image inputs must be explicit. The
experimental Dockerfile overlays the current source and compiles the locked core
test binary offline; it reuses the build stage's dependency cache. A dependency
cache miss is a coverage gap, never permission to substitute another revision.

```sh
docker build --platform linux/amd64 --network none \
  -f docker/managed/sender-prototype.Dockerfile \
  --build-arg NAC_SENDER_BUILD_IMAGE=<local-build-stage> \
  --build-arg NAC_MANAGED_IMAGE=<local-managed-runtime> \
  -t nac-managed:sender-prototype .
MANAGED_SENDER_PROBE_IMAGE=nac-managed:sender-prototype \
  sh scripts/smoke-managed-sender-prototype.sh
```

The script creates only its named fixture volumes/container, denies external
network access, drops all runtime capabilities and verifies cleanup. It uses a
root initializer for fixture volume ownership, not a privileged NAC process,
setuid executable or added runtime capabilities. No live provider, customer
credential, registry publication, cluster, retained-secret clearance or fleet
qualification is involved.

## Accepted contract still required

B's canonical lifecycle contract is pinned to ArceeFM
[PR1085](https://github.com/arcee-ai/ArceeFM/pull/1085), revision
`9e8b22ef5f42439468edad39f02a83ead778414a`. It binds operation phases, exact
resources/predecessors, release and freshness. It explicitly leaves native
producer authentication, current policy/readback, enrollment, delivery and real
resource CAS to qualified consumers. Its JSON digest is not authentication.
The separate runtime release contract remains revision `ca23550` in
[PR1080](https://github.com/arcee-ai/ArceeFM/pull/1080).

Stop at the unestablished production enrollment/evidence producer. Do not convert
fixture records, caller-controlled fields, legacy assertions or a local receipt
into production authority. Incoming protected runtime ingress is a separate
adapter and contract; this outgoing experiment does not change or qualify it.
