---
name: testing-nac-web-ui
description: How to run and end-to-end test the nac-web browser UI (server startup, sessions, composer quirks, shimmer/thread checks)
---

# Testing the nac-web UI

## Start the server from the branch under test
- Build: `cargo build` (frontend dist is embedded via `include_dir!` in crates/nac-server/src/lib.rs — you MUST rebuild the Rust binary after `npm run build` regenerates crates/nac-server/assets/dist, otherwise the server serves the old bundle).
- Kill any stale server first: `pkill -f 'nac-web --bind'` (an old-build server may still hold port 3210).
- Run: `cd /home/ubuntu/nac-repro && nohup setsid /home/ubuntu/repos/nac/target/debug/nac-web --bind 127.0.0.1:3210 -C /home/ubuntu/nac-repro/ws --no-open >> server.log 2>&1 &`
- Verify the served bundle hash: `curl -s localhost:3210 | grep -o 'index-[^"]*\.js'` and compare with crates/nac-server/assets/dist/index.html.

## Model credentials
- `~/.config/nac/config.toml` trusts openrouter.ai. Prior working sessions use DeepSeek via OpenRouter (session env). OPENROUTER_API_KEY and ANTHROPIC_API_KEY are in Devin secrets; ANTHROPIC_API_KEY may contain whitespace that must be stripped.

## Composer input quirk (important)
- The chat textarea ("Ask anything…") is a React controlled component. The browser tool's `type` action and even a native-setter + `input` event dispatch do NOT enable the Send button.
- Working method: click the textarea to focus it, then send real keystrokes with `xdotool type --delay 15 '<prompt>'` from the shell (DISPLAY is `:0`). Then click the Send (paper-plane) button.
- Beware: if focus is lost, xdotool keystrokes can trigger unrelated UI (e.g. the "Revert to this snapshot" dialog). Always verify `document.querySelector('textarea').value` and Send `disabled:false` before clicking Send.
- The F5 / browser-tool reload may not actually reload; use `xdotool key ctrl+r` and confirm via `performance.now()`.

## Shimmer / thread checks
- Live-run shimmer class: `.text-shimmer-basic`; check with `document.querySelectorAll('.text-shimmer-basic').length`.
- Run-in-progress indicator: Send button becomes `aria-label="Stop run"`.
- Threads panel: left tab "Threads", click a thread (probeN) to see its Command Log with `exec_command` rows and ✓ results.
- Good regression prompt for the non-UTF-8 worker-pump bug: dispatch a thread running `ls -la`, `printf '\375\376\377\n' >&2`, `date` — later commands must still get ✓ and nothing should shimmer after the final answer.

## Screen capture for artifacts
- X display is `:0` (not `:1`). `ffmpeg -f x11grab -video_size 1024x768 -i :0 out.mp4`, then convert to animated webp: `ffmpeg -i out.mp4 -ss A -to B -vf "setpts=PTS/5,scale=880:-2,fps=8" -loop 0 out.webp`.

## Devin Secrets Needed
- OPENROUTER_API_KEY (model calls via openrouter.ai), ANTHROPIC_API_KEY (optional; strip whitespace).
