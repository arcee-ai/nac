# nac

Small coding agent.
Heavily inspired by [slate](https://randomlabs.ai/blog/slate). Also takes inspiration from [nanocode](https://github.com/1rgs/nanocode) and [pi](https://github.com/badlogic/pi-mono).

Install the latest `edge` build:

```sh
curl -fsSL https://raw.githubusercontent.com/arcee-ai/nac/main/scripts/install.sh | sh
```

Pinned version installs are not supported yet.

The installer places two binaries in `$HOME/.local/bin` by default:

- `nac-web`: the web dashboard for managing multiple sessions.
- `nac`: the terminal UI and utility commands such as `codex-auth`, `arcee-auth`, and `upgrade`.

Before launching a new session, configure an explicit `backend` and `model`. Most backends also require `base_url`; the managed `chatgpt-codex-responses` and `arcee-auth` backends materialize their fixed canonical URL when it is omitted. API-key backends also require `api_key_env`, the exact name of the one environment variable NAC may read for that session. The full contract and examples are under [Model configuration](#model-configuration).

To use ChatGPT Codex OAuth instead of an API key, run `nac codex-auth login` and complete the device-code flow in a browser, then select `chatgpt-codex-responses` with its required model. An omitted base URL resolves to `https://chatgpt.com/backend-api`.

Linux installs use the portable static build.

Upgrade to the latest `edge` build:

```sh
nac upgrade
```

`nac upgrade` reinstalls both `nac` and `nac-web`.

Run the web dashboard:

```sh
nac-web -C /path/to/project --bind 127.0.0.1:3210
```

Open `http://127.0.0.1:3210/` for the dense session dashboard. `nac-web` exposes a central session manager for web clients. It resolves one server store at startup, then can create, resume, inspect, submit prompts to, and stream events from multiple sessions at once. Useful endpoints:

- `GET /health`
- `GET /store`
- `GET /sessions`
- `POST /sessions`
- `GET /sessions/{session_id}`
- `GET /sessions/{session_id}/config`
- `PATCH /sessions/{session_id}/config`
- `POST /sessions/{session_id}/runs`
- `GET /sessions/{session_id}/events?after_sequence_id=0`
- `GET /sessions/{session_id}/events/stream?after_sequence_id=0`
- `POST /sessions/{session_id}/cancel-active-run`

`AGENTS.md` is loaded hierarchically from the project and globally from `NAC_HOME` / `~/.config/nac`. Skills are discovered from project and user skill directories; the orchestrator sees compact skill metadata and preloads selected skills for worker threads, while workers do not activate skills themselves. nac ignores `disable-model-invocation`; avoid interactive skills because nac is intended to run rather autonomously. Sessions are stored in the project store (`.nac/store.db` by default): use `nac resume` for the picker, `nac resume --last` for the newest session, or `nac resume SESSION_ID` for a specific session. Thread history does not auto-compact right now.

Uninstall:

```sh
curl -fsSL https://raw.githubusercontent.com/arcee-ai/nac/main/scripts/uninstall.sh | sh
```

`nac` can run tools inside a Podman sandbox (requires Podman to be installed):

```sh
nac --sandbox
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

`nac` also supports a smolvm sandbox backend — a lightweight microVM that provides hardware-level VM isolation instead of container namespace isolation. It requires `smolvm` to be installed.

Select it with `--sandbox-backend smolvm`, or set `backend = "smolvm"` under `[sandbox]` in config:

```sh
nac --sandbox --sandbox-backend smolvm
```

smolvm uses the same default OCI image (`python:3.13-bookworm`) and the same mount flags as Podman. Network is always enabled for smolvm VMs. On macOS, smolvm runs natively via the Hypervisor.framework — no separate machine init step is needed.

## Model configuration

Config lives at `~/.config/nac/config.toml`, or at `$NAC_HOME/config.toml` when `NAC_HOME` is set. A new session merges explicit CLI or web launch values over `[model]` in that file. The resulting `backend` and `model` must be present and nonblank before the session is created. `base_url` is also required except that an absent value is materialized as `https://chatgpt.com/backend-api` for `chatgpt-codex-responses` and `https://api.arcee.ai/api/v1` for `arcee-auth`. No other backend receives an endpoint default, and a present value is validated rather than replaced.

Model selection is config-first, not environment-driven:

- NAC never reads `OPENAI_MODEL` or `OPENAI_BASE_URL` and does not infer a backend, model, or endpoint from provider conventions.
- NAC does not search provider API-key variables. An API key is read only through the exact `api_key_env` selector described below.
- A created session persists its complete effective model settings. Resume, server attachment, and managed workers use that stored snapshot rather than re-resolving the model tuple or credential selector from ambient config. Non-model runtime settings can still come from the current config.

Persisted model settings remain editable. In `nac-web`, open a session's **Settings** dialog; the equivalent API is `GET /sessions/{session_id}/config` and `PATCH /sessions/{session_id}/config`. PATCH validates the complete prospective settings and current credentials before committing and leaves the previous snapshot unchanged on failure. Omitted fields are preserved; `null` clears `reasoning_effort` or `api_key_env`, and `null` or `{}` clears `extra_headers`. Required `backend`, `model`, and `base_url` cannot be cleared. Settings can be opened and repaired even when an invalid or incomplete persisted snapshot cannot resume. A session with an active run must be cancelled before editing its settings.

The TUI has the same tri-state launch behavior. Omit a model option to inherit its new-session config value. Use `--clear-api-key-env` to remove a configured selector, `--clear-effort` to omit reasoning effort, and `--extra-headers '{}'` to replace configured headers with an empty map. `--effort none` is a concrete effort value and is distinct from `--clear-effort`.

### API-key selection

The API-key backends are `openai-responses`, `together-chat`, `anthropic-messages`, `deepseek-chat`, `fireworks-chat`, and `arcee-api`. Every one requires `api_key_env`:

- The selector must match `[A-Za-z_][A-Za-z0-9_]*` exactly. NAC does not trim or rewrite it.
- NAC reads only the environment variable whose name is stored in `api_key_env`; there is no fallback to `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TOGETHER_API_KEY`, `ARCEE_API_KEY`, or any other provider-named variable.
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
backend = "openai-responses"
model = "gpt-5.5"
base_url = "https://api.openai.com/v1"
reasoning_effort = "xhigh"
api_key_env = "OPENAI_API_KEY"

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

## Managed credentials and endpoints

### ChatGPT Codex OAuth

Run `nac codex-auth login`, `nac codex-auth status`, or `nac codex-auth logout` to manage Codex OAuth. Login requests device codes from `https://auth.openai.com/api/accounts/deviceauth/usercode`, polls `https://auth.openai.com/api/accounts/deviceauth/token`, opens `https://auth.openai.com/codex/device` for browser verification, and exchanges or refreshes tokens at `https://auth.openai.com/oauth/token`. The `chatgpt-codex-responses` backend materializes `base_url = "https://chatgpt.com/backend-api"` when the setting is absent; an explicitly supplied value must still pass the managed Codex endpoint checks (an optional trailing slash is accepted). It sends non-streaming Responses requests to `https://chatgpt.com/backend-api/codex/responses`, reads OAuth only from `auth.json`, and never accepts an API-key selector.

### Arcee managed auth and API keys

Arcee credential mode is explicit:

- `arcee-auth` reads the API key and inference origin saved by `nac arcee-auth login` in `arcee_auth.json`. It rejects `api_key_env`. When `base_url` is absent NAC materializes `https://api.arcee.ai/api/v1`; a configured value must have the same origin as the stored credential.
- `arcee-api` never reads `arcee_auth.json`. It requires `api_key_env` and uses only that selected environment variable.

Manage the stored Arcee login with:

```sh
nac arcee-auth login
nac arcee-auth status
nac arcee-auth logout
```

The login control plane is fixed at `https://api.arcee.ai`, using `/app/v1/device/code` and `/app/v1/device/token`; environment variables cannot redirect it. The login response supplies the approved Arcee inference origin. `status` shows its workspace, organization, base URL, and credential path without printing the key.

Both Arcee backends accept only `https` origins on `arcee.ai` or its subdomains with effective port 443. Accepted inference paths are `/`, `/api`, `/api/v1`, and `/api/v1/chat/completions`; all resolve to `/api/v1/chat/completions`. Other hosts and path forms are rejected.

A managed login needs a model and may omit the fixed production base URL:

```toml
[model]
backend = "arcee-auth"
model = "trinity-large-thinking"
# base_url defaults to "https://api.arcee.ai/api/v1"
```

An Arcee API-key session instead selects its key variable explicitly:

```sh
export MY_ARCEE_KEY="..."
```

```toml
[model]
backend = "arcee-api"
model = "trinity-large-thinking"
base_url = "https://api.arcee.ai/api/v1"
api_key_env = "MY_ARCEE_KEY"
```

### Credential files

Managed credentials live in the NAC home directory: `$NAC_HOME` when set, otherwise `$XDG_CONFIG_HOME/nac` when set, otherwise `~/.config/nac`. Arcee uses only `arcee_auth.json`; ChatGPT Codex uses only `auth.json`.

Credential reads reject symlinks and non-regular files, and writes use locking plus atomic replacement. On Unix, managed credential files must have no group or other permission bits; reads reject files such as mode `0644` or `0660`, and writes create owner-only mode-`0600` files. Non-Unix platforms retain the symlink, regular-file, locking, and atomic-write checks without the Unix mode-bit policy. Each logout command removes only its own credential path and does not follow a symlink target.

## Model request security

All model inference clients disable HTTP redirects so prompts, credentials, and request bodies are not replayed to a redirect destination. This applies to every backend, not only Arcee. Extra headers are validated centrally for every backend and cannot override `Host`, `Authorization`, `Proxy-Authorization`, or `x-api-key` in any letter case; backend-selected credentials remain authoritative. Invalid header names and values are also rejected before dispatch.
