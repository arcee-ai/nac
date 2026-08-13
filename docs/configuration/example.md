# Example config

See [Reasoning effort](model.md#reasoning-effort) for backend-specific values.

```toml
# Extra project-doc names tried after AGENTS.override.md and AGENTS.md (always
# first, per directory from repo root to the workspace). Default: none.
[agents_md]
fallback_filenames = []
# Combined UTF-8 byte cap across loaded files. Default 4194304 (4 MiB); minimum 1.
max_bytes = 4194304

# SQLite session store. Relative paths resolve against process cwd.
# If omitted: $NAC_HOME/store.db, else $XDG_CONFIG_HOME/nac/store.db,
# else ~/.config/nac/store.db; last-resort fallback is .nac/store.db.
[storage]
store_path = ".nac/store.db"

# New sessions merge CLI/web launch values over this section. Live keys are
# model, reasoning_effort, and extra_headers. Removed keys (backend, base_url,
# api_key_env) in an older file are ignored with a one-time warning. A
# [compaction] section still parses but is ignored.
[model]
# Catalog id; backend and default base URL resolve from it (gpt-5.5 → openai-responses).
model = "gpt-5.5"
# Optional. Omitted means NAC sends no effort. gpt-5.5 accepts none, minimal,
# low, medium, high, xhigh. Other backends: see Reasoning effort.
reasoning_effort = "xhigh"
# [model.extra_headers]
# X-Custom = "value"   # cannot set Host, Authorization, Proxy-Authorization, or x-api-key

# Applied when tools run under --sandbox. CLI flags override these values.
[sandbox]
image = "python:3.13-bookworm"  # default
# backend = "podman"            # only supported value; default
# cpus = 2                      # default
# memory_mib = 2048             # default

[worker]
# Worker dispatch timeout in seconds. Default 3600; values below 1800 are raised to 1800.
thread_timeout_secs = 3600
# In-memory retention for the producing dispatch only. exec_command keeps stdout
# and stderr separate, returns status/exit_code plus concise previews, and
# supplies an output_id once the process starts. read_command_output pages
# combined (emission order), stdout, or stderr; PTY is combined-only.
# write_stdin advances a preview cursor without deleting retained bytes.
# Oldest bytes roll over; reads report overflowed and the retained range.
# Output IDs expire when the dispatch ends (including error or cancel).
# Short commands fit in their previews and need no follow-up read.
command_output_max_bytes = 8388608           # per command/PTY; 1..=1 GiB; default 8 MiB
command_output_session_max_bytes = 67108864  # per dispatch; >= per-command, <= 4 GiB; default 64 MiB

# Table key is the local server name. Transports: streamable_http (url, optional
# headers) and stdio (command, args, env). enabled defaults to true. String
# values (command, args, env values, url, header values) expand ${ENV_VAR};
# the variable must be set. library_id is dashboard bookkeeping and is ignored
# at connect.
[mcp_servers.exa_web_search]
enabled = true
transport = "streamable_http"
url = "https://mcp.exa.ai/mcp"
# headers = { "x-api-key" = "${EXA_API_KEY}" }

[mcp_servers.context7]
enabled = true
transport = "streamable_http"
url = "https://mcp.context7.com/mcp"

[mcp_servers.grep_app]
enabled = true
transport = "streamable_http"
url = "https://mcp.grep.app"

# [mcp_servers.local_stdio]
# enabled = true
# transport = "stdio"
# command = "npx"
# args = ["-y", "some-mcp-server"]
# env = { "API_TOKEN" = "${API_TOKEN}" }

# Extra hosts allowed to receive API-key credentials as base_url. Only this
# file can widen the set; the HTTP API cannot.
# [security]
# trusted_base_url_hosts = ["my-proxy.example"]
```
