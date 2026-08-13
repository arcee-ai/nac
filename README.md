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

The HTTP API covers health and store metadata; session lifecycle, configuration, runs, messages, thread events, and workspace operations; model, SSH, MCP, auth, and credential management; and the streamable HTTP MCP service. Useful starting points are `POST /sessions`, `POST /sessions/{session_id}/runs`, and `GET /sessions/{session_id}/events/stream?after_sequence_id=0`. The exact route inventory is the `api_router` function in [`crates/nac-server/src/lib.rs`](crates/nac-server/src/lib.rs).

In a git checkout every run also freezes the tree as a revision under `refs/nac/revisions/*`, staged through a private index so the user's own index is never touched. Capture is a convenience: a workspace nac cannot capture still finishes its runs normally. Saved model configurations live in the store. Provider model discovery forwards a key once and never stores it, while importing a model config resolves an on-disk configuration as a session launch would. Stored credentials are write-only over HTTP: callers can add, replace, or remove a key, but only an identifying suffix is returned.

`nac-web` binds only to IPv4/IPv6 loopback and has no built-in authentication. Requests are refused unless the `Host` header names a loopback address or `localhost`, which blocks DNS rebinding; `Origin`, `Sec-Fetch-Site`, and CSRF are still not enforced. Tunnels and reverse proxies can expose the loopback listener remotely; their public name must be listed in `NAC_ALLOWED_HOSTS` (comma-separated, `*` disables the check), and whatever fronts the server must provide strong authentication before forwarding traffic to `nac-web`. Anyone able to reach the server is trusted.

The store schema upgrades forward. Back up each store before upgrading; do not downgrade it, use mixed-version writers, or combine parent binaries and custom workers from different releases. API responses and event streams can contain conversation or assistant content and are sensitive. Operational tool telemetry omits or sanitizes most full arguments, results, and logs, but exposes short identifying previews. `GET /sessions/{session_id}/config` is the authoritative, sensitive settings repair view.

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

Config lives at `~/.config/nac/config.toml`, or at `$NAC_HOME/config.toml` when `NAC_HOME` is set. A new session merges explicit CLI or web launch values over `[model]` in that file. `[model]` keeps only `model`, `reasoning_effort`, and `extra_headers` as launch defaults; the removed `backend`, `base_url`, and `api_key_env` keys no longer select the launched model tuple and produce a one-time warning. For credential safety, a legacy `[model].base_url` still authorizes that configured destination for API-key forwarding. The resulting `backend` and `model` must be present and nonblank before the session is created: the backend is explicit or resolved from the model id through the catalog (a unique exact match wins; a collision prefers the non-managed provider with a warning; an unknown id stays unresolved). An absent `base_url` materializes from the catalog's provider endpoint default — the five models.dev providers and `arcee-api` carry one, and the managed `chatgpt-codex-responses` and `arcee-auth` backends use their fixed canonical URLs. A present value is validated rather than replaced.

Model selection is config-first, not environment-driven:

- NAC never reads `OPENAI_MODEL` or `OPENAI_BASE_URL` and does not infer a backend, model, or endpoint from provider conventions.
- A created session persists its complete effective model settings. Resume, server attachment, and managed workers use that stored snapshot rather than re-resolving the model tuple or credential selector from ambient config. Non-model runtime settings can still come from the current config.

Persisted session settings remain editable. In `nac-web`, open a session's **Settings** dialog; the equivalent API is `GET /sessions/{session_id}/config` and `PATCH /sessions/{session_id}/config`. PATCH validates the complete prospective model settings and current credentials before committing and leaves the previous snapshot unchanged on failure. Omitted fields are preserved; `null` clears `reasoning_effort` or `api_key_env`, and `null` or `{}` clears `extra_headers`. Required `backend`, `model`, and `base_url` cannot be cleared. Settings can be opened and repaired even when an invalid or incomplete persisted snapshot cannot resume. A session with an active run must be cancelled before editing its settings; an active manual compaction must be allowed to finish.

For new sessions, omitted `model`, `reasoning_effort`, or `extra_headers` values inherit `[model]`; `null` clears optional values. An omitted `api_key_env` uses credential auto-selection, while `null` explicitly selects no variable. `"none"` is a concrete reasoning effort, and `extra_headers: {}` explicitly selects an empty map. Compaction has its own rules below.

### Orchestrator compaction threshold

