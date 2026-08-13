---
name: nac-onboarding
description: Install and configure Arcee AI nac, get the user into the nac dashboard, and connect their MCP client to nac. Use when a user asks to get started with nac, connect nac to an agent, add MCP servers, or expose nac's MCP server to Claude Code, Codex, OpenCode, or another MCP client.
---

# NAC onboarding

Get the user to a running nac dashboard as fast as possible, then connect their MCP client. Authentication, model choice, and MCP server setup all happen in the dashboard UI — do not walk the user through them in chat.

Keep credentials private: if the user ever needs to enter a key or complete a device login, they do it themselves in the UI or their own shell; never request a token in chat or write one into a tracked file.

## 1. Install and launch

1. Check whether `nac-web` is available with `nac-web --version`.
2. If it is missing, install the current edge build:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/arcee-ai/nac/main/scripts/install.sh | sh
   ```

3. Start nac from the repository the user wants it to work on:

   ```sh
   nac-web
   ```

   Use `nac-web -C /path/to/project -y` when a non-interactive launch is useful. Keep the process running.

4. Hand the user the dashboard URL (`http://127.0.0.1:3210` by default) and confirm it responds. Everything from here — signing in with Arcee or ChatGPT, picking a model, adding MCP servers from the MCP Library — is done in the UI. Point the user at the dashboard's auth and model picker and let them drive.

## 2. Connect this MCP client to nac

The MCP client is the harness running this session — the agent the user prompted to install the skill. Do not ask which client to use; configure the one you are running in. Add this streamable-HTTP server to your own harness's MCP configuration:

```text
URL: http://127.0.0.1:3210/mcp
Transport: streamable HTTP
```

This exposes nac session-management tools to the client agent. The listener is intended for the same machine and has no built-in authentication; do not expose it through a tunnel or reverse proxy unless the user adds strong access control.

Use the client's normal MCP configuration mechanism and adapt its configuration syntax around the URL above. Restart or reload the client if it does not pick up the server automatically, then confirm the client can see nac's tools.

## Completion checklist

Before calling setup complete, confirm that:

- `nac-web` is installed and running, and the dashboard URL responds.
- The user is in the dashboard and can reach sign-in and the model picker themselves.
- nac's `/mcp` endpoint is configured in this harness's MCP client configuration and nac's tools are visible.
