# Model configuration

Choose a model for each new session in the web client or pass it explicitly when starting a session through the CLI or API. NAC stores the effective backend, model, endpoint and credential selector with that session; resume uses the stored selection. Provider credentials are managed independently and can be reused across sessions. Saved model presets and project model defaults are no longer supported. Existing `[model]` defaults in `config.toml` are ignored with a diagnostic.

NAC never reads `OPENAI_MODEL` or `OPENAI_BASE_URL`. An explicit backend may be selected or resolved from the selected model through the catalog. An unknown model ID requires an explicit backend. If no endpoint is supplied, the provider's endpoint is used; an explicitly supplied endpoint is validated.

Persisted session settings remain editable. In `nac-web`, open a session's **Settings** dialog; the equivalent API is `GET /sessions/{session_id}/config` and `PATCH /sessions/{session_id}/config`. PATCH validates the complete prospective model settings and current credentials before committing and leaves the previous snapshot unchanged on failure. Omitted fields are preserved; `null` clears `reasoning_effort` or `api_key_env`, `null` or `{}` clears `extra_headers`, `null` or `false` disables `allow_insecure_http`, and `null` or `0` disables `orchestrator_compaction_threshold`. Required `backend`, `model`, and `base_url` cannot be cleared. Settings can be opened and repaired even when an invalid or incomplete persisted snapshot cannot resume. A session with an active run must be cancelled before editing its settings; an active manual compaction must be allowed to finish.

A new session requires its own model selection. Optional `reasoning_effort`, credential selector and headers are chosen for that session; `null` clears an optional value. A provider connection stores a credential independently and makes its endpoint available when selecting a session model. A project supplies its working location, not model settings.

## Compaction threshold

The current API spelling `orchestrator_compaction_threshold` also controls
checkpoint creation for direct sessions. It is an optional absolute token count;
omission defaults to 70% of the planning budget, while `null` or `0` disables
new checkpoints. For Codex, the budget is the effective input limit, capped by
any lower provider auto-compaction limit. GET returns the current resolved value
for automatic sessions and the persisted value for fixed sessions; PATCH omission
preserves the policy and `null` or `0` disables it. Existing valid checkpoints remain
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
