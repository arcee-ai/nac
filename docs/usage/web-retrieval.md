# Native web retrieval

NAC provides `web_search` and `web_fetch` to top-level direct sessions when a
nonblank `EXA_API_KEY` is available. Direct sessions prefer a captured managed
startup credential when present, otherwise resolve the process environment and
then NAC's credential store. Direct sessions inherit these tools to traditional
children when the parent has
an eligible source. No child flag or additional credential setup is required.
The eight native coding tools remain the child baseline; nesting and goals are
not available to children.

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
tools and credentials form one immutable request/tool-round snapshot. Native Exa
credentials are not inherited from ambient child configuration.

Native Exa credentials cannot be expanded or forwarded through MCP configuration,
stdio environments, or HTTP-header helpers, including on local hosts.

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
