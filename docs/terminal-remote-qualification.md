# Remote human terminal qualification (ALL-143)

SSH and Podman human terminals are preparatory work. Public human terminal
admission remains limited to the selected Local backend in both the permission
tool and terminal manager. No fallback changes the selected execution backend.
This document records the remaining qualification boundary, not support acceptance.

## Implemented preparation

The common lifecycle/protocol contract is ALL-141 at
`a87fd5d3f22c892723d0e6eb4e3492147ede380f`. The existing CLI adapters still own
remote cwd, command environment, connection/container identity and cleanup pidfile.
The human PTY construction path adds `ssh -e none` and
`podman exec --detach-keys=` so OpenSSH escapes and Podman detach keys cannot
consume human input. Model PTY construction retains its existing flags, TERM,
pager and environment defaults. Credential filtering remains at the shared
execution backend boundary.

The shared supervisor's PTY fallback now uses `fg %1 >/dev/null`. Its previous
`2>/dev/null` also redirected the descriptor Bash uses for foreground terminal
ownership. On macOS Bash 3.2, that left the supervisor and requested interactive
shell stopped in a background process group. Keeping stderr attached restores
foreground ownership while retaining the stdout redirection that suppresses
startup job text. This repair also affects existing model PTYs that use this
fallback; it preserves command construction and pipe invocation behavior.

The `setsid -w` branch is unchanged. Acquiring a new session does not by itself
prove controlling-terminal/job-control fidelity. A local fixture forcing the
fallback cannot qualify the Linux branch or either real transport.

## Reproducible local checks

Run `make setup` in a fresh worktree, then:

```sh
cargo test --locked -p nac-core remote_pty_tests -- --test-threads=1
cargo test --locked -p nac-core unqualified_remote_human_terminals -- --test-threads=1
cargo test --locked -p nac-core sandbox::ssh::tests -- --test-threads=1
cargo test --locked -p nac-core sandbox::podman::tests -- --test-threads=1
cargo test --locked -p nac-core remote_cleanup -- --test-threads=1
cargo test --locked -p nac-core failed_remote_one_shot_cleanup -- --test-threads=1
```

The real local PTY regression forces the portable fallback using a disposable
`setsid` fixture in its private temporary directory. It checks monitor mode,
24x80 to 31x91 geometry, UTF-8 and ANSI output, Ctrl-C, Ctrl-Z/background resume,
and cleanup of a background descendant in a separate job process group.
Reads, cleanup helper lifetime and child reaping are bounded. All PTY descriptors
close before reaping. Failed process inspection retains its cleanup record and
does not become a successful cleanup result. Other existing tests characterize
remote transport-before-cleanup ordering, PID reuse, inspection uncertainty,
cancellation and durable retry/recovery. CLI construction fixtures do not open
SSH connections or create containers.

## Environment evidence and remaining acceptance

Qualification on 2026-10-09 observed Darwin 27 arm64, Bash 3.2,
OpenSSH 10.3p1/LibreSSL 3.3.6 and Podman CLI 6.1.0. The existing AppleHV Podman
machine was stopped and its runtime socket refused connections. No disposable
Linux SSH target was assigned. The VM was not started and no container or
external host was provisioned or modified.

Before enabling either remote human backend, assign a disposable Linux SSH
host with explicit host/port, user, identity, known-host trust, writable cwd and
process-cleanup authority; separately assign a running disposable Podman runtime
and an immutable container image digest. Starting the existing user VM and
creating/removing qualification containers require explicit authorization.

Run the exact supervised adapter on each target, recording kernel, util-linux,
Bash, SSH client/server and Podman/runtime versions. Capture `/dev/tty`, session,
process-group and foreground-group identity, initial/changed geometry and
foreground SIGWINCH. Exercise Ctrl-C, Ctrl-Z, jobs/bg/fg, vim/less redraw,
alternate screen, bracketed paste, UTF-8, line-leading `~.` and `~` + Ctrl-Z,
and bytes 0x10/0x11 in raw mode. Verify high output and split-secret redaction
across live, replay and retained output.

Use the common browser protocol to verify active-output reload, slow observers,
concurrent agent file changes, wrong-session/stale-incarnation rejection,
repeated launch/terminate and owner restart. Disconnect the transport and stop
the container independently of browser detach. Observe retained cleanup
obligations and retry after host access/inspection recovers. A failed or
unavailable backend must remain unavailable; observer detach must not terminate
the owned process. These real-backend and browser cases remain unverified here.
