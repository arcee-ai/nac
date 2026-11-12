# NAC desktop (Rune)

A native desktop client for NAC, drawn with [Rune](https://github.com/anomalyco/rune) (wgpu,
winit, Taffy, Parley). There is no webview: the app draws its own UI and talks to `nac-web` over
HTTP and SSE. The look follows dogfood's web client.

This crate is its own Cargo workspace with its own lockfile; NAC's root workspace does not
include it. Rune is a git dependency pinned to one revision.

## Build

```sh
cd desktop/rune
cargo build            # toolchain 1.99.1, from rust-toolchain.toml
cargo clippy
```

Linux needs `sudo apt-get install -y libxkbcommon-dev libwayland-dev`.

## Run

```sh
# Attach to a running server.
target/debug/nac-desktop --server http://127.0.0.1:8080

# Start a nac-web child on a free loopback port and stop it on quit.
target/debug/nac-desktop --nac-web /path/to/nac-web --directory /path/to/workspace
```

| Flag | Meaning |
| --- | --- |
| `--server URL` | Attach to this server. No child is started. |
| `--nac-web PATH` | The `nac-web` to start. Otherwise `$NAC_WEB`, then a `nac-web` beside `nac-desktop`, then `PATH`. |
| `--directory DIR` | The child's working directory. Defaults to `$HOME`. |
| `--store-path PATH` | The child's store. Defaults to the one `nac-web` selects. |
| `--session ID` | Headless only: open this session before drawing. |

The child is started by the desktop launch contract of `crates/nac-server/src/desktop_launch.rs`
(`__desktop-identity`, `__desktop-configuration`, then a `hello`/`ready`/`stop` exchange over a
Unix socket named by `NAC_DESKTOP_CHANNEL_FD`). A `nac-web` without that contract is started with
`--bind 127.0.0.1:PORT` and polled on `GET /readyz`.

## Session behavior

The app follows the server's UI policy (`GET /ui-config`, see
`docs/usage/session-behaviors.md`). By default New session asks only for a model and creates a
`direct` session, and only direct sessions are listed. When the server runs with
`NAC_ORCHESTRATION=1`, the model menu gains a session-type submenu and every session is listed.

## Working in a session

- **Messages during a run.** In a direct session the send arrow steers the running turn and
  **Queue next** holds the message for the next one. Undelivered messages are listed above the
  composer, where each can be switched between the two or withdrawn. Stop cancels the run.
- **Questions.** A question the agent asks is a card at the end of the transcript, with its
  suggested answers, a field for another answer, and Cancel question.
- **Permissions.** A request is a card with Deny, Always allow and Approve. A running subagent's
  requests are shown in its parent, named by the subagent. The server refuses a subagent's request
  after five seconds unless a client holds that subagent's event stream, so the app holds one for
  each running subagent of the open session.
- **Approval mode.** The chip in the composer switches a direct session between Manual, Full
  access and Approve for me. Orchestrator sessions have no approval mode.
- **Subagents.** The sessions a session started are listed above its composer and are left out of
  the sidebar. A subagent's header links back to its parent.
- **Model and effort.** Their chips change the open session between runs.
- **Projects and sessions.** The sidebar's and Overview's Add project open the system folder
  sheet. A secondary click on a project or session row offers Rename and Delete. Deleting a
  project keeps its sessions and its folder.

### Full access

Full access is the server's `auto_approve` mode, which the web client calls Approve all. The
server then answers ordinary permission requests for the session and its subagents without
asking. It creates no remembered grants, and hard denials and configured `deny` rules still
apply. Settings has a switch that starts new direct sessions in Full access.

### Menus

The model, effort, approval mode and row menus are native pop-up menus, which Rune has on macOS
and Windows. Elsewhere those controls show "Menus need macOS or Windows.", and New session uses
the first listed model.

### Saved settings

The theme, the last model, collapsed projects and the Full access switch are kept in
`ai.arcee.nac.rune/prefs.json` under the user's settings directory. A headless run keeps them in
memory unless `RUNE_PREFS_DIR` names a directory.

## Headless snapshots

Rune renders without a display or a GPU. Fixture scenes need no server:

```sh
target/debug/nac-desktop --list-scenes
target/debug/nac-desktop --snap out.png --scene overview --size 1280x800 --scale 2 --theme light
target/debug/nac-desktop --tree tree.json --scene session-running
```

Scenes: `overview`, `session`, `session-running`, `session-permission`, `session-question`,
`session-queue`, `session-child`, `rename`, `delete`, `empty`, `settings`.

With `--server` (or `--nac-web`) a headless run loads the real project and session lists before
it draws, and stops a child it started:

```sh
target/debug/nac-desktop --server http://127.0.0.1:8080 --tree tree.json
```

## macOS bundle

Built, bundled and used in a window on macOS 27.2 (arm64). Following Rune's
`scripts/mac-app.md`, from a Rune checkout at the pinned revision:

```sh
cargo build --release
/path/to/rune/scripts/mac-app --name NAC --id ai.arcee.nac.rune --exe nac-desktop \
  --bin target/release/nac-desktop
```

The bundle identifier above is a placeholder. Put `nac-web` beside `nac-desktop` in
`Contents/MacOS/` so the app finds it without `--nac-web`.

## Fonts

`assets/fonts/` holds Geist and Geist Mono (variable weight), licensed under the SIL Open Font
License 1.1; the license text is `assets/fonts/OFL.txt`.

## Layout

| File | Owns |
| --- | --- |
| `src/main.rs` | Flags, fonts, window chrome, keys, startup and quit. |
| `src/engine.rs` | Attaching to a server, or starting and stopping the `nac-web` child. |
| `src/api.rs` | The blocking HTTP client and the response types. |
| `src/stream.rs` | The session event stream: replay cursor, gaps, reconnect. |
| `src/state.rs` | The app model, its actions, worker threads and the event reducer. |
| `src/controls.rs` | What the open session is told: messages, answers, permission replies, approval mode, model and effort. |
| `src/manage.rs` | Adding, renaming and deleting projects and sessions, and the saved settings. |
| `src/transcript.rs` | Snapshot messages to transcript items. |
| `src/theme.rs` | The kit themes built from dogfood's tokens. |
| `src/icons.rs` | Icons. |
| `src/fixtures.rs` | Canned scenes for snapshots. |
| `src/views/` | Sidebar, Overview, session and settings pages, the composer, the permission and question cards, and the rename and delete dialog. |
