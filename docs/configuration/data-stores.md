# Data stores and build tracks

NAC isolates default local SQLite data by the runtime build track:

| Runtime track | Default file under `NAC_HOME` |
| --- | --- |
| source / `dev` | `dev.db` |
| beta | `beta.db` |
| stable | `stable.db`, or legacy `store.db` when `stable.db` is absent |

Without `NAC_HOME`, the normal platform configuration directory is used; the
fallback for an environment without a home directory is `.nac/<track>.db`.
The `--store-path` CLI option and `[storage].store_path` configuration remain
authoritative expert overrides. Relative overrides continue to resolve against
the launch configuration directory.

For compatibility with installations created before track isolation, a stable
build uses `NAC_HOME/store.db` in place when that legacy file exists and
`stable.db` does not. It emits a startup warning and does not copy or rename
the database. If both files exist, `stable.db` wins and the legacy file remains
untouched. Development and beta builds never adopt the legacy stable file.

Promotion never copies development or beta data into the stable store. There
is no preview store because NAC has no preview release channel. Switching a
running installation between channels is not supported; a future product
decision must define that behavior before any UI, API, or configuration option
is added.

Managed NAC is deliberately different: one host owns one PVC-backed database
at `/var/lib/nac/nac.sqlite3`. The managed entrypoint passes that explicit path,
so build-track defaults never split or copy the host store. Upgrades migrate it
forward in place.

Migrations are serialized with an immediate SQLite transaction, apply forward
only, and commit schema and data changes atomically. A failed migration rolls
back and startup fails closed. A binary refuses a schema newer than it supports
without modifying it. Downgrade, reversible migrations, N/N-1 compatibility,
automatic rollback, and snapshot/restore promises are not supported.
