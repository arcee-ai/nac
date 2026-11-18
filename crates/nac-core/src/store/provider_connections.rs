use super::*;

/// A provider route references a credential by name; the secret is held in the
/// separate credential store. Model choice is deliberately session-owned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderConnectionRecord {
    pub connection_id: String,
    pub backend: String,
    pub base_url: String,
    pub allow_insecure_http: bool,
    pub api_key_env: String,
    pub created_at: String,
    pub updated_at: String,
}

coordinated_command! {
pub fn list_provider_connections(path: &Path) -> Result<Vec<ProviderConnectionRecord>> {
    let conn = open_runtime_connection(path)?;
    let mut query = conn.prepare(
        "SELECT connection_id, backend, base_url, allow_insecure_http, api_key_env, created_at, updated_at
         FROM provider_connections ORDER BY updated_at, connection_id",
    )?;
    let rows = query.query_map([], |row| Ok(ProviderConnectionRecord {
        connection_id: row.get(0)?,
        backend: row.get(1)?,
        base_url: row.get(2)?,
        allow_insecure_http: row.get(3)?,
        api_key_env: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    }))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}
command ListProviderConnectionsCommand {}
call |_command| ()
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
pub fn insert_provider_connection(path: &Path, record: &ProviderConnectionRecord) -> Result<()> {
    anyhow::ensure!(
        !record.connection_id.trim().is_empty()
            && !record.backend.trim().is_empty()
            && !record.base_url.trim().is_empty()
            && !record.api_key_env.trim().is_empty(),
        "provider connection fields must not be empty"
    );
    let conn = open_runtime_connection(path)?;
    conn.execute(
        "INSERT INTO provider_connections
         (connection_id, backend, base_url, allow_insecure_http, api_key_env, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        params![record.connection_id, record.backend, record.base_url,
            record.allow_insecure_http, record.api_key_env],
    )?;
    Ok(())
}
command InsertProviderConnectionCommand {
    record: ProviderConnectionRecord = record.clone(),
}
call |command| (&command.record)
correlation |_command| crate::telemetry::Correlation::default();
port public;
}
