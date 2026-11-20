use super::*;

/// Provider routes own only a credential selector, never a secret or a model.
pub(super) fn create_provider_connections(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS provider_connections (
             connection_id TEXT PRIMARY KEY,
             backend TEXT NOT NULL,
             base_url TEXT NOT NULL,
             allow_insecure_http INTEGER NOT NULL CHECK (allow_insecure_http IN (0, 1)),
             api_key_env TEXT NOT NULL,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_provider_connections_backend
             ON provider_connections(backend, updated_at);",
    )?;
    Ok(())
}

/// Preserve each named credential route before presets become inert. The
/// original rows remain available to bounded migrations until they are removed.
pub(super) fn migrate_provider_connections(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "INSERT INTO provider_connections
             (connection_id, backend, base_url, allow_insecure_http, api_key_env, created_at, updated_at)
         SELECT config_id, backend, base_url, allow_insecure_http, api_key_env, created_at, updated_at
           FROM model_configurations
          WHERE api_key_env IS NOT NULL AND length(trim(api_key_env)) > 0;",
    )?;
    Ok(())
}
