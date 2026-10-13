# On-demand terminal output

In a direct primary chat, ask the agent to inspect a failed terminal command.
It can discover the chat's existing human shells, agent executions and exact
human `!` commands, then retrieve or search bounded sanitized output without a
selection attachment. Terminal activity does not submit a prompt, add scrollback
to the conversation, start a model turn or grant input authority.

The model tools stay available with the same definitions before and after a
terminal appears. `list_executions` accepts an optional `limit` (1–32, default
16) and exclusive `after` ID cursor. It returns `executions` and `next_after`;
an empty list is valid. Each entry reports `id`, `origin` (`human`, `agent`,
`human_command`), `representation` (`pty`, `log`), source-masked `cwd`, `backend`,
`process_state` (`running`, `cleanup_pending`, `settled`), `exit_code`,
`output_complete`, `output_error`, `retained`, `read` and `input` capabilities.
The inventory is a current view and contains no output preview or raw artifact
ID. A capability reports availability; configured permissions still apply.

Use `read_command_output` with exactly one ID:

```json
{"execution_id":"<id from list_executions>","offset":"0","limit":4096}
```

The existing `output_id` form from `exec_command` and `write_stdin` keeps its
paging semantics and cannot read a human output artifact. `execution_id` binds
the current chat and process incarnation. Knowing an old ID, sharing a project
or cwd, or copying a parent/child/fork attribution does not grant a live read.
Restart, capability expiry and eviction make the handle unavailable.

Execution reads use caller-owned byte cursors. Returned offsets and retained
bounds are exact decimal strings. `limit` bounds scanned source bytes (1–65536,
default 16384). Text decodes UTF-8 lossily and escapes controls except newline
and tab; offsets refer to sanitized source bytes, rather than displayed text.
The immutable launch policy has already masked retained bytes, so pages never
substitute current credentials or mask canonical content a second time. PTYs
support `combined`; logs also support `stdout` and `stderr`.

A retention `gap` returns no content. Continue at `next_offset` to inspect the
retained tail. `caught_up` describes the current retained end; `output_complete`
describes collector completion separately from process settlement. An exited
process may still have pending cleanup or output collection. `eof` requires
collector completion and reaching the retained end.

Add `query` for literal UTF-8 search in one bounded page:

```json
{"execution_id":"<id from list_executions>","query":"missing dependency","offset":"0","limit":4096}
```

A query contains 1–256 UTF-8 bytes, and its scan limit must exceed that length.
Search returns at most 16 matches with up to 64 surrounding source bytes on
each side, and no full page. Continue at `next_offset`; overlapping page tails
preserve possible matches across scan boundaries. `search_complete` means the
current retained end was fully searched, rather than promising future output.

Discovery, reads and searches use ordinary `command_output` agent permissions,
including configured Deny, Ask and canonical capability revalidation after
approval. They do not write stdin, stop, retain, launch, recover or wake work.
A human shell keeps its default input protection. Browser observation and
model reads do not advance one another's cursors or alter process lifetime.
Explicit selection preview/send/queue/steer remains a separate evidence
admission with its existing immutable provenance.

Human terminal support remains limited to the currently qualified Local direct
primary path. Agent log/PTY reads use their construction-selected backend;
this capability adds no SSH, Podman or hosted human-terminal qualification.
