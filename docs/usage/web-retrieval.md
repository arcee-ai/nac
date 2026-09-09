# Native web retrieval

NAC provides `web_search` and `web_fetch` to top-level direct sessions and
orchestrator-managed workers when a nonblank `EXA_API_KEY` is available. A
direct session resolves the process environment first and then NAC's managed
credential store. A worker uses only the orchestrator process's environment
snapshot at dispatch. When the applicable source has no usable value, both
tools are silently absent.

The capability decision is refreshed for every model request. Direct sessions
refresh their credential at that boundary; a worker keeps its dispatch
snapshot. The credential and visible tool names form one immutable request
snapshot, so a tool response cannot invoke web retrieval unless the request
that produced it admitted the tools. Orchestrator primaries and traditional
child sessions never receive these capabilities. A top-level direct session
using managed-orchestrator control tools does receive them.

The orchestrator removes `EXA_API_KEY` from the worker process environment. The
worker consumes the snapshot from a private control pipe only after its MCP
configuration and stdio transports are constructed. Model-controlled commands,
terminals, MCP configuration expansion, and MCP descendants therefore cannot
read the key. Exact-value redaction also covers retained worker stdout and
stderr; the key is never included in model-visible tool definitions or durable
worker episodes.

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
