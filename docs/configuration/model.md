# Model configuration

Config lives at `~/.config/nac/config.toml`, or at `$NAC_HOME/config.toml` when `NAC_HOME` is set. A new session merges explicit CLI or web launch values over `[model]` in that file. `[model]` keeps only `model`, `reasoning_effort`, and `extra_headers`; the removed `backend`, `base_url`, and `api_key_env` keys in an older config are ignored with a one-time warning. The resulting `backend` and `model` must be present and nonblank before the session is created: the backend is explicit or resolved from the model id through the catalog. Model-only OpenAI inference remains `openai-responses` even though official OpenAI metadata is also presented under `openai-chat-completions`; selecting Chat Completions is always explicit. An unknown id therefore needs an explicit backend, but never needs catalog membership. An absent `base_url` materializes from the selected provider's endpoint default; a present value is validated rather than replaced.

## Custom and self-hosted base URLs

A caller-supplied `base_url` is never rewritten when invalid. Transport checks apply before NAC sends an API key:

1. **Shape.** The value must be an absolute `http` or `https` URL with a host and no embedded userinfo.
2. **Transport.** `http://` is accepted by default only for `localhost` / `*.localhost`, loopback, private (`10/8`, `172.16/12`, `192.168/16`), or link-local IP literals. Any other host requires `https://`, unless the saved configuration or session sets `allow_insecure_http = true`. That flag is intentionally dangerous: the API key, prompts, source, tool output, and responses may be read or modified in transit. It bypasses only the public-HTTP rejection; redirects stay disabled and credential headers stay protected. See [Model request security](../security/model-requests.md).

There is no host allowlist. Any public HTTPS origin is accepted for API-key backends. Managed `arcee-auth` and `chatgpt-codex-responses` still enforce their own origin policies.

Wire path is backend-specific. `openai-responses` posts to `{base}/responses`. Chat-completions backends (`openai-chat-completions`, `deepseek-chat`, `together-chat`, `fireworks-chat`) post to `{base}/chat/completions`, so a typical vLLM root should include the `/v1` prefix (`http://192.168.1.10:8000/v1`). vLLM usually speaks `/v1/chat/completions`, not `/responses` — pick `openai-chat-completions`, not `openai-responses`. Arcee backends are the exception: they join `/api/v1/chat/completions` themselves.

Model-only OpenAI ids still resolve to `openai-responses`. Selecting Chat Completions is always explicit. Unknown endpoints omit OpenAI-only optional extensions unless a `$NAC_HOME/models.json` override enables them.

Model selection is config-first, not environment-driven:

- NAC never reads `OPENAI_MODEL` or `OPENAI_BASE_URL` and does not infer a backend, model, or endpoint from provider conventions.
- A created session persists its complete effective model settings. Resume, server attachment, and managed workers use that stored snapshot rather than re-resolving the model tuple or credential selector from ambient config. Non-model runtime settings can still come from the current config.

Persisted session settings remain editable. In `nac-web`, open a session's **Settings** dialog; the equivalent API is `GET /sessions/{session_id}/config` and `PATCH /sessions/{session_id}/config`. PATCH validates the complete prospective model settings and current credentials before committing and leaves the previous snapshot unchanged on failure. Omitted fields are preserved; `null` clears `reasoning_effort` or `api_key_env`, `null` or `{}` clears `extra_headers`, `null` or `false` disables `allow_insecure_http`, and `null` or `0` disables `orchestrator_compaction_threshold`. Required `backend`, `model`, and `base_url` cannot be cleared. Settings can be opened and repaired even when an invalid or incomplete persisted snapshot cannot resume. A session with an active run must be cancelled before editing its settings; an active manual compaction must be allowed to finish.

The new-session form and `POST /sessions` share one tri-state rule: omitting a model field inherits its new-session config value, and `null` clears it. So `api_key_env: null` removes a configured selector and `reasoning_effort: null` omits the effort, while `"none"` is a concrete effort value rather than a way to clear it; `extra_headers: {}` replaces configured headers with an empty map. `orchestrator_compaction_threshold` defaults to 70% of the resolved model's context window when omitted and is disabled by `null` or `0`. Resume always uses the value persisted with the session, and managed workers do not inherit this orchestrator-only setting.

## Project defaults

A project's optional saved model configuration is a new-session inheritance
layer. Precedence is: explicit `POST /sessions` field, project configuration,
working-directory configuration, then built-in resolution. A saved
configuration supplies `model`, `backend`, `base_url`, `allow_insecure_http`, `reasoning_effort`,
`api_key_env`, `extra_headers`, `light_model`, and an explicit compaction
threshold. Its absent reasoning or credential selector clears the
working-directory value; an empty header map clears working-directory headers;
an absent light model selects single-model operation. An absent saved
compaction threshold leaves normal working-directory/built-in behavior.
`initial_prompt` is not used by session creation.

New chat and Settings can set or clear a per-chat `light_model` (`null`
disables dual-model). Direct-only presentation hides unused light-model
controls but preserves hidden settings
([session behaviors](../usage/session-behaviors.md)). The persisted session
snapshot wins on resume. `allow_insecure_http` is a single choice for the
primary and optional light model; it is not a `[model]` config.toml key.

