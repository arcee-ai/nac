<p align="center">
  <img src="docs/images/header.jpg" alt="nac from Arcee" />
</p>

<p align="center">
  <a href="https://arcee.ai">Arcee</a> &bull;
  <a href="#documentation">Documentation</a> &bull;
  <a href="https://github.com/arcee-ai/nac/releases">Releases</a> &bull;
  <a href="https://platform.arcee.ai">Arcee Open Model API</a>
</p>

<p align="center">
  <a href="https://github.com/arcee-ai/nac/actions/workflows/release.yml">
    <img src="https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white" alt="CI" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License" />
  </a>
</p>

nac is an open-source agent harness for longer, ambitious tasks — experiments, training runs, infrastructure, and prototyping that has to stay aligned with the original intent. It uses a thread-and-episode architecture inspired by [slate](https://randomlabs.ai/blog/slate): a central orchestrator plans and decomposes work but cannot execute commands or edit files; it only launches threads, which return episodes — structured summaries of what they accomplished. Also takes inspiration from [nanocode](https://github.com/1rgs/nanocode) and [pi](https://github.com/badlogic/pi-mono). For the technical write-up, see the [nac blog post](https://arcee.ai/blog/nac).

## Quickstart

**By Hand.** Install the latest stable release:

```sh
curl -fsSL https://raw.githubusercontent.com/arcee-ai/nac/main/scripts/install.sh | sh
```

The installer puts `nac-web` in `$HOME/.local/bin`. Add that directory to your `PATH` if needed, then start the dashboard from your project,

```sh
nac-web
```

and navigate to the interface in your browser (default: [http://127.0.0.1:3210](http://127.0.0.1:3210/)).

**By Agent.** Nac provides a portable onboarding skill and MCP integration; paste this into your chosen agent harness to install nac, configure it, and connect the MCP:

> Install the nac onboarding skill with `curl -fsSL https://raw.githubusercontent.com/arcee-ai/nac/main/scripts/install-skill.sh | sh -s -- --target agents`, load `nac-onboarding`, and walk me through installing nac, selecting Arcee login, ChatGPT Codex login, or an OpenAI-compatible API key, adding MCP servers, and connecting your MCP client to nac.

**Upgrade.** Nac ships with a native upgrade function which can be used to install the latest stable release of nac.

```sh
nac-web upgrade
```

```sh
# Upgrade to the latest nightly release candidate
nac-web upgrade --pre-release
```


### Model Provider Authentication

Pick one before you start a session, or configure it later from the dashboard.

```sh
# Recommended: Arcee device-code login → Latest Open & Arcee Trinity models
nac-web arcee-auth login

# ChatGPT account via OAuth → OpenAI models
nac-web codex-auth login

# Any catalog provider (DeepSeek, Fireworks, Together, OpenAI, Anthropic, arcee-api, …)
export OPENAI_API_KEY=...   # or ANTHROPIC_API_KEY, TOGETHER_API_KEY, ARCEE_API_KEY, …
```

More details can be found in [Providers and logins](docs/configuration/credentials.md) and [Model configuration](docs/configuration/model.md). 


### Uninstall

```sh
curl -fsSL https://raw.githubusercontent.com/arcee-ai/nac/main/scripts/uninstall.sh | sh
```

## Documentation

- [Usage](docs/usage/README.md)
  - [AGENTS.md Files](docs/usage/agents-md.md)
  - [Skills](docs/usage/skills.md)
  - [Sandbox](docs/usage/sandbox.md)
- [Configuration](docs/configuration/README.md)
  - [Example config](docs/configuration/example.md)
  - [Model configuration](docs/configuration/model.md)
  - [Catalog and cost](docs/configuration/catalog.md)
  - [Providers and logins](docs/configuration/credentials.md)
- [HTTP API](docs/api/http.md)
- [Model request security](docs/security/model-requests.md)

## Contributing

Pull requests are welcome. A CLA-signing bot checks every PR against arcee-ai's [CLA](https://github.com/arcee-ai/mergekit/blob/main/CLA.md); comment `I have read the CLA Document and I hereby sign the CLA` on your PR to sign it (or `recheck` to re-run the check).

For production-equivalent local development, run `make demo`. It rebuilds the
frontend bundle, compiles the real `nac-web` binary with those embedded assets,
and opens the dashboard; use Ctrl-C and rerun it after source changes. The
existing `make dev` target remains available when the committed bundle is
already current.

The local verification lanes are `make test-web` for frontend unit/component
tests, `make test-e2e` for isolated real-browser tests against the embedded
server and a credential-free scripted model, and `make test-durability` for the
focused lifecycle/crash-window regressions. Install the E2E browser once with
`npm --prefix crates/nac-server/web exec -- playwright install chromium`.

nac is licensed under [Apache 2.0](LICENSE).
