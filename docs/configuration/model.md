# Model configuration

Config lives at `~/.config/nac/config.toml`, or at `$NAC_HOME/config.toml` when `NAC_HOME` is set. A new session merges explicit CLI or web launch values over `[model]` in that file. `[model]` keeps only `model`, `reasoning_effort`, and `extra_headers`; the removed `backend`, `base_url`, and `api_key_env` keys in an older config are ignored with a one-time warning. The resulting `backend` and `model` must be present and nonblank before the session is created: the backend is explicit or resolved from the model id through the catalog (a unique exact match wins; a collision prefers the non-managed provider with a warning; an unknown id stays unresolved). An absent `base_url` materializes from the catalog's provider endpoint default — the five models.dev providers and `arcee-api` carry one, and the managed `chatgpt-codex-responses` and `arcee-auth` backends use their fixed canonical URLs. A present value is validated rather than replaced.

Model selection is config-first, not environment-driven:

- NAC never reads `OPENAI_MODEL` or `OPENAI_BASE_URL` and does not infer a backend, model, or endpoint from provider conventions.
- A created session persists its complete effective model settings. Resume, server attachment, and managed workers use that stored snapshot rather than re-resolving the model tuple or credential selector from ambient config. Non-model runtime settings can still come from the current config.

Persisted session settings remain editable. In `nac-web`, open a session's **Settings** dialog; the equivalent API is `GET /sessions/{session_id}/config` and `PATCH /sessions/{session_id}/config`. PATCH validates the complete prospective model settings and current credentials before committing and leaves the previous snapshot unchanged on failure. Omitted fields are preserved; `null` clears `reasoning_effort` or `api_key_env`, `null` or `{}` clears `extra_headers`, and `null` or `0` disables `orchestrator_compaction_threshold`. Required `backend`, `model`, and `base_url` cannot be cleared. Settings can be opened and repaired even when an invalid or incomplete persisted snapshot cannot resume. A session with an active run must be cancelled before editing its settings; an active manual compaction must be allowed to finish.

The new-session form and `POST /sessions` share one tri-state rule: omitting a model field inherits its new-session config value, and `null` clears it. So `api_key_env: null` removes a configured selector and `reasoning_effort: null` omits the effort, while `"none"` is a concrete effort value rather than a way to clear it; `extra_headers: {}` replaces configured headers with an empty map. `orchestrator_compaction_threshold` defaults to 70% of the resolved model's context window when omitted and is disabled by `null` or `0`. Resume always uses the value persisted with the session, and managed workers do not inherit this orchestrator-only setting.

## Orchestrator compaction threshold

The orchestrator compaction threshold is an optional absolute token count for new orchestrator sessions. When omitted, it defaults to 70% of the resolved model's context window (rounded to the nearest whole token). A positive value is captured in each new session; an explicit `null` or `0` disables creating new checkpoints. The create-session JSON field is `orchestrator_compaction_threshold`: omission applies the 70%-of-context default, while `null` or `0` disables it. GET returns the persisted positive value or `null`; PATCH omission preserves it, and PATCH `null` or `0` disables it. The web launch and Settings forms expose the same rules. A `[compaction]` section in config.toml is silently ignored — the threshold is no longer inherited from config.

Before each ordinary model call, a session-backed orchestrator automatically compacts only when its estimated context reaches the configured threshold. Compaction replaces an oldest prefix with a durable historical summary, targeting at least half (rounded up) of the serialized UTF-8 JSON byte weight of the compactable provider context. Canonical System messages and separately supplied tool definitions are excluded from that weight and remain preserved; Tool messages count toward it, and the cut snaps forward to the first safe User, Assistant, or end boundary without splitting a tool-call/result group. The complete canonical transcript remains unchanged in session storage, checkpoint rows stay private, and workers never compact. The threshold is a proactive trigger rather than a hard context limit; an oversized retained tail can still produce a terminal `finish_reason=length`. Existing valid checkpoints remain active on resume even when creating new checkpoints is disabled. `POST /sessions/{session_id}/compact` bypasses the threshold and requests the same operation immediately without submitting a prompt; it is refused while another run or manual compaction is active.

## API-key selection

The API-key backends are `openai-responses`, `together-chat`, `anthropic-messages`, `deepseek-chat`, `fireworks-chat`, and `arcee-api`. Each resolves its credential selector (`api_key_env`, the NAME of the one environment variable NAC may read) as follows:

- An explicit per-session `api_key_env` override always wins. The selector must match `[A-Za-z_][A-Za-z0-9_]*` exactly. NAC does not trim or rewrite it.
- With no explicit selector, NAC auto-selects the provider's conventional variable (`OPENAI_API_KEY`, `TOGETHER_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `FIREWORKS_API_KEY`, or `ARCEE_API_KEY`) when it exists in the environment, and persists the selected name into the session.
- With no explicit selector and no conventional variable set, validation fails with a guided error naming the provider's conventional variable.
- The selected variable must exist, contain Unicode, and have a nonempty, non-whitespace value when settings are validated for use.

`arcee-auth` and `chatgpt-codex-responses` instead use [providers and logins](credentials.md) and reject `api_key_env`, including an inherited selector. Clear it when switching a configured API-key session to either managed backend.

## Reasoning effort

NAC never supplies a reasoning effort unless one is explicitly configured or launched. Supported explicit values depend on the selected wire backend and, for Anthropic, the model family:

- `openai-responses` and `chatgpt-codex-responses`: `none`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
- `deepseek-chat`: `none`, `high`, or `xhigh`.
- `fireworks-chat` and `together-chat`: `none`, `low`, `medium`, or `high`.
- `anthropic-messages`: `none` sends no thinking controls. Claude Opus 4.6 and Sonnet 4.6 families, including dated snapshots, accept `low`, `medium`, and `high`; only Opus 4.6 also accepts `xhigh`, which maps to Anthropic `max`. Other Anthropic model names accept only `none`.
- `arcee-auth` and `arcee-api`: no explicit effort value is accepted; clear the setting.

Unsupported backend/model combinations are rejected before persistence or request dispatch.
