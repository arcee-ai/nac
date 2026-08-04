# nac

Small coding agent.
Heavily inspired by [slate](https://randomlabs.ai/blog/slate). Also takes inspiration from [nanocode](https://github.com/1rgs/nanocode) and [pi](https://github.com/badlogic/pi-mono).

Install the latest `edge` build:

```sh
curl -fsSL https://raw.githubusercontent.com/arcee-ai/nac/main/scripts/install.sh | sh
```

Pinned version installs are not supported yet.

The installer places one binary in `$HOME/.local/bin` by default:

- `nac-web`: the web dashboard for managing multiple sessions, plus utility commands such as `codex-auth`, `arcee-auth`, and `upgrade`.

### Choose auth

Pick one path before you start a session — each unlocks a different set of models:

| Path | Command | What you get |
| --- | --- | --- |
| **Arcee (recommended)** | `nac-web arcee-auth login` | Arcee account via device-code login → open / Trinity models, no API key |
| **ChatGPT Codex** | `nac-web codex-auth login` | ChatGPT account via OAuth → OpenAI / Codex models |
| **API key** | export the provider's conventional env var | Any catalog provider (DeepSeek, Fireworks, Together, OpenAI, Anthropic, `arcee-api`, …) |

Arcee login is the shortest path to Arcee's hosted open models. Codex login is for people who already use ChatGPT and want those models inside nac. API keys skip browser login entirely. Details for the managed flows are under [Managed credentials and endpoints](#managed-credentials-and-endpoints).

Before launching a new session, configure a `model` (or pick one in the dashboard's model picker). The backend resolves from the model id through the embedded model catalog, the base URL materializes from the catalog's provider endpoint default, and an API-key credential auto-selects the provider's conventional environment variable when it is set — so a bare `model` is usually the whole configuration. Explicit `backend`, `base_url`, and `api_key_env` overrides remain available per session. The full contract and examples are under [Model configuration](#model-configuration).

Linux installs use the portable static build.

Upgrade to the latest `edge` build:

```sh
nac-web upgrade
```

`nac-web upgrade` reinstalls `nac-web`.

Run the web dashboard from the project you want to work in:

```sh
nac-web
```

It confirms the current working directory as the project folder (`Y` to accept, `n` to type another path), then listens on `http://127.0.0.1:3210` and opens that URL in your browser. Pass `-C /path/to/project` to skip the prompt, or `-y` to accept cwd non-interactively. Pass `-p 4321` or `--port 4321` to choose a custom loopback port in the range `1..=65535`; use `--bind` instead to specify a full IPv4 or IPv6 loopback address. `--port` and `--bind` cannot be combined. The dashboard is a React app whose build output is committed under `crates/nac-server/assets/dist` and embedded in the binary, so a release never needs Node. `nac-web` exposes a central session manager for web clients. It resolves one server store at startup, then can create, resume, inspect, submit prompts to, and stream events from multiple sessions at once.

Server and session lifecycle:

- `GET /health`
- `GET /store`
- `GET /sessions`
- `POST /sessions`
- `PUT /sessions/order`
- `GET /sessions/{session_id}`
- `DELETE /sessions/{session_id}`
- `PUT /sessions/{session_id}/presentation`

Conversation and runs:

- `GET /sessions/{session_id}/messages`
- `GET /sessions/{session_id}/threads/{thread_name}/events`
- `POST /sessions/{session_id}/runs`
- `POST /sessions/{session_id}/compact`
- `POST /sessions/{session_id}/steering`
- `POST /sessions/{session_id}/threads/{thread_name}/steering`
- `GET /sessions/{session_id}/events?after_sequence_id=0`
- `GET /sessions/{session_id}/events/stream?after_sequence_id=0`
- `POST /sessions/{session_id}/cancel-active-run`

Session settings:

- `GET /sessions/{session_id}/config`
- `PATCH /sessions/{session_id}/config`

Workspace, for browsing what a session changed. In a git checkout every run also freezes the tree as a revision under `refs/nac/revisions/*`, staged through a private index so the user's own index is never touched, which keeps earlier runs inspectable. Capture is a convenience: a workspace nac cannot capture still finishes its runs normally:

- `GET /sessions/{session_id}/workspace/diff`
- `GET /sessions/{session_id}/workspace/files`
- `GET /sessions/{session_id}/workspace/file`
- `GET /sessions/{session_id}/workspace/branches`
- `POST /sessions/{session_id}/workspace/branches`
- `GET /sessions/{session_id}/workspace/revisions`
- `GET /sessions/{session_id}/workspace/revisions/{revision_id}/changes`

Launch support, used by the new-session form. Saved model configurations live in the store; `POST /providers/models` forwards a key once to list the models it may use and never stores it, while `/model-configs/from-file` resolves an on-disk configuration the same way a session launch would:

- `GET /fs/browse`
- `POST /sessions/launch-defaults`
- `POST /providers/models`
- `GET /model-configs`
- `POST /model-configs`
- `POST /model-configs/from-file`
- `DELETE /model-configs/{config_id}`
- `POST /model-configs/{config_id}/models`

Stored credentials are write-only over HTTP: a caller may add, replace, or drop a key, but the value is never echoed back — only a suffix long enough to tell two keys apart:

- `GET /credentials`
- `PUT /credentials/{name}`
- `DELETE /credentials/{name}`

`nac-web` binds only to IPv4/IPv6 loopback and has no built-in authentication. Requests are refused unless the `Host` header names a loopback address or `localhost`, which blocks DNS rebinding; `Origin`, `Sec-Fetch-Site`, and CSRF are still not enforced. Tunnels and reverse proxies can expose the loopback listener remotely; their public name must be listed in `NAC_ALLOWED_HOSTS` (comma-separated, `*` disables the check), and whatever fronts the server must provide strong authentication before forwarding traffic to `nac-web`. Anyone able to reach the server is trusted.

Snapshot messages can be bounded with `message_limit`; only then does snapshot `include_system=true` affect the selected page and add `message_page`/`message_cycle`. `GET .../messages` pages backward with `before` and `limit` (and accepts `include_system`), while thread events page with `before_id` and `limit` and return `next_before_id`. Persisted snapshot and initial thread-event-page baselines carry `thread_event_boundary: {epoch_id, sequence_id}`; merge only later envelopes from the same epoch. SSE first reports `{epoch_id, replay_boundary_sequence_id}` and supports sequence replay within that epoch. Finite responses may be gzip-compressed; SSE is never compressed.

The store schema is version 6 and upgrades forward. Back up each store before upgrading; v6 stores must not be opened with older binaries or downgraded. Do not use mixed-version writers against one store. Parent binaries and custom worker executables must use matching releases; mixed versions are unsupported because the required `--dispatch-id` worker protocol is version-coupled. Operational tool telemetry is intentionally lossy: full tool arguments, tool results, and log/error text are omitted or sanitized before persistence and streaming. The deliberate exception is `key_arg_preview`: each tool call persists and streams a short (roughly 120-character) human-readable snippet of its key argument — the path for file tools, the command for `exec_command`, the input for `write_stdin` — so the dashboard can show what a call is doing. Snapshots, SSE, and thread-event APIs may still carry conversation or assistant content and remain sensitive, as do canonical message APIs. Snapshot metadata omits extra-header values; `GET /sessions/{session_id}/config` is the authoritative, sensitive repair view.

`AGENTS.md` is loaded hierarchically from the project and globally from `NAC_HOME` / `~/.config/nac`. Skills are discovered from project and user skill directories; the orchestrator sees compact skill metadata and preloads selected skills for worker threads, while workers do not activate skills themselves. nac ignores `disable-model-invocation`; avoid interactive skills because nac is intended to run rather autonomously. Sessions are stored in the project store (`.nac/store.db` by default): open the web dashboard to list and select existing sessions, or use the `GET /sessions` and `GET /sessions/{session_id}` API endpoints to inspect a specific session. Worker thread history does not auto-compact.

Uninstall:

```sh
curl -fsSL https://raw.githubusercontent.com/arcee-ai/nac/main/scripts/uninstall.sh | sh
```

`nac-web` can run tools inside a Podman sandbox (requires Podman to be installed):

```sh
nac-web --sandbox
```

By default this mounts the current directory into the sandbox at `/workspace`.

For a custom setup:

- `--no-mount-cwd` disables the default current-directory mount
- `--mount HOST:GUEST` adds a read-write mount
- `--mount-ro HOST:GUEST` adds a read-only mount
- `--sandbox-image IMAGE` overrides the default image (`python:3.13-bookworm`)

On macOS, start Podman first:

```sh
podman machine init
podman machine start
```

## Model configuration

Config lives at `~/.config/nac/config.toml`, or at `$NAC_HOME/config.toml` when `NAC_HOME` is set. A new session merges explicit CLI or web launch values over `[model]` and `[compaction]` in that file. `[model]` keeps only `model`, `reasoning_effort`, and `extra_headers`; the removed `backend`, `base_url`, and `api_key_env` keys in an older config are ignored with a one-time warning. The resulting `backend` and `model` must be present and nonblank before the session is created: the backend is explicit or resolved from the model id through the catalog (a unique exact match wins; a collision prefers the non-managed provider with a warning; an unknown id stays unresolved). An absent `base_url` materializes from the catalog's provider endpoint default — the five models.dev providers and `arcee-api` carry one, and the managed `chatgpt-codex-responses` and `arcee-auth` backends use their fixed canonical URLs. A present value is validated rather than replaced.

Model selection is config-first, not environment-driven:

- NAC never reads `OPENAI_MODEL` or `OPENAI_BASE_URL` and does not infer a backend, model, or endpoint from provider conventions.
- A created session persists its complete effective model settings. Resume, server attachment, and managed workers use that stored snapshot rather than re-resolving the model tuple or credential selector from ambient config. Non-model runtime settings can still come from the current config.

Persisted session settings remain editable. In `nac-web`, open a session's **Settings** dialog; the equivalent API is `GET /sessions/{session_id}/config` and `PATCH /sessions/{session_id}/config`. PATCH validates the complete prospective model settings and current credentials before committing and leaves the previous snapshot unchanged on failure. Omitted fields are preserved; `null` clears `reasoning_effort` or `api_key_env`, `null` or `{}` clears `extra_headers`, and `null` or `0` disables `orchestrator_compaction_threshold`. Required `backend`, `model`, and `base_url` cannot be cleared. Settings can be opened and repaired even when an invalid or incomplete persisted snapshot cannot resume. A session with an active run must be cancelled before editing its settings; an active manual compaction must be allowed to finish.

The new-session form and `POST /sessions` share one tri-state rule: omitting a model field inherits its new-session config value, and `null` clears it. So `api_key_env: null` removes a configured selector and `reasoning_effort: null` omits the effort, while `"none"` is a concrete effort value rather than a way to clear it; `extra_headers: {}` replaces configured headers with an empty map. `orchestrator_compaction_threshold` inherits `[compaction].threshold_tokens` when omitted and is disabled by `null` or `0`. Resume always uses the value persisted with the session, and managed workers do not inherit this orchestrator-only setting.

### Orchestrator compaction threshold

`[compaction].threshold_tokens` is an optional absolute token count for new orchestrator sessions. A positive value is captured in each new session; an absent or zero value disables creating new checkpoints. The create-session JSON field is `orchestrator_compaction_threshold`: omission inherits config, while `null` or `0` disables it. GET returns the persisted positive value or `null`; PATCH omission preserves it, and PATCH `null` or `0` disables it. The web launch and Settings forms expose the same rules.

Before each ordinary model call, a session-backed orchestrator automatically compacts only when its estimated context reaches the configured threshold. Compaction replaces an oldest prefix with a durable historical summary, targeting at least half (rounded up) of the serialized UTF-8 JSON byte weight of the compactable provider context. Canonical System messages and separately supplied tool definitions are excluded from that weight and remain preserved; Tool messages count toward it, and the cut snaps forward to the first safe User, Assistant, or end boundary without splitting a tool-call/result group. The complete canonical transcript remains unchanged in session storage, checkpoint rows stay private, and workers never compact. The threshold is a proactive trigger rather than a hard context limit; an oversized retained tail can still produce a terminal `finish_reason=length`. Existing valid checkpoints remain active on resume even when creating new checkpoints is disabled. `POST /sessions/{session_id}/compact` bypasses the threshold and requests the same operation immediately without submitting a prompt; it is refused while another run or manual compaction is active.

### API-key selection

The API-key backends are `openai-responses`, `together-chat`, `anthropic-messages`, `deepseek-chat`, `fireworks-chat`, and `arcee-api`. Each resolves its credential selector (`api_key_env`, the NAME of the one environment variable NAC may read) as follows:

- An explicit per-session `api_key_env` override always wins. The selector must match `[A-Za-z_][A-Za-z0-9_]*` exactly. NAC does not trim or rewrite it.
- With no explicit selector, NAC auto-selects the provider's conventional variable (`OPENAI_API_KEY`, `TOGETHER_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `FIREWORKS_API_KEY`, or `ARCEE_API_KEY`) when it exists in the environment, and persists the selected name into the session.
- With no explicit selector and no conventional variable set, validation fails with a guided error naming the provider's conventional variable.
- The selected variable must exist, contain Unicode, and have a nonempty, non-whitespace value when settings are validated for use.

`arcee-auth` and `chatgpt-codex-responses` instead use managed credentials and reject `api_key_env`, including an inherited selector. Clear it when switching a configured API-key session to either managed backend.

### Reasoning effort

NAC never supplies a reasoning effort unless one is explicitly configured or launched. Supported explicit values depend on the selected wire backend and, for Anthropic, the model family:

- `openai-responses` and `chatgpt-codex-responses`: `none`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
- `deepseek-chat`: `none`, `high`, or `xhigh`.
- `fireworks-chat` and `together-chat`: `none`, `low`, `medium`, or `high`.
- `anthropic-messages`: `none` sends no thinking controls. Claude Opus 4.6 and Sonnet 4.6 families, including dated snapshots, accept `low`, `medium`, and `high`; only Opus 4.6 also accepts `xhigh`, which maps to Anthropic `max`. Other Anthropic model names accept only `none`.
- `arcee-auth` and `arcee-api`: no explicit effort value is accepted; clear the setting.

Unsupported backend/model combinations are rejected before persistence or request dispatch.

### Example config

```toml
[agents_md]
fallback_filenames = []
max_bytes = 4194304

[storage]
store_path = ".nac/store.db"

[model]
model = "gpt-5.5"
reasoning_effort = "xhigh"

[compaction]
threshold_tokens = 64000

[sandbox]
image = "python:3.13-bookworm"

[worker]
thread_timeout_secs = 3600

[mcp_servers.exa_web_search]
enabled = true
transport = "streamable_http"
url = "https://mcp.exa.ai/mcp"

[mcp_servers.context7]
enabled = true
transport = "streamable_http"
url = "https://mcp.context7.com/mcp"

[mcp_servers.grep_app]
enabled = true
transport = "streamable_http"
url = "https://mcp.grep.app"
```

Supported MCP transports right now are `stdio` and `streamable_http`. Stdio servers can provide `command`, `args`, and `env`; streamable HTTP servers provide `url` and optional `headers`. MCP string values support `${ENV_VAR}` expansion.

## Model catalog, overrides, and cost

NAC ships an embedded model catalog generated from [models.dev](https://models.dev): per-model context windows, maximum output tokens, pricing per 1M tokens, and supported reasoning effort levels for the `deepseek-chat`, `fireworks-chat`, `together-chat`, `openai-responses`, and `anthropic-messages` backends (`arcee-auth`/`arcee-api` and `chatgpt-codex-responses` entries are maintained by hand). Effort validation, Anthropic `max_tokens`, and per-response cost all read this catalog. Each provider also carries a conventional credential variable name and an endpoint default base URL, which drive credential auto-selection and absent-`base_url` materialization; a configured model id resolves its provider through the catalog (unique exact match; collisions prefer the non-managed provider with a warning). A model the catalog does not know resolves from its provider's default entry with conservative fallbacks (128k context, 16k max output, zero cost), so unknown models keep working.

At startup, `nac-web` spawns a fire-and-forget background refresh that revalidates the catalog against models.dev with the stored ETag, at most once every 4 hours. A changed payload is mapped into `$NAC_HOME/model-catalog/overlay.json` (atomic write) and loaded over the embedded baseline; a `304` defers the next check, and any failure leaves the cached overlay and baseline untouched and retries on the next start. The refresh never blocks model calls, and resolution, picker, resume, and validation paths never perform network I/O — offline operation always works from the cached overlay and the embedded baseline. A corrupt overlay, or one older than the embedded baseline, is ignored with a warning. `MODELS_DEV_URL` can point the refresh at a mirror.

Per-deployment overrides live in `$NAC_HOME/models.json` (`~/.config/nac/models.json` by default):

```json
{
  "overrides": [
    {
      "provider": "anthropic-messages",
      "model": "claude-haiku-4-5",
      "set": { "thinking_level_map": { "none": "none", "high": "high" } }
    },
    {
      "provider": "openai-responses",
      "model": "my-local-model",
      "set": { "context_window": 262144, "max_tokens": 32768 }
    }
  ]
}
```

- `provider` is a backend id; `model` is an exact model id, or `_default` to patch the provider-wide fallback entry. An unknown id derives its base metadata from the dated-snapshot family entry or the provider default before patching, so overriding a model the catalog does not know yet — for example one served by a custom `base_url` — is the supported self-unblock path.
- `set` accepts `display_name`, `context_window`, `max_tokens`, `cost` (`input`/`output`/`cache_read`/`cache_write` per 1M tokens), `cache_write_1h`, `reasoning`, and `thinking_level_map`. The wire protocol (`api`) and adapter quirks (`compat`) are not patchable.
- `thinking_level_map` replaces the model's whole effort map; keys are effort levels (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`) and values are provider wire values. This is how effort validation is relaxed per model — the first override above lets `claude-haiku-4-5` accept `high`.
- Precedence is user overrides over the runtime overlay over the embedded baseline over the provider default over the fallback. A malformed file degrades to a warning with the baseline still usable; invalid entries are skipped individually with warnings.

Every model response carries a dollar cost in its token usage, computed from catalog pricing as `tokens × rate` per input/output/cache-read/cache-write bucket (micro-USD, rounded half-up per response). Anthropic 1-hour cache writes bill at the `cache_write_1h` rate (default 2× the input rate); unknown pricing bills zero rather than failing. Cost rides in the `TokenUsageUpdated` event's `usage.cost` and accumulates into the session's persisted token accounting. The dashboard shows it in the session bar's tokens metric (cumulative cost appended to the token counts), in that metric's tooltip (a per-bucket breakdown plus the last response's cost), and in each worker's token-usage panel (a Cost row). Unknown pricing renders as `—`, never `$0.00`.

### Model selection in the dashboard

The launch dialog and the session settings panel pick models from a searchable combobox: entries grouped by provider, each row showing the display name, model id, context window, and per-1M pricing (`pricing unknown` when the catalog has no rates). The reasoning dropdown is constrained to the selected model's supported effort levels and hidden when the model accepts none; an unrecognized model assumes its provider's default effort list, flagged as assumed and validated by the backend on submit. A persistent "Custom model…" option enters an arbitrary model id on a chosen provider for endpoints the catalog does not know. Selections the catalog does not recognize carry an `unrecognized model — conservative defaults` badge; models patched by `$NAC_HOME/models.json` carry a `customized` badge. If the catalog cannot be loaded, both surfaces fall back to manual backend and model entry with a notice.

`GET /models` serves the listing as `{ catalog_version, providers }`. Each provider carries its auth requirement (`api_key_env`, `managed_arcee`, or `codex_oauth`), a per-request `auth_status` (`ready` or `no_credential`) with an `auth_hint` (the conventional credential env var name or the login command), any managed base URL, the catalog endpoint default base URL, the provider default limits (context window, max output, default effort list), and its model entries with per-model limits, pricing, and supported efforts. `catalog_version` is a monotonic counter bumped on every catalog reload.

A provider with no usable credential gets a `no credential detected` badge in the picker, with the fix path in the tooltip (set the named environment variable or choose a custom selector; run the login command for managed providers). The status is computed per request from the server process environment and the managed credential files; it is informational only — it never blocks selection and never changes how auth works.

The launch dialog's collapsed `overrides` disclosure holds the per-session endpoint overrides: base url, API key variable, and extra headers (a JSON object). Empty fields do nothing — the normal config resolution applies; filled fields override the configured values for the new session, with a filled extra-headers field replacing the configured map. The base url and API key variable fields hide for managed backends, which need neither.

The `compaction threshold (tokens)` field auto-suggests 70% of the selected model's context window in whole tokens on every picker model change, in both the launch dialog and the settings panel; the field stays editable and a manual value persists until the next model change.

## Managed credentials and endpoints

### ChatGPT Codex OAuth

Run `nac-web codex-auth login`, `nac-web codex-auth status`, or `nac-web codex-auth logout` to manage Codex OAuth. Login requests device codes from `https://auth.openai.com/api/accounts/deviceauth/usercode`, polls `https://auth.openai.com/api/accounts/deviceauth/token`, opens `https://auth.openai.com/codex/device` for browser verification, and exchanges or refreshes tokens at `https://auth.openai.com/oauth/token`. The `chatgpt-codex-responses` backend materializes `base_url = "https://chatgpt.com/backend-api"` when the setting is absent; an explicitly supplied value must still pass the managed Codex endpoint checks (an optional trailing slash is accepted). It posts streaming Responses requests (`stream: true`, `Accept: text/event-stream`) to `https://chatgpt.com/backend-api/codex/responses`, forwards live text and reasoning deltas to the dashboard when a client is watching, reads OAuth only from `auth.json`, and never accepts an API-key selector.

### Arcee managed auth and API keys

Arcee credential mode is explicit:

- `arcee-auth` reads the API key and inference origin saved by `nac-web arcee-auth login` in `arcee_auth.json`. It rejects `api_key_env`. When `base_url` is absent NAC materializes `https://api.arcee.ai/api/v1`; a configured value must have the same origin as the stored credential.
- `arcee-api` never reads `arcee_auth.json`. Its endpoint default is `https://api.arcee.ai/api/v1`; its credential auto-selects `ARCEE_API_KEY` when set, and an explicit `api_key_env` selector names another variable.

Manage the stored Arcee login with:

```sh
nac-web arcee-auth login
nac-web arcee-auth status
nac-web arcee-auth logout
```

The login control plane is fixed at `https://api.arcee.ai`, using `/app/v1/device/code` and `/app/v1/device/token`; environment variables cannot redirect it. The login response supplies the approved Arcee inference origin. `status` shows its workspace, organization, base URL, and credential path without printing the key.

Both Arcee backends accept only `https` origins on `arcee.ai` or its subdomains with effective port 443. Accepted inference paths are `/`, `/api`, `/api/v1`, and `/api/v1/chat/completions`; all resolve to `/api/v1/chat/completions`. Other hosts and path forms are rejected.

A managed login is selected explicitly in the dashboard's model picker (or with a per-session `backend = "arcee-auth"` override): the Trinity model ids collide with `arcee-api` in the catalog, and a collision resolves to the non-managed provider. The managed session's base URL defaults to `https://api.arcee.ai/api/v1`.

An Arcee API-key session resolves from the model id alone when `ARCEE_API_KEY` is exported:

```toml
[model]
model = "trinity-large-thinking"
```

To use a different key variable, set a per-session `api_key_env = "MY_ARCEE_KEY"` override.

### Credential files

Managed credentials live in the NAC home directory: `$NAC_HOME` when set, otherwise `$XDG_CONFIG_HOME/nac` when set, otherwise `~/.config/nac`. Arcee uses only `arcee_auth.json`; ChatGPT Codex uses only `auth.json`.

Credential reads reject symlinks and non-regular files, and writes use locking plus atomic replacement. On Unix, managed credential files must have no group or other permission bits; reads reject files such as mode `0644` or `0660`, and writes create owner-only mode-`0600` files. Non-Unix platforms retain the symlink, regular-file, locking, and atomic-write checks without the Unix mode-bit policy. Each logout command removes only its own credential path and does not follow a symlink target.

## Model request security

All model inference clients disable HTTP redirects so prompts, credentials, and request bodies are not replayed to a redirect destination. This applies to every backend, not only Arcee. Extra headers are validated centrally for every backend and cannot override `Host`, `Authorization`, `Proxy-Authorization`, or `x-api-key` in any letter case; backend-selected credentials remain authoritative. Invalid header names and values are also rejected before dispatch.
