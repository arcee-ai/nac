# Sandbox

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
