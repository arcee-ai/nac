# nac

Small coding agent.
Heavily inspired by [slate](https://randomlabs.ai/blog/slate). Also takes inspiration from [nanocode](https://github.com/1rgs/nanocode) and [pi](https://github.com/badlogic/pi-mono).

Install the latest `edge` build:

```sh
curl -fsSL https://raw.githubusercontent.com/sapiosaturn/nac/main/scripts/install.sh | sh
```

Pinned version installs are not supported yet.

Set `OPENAI_API_KEY`, then run `nac`. Use `nac --compact` for the compact single-column TUI, or `nac --full` to override a compact config default.

Optional:
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`

Linux installs use the portable static build.

`AGENTS.md` is loaded hierarchically from the project and globally from `NAC_HOME` / `~/.config/nac`. Skills are discovered from project and user skill directories and activated from workers with `activate_skill(...)`. Sessions are stored in the project store (`.nac/store.db` by default): use `nac resume` for the picker, `nac resume --last` for the newest session, or `nac resume SESSION_ID` for a specific session. Thread history does not auto-compact right now.

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

[ui]
mode = "full" # "full" or "compact"

[storage]
store_path = ".nac/store.db"

[model]
backend = "openai-responses" # "auto", "deepseek-chat", "fireworks-chat", or "openai-responses"
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
