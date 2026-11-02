# NAC Guide / nac-help

Source: first-party bundled NAC Guide. Use the installed immutable documentation
pack for NAC setup, sessions/subagents, workspace/backends, models/auth, MCP,
skills/instructions, permissions, recovery and managed-host differences.

Use `nac_guide` with `{"operation":"index","query":"<topic>"}` to find refs,
then `{"operation":"read","document_id":"<id>","section_id":"<id>"}`.
An omitted section returns a document outline. Follow `next_offset` for more
bytes only when needed. `{"operation":"manifest"}` reports installed identity.
These references are embedded resources, never host filesystem paths. Retrieval
works offline on Local, SSH, Podman and managed hosts without Exa or a checkout.

Read the relevant sections before answering. Cite `NAC Guide document_id#section_id`
and installed product version; include a short readable excerpt when useful.
The release-local pack is authoritative for installed behavior. Do not silently
substitute online main/latest. If separately requested online sources describe
a different build, label them separately and explain the mismatch. An old
fingerprint must be refreshed from the installed index, not guessed.

Documentation describes product behavior, not the current session's settings.
Never invent enabled tools, credentials, backend readiness or features. State
unknown current configuration explicitly and offer supported inspection steps.
Unknown refs/topics get a truthful unknown result; do not invent a capability.
Read web-retrieval for subagent search restrictions and session-behaviors for
the distinction between traditional children and managed orchestrators.

A help request authorizes explanation only. Do not run commands, install skills,
modify settings, start sessions, wake work, grant permissions or navigate merely
because documentation describes those operations. Handle separately requested
operations through existing authorization. A coding task merely mentioning NAC
does not activate unrelated guidance. Workers use only the selected preload;
there is no general worker skill activation.
