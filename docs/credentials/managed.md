# Managed credentials and endpoints

## ChatGPT Codex OAuth

Run `nac-web codex-auth login`, `nac-web codex-auth status`, or `nac-web codex-auth logout` to manage Codex OAuth. Login requests device codes from `https://auth.openai.com/api/accounts/deviceauth/usercode`, polls `https://auth.openai.com/api/accounts/deviceauth/token`, opens `https://auth.openai.com/codex/device` for browser verification, and exchanges or refreshes tokens at `https://auth.openai.com/oauth/token`. The `chatgpt-codex-responses` backend materializes `base_url = "https://chatgpt.com/backend-api"` when the setting is absent; an explicitly supplied value must still pass the managed Codex endpoint checks (an optional trailing slash is accepted). It posts streaming Responses requests (`stream: true`, `Accept: text/event-stream`) to `https://chatgpt.com/backend-api/codex/responses`, forwards live text and reasoning deltas to the dashboard when a client is watching, reads OAuth only from `auth.json`, and never accepts an API-key selector.

## Arcee managed auth and API keys

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

## Credential files

Managed credentials live in the NAC home directory: `$NAC_HOME` when set, otherwise `$XDG_CONFIG_HOME/nac` when set, otherwise `~/.config/nac`. Arcee uses only `arcee_auth.json`; ChatGPT Codex uses only `auth.json`.

Credential reads reject symlinks and non-regular files, and writes use locking plus atomic replacement. On Unix, managed credential files must have no group or other permission bits; reads reject files such as mode `0644` or `0660`, and writes create owner-only mode-`0600` files. Non-Unix platforms retain the symlink, regular-file, locking, and atomic-write checks without the Unix mode-bit policy. Each logout command removes only its own credential path and does not follow a symlink target.
