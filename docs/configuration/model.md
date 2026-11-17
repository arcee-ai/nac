# Model configuration

Config lives at `~/.config/nac/config.toml`, or at `$NAC_HOME/config.toml` when `NAC_HOME` is set. A new session merges explicit CLI or web launch values over `[model]` in that file. `[model]` keeps only `model`, `reasoning_effort`, and `extra_headers`; the removed `backend`, `base_url`, and `api_key_env` keys in an older config are ignored with a one-time warning. The resulting `backend` and `model` must be present and nonblank before the session is created: the backend is explicit or resolved from the model id through the catalog. Model-only OpenAI inference remains `openai-responses` even though official OpenAI metadata is also presented under `openai-chat-completions`; selecting Chat Completions is always explicit. An unknown id therefore needs an explicit backend, but never needs catalog membership. An absent `base_url` materializes from the selected provider's endpoint default; a present value is validated rather than replaced.

Model selection is config-first, not environment-driven:

- NAC never reads `OPENAI_MODEL` or `OPENAI_BASE_URL` and does not infer a backend, model, or endpoint from provider conventions.
- A created session persists its complete effective model settings. Resume and server attachment use that stored snapshot rather than re-resolving the model tuple or credential selector from ambient config. Non-model runtime settings can still come from the current config.

Persisted session settings remain editable. In `nac-web`, open a session's **Settings** dialog; the equivalent API is `GET /sessions/{session_id}/config` and `PATCH /sessions/{session_id}/config`. PATCH validates the complete prospective model settings and current credentials before committing and leaves the previous snapshot unchanged on failure. Omitted fields are preserved; `null` clears `reasoning_effort` or `api_key_env`, `null` or `{}` clears `extra_headers`, `null` or `false` disables `allow_insecure_http`, and `null` or `0` disables `orchestrator_compaction_threshold`. Required `backend`, `model`, and `base_url` cannot be cleared. Settings can be opened and repaired even when an invalid or incomplete persisted snapshot cannot resume. A session with an active run must be cancelled before editing its settings; an active manual compaction must be allowed to finish.

The new-session form and `POST /sessions` share one tri-state rule: omitting a model field inherits its new-session config value, and `null` clears it. So `api_key_env: null` removes a configured selector and `reasoning_effort: null` omits the effort, while `"none"` is a concrete effort value rather than a way to clear it; `extra_headers: {}` replaces configured headers with an empty map. `orchestrator_compaction_threshold` defaults to 70% of the resolved model's effective input budget when omitted, capped by any lower provider auto-compaction limit and is disabled by `null` or `0`. Resume always uses the value persisted with the session.

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

The ordinary create-request tri-state remains authoritative over the project
layer: omission inherits, required model/backend/base URL fields reject
`null`, optional selector/effort/header fields clear on `null`, light-model
`null` disables it, and compaction `null` or `0` disables it. The merged result
is persisted in the session. Project edits affect later sessions only; resume
and session Settings PATCH never reread project defaults. A referenced saved
configuration cannot be deleted until the project clears or changes its
reference.

## Compaction threshold

The current API spelling `orchestrator_compaction_threshold` also controls
checkpoint creation for direct sessions. It is an optional absolute token count;
omission defaults to 70% of the resolved effective input budget, capped by any lower provider auto-compaction limit, while `null` or `0`
disables new checkpoints. GET returns the persisted value; PATCH omission
preserves it and `null` or `0` disables it. Existing valid checkpoints remain
active on resume. The neutral-contract retirement slice (ALL-615) owns renaming
this wire key.

Automatic compaction preserves the canonical transcript and keeps checkpoint
rows private. `POST /sessions/{session_id}/compact` requests compaction without
submitting a prompt and is refused during another run or manual compaction.

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
