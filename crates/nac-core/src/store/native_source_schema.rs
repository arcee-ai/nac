//! Same-database source revisions and writer exclusion. No cross-system grant.
use super::*;

pub(crate) fn create_tables(c: &Connection) -> Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS native_source_revisions (
            kind TEXT NOT NULL CHECK(kind IN ('project','model','session')),
            resource_id TEXT NOT NULL CHECK(length(resource_id)>0),
            revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=0),
            PRIMARY KEY(kind,resource_id));
         CREATE TABLE IF NOT EXISTS native_source_reservations (
            operation_id TEXT PRIMARY KEY,
            binding_json TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_generation INTEGER NOT NULL CHECK(source_generation>=0),
            session_id TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('pending','preparing','prepared','uncertain','no_start')),
            UNIQUE(source_id,source_generation));
         CREATE TABLE IF NOT EXISTS native_source_slots (
            kind TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            operation_id TEXT NOT NULL REFERENCES native_source_reservations(operation_id),
            revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=0),
            PRIMARY KEY(kind,resource_id));
         CREATE TRIGGER IF NOT EXISTS native_source_reservation_no_delete BEFORE DELETE ON native_source_reservations
         BEGIN SELECT RAISE(ABORT,'native source history retained'); END;
         CREATE TRIGGER IF NOT EXISTS native_source_reservation_transition BEFORE UPDATE ON native_source_reservations
         WHEN NEW.operation_id IS NOT OLD.operation_id OR NEW.binding_json IS NOT OLD.binding_json
           OR NEW.source_id IS NOT OLD.source_id OR NEW.source_generation IS NOT OLD.source_generation
           OR NEW.session_id IS NOT OLD.session_id OR NOT (
             (OLD.state='pending' AND NEW.state IN ('preparing','no_start')) OR
             (OLD.state='preparing' AND NEW.state IN ('prepared','uncertain')) OR
             (OLD.state='prepared' AND NEW.state='uncertain'))
         BEGIN SELECT RAISE(ABORT,'native source transition refused'); END;
         CREATE TRIGGER IF NOT EXISTS native_source_revision_no_delete BEFORE DELETE ON native_source_revisions
         BEGIN SELECT RAISE(ABORT,'native source revision retained'); END;
         CREATE TRIGGER IF NOT EXISTS native_source_revision_monotonic BEFORE UPDATE ON native_source_revisions
         WHEN NEW.kind IS NOT OLD.kind OR NEW.resource_id IS NOT OLD.resource_id OR NEW.revision<=OLD.revision
         BEGIN SELECT RAISE(ABORT,'native source revision refused'); END;
         INSERT OR IGNORE INTO native_source_revisions SELECT 'project',project_id,1 FROM projects;
         INSERT OR IGNORE INTO native_source_revisions SELECT 'model',config_id,1 FROM model_configurations;
         INSERT OR IGNORE INTO native_source_revisions SELECT 'session',session_id,1 FROM sessions;",
    )?;
    for (table, kind, key, update) in [
        ("projects", "project", "project_id", "UPDATE OF project_id,cwd,ssh_host,ssh_port,ssh_identity_file,default_model_config_id"),
        ("model_configurations", "model", "config_id", "UPDATE"),
        ("sessions", "session", "session_id", "UPDATE OF session_id,behavior,cwd,host_id,ssh_port,ssh_identity_file,model,base_url,allow_insecure_http,backend,reasoning_effort,sandbox_json,api_key_env,extra_headers_json,config_version,orchestrator_compaction_threshold,light_model_json,permission_approval_mode,permission_auto_approve_generation,permission_approval_revision"),
    ] {
        for (suffix, event, refs) in [
            ("insert", "INSERT", vec!["NEW"]),
            ("update", update, vec!["OLD", "NEW"]),
            ("delete", "DELETE", vec!["OLD"]),
        ] {
            let predicate = if suffix == "update" {
                let columns = if kind == "model" {
                    let mut stmt=c.prepare(&format!("PRAGMA table_info({table})"))?;
                    let names=stmt.query_map([],|r|r.get::<_,String>(1))?.collect::<rusqlite::Result<Vec<_>>>()?;
                    names
                } else { update.strip_prefix("UPDATE OF ").unwrap_or(key).split(',').map(str::to_owned).collect() };
                columns.iter().map(|col|format!("OLD.{col} IS NOT NEW.{col}")).collect::<Vec<_>>().join(" OR ")
            } else if suffix == "insert" {
                format!("NOT EXISTS(SELECT 1 FROM {table} WHERE {key}=NEW.{key})")
            } else { "1".into() };
            let guards = refs.iter().map(|r| format!(
                "EXISTS(SELECT 1 FROM native_source_slots WHERE kind='{kind}' AND resource_id={r}.{key})"
            )).collect::<Vec<_>>().join(" OR ");
            let revisions = refs.iter().map(|r| format!(
                "INSERT INTO native_source_revisions(kind,resource_id,revision) VALUES('{kind}',{r}.{key},1) ON CONFLICT(kind,resource_id) DO UPDATE SET revision=revision+1;"
            )).collect::<String>();
            let revision_predicate=if suffix=="insert" { "1" } else { &predicate };
            c.execute_batch(&format!(
                "CREATE TRIGGER IF NOT EXISTS native_source_{table}_{suffix}_guard BEFORE {event} ON {table}
                 WHEN ({predicate}) AND ({guards}) BEGIN SELECT RAISE(ABORT,'native source reserved'); END;
                 CREATE TRIGGER IF NOT EXISTS native_source_{table}_{suffix}_revision AFTER {event} ON {table}
                 WHEN ({revision_predicate}) BEGIN {revisions} END;"
            ))?;
        }
    }
    // Association changes affect both the session and project launch source,
    // including first-chat selection and FK cascades. Fence old AND new keys.
    for (suffix, event, refs) in [
        ("insert", "INSERT", vec!["NEW"]),
        ("update", "UPDATE", vec!["OLD", "NEW"]),
        ("delete", "DELETE", vec!["OLD"]),
    ] {
        let mut guards = Vec::new();
        let mut revisions = String::new();
        for r in refs {
            for (kind, key) in [("session", "session_id"), ("project", "project_id")] {
                guards.push(format!("EXISTS(SELECT 1 FROM native_source_slots WHERE kind='{kind}' AND resource_id={r}.{key})"));
                revisions.push_str(&format!("INSERT INTO native_source_revisions VALUES('{kind}',{r}.{key},1) ON CONFLICT(kind,resource_id) DO UPDATE SET revision=revision+1;"));
            }
        }
        c.execute_batch(&format!(
            "CREATE TRIGGER IF NOT EXISTS native_source_session_projects_{suffix}_guard BEFORE {event} ON session_projects
             WHEN {} BEGIN SELECT RAISE(ABORT,'native source reserved'); END;
             CREATE TRIGGER IF NOT EXISTS native_source_session_projects_{suffix}_revision AFTER {event} ON session_projects
             BEGIN {revisions} END;", guards.join(" OR ")
        ))?;
    }
    Ok(())
}
