//! Coherent selected-row observation DATA, never source reservation or admission.
use super::model_configurations::{model_configuration_columns, row_to_record_at};
use super::*;

/// The selected model and its revision from the SAME committed SQLite view.
/// This observation does not freeze writers or reconstruct an original owner.
/// Deliberately not Debug/Serialize: the record can contain private headers.
pub struct ModelConfigurationSource {
    pub record: ModelConfigurationRecord,
    pub revision: i64,
}

type SourceResult = std::result::Result<ModelConfigurationSource, ModelConfigurationStoreError>;

fn source_unavailable() -> ModelConfigurationStoreError {
    ModelConfigurationStoreError::Store(anyhow!("selected model source unavailable"))
}

coordinated_command! {
/// Read a real selected row and positive native source revision atomically.
/// Missing/corrupt source data refuses; no default row or revision is invented.
/// The ordinary model reader retains its established decoding behavior.
pub fn load_model_configuration_source(path: &Path, config_id: &str) -> SourceResult {
    let connection = open_runtime_connection(path).map_err(|_| source_unavailable())?;
    connection.query_row(
        &format!("SELECT {}, r.revision FROM model_configurations m
            JOIN native_source_revisions r ON r.kind='model' AND r.resource_id=m.config_id
            WHERE m.config_id=?1 AND typeof(r.revision)='integer' AND r.revision>0",
            model_configuration_columns("m")),
        params![config_id],
        |row| {
            // The ordinary decoder intentionally tolerates invalid headers. A
            // source fingerprint must reject them instead of hashing defaults.
            let headers: String = row.get(8)?;
            serde_json::from_str::<std::collections::BTreeMap<String, String>>(&headers)
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            Ok(ModelConfigurationSource {
                record: row_to_record_at(row, 0)?,
                revision: row.get(14)?,
            })
        },
    ).map_err(|_| source_unavailable())
}
command LoadModelConfigurationSourceCommand {
    config_id: String = config_id.to_owned(),
}
call |command| (&command.config_id)
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

#[cfg(test)]
#[path = "model_configuration_source_tests.rs"]
mod tests;
