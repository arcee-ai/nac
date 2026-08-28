use std::sync::Arc;

use super::*;

struct TestDir(PathBuf);

impl TestDir {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "nac-managed-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn valid_config(root: &Path) -> ManagedHostConfig {
    ManagedHostConfig {
        version: MANAGED_CONFIG_VERSION,
        logical_host_id: "host-123".to_string(),
        owner: Some("owner@example.test".to_string()),
        public_hostname: "nac.example.test".to_string(),
        repository_root: root.join("repositories"),
        state_root: root.join("state"),
        home_root: root.join("home"),
        github_client_id: "Iv1.example".to_string(),
        model_backend: "arcee-api".to_string(),
        model_id: "trinity-large-thinking".to_string(),
        model_endpoint: "https://models.example.test/v1".to_string(),
        model_credential_file: root.join("model-token"),
        model_credential_environment_names: vec!["ARCEE_API_KEY".to_string()],
    }
}

#[test]
fn optional_managed_configuration_is_absent_without_an_explicit_path() {
    assert_eq!(ManagedHostConfig::load_optional(None).unwrap(), None);
}

#[test]
fn managed_configuration_is_strict_and_structurally_validated() {
    let root = TestDir::new("config");
    let path = root.0.join("managed.toml");
    std::fs::write(
        &path,
        format!(
            "version = 1\nlogical_host_id = \"host-123\"\nowner = \"owner@example.test\"\npublic_hostname = \"nac.example.test\"\nrepository_root = \"{0}/repositories\"\nstate_root = \"{0}/state\"\nhome_root = \"{0}/home\"\ngithub_client_id = \"Iv1.example\"\nmodel_backend = \"arcee-api\"\nmodel_id = \"trinity-large-thinking\"\nmodel_endpoint = \"https://models.example.test/v1\"\nmodel_credential_file = \"{0}/model-token\"\nmodel_credential_environment_names = [\"ARCEE_API_KEY\"]\n",
            root.0.display()
        ),
    )
    .unwrap();
    let config = ManagedHostConfig::load(&path).unwrap();
    assert_eq!(config.logical_host_id, "host-123");

    std::fs::write(
        &path,
        std::fs::read_to_string(&path).unwrap() + "unknown = true\n",
    )
    .unwrap();
    assert!(ManagedHostConfig::load(&path)
        .unwrap_err()
        .to_string()
        .contains("failed to parse"));
}

#[test]
fn managed_configuration_rejects_relative_or_insecure_transport_fields() {
    let root = TestDir::new("config-invalid");
    let mut config = valid_config(&root.0);
    config.repository_root = PathBuf::from("repositories");
    assert!(config
        .validate()
        .unwrap_err()
        .to_string()
        .contains("absolute"));
    config.repository_root = root.0.join("repositories");
    config.model_endpoint = "http://models.example.test".to_string();
    assert!(config.validate().unwrap_err().to_string().contains("HTTPS"));
    config.model_endpoint = "https://models.example.test".to_string();
    config.public_hostname = "https://nac.example.test".to_string();
    assert!(config
        .validate()
        .unwrap_err()
        .to_string()
        .contains("hostname"));
}

#[test]
fn host_secret_store_is_write_only_atomic_and_restart_safe() {
    let root = TestDir::new("secrets");
    let store = HostSecretStore::new(&root.0);
    let created = store.put("DEMO_TOKEN", "first\nline").unwrap();
    assert_eq!(created.name, "DEMO_TOKEN");
    assert_eq!(store.list().unwrap(), vec![created.clone()]);
    assert_eq!(
        store.snapshot().unwrap().get("DEMO_TOKEN"),
        Some("first\nline")
    );

    let reopened = HostSecretStore::new(&root.0);
    let replaced = reopened.put("DEMO_TOKEN", "rotated").unwrap();
    assert!(replaced.updated_at_unix_ms >= created.updated_at_unix_ms);
    assert_eq!(store.snapshot().unwrap().get("DEMO_TOKEN"), Some("rotated"));
    assert!(store.delete("DEMO_TOKEN").unwrap());
    assert!(!store.delete("DEMO_TOKEN").unwrap());
    assert!(reopened.snapshot().unwrap().is_empty());

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(root.0.join("managed_host_secrets.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }
}

#[test]
fn host_secret_store_serializes_concurrent_updates() {
    let root = TestDir::new("secrets-concurrent");
    let store = Arc::new(HostSecretStore::new(&root.0));
    let first = Arc::clone(&store);
    let second = Arc::clone(&store);
    let a = std::thread::spawn(move || first.put("FIRST_TOKEN", "alpha").unwrap());
    let b = std::thread::spawn(move || second.put("SECOND_TOKEN", "beta").unwrap());
    a.join().unwrap();
    b.join().unwrap();
    let snapshot = store.snapshot().unwrap();
    assert_eq!(snapshot.get("FIRST_TOKEN"), Some("alpha"));
    assert_eq!(snapshot.get("SECOND_TOKEN"), Some("beta"));
}

#[test]
fn host_secret_store_rejects_reserved_names_values_and_symlinks() {
    let root = TestDir::new("secrets-invalid");
    let store = HostSecretStore::new(&root.0).with_reserved_names(["MODEL_TOKEN".to_string()]);
    for name in [
        "PATH",
        "NAC_HOME",
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "GIT_CONFIG_COUNT",
        "LD_PRELOAD",
        "DYLD_INSERT_LIBRARIES",
        "MODEL_TOKEN",
    ] {
        assert!(store
            .put(name, "secret")
            .unwrap_err()
            .to_string()
            .contains("reserved"));
    }
    assert!(store.put("not-valid", "secret").is_err());
    assert!(store.put("EMPTY", "").is_err());
    assert!(store
        .put("TOO_LARGE", &"x".repeat(MAX_HOST_SECRET_VALUE_BYTES + 1))
        .is_err());

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let target = root.0.join("target");
        std::fs::write(&target, "unchanged").unwrap();
        symlink(&target, root.0.join("managed_host_secrets.json")).unwrap();
        let error = store.put("SAFE_NAME", "secret").unwrap_err();
        assert!(error.to_string().contains("symlink credential"));
        assert_eq!(std::fs::read_to_string(target).unwrap(), "unchanged");
    }
}

#[test]
fn immutable_snapshot_redacts_exact_values_without_revealing_names() {
    let root = TestDir::new("secrets-redact");
    let store = HostSecretStore::new(&root.0);
    store.put("DEMO_TOKEN", "canary-secret-value").unwrap();
    let snapshot = store.snapshot().unwrap();
    store.put("DEMO_TOKEN", "rotated-value").unwrap();
    assert_eq!(snapshot.get("DEMO_TOKEN"), Some("canary-secret-value"));
    assert_eq!(
        snapshot.redact("failed with canary-secret-value twice canary-secret-value"),
        "failed with [REDACTED] twice [REDACTED]"
    );
}
