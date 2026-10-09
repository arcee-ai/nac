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

Existing Ubuntu CI at head `2665302efa606a0186de8ea68c11002ad77cecf6`
reproduced controlling-terminal loss with actual util-linux 2.39.3 and Bash 5.2:
`/dev/tty` failed, foreground group was -1, monitor mode was off and Ctrl-C did
not interrupt the job, although geometry changed. PTYs now retain their inherited
controlling session through the monitor/foreground path even when setsid exists.
The non-PTY `setsid -w` branch is unchanged. Postrepair Linux CI evidence is still
pending; neither local nor Linux fixtures qualify a real SSH/Podman transport.

Cleanup traversal now runs each recursive function in a subshell so parent,
child and proc-stat variables cannot overwrite the caller's state. A deterministic
snapshot fixture reproduced a missing parent/duplicated grandchild in the previous
portable function. Earlier Linux fallback CI also reported a surviving background
descendant; additional identity and cleanup-trace diagnostics distinguish that
live case from fixture/PID-state uncertainty. Identity revalidation, signaling and
failed-inspection record retention are unchanged.

## Natural-exit ownership gap

A bounded Darwin real-PTY probe at local head
`47070673e8aa17134e18ff319a978c57082e2f25` reproduced an additional gap after
ordinary interactive-shell exit, with and without `disown`. A HUP/TERM-ignoring
background job in a separate process group was reparented to PID 1 and remained
live with the same kernel start seconds/microseconds. The supervisor removed its
pidfile; the existing kill wrapper then returned zero without terminating that
job. Closing every PTY observer descriptor before reaping did not remove the job.
The outer wrapper reaped via SIGHUP after descriptor closure, so this is not an
assertion that the outer transport completed with exit code zero. Fixture cleanup
used only captured kernel-stamped identities and verified that none remained live.

The foreground and recursion repairs do not establish complete remote settlement.
This gap also matters for opaque model commands that launch interactive shells.
A supervisor PID, terminal/channel closure, or an absent pidfile does not prove
that all separate job groups exited. Periodic descendant snapshots, shell trap
injection, and SID-wide signaling in an inherited SSH session do not supply the
required ownership guarantee.

Client-side native process supervision owns the local SSH/Podman CLI process;
it cannot acquire kernel authority over another host or a Podman VM's processes.
A remote native owner would need an explicit backend capability and authoritative
containment/adoption of descendants across parent exit, with stable identity,
retained cleanup failure and durable retry. A remote helper is not currently an
installed prerequisite and has not been deployed or provisioned here.

Podman's existing container owner can clean the complete owned container at
session teardown. That authority belongs to the established sandbox lifecycle;
per-terminal cleanup cannot destroy a container shared with agent work or sibling
terminals. Successful eventual container teardown is a separate guarantee from
successful per-terminal settlement. Remote human admission remains disabled
until a qualified ownership mechanism and real transport acceptance satisfy both.

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
The Linux fixture runs with the actual installed utility available and records `/dev/tty`,
session/process/foreground group identity, monitor mode, resize and Ctrl-C.
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
foreground SIGWINCH. Exercise Ctrl-C, Ctrl-Z, jobs/bg/fg, natural shell exit with
disowned jobs in separate groups, vim/less redraw,
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
