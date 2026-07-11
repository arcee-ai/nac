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

Set an API key variable and configure its name explicitly before launching. For example, export `OPENAI_API_KEY`, set `api_key_env = "OPENAI_API_KEY"` under `[model]` as shown below, then run `nac-web -C /path/to/project` and open the printed local URL. Provider-style variables are never probed implicitly; `OPENAI_API_KEY`, `TOGETHER_API_KEY`, and `ANTHROPIC_API_KEY` are read only when selected by `api_key_env`.

To use ChatGPT Codex auth instead of an OpenAI API key, run `nac codex-auth login` and complete the device-code flow in a browser. In `nac-web`, choose `chatgpt-codex-responses` in the launch modal, or configure `backend = "chatgpt-codex-responses"` under `[model]`. For the TUI, launch with `nac --backend chatgpt-codex-responses`.

`backend`, `model`, and `base_url` are required model settings. Set them in `config.toml` or provide explicit session launch values; nac does not infer them from ambient environment variables or provider defaults.

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

## Recommended config

Config lives at `~/.config/nac/config.toml`, or at `$NAC_HOME/config.toml` when `NAC_HOME` is set. Explicit session launch settings override TOML values. `backend`, `model`, and `base_url` must resolve from those two sources; ambient model/base variables and provider defaults are not used. Resumed sessions continue using the exact model settings stored in their session snapshot.

For every API-key backend (`openai-responses`, `together-chat`, `anthropic-messages`, `deepseek-chat`, `fireworks-chat`, and `arcee-api`), `api_key_env` is required and names the only environment variable read for credentials. The selector must match `[A-Za-z_][A-Za-z0-9_]*`, and its value must be nonempty. Managed `arcee-auth` and `chatgpt-codex-responses` reject `api_key_env` and use their respective stored credentials. Store paths remain relative to the launch working directory.

Reasoning effort is never defaulted by NAC. For `anthropic-messages`, `none` (and an omitted effort) sends no thinking controls. `low`, `medium`, and `high` are accepted for Claude Opus 4.6 and Sonnet 4.6 families (including dated snapshots); `xhigh` maps to Anthropic `max` only for Opus 4.6. Unknown and older Claude models reject explicit non-`none` effort during configuration validation.

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

For ChatGPT Codex auth, configure `base_url = "https://chatgpt.com/backend-api"`; NAC sends non-streaming Responses requests to `/codex/responses`. Use `nac codex-auth status` to inspect the saved account and `nac codex-auth logout` to remove local tokens.

## Arcee auth

NAC provides a device-code flow and separate commands for inspecting and removing Arcee credentials:

```sh
nac arcee-auth login
nac arcee-auth status
nac arcee-auth logout
```

> The CLI flow is implemented, but availability of the production device-authorization endpoint is still deferred. Do not assume `nac arcee-auth login` will complete against production yet.

`login` always contacts the canonical `https://api.arcee.ai` control-plane origin; environment variables cannot override the auth service. It prints a browser URL and confirmation code, then stores the returned API key and Arcee inference base URL. `status` prints the stored workspace, organization, base URL, and credential path without printing the key. If the credential is for the wrong deployment, run `logout`, log in for the intended Arcee deployment, and use `status` to confirm the returned `base_url` before starting NAC.

Credentials live in the NAC home directory: `$NAC_HOME` when set, otherwise `$XDG_CONFIG_HOME/nac` when set, otherwise `~/.config/nac`. Arcee reads and writes only `arcee_auth.json`; ChatGPT Codex reads and writes only `auth.json`. Legacy Arcee-shaped records in `auth.json` are ignored and are never migrated implicitly.

Credential selection follows the explicit backend mode:

- `backend = "arcee-auth"` uses the managed API key saved by `arcee-auth login`; the required explicit/configured `base_url` must match the stored credential origin.
- An explicit Arcee-owned URL with `arcee-auth` (`arcee.ai` or a subdomain) must use HTTPS on effective port 443. Its origin must match the origin saved at login; changing only the path does not change the credential origin.
- `backend = "arcee-api"` uses only the environment variable explicitly selected by `api_key_env` and never reads `arcee_auth.json`.
- Both Arcee modes accept only approved Arcee-owned HTTPS origins on effective port 443 and the canonical production path forms. Non-Arcee hosts are not supported as custom Arcee endpoints.
- Both Arcee modes preserve Arcee chat-completions URL normalization, no-redirect request handling, and rejection of sensitive `Host`, `Authorization`, and `Proxy-Authorization` header overrides.
- The old `backend = "arcee"` and `backend = "auto"` values are unsupported. Existing config and stored sessions using either value require explicit settings repair; they are not silently migrated.

For example, a stored login still requires the complete model tuple:

```toml
[model]
backend = "arcee-auth"
model = "trinity-large-thinking"
base_url = "https://api.arcee.ai"
```

An API-key Arcee session instead selects `arcee-api` and an explicit selector:

```sh
export ARCEE_API_KEY="..."
```

```toml
[model]
backend = "arcee-api"
model = "trinity-large-thinking"
base_url = "https://api.arcee.ai"
api_key_env = "ARCEE_API_KEY"
```

For safety, credential reads reject symlinks and non-regular files, and writes use atomic replacement. On Unix, reads also reject credential files with any group/other permission bits (for example, mode `0644` or `0660`); set the file to owner-only mode such as `0600`. Writes create mode-`0600` files. Non-Unix platforms retain the existing symlink/non-regular checks and atomic writes but do not apply this Unix mode-bit policy. `arcee-auth logout` may unlink a symlink at the Arcee-owned `arcee_auth.json` path without following or modifying its target; it never inspects or removes `auth.json`. All Arcee requests reject overrides of the sensitive `Host`, `Authorization`, and `Proxy-Authorization` headers.
