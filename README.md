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

Before launching a new session, configure an explicit `backend` and `model`. Most backends also require `base_url`; the managed `chatgpt-codex-responses` and `arcee-auth` backends materialize their fixed canonical URL when it is omitted. API-key backends also require `api_key_env`, the exact name of the one environment variable NAC may read for that session. The full contract and examples are under [Model configuration](#model-configuration).

To use ChatGPT Codex OAuth instead of an API key, run `nac-web codex-auth login` and complete the device-code flow in a browser, then select `chatgpt-codex-responses` with its required model. An omitted base URL resolves to `https://chatgpt.com/backend-api`.

Linux installs use the portable static build.

Upgrade to the latest `edge` build:

```sh
nac-web upgrade
```

`nac-web upgrade` reinstalls `nac-web`.

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
- `GET /sessions/{session_id}/messages`
- `GET /sessions/{session_id}/threads/{thread_name}/events`
- `GET /sessions/{session_id}/config`
- `PATCH /sessions/{session_id}/config`
- `POST /sessions/{session_id}/fork`
- `POST /sessions/{session_id}/compact`
- `POST /sessions/{session_id}/runs`
- `PUT /sessions/{session_id}/thread-updates`
- `POST /sessions/{session_id}/steering`
- `POST /sessions/{session_id}/threads/{thread_name}/steering`
- `GET /sessions/{session_id}/events?after_sequence_id=0`
- `GET /sessions/{session_id}/events/stream?after_sequence_id=0`
- `POST /sessions/{session_id}/cancel-active-run`

`nac-web` binds only to IPv4/IPv6 loopback and has no built-in authentication. NAC does not enforce `Host` or `Origin` headers, restrict `Sec-Fetch-Site`, or provide built-in CSRF protection. Tunnels and reverse proxies can expose the loopback listener remotely; if you use one, it must provide strong authentication before forwarding traffic to `nac-web`. Anyone able to reach the server is trusted.

Snapshot messages can be bounded with `message_limit`; only then does snapshot `include_system=true` affect the selected page and add `message_page`/`message_cycle`. `GET .../messages` pages backward with `before` and `limit` (and accepts `include_system`), while thread events page with `before_id` and `limit` and return `next_before_id`. Persisted snapshot and initial thread-event-page baselines carry `thread_event_boundary: {epoch_id, sequence_id}`; merge only later envelopes from the same epoch. SSE first reports `{epoch_id, replay_boundary_sequence_id}` and supports sequence replay within that epoch. Finite responses may be gzip-compressed; SSE is never compressed.

### Store schema, pinned snapshot, and rollback

The store schema is version 5. This release can migrate schema versions 0 through 4 forward, but schema compatibility is one-way: a v5 store must not be opened with an older binary or downgraded, and mixed-version writers against one store are unsupported. Parent binaries and custom worker executables must use matching releases because the required `--dispatch-id` worker protocol is also version-coupled.

Before mutating the schema of an existing store whose version differs from the current version, NAC uses SQLite's online backup API to capture committed database and WAL contents at:

```text
<store-parent>/backups/pinned/pre-branching.db
<store-parent>/backups/pinned/pre-branching.sha256
```

This pair is create-once: NAC validates an existing snapshot with `PRAGMA integrity_check` and verifies its SHA-256 sidecar, but never overwrites it. A missing, incomplete, corrupt, or hash-mismatched pair blocks migration. Both files contain sensitive store data and are owner-only on Unix. `scripts/backup-nac-store.sh` creates separate rotating `backups/store-*.db` copies; its retention cleanup does not remove `backups/pinned/`.

To validate or restore the pinned database, first stop `nac-web` and every other writer. Set `store` to the actual active store path (for example `.nac/store.db` or `~/.config/nac/store.db`), then run:

```sh
store=/path/to/store.db
snapshot="$(dirname "$store")/backups/pinned/pre-branching.db"
sidecar="$(dirname "$store")/backups/pinned/pre-branching.sha256"

sqlite3 "$snapshot" 'PRAGMA integrity_check;'
expected=$(tr -d '[:space:]' < "$sidecar")
if command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$snapshot" | awk '{print $1}')
else
  actual=$(sha256sum "$snapshot" | awk '{print $1}')
fi
[ "$actual" = "$expected" ] || { echo "snapshot SHA-256 mismatch" >&2; exit 1; }

mv "$store" "$store.before-restore"
rm -f "$store-wal" "$store-shm"
cp "$snapshot" "$store"
chmod 600 "$store"
```

`integrity_check` must print `ok`, and the hash comparison must succeed before restoring. The snapshot retains its pre-migration schema version: after rollback, use a binary compatible with that version if the goal is to remain rolled back. Starting the current binary will validate the pinned pair and migrate the restored store forward again.

### Forking sessions

The dashboard shows a subtle interstitial **fork** control exactly between an eligible persisted, completed assistant output and the immediately following persisted user message. There is no public CLI fork command. The HTTP equivalent is:

```http
POST /sessions/{session_id}/fork
Content-Type: application/json

{"title":"Alternative approach","through_message_index":12}
```

The JSON body is required. `title` is optional and follows the normal title validation rules. `through_message_index` is required and must be the **zero-based raw canonical index of the preceding assistant message**; use `message_page.canonical_indices` rather than a filtered display position. The message at the next canonical index must be a user message, and the selected assistant prefix must be protocol-complete (for example, it cannot leave tool calls awaiting results). The child copies the canonical transcript through the selected assistant and excludes the following user message. Missing or empty bodies, missing indices, out-of-range indices, other selected roles, trailing assistants, non-user successors, and incomplete tool-call boundaries are rejected.

A successful request returns `201 Created`. Its top level is the immediately usable child session snapshot (the same projection used by the dashboard), with additive lineage metadata. An abridged response is:

```json
{
  "metadata": { "session_id": "fork-…" },
  "fork": {
    "source_session_id": "source-session-id",
    "copied_message_count": 13,
    "source_message_count": 20,
    "created_at": "2026-08-04T18:00:00Z"
  }
}
```

The source must be idle: an active run or compaction, or a conflicting cross-process operation lease, returns `409 Conflict`. Invalid titles or boundaries return `400 Bad Request`, and a missing source returns `404 Not Found`. Rejected requests do not create a child.

A fork copies the selected canonical conversation prefix plus the source working directory and durable execution configuration (model/backend, endpoint, reasoning, sandbox and mounts, credential environment-variable selector, extra headers, and compaction threshold). It does **not** copy worker/thread state, events, steering, checkpoints, worksets, metrics, response timing/token history, presentation pin/order, or active operations; those begin empty or reset, and a title is set only when requested. Subsequent source and child conversation state is independent.

Forking is not a filesystem or Git branch. The child uses the same working directory and copied sandbox/mount configuration, so source and child can observe and modify the same files, Git working tree, and repository state. Coordinate concurrent work or create a separate worktree yourself. Forking also duplicates sensitive conversation content and may duplicate sensitive persisted configuration such as extra headers and credential selectors; protect, export, and delete the child as carefully as the source.

Operational tool telemetry is intentionally lossy: full tool arguments, tool results, and log/error text are omitted or sanitized before persistence and streaming. Failures expose a stable `failure_kind` (`context_limit`, `authentication`, `ssh`, `provider`, `persistence`, `cancelled`, or `unknown`) and a fixed safe message; the server writes the full internal cause locally as a single log record correlated by the event envelope's run ID. The deliberate tool-telemetry exception is `key_arg_preview`: each tool call persists and streams a short (roughly 120-character) human-readable snippet of its key argument — the path for file tools, the command for `exec_command`, the input for `write_stdin` — so the dashboard can show what a call is doing. Snapshots, SSE, and thread-event APIs may still carry conversation or assistant content and remain sensitive, as do canonical message APIs. Snapshot metadata omits extra-header values; `GET /sessions/{session_id}/config` is the authoritative, sensitive repair view. `/assets/app.css` is a compatibility alias for `/assets/redesign.css`.

`AGENTS.md` is loaded hierarchically from the project and globally from `NAC_HOME` / `~/.config/nac`. Skills are discovered from project and user skill directories; the orchestrator sees compact skill metadata and preloads selected skills for worker threads, while workers do not activate skills themselves. nac ignores `disable-model-invocation`; avoid interactive skills because nac is intended to run rather autonomously. Sessions are stored in the project store (`.nac/store.db` by default): open the web dashboard to list and select existing sessions, or use the `GET /sessions` and `GET /sessions/{session_id}` API endpoints to inspect a specific session. Deleting an active worker thread first cancels its managed process tree and waits for the terminal lifecycle event before removing retained thread data. Worker thread history does not auto-compact.

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

`nac-web` also supports a smolvm sandbox backend — a lightweight microVM that provides hardware-level VM isolation instead of container namespace isolation. It requires `smolvm` to be installed.

Select it with `--sandbox-backend smolvm`, or set `backend = "smolvm"` under `[sandbox]` in config:

```sh
nac-web --sandbox --sandbox-backend smolvm
```

smolvm uses the same default OCI image (`python:3.13-bookworm`) and the same mount flags as Podman. Network is always enabled for smolvm VMs. On macOS, smolvm runs natively via the Hypervisor.framework — no separate machine init step is needed.

## Model configuration

Config lives at `~/.config/nac/config.toml`, or at `$NAC_HOME/config.toml` when `NAC_HOME` is set. A new session merges explicit CLI or web launch values over `[model]` and `[compaction]` in that file. The resulting `backend` and `model` must be present and nonblank before the session is created. `base_url` is also required except that an absent value is materialized as `https://chatgpt.com/backend-api` for `chatgpt-codex-responses` and `https://api.arcee.ai/api/v1` for `arcee-auth`. No other backend receives an endpoint default, and a present value is validated rather than replaced.

Model selection is config-first, not environment-driven:

- NAC never reads `OPENAI_MODEL` or `OPENAI_BASE_URL` and does not infer a backend, model, or endpoint from provider conventions.
- NAC does not search provider API-key variables. An API key is read only through the exact `api_key_env` selector described below.
- A created session persists its complete effective model settings. Resume, server attachment, and managed workers use that stored snapshot rather than re-resolving the model tuple or credential selector from ambient config. Non-model runtime settings can still come from the current config.

Persisted session settings remain editable. In `nac-web`, open a session's **Settings** dialog; the equivalent API is `GET /sessions/{session_id}/config` and `PATCH /sessions/{session_id}/config`. PATCH validates the complete prospective model settings and current credentials before committing and leaves the previous snapshot unchanged on failure. Omitted fields are preserved; `null` clears `reasoning_effort` or `api_key_env`, `null` or `{}` clears `extra_headers`, and `null` or `0` disables `orchestrator_compaction_threshold`. Required `backend`, `model`, and `base_url` cannot be cleared. Settings can be opened and repaired even when an invalid or incomplete persisted snapshot cannot resume. A session with an active run must be cancelled before editing its settings; an active manual compaction must be allowed to finish.

The web dashboard has the same tri-state launch behavior. Omit a model option to inherit its new-session config value. Use `--clear-api-key-env` to remove a configured selector, `--clear-effort` to omit reasoning effort, and `--extra-headers '{}'` to replace configured headers with an empty map. `--effort none` is a concrete effort value and is distinct from `--clear-effort`. Use `--orchestrator-compaction-threshold TOKENS` for a fresh session; omit it to inherit `[compaction].threshold_tokens`, or pass `0` to disable an inherited value. Resume always uses the value persisted with the session, and managed workers do not inherit this orchestrator-only setting.

### Orchestrator compaction threshold

`[compaction].threshold_tokens` is an optional absolute token count for new orchestrator sessions. A positive value is captured in each new session; an absent or zero value disables creating new checkpoints. The create-session JSON field is `orchestrator_compaction_threshold`: omission inherits config, while `null` or `0` disables it. GET returns the persisted positive value or `null`; PATCH omission preserves it, and PATCH `null` or `0` disables it. The web launch and Settings forms expose the same rules.

Before each ordinary model call, a session-backed orchestrator automatically compacts only when its estimated context reaches the configured threshold. Compaction replaces an oldest prefix with a durable historical summary, targeting at least half (rounded up) of the serialized UTF-8 JSON byte weight of the compactable provider context. Canonical System messages and separately supplied tool definitions are excluded from that weight and remain preserved; Tool messages count toward it, and the cut snaps forward to the first safe User, Assistant, or end boundary without splitting a tool-call/result group. The complete canonical transcript remains unchanged in session storage, checkpoint rows stay private, and workers never compact. The threshold is a proactive trigger rather than a hard context limit; an oversized retained tail can still produce a terminal `finish_reason=length`. Existing valid checkpoints remain active on resume even when creating new checkpoints is disabled. Use `/compact` in the web dashboard to bypass the threshold and request the same operation immediately without submitting a prompt; the manual command is unavailable while another run or manual compaction is active.

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

## Managed credentials and endpoints

### ChatGPT Codex OAuth

Run `nac-web codex-auth login`, `nac-web codex-auth status`, or `nac-web codex-auth logout` to manage Codex OAuth. Login requests device codes from `https://auth.openai.com/api/accounts/deviceauth/usercode`, polls `https://auth.openai.com/api/accounts/deviceauth/token`, opens `https://auth.openai.com/codex/device` for browser verification, and exchanges or refreshes tokens at `https://auth.openai.com/oauth/token`. The `chatgpt-codex-responses` backend materializes `base_url = "https://chatgpt.com/backend-api"` when the setting is absent; an explicitly supplied value must still pass the managed Codex endpoint checks (an optional trailing slash is accepted). It sends non-streaming Responses requests to `https://chatgpt.com/backend-api/codex/responses`, reads OAuth only from `auth.json`, and never accepts an API-key selector.

### Arcee managed auth and API keys

Arcee credential mode is explicit:

- `arcee-auth` reads the API key and inference origin saved by `nac-web arcee-auth login` in `arcee_auth.json`. It rejects `api_key_env`. When `base_url` is absent NAC materializes `https://api.arcee.ai/api/v1`; a configured value must have the same origin as the stored credential.
- `arcee-api` never reads `arcee_auth.json`. It requires `api_key_env` and uses only that selected environment variable.

Manage the stored Arcee login with:

```sh
nac-web arcee-auth login
nac-web arcee-auth status
nac-web arcee-auth logout
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
