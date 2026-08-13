# AGENTS.md Files

`AGENTS.md` is loaded hierarchically and injected as instructions for both the orchestrator and worker threads. More specific files override broader ones when they conflict.

## Where files are loaded

A global file is loaded first from `NAC_HOME` (`$NAC_HOME` when set, otherwise `$XDG_CONFIG_HOME/nac`, otherwise `~/.config/nac`). Then project files are loaded from the git root (or the workspace if there is no `.git`) down to the session workspace, one directory at a time.

In each directory nac tries these names, in order, and uses the first non-empty file:

1. `AGENTS.override.md`
2. `AGENTS.md`
3. Any extra names in `[agents_md] fallback_filenames` from [config.toml](../configuration/example.md)

Empty files are skipped. Combined UTF-8 size across loaded files is capped by `[agents_md] max_bytes` (default 4 MiB, minimum 1). Content past that cap is truncated.

The orchestrator receives the combined documents as a separate system message. Workers receive the same text appended to their system prompt. See [Skills](skills.md) for skill discovery, which is independent of `AGENTS.md`.
