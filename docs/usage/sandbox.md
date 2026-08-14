# Sandbox

`nac-web` can run tools inside a Podman sandbox (requires Podman to be installed):

```sh
nac-web --sandbox
```

The first sandbox launch pulls the container image and can take a few
minutes; the launch dialog shows the current phase and elapsed time while it
runs.

By default this mounts the current directory into the sandbox at `/workspace`.
When the current directory belongs to a git repository, the sandbox mounts a
throwaway per-session [git worktree](https://git-scm.com/docs/git-worktree)
forked from `HEAD` instead of the live checkout, so the session can write files
and switch branches without touching your working tree:

- The worktree lives under the nac home directory (`worktrees/<session-key>`)
  on a `nac/<session-key>` branch and is removed when the session is deleted.
- Uncommitted changes in your checkout are not visible to the session — the
  fork starts clean from `HEAD`.
- If the session commits work, its branch is kept on session deletion and the
  path to it is logged; an unused branch is deleted with the worktree.
- If the working folder is below the repository root, only that subtree is
  mounted, so git commands do not work inside the sandbox (same as a plain
  mount of that folder).
- The repository's shared git directory is mounted read-write so git works in
  the sandbox; the session can still mutate refs and repo metadata, though it
  can no longer touch your checked-out files. nac's own host-side git commands
  run with hooks disabled.
- Directories outside a git repository are mounted live, as before.

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
