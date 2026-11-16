# Troubleshooting

Verified pitfalls that look like product bugs and are not.

## Not enough credits for this request

A provider 402 surfaces as **Not enough credits for this request**. The wallet
can still show a balance — the platform reserves against catalog `max_tokens`.
This is not a nac wallet or ledger. nac still only surfaces the provider 402.

## Not signed in to Arcee

A logged-out Arcee / managed-auth refusal is a different path. The title is
**Not signed in to Arcee** (`ManagedAuthCallout`). Do not treat that path as a
402.

## Worker stopped after identical tool failures

Three identical failing tool rounds stop the worker as `ModelError`
(`REPEATED_TOOL_FAILURE_LIMIT`). The orchestrator sees that reason on the
thread tool result.

## Self-hosted model rejected

See [Custom and self-hosted base URLs](../configuration/model.md#custom-and-self-hosted-base-urls).
Public-IP HTTP needs `allow_insecure_http`. `openai-responses` will not talk to
vLLM; pick `openai-chat-completions` and include `/v1` on a typical vLLM root.

## Goal stopped after a stream blip

Transient stream/transport failures retry automatically (1s, then 2s,
exponential up to 30s). After three consecutive transient failures the goal
becomes `blocked` with recovery action `ResumeGoal`. Resume it. This is not a
402. See [Durable direct goals](direct-goals.md).

## Stop vs still-running tools

Composer **Stop** hides running state immediately. Cancel HTTP still waits until
the command tree is dead. A later request can 409 (`session is busy`) until that
wait finishes.

## Tool deadline vs wait_tasks

Prepared tools accept optional `_nac.timeout_ms` (1..3_600_000 ms). Default
bound five minutes; maximum one hour. Hitting the deadline cancels and settles
that invocation. `wait_tasks` has a separate observation timeout; do not
collapse the two. See [Independent direct tasks](independent-tasks.md).

## Remote MCP OAuth fails after a working loopback connect

The identity provider must have the per-server remote callback, not
`http://localhost:1456/mcp_library/oauth/callback`. See [MCP OAuth](mcp-oauth.md).

## database is locked → HTTP 409

Leftover `database is locked` and connection-capacity timeouts on mutating
routes map to HTTP 409. `POST /sessions` retries SQLITE_BUSY/LOCKED with short
delays inside an Immediate transaction. Exhausted retries still return no
session id.
