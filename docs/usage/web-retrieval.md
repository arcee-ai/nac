# Native web retrieval

NAC provides `web_search` and `web_fetch` to top-level direct sessions when a
nonblank `EXA_API_KEY` resolves. A process environment value wins over the
same name in NAC's managed credential store. When neither source contains a
usable value, both tools are silently absent.

The capability decision is refreshed for every model request. The resolved
credential and visible tool names form one immutable request snapshot, so a
tool response cannot invoke web retrieval unless the request that produced it
admitted the tools. Existing orchestrator primaries and workers, and
traditional child sessions, never receive these capabilities. A top-level
direct session using managed-orchestrator control tools does receive them.

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
