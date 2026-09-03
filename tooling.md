# NAC harness tooling decisions

Status: partial tool inventory; web retrieval v0 settled
Date: 2026-08-26

## Purpose

This document records product decisions for the expanded direct-agent tool
surface. It is intentionally separate from `demo_ext_managed.md`: managed NAC
may provide the credential/configuration seam, while this document owns which
agents see the tools and how the tools behave.

The complete launch tool inventory still requires human review. Only the web
retrieval slice below is settled and ready for implementation.

## Compatibility boundary

- Preserve the existing/default NAC orchestrator and worker execution behavior.
- Do not add these tools to the existing NAC orchestrator primary or workers.
- Do not add these tools to traditional coding subagents in v0.
- Add `web_search` and `web_fetch` only to:
  - the normal top-level direct agent; and
  - the normal top-level direct agent with orchestrator-management tools.
- Existing capability sets remain unchanged when the Exa credential is absent.

## Credential and visibility contract

- Both tools require a nonblank `EXA_API_KEY`.
- Resolve the key from either:
  1. the NAC process environment; or
  2. NAC-managed credential/configuration storage.
- A nonblank environment value takes precedence over the NAC-managed value.
- If no usable key resolves, silently omit both tools from the model-visible
  capability set. Do not expose placeholder tools and do not show missing-key
  UX in v0.
- Credential changes should affect a subsequent model-request capability
  snapshot without allowing an invocation outside the snapshot that admitted
  it. The exact refresh/watching mechanism is an implementation detail.
- Never return, log, persist in transcripts, or expose the key to the model.

## Retrieval architecture

- `web_search` uses Exa Search.
- `web_fetch` uses Exa Contents. NAC sends the requested target URL to Exa and
  does not connect directly to the target server in v0.
- NAC communicates with the official Exa API over HTTPS. Credential-bearing
  requests must not follow a redirect to a different origin.
- Target URLs may use public `http://` or `https://` URLs.
- Validate requested URLs and reject malformed URLs, embedded credentials,
  unsupported schemes, and local/private/reserved targets as non-approvable
  safety failures.
- If Exa reports a final URL, validate it before presenting it as a usable
  result. Exa, rather than NAC, owns target-side redirect execution in this
  architecture; documentation and tests must describe that boundary honestly.

## Permission behavior

- Both tools default to `allow`.
- Normal NAC permission configuration may still change either action to `ask`
  or `deny`.
- If `web_fetch` is configured to ask, use concise human-facing wording such
  as: **Allow `web_fetch` to fetch this URL?** Do not expose transport details
  in routine approval UX.
- Permission resources must not persist raw search queries, secret-bearing URL
  components, or unredacted URL query strings.
- Approval must not override URL validation, credential isolation, capability
  membership, provider-origin restrictions, cancellation, or response/time/
  size bounds.

## Model-facing shape and implementation references

- Use the `agentic_auxilary` web-retrieval tools as the primary reference for
  useful parameter names, descriptions, result shapes, cancellation, output
  bounds, and content conversion.
- Reimplement the tools in NAC. Do not add a local path dependency or copy the
  reference implementation wholesale.
- Do not copy its current networking contract: its `web_fetch` performs an
  arbitrary direct HTTP request, whereas NAC v0 uses Exa Contents.
- Keep search result counts, query/URL lengths, timeouts, retries, provider
  response sizes, decoded content, and total model-visible output bounded.
- Propagate NAC cancellation through connection, response streaming, retry
  backoff, decoding, and result construction.
- Reuse NAC's native tool registration, capability snapshots, permission
  projection, event emission, rich results, and known-secret redaction rather
  than creating a parallel dispatch path.

## Explicitly deferred

- Missing-Exa-key warnings, popups, or integration-status UX.
- Direct fetching of arbitrary target URLs from the NAC process.
- Routing retrieval through Local, Podman, or SSH execution backends.
- A Codex-style general network proxy and hop-by-hop network approval system.
- Adding web tools to existing orchestrator workers or traditional subagents.
- Finalizing the rest of the normal-agent tool inventory.

## Scope of the next implementation goal

The next goal may implement this settled web-retrieval slice together with the
implementation-ready managed NAC v0 contract in `demo_ext_managed.md`.

It must not treat the still-pending broader tool inventory or manual frontend
review as implicit requirements. Those will produce separate decisions and
follow-up work.
