use super::*;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PermissionGrantRecord {
    pub id: String,
    pub session_id: String,
    pub action: String,
    pub resource: String,
    pub backend: String,
    pub session_config_version: i64,
    pub created_at: String,
}

const COLUMNS: &str =
    "id, session_id, action, resource, backend, session_config_version, created_at";

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<PermissionGrantRecord> {
    Ok(PermissionGrantRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        action: row.get(2)?,
        resource: row.get(3)?,
        backend: row.get(4)?,
        session_config_version: row.get(5)?,
        created_at: row.get(6)?,
    })
}

pub fn list_permission_grants(path: &Path, session_id: &str) -> Result<Vec<PermissionGrantRecord>> {
    let connection = open_runtime_connection(path)?;
    let mut statement = connection.prepare(&format!(
        "SELECT {COLUMNS} FROM permission_grants
         WHERE session_id = ?1 ORDER BY created_at ASC, id ASC"
    ))?;
    let rows = statement.query_map(params![session_id], row_to_record)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

pub(crate) fn list_effective_permission_grants(
    path: &Path,
    session_id: &str,
    backend: &str,
    session_config_version: i64,
) -> Result<Vec<PermissionGrantRecord>> {
    let connection = open_runtime_connection(path)?;
    let mut statement = connection.prepare(&format!(
        "SELECT {COLUMNS} FROM permission_grants
         WHERE session_id = ?1 AND backend = ?2 AND session_config_version = ?3
         ORDER BY created_at ASC, id ASC"
    ))?;
    let rows = statement.query_map(
        params![session_id, backend, session_config_version],
        row_to_record,
    )?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

pub fn insert_permission_grants(
    path: &Path,
    session_id: &str,
    action: &str,
    resources: &[String],
    backend: &str,
    session_config_version: i64,
) -> Result<Vec<PermissionGrantRecord>> {
    if session_id.trim().is_empty() || action.trim().is_empty() {
        return Err(anyhow!(
            "permission grant session and action must not be empty"
        ));
    }
    if resources.is_empty() || resources.iter().any(|resource| resource.trim().is_empty()) {
        return Err(anyhow!("permission grant resources must not be empty"));
    }
    if !matches!(backend, "local" | "podman" | "ssh") {
        return Err(anyhow!("unsupported permission grant backend '{backend}'"));
    }
    if session_config_version < 0 {
        return Err(anyhow!(
            "permission grant config version must not be negative"
        ));
    }
    let mut connection = open_runtime_connection(path)?;
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let now = now_utc();
    for resource in resources {
        transaction.execute(
            "INSERT OR IGNORE INTO permission_grants
             (id, session_id, action, resource, backend, session_config_version, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                uuid::Uuid::new_v4().to_string(),
                session_id,
                action,
                resource,
                backend,
                session_config_version,
                now
            ],
        )?;
    }
    transaction.commit()?;
    list_effective_permission_grants(path, session_id, backend, session_config_version)
}

pub fn delete_permission_grant(path: &Path, session_id: &str, grant_id: &str) -> Result<()> {
    let connection = open_runtime_connection(path)?;
    let changed = connection.execute(
        "DELETE FROM permission_grants WHERE session_id = ?1 AND id = ?2",
        params![session_id, grant_id],
    )?;
    if changed == 0 {
        return Err(anyhow!(
            "permission grant '{grant_id}' was not found in session '{session_id}'"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grants_are_deduplicated_scoped_and_revision_bound() {
        let path = std::env::temp_dir()
            .join(format!("nac-permission-grants-{}", uuid::Uuid::new_v4()))
            .join("store.db");
        crate::store::initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        crate::store::insert_test_session(&path, "session-b");

        let resources = vec!["command:[cargo][test]*".to_string()];
        insert_permission_grants(&path, "session-a", "execute", &resources, "local", 0).unwrap();
        insert_permission_grants(&path, "session-a", "execute", &resources, "local", 0).unwrap();
        assert_eq!(list_permission_grants(&path, "session-a").unwrap().len(), 1);
        assert_eq!(
            list_effective_permission_grants(&path, "session-a", "local", 0)
                .unwrap()
                .len(),
            1
        );
        assert!(
            list_effective_permission_grants(&path, "session-a", "ssh", 0)
                .unwrap()
                .is_empty()
        );
        assert!(
            list_effective_permission_grants(&path, "session-a", "local", 1)
                .unwrap()
                .is_empty()
        );
        assert!(list_permission_grants(&path, "session-b")
            .unwrap()
            .is_empty());

        let id = list_permission_grants(&path, "session-a").unwrap()[0]
            .id
            .clone();
        delete_permission_grant(&path, "session-a", &id).unwrap();
        assert!(list_permission_grants(&path, "session-a")
            .unwrap()
            .is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