The ordinary create-request tri-state remains authoritative over the project
layer: omission inherits, required model/backend/base URL fields reject
`null`, optional selector/effort/header fields clear on `null`, light-model
`null` disables it, and compaction `null` or `0` disables it. The merged result
is persisted in the session. Project edits affect later sessions only; resume
and session Settings PATCH never reread project defaults. A referenced saved
configuration cannot be deleted until the project clears or changes its
reference.

## Orchestrator compaction threshold

The orchestrator compaction threshold is an optional absolute token count for new orchestrator sessions. When omitted, it defaults to 70% of the resolved model's context window (rounded to the nearest whole token). A positive value is captured in each new session; an explicit `null` or `0` disables creating new checkpoints. The create-session JSON field is `orchestrator_compaction_threshold`: omission applies the 70%-of-context default, while `null` or `0` disables it. GET returns the persisted positive value or `null`; PATCH omission preserves it, and PATCH `null` or `0` disables it. The web launch and Settings forms expose the same rules. A `[compaction]` section in config.toml is silently ignored — the threshold is no longer inherited from config.

Before each ordinary model call, a session-backed orchestrator automatically compacts only when its estimated context reaches the configured threshold. Compaction replaces an oldest prefix with a durable historical summary, targeting at least half (rounded up) of the serialized UTF-8 JSON byte weight of the compactable provider context. Canonical System messages and separately supplied tool definitions are excluded from that weight and remain preserved; Tool messages count toward it, and the cut snaps forward to the first safe User, Assistant, or end boundary without splitting a tool-call/result group. The complete canonical transcript remains unchanged in session storage, checkpoint rows stay private, and workers never compact. The threshold is a proactive trigger rather than a hard context limit; an oversized retained tail can still produce a terminal `finish_reason=length`. Existing valid checkpoints remain active on resume even when creating new checkpoints is disabled. `POST /sessions/{session_id}/compact` bypasses the threshold and requests the same operation immediately without submitting a prompt; it is refused while another run or manual compaction is active.

## API-key selection

The API-key backends are `openai-responses`, `openai-chat-completions`, `together-chat`, `anthropic-messages`, `deepseek-chat`, `fireworks-chat`, and `arcee-api`. Each resolves its credential selector (`api_key_env`, the NAME of the one environment variable NAC may read) as follows:

- An explicit per-session `api_key_env` override always wins. The selector must match `[A-Za-z_][A-Za-z0-9_]*` exactly. NAC does not trim or rewrite it.
- With no explicit selector, NAC auto-selects the provider's conventional variable (`OPENAI_API_KEY`, `TOGETHER_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `FIREWORKS_API_KEY`, or `ARCEE_API_KEY`) when it exists in the environment, and persists the selected name into the session.
- With no explicit selector and no conventional variable set, validation fails with a guided error naming the provider's conventional variable.
- The selected variable must exist, contain Unicode, and have a nonempty, non-whitespace value when settings are validated for use.

`arcee-auth` and `chatgpt-codex-responses` instead use [providers and logins](credentials.md) and reject `api_key_env`, including an inherited selector. Clear it when switching a configured API-key session to either managed backend.

## Reasoning effort

NAC never supplies a reasoning effort unless one is explicitly configured or launched. Supported explicit values depend on the selected wire backend and, for Anthropic, the model family:

- Known official OpenAI models on `openai-responses`, `openai-chat-completions`, and `chatgpt-codex-responses`: `none`, `minimal`, `low`, `medium`, `high`, or `xhigh`. Unknown Chat Completions models start with no optional reasoning controls; add an explicit catalog override only when the endpoint supports them.
- `deepseek-chat`: `none`, `high`, or `xhigh`.
- `fireworks-chat` and `together-chat`: `none`, `low`, `medium`, or `high`.
- `anthropic-messages`: `none` sends no thinking controls. Claude Opus 4.6 and Sonnet 4.6 families, including dated snapshots, accept `low`, `medium`, and `high`; only Opus 4.6 also accepts `xhigh`, which maps to Anthropic `max`. Other Anthropic model names accept only `none`.
- `arcee-auth` and `arcee-api`: no explicit effort value is accepted; clear the setting.

Unsupported backend/model combinations are rejected before persistence or request dispatch.

## OpenAI Chat Completions

`openai-chat-completions` is the explicit protocol for the official OpenAI Chat Completions API and arbitrary compatible gateways. Its default is `https://api.openai.com/v1`, inference uses `POST <base_url>/chat/completions`, and model discovery is a best-effort `GET <base_url>/models`. A discovery error or an incomplete list is shown as a diagnostic but does not invalidate a manually entered model id. Unknown endpoints/models use a conservative request body: NAC omits OpenAI-only optional extensions unless catalog policy explicitly enables them.

Chat Completions sends neither `max_completion_tokens` nor legacy `max_tokens` by default. Catalog `max_tokens` remains metadata for context planning, display, and cost; it is never converted into a generation cap for this backend. A `$NAC_HOME/models.json` override may set `max_completion_tokens` for a deliberate modern cap, or `legacy_max_tokens` for a gateway that requires the old request field. They are mutually exclusive.
