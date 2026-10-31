# Workspaces and execution backends

A session binds its workspace and execution backend during construction. Local,
SSH and optional Podman execution are separate choices. A tool approval cannot
change that backend or escape a sandbox. Select the appropriate project/session
configuration before starting work; a help question does not change it.

## Local and SSH

A local project uses a directory on the NAC host. An SSH project uses a remote
host and workspace path; its remote path is not a host-local path. The product
supports SSH host, optional port and identity-file configuration. Connection and
remote-tool readiness must be verified for that host rather than inferred from
documentation. SSH and Podman options cannot be combined in a session launch.

Local unsandboxed skills and project instructions follow the documented
[discovery rules](skills.md) and [AGENTS.md rules](agents-md.md). SSH uses
host-discovered user skills with hidden filesystem paths and does not load local
project AGENTS.md. An SSH skill listing does not make arbitrary host reference
files accessible remotely. The bundled guide instead retrieves immutable
references inside the NAC harness, independent of either filesystem.

## Podman and managed hosts

Podman is opt-in and requires an available runtime. Its filesystem/network
confinement remains effective after approval; see [Sandbox](sandbox.md) for
mounts, supported setup and the documented recovery limitation. A stopped Podman
machine is unavailable, even when the CLI is installed. Do not switch to local
execution to make a denied or unavailable sandbox operation succeed.

A managed host provides its own workspace, ownership, credentials, readiness
and persistence contract; it is not a different public session behavior. See
[Managed NAC](../managed/README.md). Do not infer a managed installation from
having an orchestrator session. Backend choices do not imply that web search,
MCP servers or models have usable credentials.

## Retained tasks and recovery

Separate retained tasks own their workspace preparation and snapshot receipts.
See [Retained isolated tasks](retained-tasks.md) for failure/resume and ownership
requirements. Reading status or help never prepares or resumes a task.
After restart, durable state and goals follow their own recovery contracts;
see [data stores](../configuration/data-stores.md) and [goals](direct-goals.md).
The guide reports installed behavior, not whether a current connection, lease
or recovery marker is ready. When those facts are unavailable, say so.
