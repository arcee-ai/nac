# nac

Small coding agent.
Heavily inspired by [slate](https://randomlabs.ai/blog/slate). Also takes inspiration from [nanocode](https://github.com/1rgs/nanocode) and [pi](https://github.com/badlogic/pi-mono).

Install the latest `edge` build:

```sh
curl -fsSL https://raw.githubusercontent.com/sapiosaturn/nac/main/scripts/install.sh | sh
```

Pinned version installs are not supported yet.

The installer places two binaries in `$HOME/.local/bin` by default:

- `nac-web`: the web dashboard for managing multiple sessions.
- `nac`: the terminal UI and utility commands such as `codex-auth` and `upgrade`.

Set `OPENAI_API_KEY`, then run `nac-web -C /path/to/project` and open the printed local URL.

To use ChatGPT Codex auth instead of an OpenAI API key, run `nac codex-auth login` and complete the device-code flow in a browser. In `nac-web`, choose `chatgpt-codex-responses` in the launch modal, or configure `backend = "chatgpt-codex-responses"` under `[model]`. For the TUI, launch with `nac --backend chatgpt-codex-responses`.

Optional:
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`

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
curl -fsSL https://raw.githubusercontent.com/sapiosaturn/nac/main/scripts/uninstall.sh | sh
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

## Recommended config

Optional config lives at `~/.config/nac/config.toml`, or at `$NAC_HOME/config.toml` when `NAC_HOME` is set. Explicit CLI args and environment variables override TOML defaults. Resumed sessions continue using the model and sandbox settings stored in their session snapshot.

The `api_key_env` setting names the environment variable to read when `OPENAI_API_KEY` is not set. Store paths remain relative to the launch working directory.

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

For ChatGPT Codex auth, the default base URL is `https://chatgpt.com/backend-api`; NAC sends non-streaming Responses requests to `/codex/responses`. Use `nac codex-auth status` to inspect the saved account and `nac codex-auth logout` to remove local tokens.
