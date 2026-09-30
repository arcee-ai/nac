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
# If omitted, NAC selects dev.db, beta.db, or stable.db for its build track
# under $NAC_HOME, $XDG_CONFIG_HOME/nac, or ~/.config/nac; last-resort fallback
# is .nac/<track>.db.
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
# Empty write_stdin polls (and explicit retention) advance a preview cursor
# without deleting retained bytes. Nonempty input requires a separate once-only
# approval that displays the exact input and binds it to the terminal handle.
# Oldest bytes roll over; reads report overflowed and the retained range.
# Output IDs expire when the dispatch ends (including error or cancel).
# Short commands fit in their previews and need no follow-up read.
command_output_max_bytes = 8388608           # per command/PTY; 1..=1 GiB; default 8 MiB
command_output_session_max_bytes = 67108864  # per dispatch; >= per-command, <= 4 GiB; default 64 MiB

# Global MCP budgets apply when a server does not override one. Values are
# milliseconds and must be between 100 and 600000.
[mcp]
startup_timeout_ms = 15000
catalog_timeout_ms = 15000
execution_timeout_ms = 300000

# Table key is the local server name. Transports: streamable_http (url, optional
# headers) and stdio (command, args, env).
# enabled defaults to true; required defaults to false. A required enabled
# server rejects session admission when startup or catalog discovery fails.
# String values (command, args, env values, url, header values) expand ${ENV_VAR};
# the variable must be set. library_id is dashboard bookkeeping and is ignored
# at connect. Advertised server instructions are included as bounded, attributed,
# untrusted guidance. Tools remain namespaced as mcp__<server>__<tool>. Resources,
# resource templates, prompts, and prompt-argument completion use NAC's shared
# MCP capability tools; exact resource reads still pass through permission policy.
# Advertised prompts also appear as session slash commands and accept a JSON
# object of string arguments, for example: /mcp__docs__review {"tone":"strict"}.
# allowed_tools is an optional exact-name allowlist (an empty list
# exposes no tools); denied_tools is an exact-name denylist and always wins.
# approval defaults to "ask". tool_approvals applies exact-name "allow" or
# "ask" overrides. Risk annotations from a server may tighten "allow" to
# "ask", but annotations can never grant access.
[mcp_servers.exa_web_search]
enabled = true
required = false
transport = "streamable_http"
url = "https://mcp.exa.ai/mcp"
# allowed_tools = ["web_search_exa"]
# denied_tools = []
# approval = "ask"
# tool_approvals = { web_search_exa = "allow" }
# headers = { "x-api-key" = "${EXA_API_KEY}" }
# env_headers = { "x-api-key" = "EXA_API_KEY" }
# bearer_token_env_var = "EXA_BEARER_TOKEN"
# A bounded helper prints one JSON object of headers. Its output is used only
# with the configured URL and is refreshed once after an HTTP auth challenge.
# header_helper = { command = "./refresh-headers", args = ["--json"], env_vars = ["TOKEN"], timeout_ms = 5000 }

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
# env_vars = ["HTTPS_PROXY"]
# cwd = "packages/mcp-server"
# startup_timeout_ms = 10000
# catalog_timeout_ms = 10000
# execution_timeout_ms = 120000

```
