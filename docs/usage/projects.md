# Projects

A project is an explicit, store-scoped record: one canonical local directory or
one canonical directory on an SSH connection, plus a name, optional description,
and optional saved model configuration. Location is immutable after create.

Projects are not execution backends. Local, SSH, and Podman session construction
is documented in [Workspaces](workspaces.md). Do not send a nonblank `cwd` or SSH
location on a project-selected create; an SSH project cannot use sandbox options.

## Create

```http
POST /projects
Content-Type: application/json

{ "cwd": "/home/me/code/app" }
```

The body uses `cwd` (local directory or SSH workspace path), optional `name`,
`description`, SSH fields (`ssh_host`, `ssh_port`, `ssh_identity_file`), and
optional `default_model_config_id`. Creation canonicalizes local paths and
verifies remote paths with the same SSH directory browse used by session launch.
Omit `name` and a local checkout derives one from the origin remote
(`owner/repo`), otherwise the directory name.

- 409 if another project already owns that canonical location
- 400 invalid or non-directory path
- 403 unreadable path
- 404 missing path
- 502 SSH transport or remote-command failure

`GET /projects` lists them. `PATCH /projects/{project_id}` edits name,
description, pin, or the saved model-configuration reference. Location cannot
change.

## Pin and reorder

Projects carry the same presentation fields as sessions: `pinned`, `sort_order`,
and `presentation_version`. `PATCH` with `pinned` moves the project to the end
of the target pin group and bumps the version.

```http
PUT /projects/order
Content-Type: application/json

{
  "pinned": true,
  "project_ids": ["proj-a", "proj-b"],
  "expected_versions": { "proj-a": 3, "proj-b": 1 }
}
```

The request must list every project in that pin group exactly once and carry
each current `presentation_version` in `expected_versions`. Stale versions or
an incomplete group return 409 rather than reordering a set that has since
changed.

## Assign sessions

Selection is explicit. NAC never infers a project from `cwd`.

- Create with `project_id` on `POST /sessions`. The new session inherits the
  project's location and copied model defaults.
- Assign an already-created session:

```http
POST /projects/{project_id}/sessions
Content-Type: application/json

{ "session_id": "<existing id>" }
```

`session_id` is the only body field. Membership is written once: 409 if the
session already belongs to a project, or if its working directory and SSH tuple
are not the project's location. There is no move or historical-backfill API.

Each session belongs to at most one project. `GET /sessions?project_id=` filters
the list. The selected project ID appears in session summary and detail metadata.

## First chat

The web marks the required first chat with `first_chat: true`. The flag requires
`project_id` and is an idempotent admission: concurrent first-chat requests for
the same empty project return the same newly created primary session. If a
primary chat already exists, its snapshot is returned instead. Ordinary **New
chat** omits the flag and always creates another session.

Direct-only UI may also send `first_chat_same_behavior: true` so a legacy
session created during that race cannot become its result. See
[Session behaviors](session-behaviors.md).

## Model defaults

A project's optional saved model configuration is copied into a new session, not
read live. It supplies `model`, `backend`, `base_url`, `allow_insecure_http`,
`reasoning_effort`, `api_key_env`, `extra_headers`, `light_model`, and an
explicit compaction threshold. Later project edits affect only later sessions;
resume uses the session snapshot. See [Project defaults](../configuration/model.md#project-defaults).

Deleting a saved model configuration still referenced by a project returns 409
and retains both the configuration and its credentials.

## Delete

```http
DELETE /projects/{project_id}
```

Delete releases rather than destroys. Sessions keep their transcripts and
reappear as unassigned; the response lists them in `released_session_ids`.

```http
DELETE /projects/{project_id}?sessions=delete
```

Pass `?sessions=delete` to take the sessions down with the project. They are
deleted one by one before the project row goes, and the response lists them in
`deleted_session_ids`. A session that refuses to be deleted fails the whole
request with the project still standing, so the rest are never left orphaned.
