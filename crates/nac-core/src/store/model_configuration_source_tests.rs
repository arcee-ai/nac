use super::*;
use crate::model_configurations::{insert_model_configuration, NewModelConfiguration};
use std::collections::BTreeMap;

struct TemporaryStore(PathBuf);
impl Drop for TemporaryStore {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn fixture() -> (TemporaryStore, PathBuf) {
    let directory = TemporaryStore(
        std::env::temp_dir().join(format!("nac-model-source-{}", uuid::Uuid::new_v4())),
    );
    let path = directory.0.join("store.db");
    initialize(&path).unwrap();
    insert_model_configuration(
        &path,
        "model",
        NewModelConfiguration {
            name: "revision-1".into(),
            backend: "arcee-api".into(),
            model: "a".into(),
            base_url: "https://example.invalid".into(),
            allow_insecure_http: false,
            api_key_env: None,
            reasoning_effort: None,
            extra_headers: BTreeMap::new(),
            orchestrator_compaction_threshold: None,
            initial_prompt: None,
            light_model: None,
        },
    )
    .unwrap();
    (directory, path)
}

#[test]
fn coherent_model_source_refuses_missing_and_retains_real_aba_revision() {
    let (_directory, path) = fixture();
    let first = load_model_configuration_source(&path, "model").unwrap();
    assert_eq!(first.revision, 1);
    assert_eq!(first.record.name, "revision-1");
    let connection = open_runtime_connection(&path).unwrap();
    connection
        .execute(
            "UPDATE model_configurations SET model='b' WHERE config_id='model'",
            [],
        )
        .unwrap();
    let changed = load_model_configuration_source(&path, "model").unwrap();
    assert_eq!(changed.record.model, "b");
    assert!(changed.revision > first.revision);
    connection
        .execute(
            "DELETE FROM model_configurations WHERE config_id='model'",
            [],
        )
        .unwrap();
    assert!(load_model_configuration_source(&path, "model").is_err());
    connection.execute("INSERT INTO model_configurations(config_id,name,backend,model,base_url,created_at,updated_at) VALUES('model','replacement','arcee-api','a','https://example.invalid','a','a')", []).unwrap();
    let replacement = load_model_configuration_source(&path, "model").unwrap();
    assert!(replacement.revision > changed.revision);
    assert_eq!(replacement.record.name, "replacement");
}

#[test]
fn coherent_model_source_refuses_corrupt_private_values_without_echoing_them() {
    for (column, value) in [
        ("extra_headers_json", "{PRIVATE_SENTINEL_HEADER"),
        ("extra_headers_json", "{\"PRIVATE_SENTINEL_HEADER\": 17}"),
        ("light_model_json", "{\"PRIVATE_SENTINEL_LIGHT\": "),
    ] {
        let (_directory, path) = fixture();
        let connection = open_runtime_connection(&path).unwrap();
        connection
            .execute(
                &format!("UPDATE model_configurations SET {column}=?1"),
                [value],
            )
            .unwrap();
        let error = load_model_configuration_source(&path, "model")
            .err()
            .unwrap();
        assert!(!format!("{error:?} {error}").contains("PRIVATE_SENTINEL"));
        if column == "extra_headers_json" {
            // Preserve the ordinary loader's established tolerant semantics.
            assert!(load_model_configuration(&path, "model")
                .unwrap()
                .extra_headers
                .is_empty());
        }
    }
}

#[test]
fn coherent_model_source_requires_existing_positive_revision() {
    let (_directory, path) = fixture();
    let connection = open_runtime_connection(&path).unwrap();
    connection.execute_batch("DROP TRIGGER native_source_revision_no_delete; DELETE FROM native_source_revisions WHERE kind='model';").unwrap();
    assert!(load_model_configuration_source(&path, "model").is_err());
    connection
        .execute(
            "INSERT INTO native_source_revisions VALUES('model','model',0)",
            [],
        )
        .unwrap();
    assert!(load_model_configuration_source(&path, "model").is_err());
    assert!(load_model_configuration_source(&path, "absent").is_err());
}

#[test]
fn coherent_model_source_never_pairs_rows_with_a_different_committed_revision() {
    let (_directory, path) = fixture();
    let writer_path = path.clone();
    let start = std::sync::Arc::new(std::sync::Barrier::new(2));
    let writer_start = start.clone();
    let writer = std::thread::spawn(move || {
        let connection = open_runtime_connection(&writer_path).unwrap();
        writer_start.wait();
        for _ in 0..100 {
            connection.execute("UPDATE model_configurations SET name='revision-' || (SELECT revision+2 FROM native_source_revisions WHERE kind='model' AND resource_id='model') WHERE config_id='model'", []).unwrap();
        }
    });
    start.wait();
    for _ in 0..100 {
        let source = load_model_configuration_source(&path, "model").unwrap();
        assert_eq!(source.record.name, format!("revision-{}", source.revision));
    }
    writer.join().unwrap();
    let source = load_model_configuration_source(&path, "model").unwrap();
    assert_eq!(source.revision, 201);
    assert_eq!(source.record.name, "revision-201");
}

#[tokio::test(flavor = "current_thread")]
async fn coherent_model_source_uses_the_actual_typed_store_coordinator() {
    let (_directory, path) = fixture();
    let coordinator = StoreCoordinator::acquire(&path).unwrap();
    let before = coordinator.stats().completed;
    let source = coordinator
        .load_model_configuration_source("model".into())
        .await
        .unwrap();
    assert_eq!(source.revision, 1);
    assert_eq!(source.record.config_id, "model");
    assert_eq!(coordinator.stats().completed, before + 1);
    coordinator.shutdown().await.unwrap();
}
