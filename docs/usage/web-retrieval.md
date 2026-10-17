# Native web retrieval

NAC provides `web_search` and `web_fetch` to top-level direct sessions when a
nonblank `EXA_API_KEY` is available. Direct sessions prefer a captured managed
startup credential when present, otherwise resolve the process environment and
then NAC's credential store. Both direct behaviors inherit these tools to traditional children; a
`direct-with-orchestrator` parent also inherits them to its managed orchestrator
subagents and their workers. No child flag or additional credential setup is
required. The eight native coding tools remain the traditional child baseline;
nesting, goals and orchestration control remain absent.

Only a construction-owned parent source can grant inherited native web.
Child JSON cannot supply eligibility or credentials. This process binding survives
idle-agent eviction. Each generation checks its
durable parent relationship and captures that parent's currently usable source.
Steering and subsequent model requests keep the admitted generation snapshot;
continuation rechecks rotation or removal. Reattachment/restart never persists a
key: a recovered parent runtime must re-establish its source before a new child
generation can inherit. A missing parent source on this process/host fails
closed, even if another host or owner has credentials. Existing active generations
retain their admitted snapshot until they finish.

Direct primaries still refresh at every model request. Visible names, allowed
tools and credentials form one immutable request/tool-round snapshot. Unrelated
top-level orchestrators remain excluded. Established Managed NAC worker
provisioning remains independent: it uses the server startup snapshot at dispatch.
Ordinary local workers gain no ambient credential lookup; eligible inherited
orchestrators forward only their admitted native snapshot.

The orchestrator removes `EXA_API_KEY` from the worker process environment and
keeps stdin exclusively for cancellation. On Linux, each credential-bearing dispatch gets
a mode-0600 filesystem Unix socket. The worker first reapplies the managed
process hardening, connects without inheriting a credential descriptor, and
authenticates the server PID with `SO_PEERCRED`; the server likewise accepts
only the PID of the worker it spawned. The worker announces readiness only
after MCP construction, then receives one bounded credential frame and closes
the socket. Credential bytes are therefore neither buffered before MCP startup
nor available to MCP descendants. Other Unix hosts retain an anonymous
close-on-exec socket with the same post-MCP readiness ordering. On non-Unix
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

Native Exa credentials cannot be expanded or forwarded through MCP configuration,
stdio environments, or HTTP-header helpers, including on local hosts.

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
