# Sandbox

Start `nac-web`, create a session, and select **Sandbox** in the launch dialog.
Sandbox mode requires Podman.

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
- If the working folder is below the repository root, the isolated worktree is
  still mounted in full and the sandbox starts in the corresponding
  subdirectory, so git commands keep working without exposing the live checkout.
- The repository's shared git directory is mounted read-only. The session's
  worktree metadata, loose refs, ref logs, and object store are overlaid
  read-write so commits and branch changes work, while host Git config and
  hooks stay read-only.
- nac registers the worktree with `--no-checkout` and materializes committed
  files inside Podman, so host Git filters and checkout hooks do not run during
  sandbox launch or recovery.
- Directories outside a git repository are mounted live, as before.
- If nac cannot inspect the repository, resolve its home directory, or create
  the worktree, launch falls back to a live writable mount and logs `sandbox
  will mount the live checkout` on server stderr. Fix that warning before
  relying on worktree isolation.
- If Git's writable administrative paths contain symlinks, escape the common
  Git directory, or otherwise cannot be validated, nac refuses the launch
  instead of exposing the live checkout.

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
