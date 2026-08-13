---
name: nac-onboarding
description: Install and configure Arcee AI nac, then help a user choose and verify Arcee managed login, ChatGPT Codex login, or an OpenAI-compatible API-key model. Use when a user asks to get started with nac, connect nac to an agent, configure a model or provider, add MCP servers, or expose nac's MCP server to Claude Code, Codex, OpenCode, or another MCP client.
---

# NAC onboarding

Guide the user to a working nac setup. Keep credentials private: ask the user to enter keys or complete device login themselves; never request a token in chat or write one into a tracked file.

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

## 2. Choose exactly one model-authentication path

Explain the trade-off briefly, then let the user choose. Do not configure more than one path unless the user explicitly wants alternatives.

| User has | Recommended action |
| --- | --- |
| An Arcee account or wants hosted Arcee models | Run `nac-web arcee-auth login`, then have them complete the device-code flow in the browser. They can create an Arcee account during that flow if needed. Confirm with `nac-web arcee-auth status`. |
| A ChatGPT subscription that includes Codex | Run `nac-web codex-auth login`, then have them complete the browser flow. Confirm with `nac-web codex-auth status`. |
| An API key for Arcee or another OpenAI-compatible provider | Have the user set the provider's conventional environment variable in their own shell. For Arcee, use `ARCEE_API_KEY`; nac's Arcee API endpoint is `https://api.arcee.ai/api/v1`. |

For managed Arcee login, choose an Arcee model in the dashboard's model picker; `trinity-large-thinking` is a suitable first choice. For API-key access, select the appropriate model/provider in the picker. Prefer the picker over hand-writing a config unless the user asks for a file-based configuration.

For an explicit Arcee API-key configuration, use this minimal shape and keep the key itself out of the file:

```toml
[model]
model = "trinity-large-thinking"
```

With `ARCEE_API_KEY` set, nac resolves the `arcee-api` backend and endpoint from its catalog. If a custom OpenAI-compatible endpoint is needed, use nac's session settings or model configuration UI to set the model, backend, base URL, and the *name* of the environment variable containing the key.

## 3. Verify before handing off

Create a short test session in the dashboard and send a harmless prompt such as "Describe this repository in three bullets." Confirm that a response arrives. If it fails:

- Re-run the relevant `*-auth status` command for managed auth and repeat login if needed.
- For API keys, verify that the required environment variable is exported in the shell that launched `nac-web`; do not print its value.
- Check that the selected model matches the selected provider and endpoint.

## 4. Add MCP capabilities to nac

Show the dashboard's MCP Library. It includes curated entries and can discover verified remote servers; add any MCP server the user needs from there, or configure a `stdio` or `streamable_http` server directly. Explain any server's data access and authentication before enabling it.

Use only values the user has authorized for headers or environment variables. MCP strings support `${ENV_VAR}` expansion, so secrets can stay in the environment rather than in `config.toml`.

## 5. Let another agent control nac through MCP

Keep `nac-web` running, then add this streamable-HTTP server to the other agent's MCP client:

```text
URL: http://127.0.0.1:3210/mcp
Transport: streamable HTTP
```

This exposes nac session-management tools to the client agent. The listener is intended for the same machine and has no built-in authentication; do not expose it through a tunnel or reverse proxy unless the user adds strong access control.

For Claude Code, Codex, OpenCode, or another MCP client, use that client's normal MCP configuration mechanism and adapt its configuration syntax around the URL above. Restart or reload the client if it does not pick up the server automatically.

## Completion checklist

Before calling setup complete, confirm that:

- `nac-web` is installed and a dashboard session can run.
- The chosen auth path or API-key environment variable validates.
- The user has selected a model successfully.
- Any requested MCP server is connected, including nac's own `/mcp` endpoint when another agent should control it.
