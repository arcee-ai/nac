# nac

Small coding agent.
Heavily inspired by [slate](https://randomlabs.ai/blog/slate). Also takes inspiration from [nanocode](https://github.com/1rgs/nanocode) and [pi](https://github.com/badlogic/pi-mono).

Install the latest `edge` build:

```sh
curl -fsSL https://raw.githubusercontent.com/sapiosaturn/nac/main/scripts/install.sh | sh
```

Pinned version installs are not supported yet.

Set `OPENAI_API_KEY`, then run `nac`.

Optional:
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`

Linux installs use the portable static build.

Uninstall:

```sh
curl -fsSL https://raw.githubusercontent.com/sapiosaturn/nac/main/scripts/uninstall.sh | sh
```

`nac` can run tools inside a Podman sandbox:

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

