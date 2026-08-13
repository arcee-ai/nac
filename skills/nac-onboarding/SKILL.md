---
name: nac-onboarding
description: Install and configure Arcee AI nac, then help a user choose and verify Arcee managed login, ChatGPT Codex login, or an OpenAI-compatible API-key model. Use when a user asks to get started with nac, connect nac to an agent, configure a model or provider, add MCP servers, or expose nac's MCP server to Claude Code, Codex, OpenCode, or another MCP client.
---

# NAC onboarding

Guide the user to a working nac setup. Keep credentials private: ask the user to enter keys or complete device login themselves; never request a token in chat or write one into a tracked file.

This is an interactive onboarding: ask the user before making choices on their behalf. Use your harness's interactive question mechanism when it has one. The auth path, the model, and whether another editor or agent should control nac are all the user's decisions, not yours.

## 1. Establish the starting point

1. Check whether `nac-web` is available with `nac-web --version`.
2. If it is missing, install the current edge build:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/arcee-ai/nac/main/scripts/install.sh | sh
   ```

3. Start nac from the repository the user wants it to work on:

   ```sh
   nac-web
   ```

   Use `nac-web -C /path/to/project -y` when a non-interactive launch is useful. The dashboard opens at a loopback URL and provides the model picker, session controls, and MCP library.

## 2. Ask the user which model-authentication path to use

Present the three paths below and ask the user which one they want. Do not pick for them, and do not configure more than one path unless the user explicitly wants alternatives. Briefly explain the trade-off when asking: managed logins need no API key but tie usage to an account subscription; an API key works with any OpenAI-compatible provider but must be provisioned and kept in the environment.

| User has | Recommended action |
| --- | --- |
| An Arcee account or wants hosted Arcee models | Run `nac-web arcee-auth login`, then have them complete the device-code flow in the browser. They can create an Arcee account during that flow if needed. Confirm with `nac-web arcee-auth status`. |
| A ChatGPT subscription that includes Codex | Run `nac-web codex-auth login`, then have them complete the browser flow. Confirm with `nac-web codex-auth status`. |
| An API key for Arcee or another OpenAI-compatible provider | Have the user set the provider's conventional environment variable in their own shell. For Arcee, use `ARCEE_API_KEY`; nac's Arcee API endpoint is `https://api.arcee.ai/api/v1`. |

## 3. Ask the user which model to run

Ask the user which model they want; do not assume a default. Verify availability before suggesting specific models — model lineups change, and a model named in older documentation may no longer exist.

- For Arcee (managed login or API key), check the currently supported models against the Arcee API docs at https://docs.arcee.ai and, when the user has an Arcee key or login available, the live model list at `GET https://api.arcee.ai/api/v1/models` (OpenAI-compatible, Bearer auth). Only suggest models that appear there.
- For ChatGPT Codex login, the Codex backend accepts only specific models; unsupported choices fail with an HTTP 400 from the Codex backend. Offer models from the dashboard's model picker or from the `chatgpt-codex-responses` provider group in `list_models`, and treat the backend's response as the final word.
- For another OpenAI-compatible provider, confirm the model id against that provider's own list endpoint or docs.

Prefer the dashboard's model picker over hand-writing a config unless the user asks for a file-based configuration. For an explicit Arcee API-key configuration, use this minimal shape with the model the user confirmed, and keep the key itself out of the file:

```toml
[model]
model = "<model confirmed with the user>"
```

With `ARCEE_API_KEY` set, nac resolves the `arcee-api` backend and endpoint from its catalog. If a custom OpenAI-compatible endpoint is needed, use nac's session settings or model configuration UI to set the model, backend, base URL, and the *name* of the environment variable containing the key.

## 4. Verify before handing off

Create a short test session in the dashboard and send a harmless prompt such as "Describe this repository in three bullets." Confirm that a response arrives. If it fails:

- Re-run the relevant `*-auth status` command for managed auth and repeat login if needed.
- For API keys, verify that the required environment variable is exported in the shell that launched `nac-web`; do not print its value.
- Check that the selected model matches the selected provider and endpoint, and that the provider actually supports it (see section 3).

## 5. Add MCP capabilities to nac

Show the dashboard's MCP Library. It includes curated entries and can discover verified remote servers; add any MCP server the user needs from there, or configure a `stdio` or `streamable_http` server directly. Explain any server's data access and authentication before enabling it.

Use only values the user has authorized for headers or environment variables. MCP strings support `${ENV_VAR}` expansion, so secrets can stay in the environment rather than in `config.toml`.

## 6. Ask whether another agent should control nac through MCP

Do not assume the user wants this. Ask whether they want to manage nac from their favorite coding editor or agent — Claude Code, Codex, OpenCode, Cursor, or another MCP client — and if so, which one. If they decline, skip this section.

If they opt in, keep `nac-web` running and add this streamable-HTTP server to their chosen client's MCP configuration:

```text
URL: http://127.0.0.1:3210/mcp
Transport: streamable HTTP
```

This exposes nac session-management tools to the client agent. The listener is intended for the same machine and has no built-in authentication; do not expose it through a tunnel or reverse proxy unless the user adds strong access control.

Use the client's normal MCP configuration mechanism and adapt its configuration syntax around the URL above. Restart or reload the client if it does not pick up the server automatically.

## Completion checklist

Before calling setup complete, confirm that:

- `nac-web` is installed and a dashboard session can run.
- The user explicitly chose an auth path, and that path or API-key environment variable validates.
- The user explicitly chose a model, verified against the provider's currently supported models, and a test session with it returns a response.
- Any requested MCP server is connected.
- nac's own `/mcp` endpoint is connected to the user's chosen editor or agent — only if they asked for that.