The orchestrator compaction threshold is an optional absolute token count. For a new session, omitting `orchestrator_compaction_threshold` defaults to 70% of the resolved model's context window (rounded to the nearest token); `null` or `0` disables new checkpoints. The chosen value is persisted. On PATCH, omission preserves it and `null` or `0` disables it; resume uses the persisted value, and managed workers do not inherit this orchestrator-only setting. The web forms follow the same rules. A `[compaction]` section in config.toml is silently ignored.

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

[sandbox]
image = "python:3.13-bookworm"

[worker]
thread_timeout_secs = 3600
command_output_max_bytes = 8388608
command_output_session_max_bytes = 67108864

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

Worker command output is retained only for its dispatch and rolls over oldest bytes at the configured limits. Set `command_output_max_bytes` for each command or PTY (up to 1 GiB) and `command_output_session_max_bytes` for the dispatch (at least the per-command limit, up to 4 GiB). Workers can page output that does not fit in a tool preview while the dispatch remains active.

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

Every model response carries a catalog-rate cost estimate in its token usage, computed as `tokens × rate` per input/output/cache-read/cache-write bucket (micro-USD, rounded half-up per response). Anthropic 1-hour cache writes bill at the `cache_write_1h` rate (default 2× the input rate); unknown pricing bills zero rather than failing. Cost rides in the `TokenUsageUpdated` event's `usage.cost` and accumulates into the session's persisted token accounting. The dashboard shows it in the session bar's tokens metric (cumulative cost appended to the token counts), in that metric's tooltip (a per-bucket breakdown plus the last response's cost), and in each worker's token-usage panel (a Cost row). Unknown pricing renders as `—`, never `$0.00`. For managed `chatgpt-codex-responses`, this is an API-equivalent estimate using catalog rates, not a provider invoice or evidence of an incremental per-token charge to the ChatGPT account.

### Model selection in the dashboard

The launch and session settings dialogs provide searchable catalog selection plus a custom-model path for endpoints the catalog does not know. Supported reasoning efforts follow the selected catalog entry. Credential readiness and its suggested fix are informational and never block selection. Per-session overrides support a base URL, API-key variable, and replacement extra-header map; managed backends hide overrides they do not accept. Compaction fields follow the canonical rules above.

## Managed credentials and endpoints

### ChatGPT Codex OAuth

Run `nac-web codex-auth login`, `nac-web codex-auth status`, or `nac-web codex-auth logout` to manage Codex OAuth. The `chatgpt-codex-responses` backend uses the fixed ChatGPT backend endpoint, reads OAuth only from `auth.json`, and never accepts an API-key selector.

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

The Arcee login control plane is fixed at `https://api.arcee.ai` and cannot be redirected by environment variables. `status` shows its workspace, organization, base URL, and credential path without printing the key. Both Arcee backends accept only HTTPS origins on `arcee.ai` or its subdomains at effective port 443, and only the root or `/api`, `/api/v1`, and `/api/v1/chat/completions` inference paths.

A managed login is selected explicitly in the dashboard's model picker (or with a per-session `backend = "arcee-auth"` override): the Trinity model ids collide with `arcee-api` in the catalog, and a collision resolves to the non-managed provider. The managed session's base URL defaults to `https://api.arcee.ai/api/v1`.

An Arcee API-key session resolves from the model id alone when `ARCEE_API_KEY` is exported:

```toml
[model]
model = "trinity-large-thinking"
```

To use a different key variable, set a per-session `api_key_env = "MY_ARCEE_KEY"` override.

### Credential files

Managed credentials live in the NAC home directory: `$NAC_HOME` when set, otherwise `$XDG_CONFIG_HOME/nac` when set, otherwise `~/.config/nac`. Arcee uses only `arcee_auth.json`; ChatGPT Codex uses only `auth.json`.

Credential files reject symlinks and non-regular files and are written atomically under a lock. On Unix, reads accept any mode with no group or other permission bits (for example, `0400`, `0600`, or `0700`, depending on the owner bits), while writes normalize the mode to `0600`. Each logout command removes only its own credential path.

## Model request security

All model inference clients disable HTTP redirects so prompts, credentials, and request bodies are not replayed to a redirect destination. This applies to every backend, not only Arcee. Extra headers are validated centrally for every backend and cannot override `Host`, `Authorization`, `Proxy-Authorization`, or `x-api-key` in any letter case; backend-selected credentials remain authoritative. Invalid header names and values are also rejected before dispatch.
