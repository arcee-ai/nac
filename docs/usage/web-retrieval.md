# Native web retrieval

NAC provides `web_search` and `web_fetch` to top-level direct sessions and
Managed NAC orchestrator workers when a nonblank `EXA_API_KEY` is available. A
direct session resolves the process environment first and then NAC's managed
credential store. A Managed NAC worker uses only its server process's
environment snapshot at dispatch. Ordinary local workers retain their prior
credential-free behavior. When the applicable source has no usable value, both
tools are silently absent.

The capability decision is refreshed for every model request. Direct sessions
refresh their credential at that boundary; a worker keeps its dispatch
snapshot. The credential and visible tool names form one immutable request
snapshot, so a tool response cannot invoke web retrieval unless the request
that produced it admitted the tools. Orchestrator primaries and traditional
child sessions never receive these capabilities. A top-level direct session
using managed-orchestrator control tools does receive them.

The orchestrator removes `EXA_API_KEY` from the worker process environment and
keeps stdin exclusively for cancellation. On Unix, each managed dispatch gets
an anonymous stream socket. The worker marks its inherited endpoint
close-on-exec before constructing any MCP transport, announces readiness only
after MCP construction, then receives one bounded credential frame and closes
the socket. Credential bytes are therefore neither buffered before MCP startup
nor inherited by MCP descendants, and an ordinary Linux `/proc/<pid>/fd` open
cannot duplicate the socket as it could the retired stdin pipe. On non-Unix
hosts, dispatch fails closed when a native credential would need delegation.

On Linux, an explicitly configured Managed NAC server and its workers also
become non-dumpable and set `no_new_privs` before spawning untrusted
descendants. This blocks ordinary
same-UID ptrace, process-memory, proc-environment, and `pidfd_getfd` inspection.
It is not a defense against a process with `CAP_SYS_PTRACE`, a privileged
container, kernel compromise, or a fully compromised NAC process. Deployments
that run untrusted MCP servers must not grant those capabilities; stronger
mutual isolation requires separate UIDs or a credential-injecting broker.

On macOS, the managed-worker socket inheritance and readiness protections still
apply, but there is no Linux-equivalent `prctl`/procfs guarantee here. A
same-user macOS MCP process is therefore outside this isolation claim; use
privilege separation or an external credential broker for that threat model.

Exact-value redaction covers retained worker stdout and stderr; the key is
never included in model-visible tool definitions or durable worker episodes.

`web_search` sends a bounded semantic-search request to Exa Search.
`web_fetch` validates one public HTTP or HTTPS target and sends that URL to Exa
Contents. NAC does not connect directly to the target URL. This v0 boundary
means Exa owns target-side DNS, connection, and redirect execution; NAC still
rejects malformed URLs, embedded credentials, unsupported schemes, and
literal or named local/private/reserved targets before authorization. Any
final URL returned by Exa is validated before it is included in a result.

Credential-bearing requests use the fixed `https://api.exa.ai` origin. They do
not follow redirects to another origin. Request deadlines, retry backoff,
provider response bytes, decoded content, result count, queries, and output
fields are bounded, and cancellation applies throughout the request. Provider
errors and successful provider content are redacted against the captured key.
Returned URLs omit query strings, and permission resources store a query hash
instead of raw URL queries or search text.

Both actions default to `allow` under NAC's normal permission policy. Later
configured rules still use the ordinary last-match behavior, for example:

```toml
[[permissions.rules]]
action = "web_fetch"
resource = "*"
effect = "ask"

[[permissions.rules]]
action = "web_search"
resource = "*"
effect = "deny"
```

An approval changes only that prepared invocation's authorization. It cannot
override URL validation, provider-origin restrictions, capability membership,
cancellation, or execution bounds.
