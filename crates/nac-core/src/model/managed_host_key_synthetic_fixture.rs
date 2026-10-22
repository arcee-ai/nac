//! Synthetic physical-serving test input; never Root or runtime authority.
use super::*;
use std::sync::Mutex;

/// Test-support-only private import fixture. It accepts no caller-selected
/// path, binding, key, proof or current checker. Its fixed canary is not a
/// provider credential. It cannot qualify a protected runtime or source grant.
/// Retain this owner while testing physical serving: drop deletes its private
/// files, so retained custody fails its ordinary private-state current check.
pub struct SyntheticInitialCustodyFixture {
    root: PathBuf,
    binding: ManagedHostKeyBinding,
    store: ManagedHostKeyStore,
    custody: Mutex<Option<InitialHostKeyCustody>>,
}

impl SyntheticInitialCustodyFixture {
    pub fn new() -> Result<Self> {
        let root = std::env::temp_dir().join(format!("nac-synthetic-custody-{}", Uuid::new_v4()));
        let mut directory = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            directory.mode(0o700);
        }
        directory.create(&root)?;
        let binding = ManagedHostKeyBinding {
            bootstrap_id: Uuid::new_v4().to_string(),
            managed_host_id: Uuid::new_v4().to_string(),
            host_incarnation_id: "synthetic-test-cr".into(),
            pvc_uid: "synthetic-test-pvc".into(),
            organization_id: Uuid::new_v4().to_string(),
            owner_epoch: 1,
            key_generation: 1,
            local_key_id: Uuid::new_v4().to_string(),
            key_id: "synthetic-test-provider-key".into(),
            clerk_instance_id: "synthetic-test-instance".into(),
            inference_origin: "https://api.arcee.ai".into(),
        };
        let store = ManagedHostKeyStore::new(&root);
        let fixture = Self {
            root,
            binding,
            store,
            custody: Mutex::new(None),
        };
        let mut wire = serde_json::to_value(&fixture.binding)?;
        wire["version"] = serde_json::json!(3);
        wire["credential_kind"] = serde_json::json!("clerk_api_key");
        wire["scopes"] = serde_json::json!(["managed:inference"]);
        wire["api_key"] = serde_json::json!("synthetic-fixture-not-a-provider-credential");
        let input = fixture.root.join("synthetic-bootstrap.json");
        write_auth_string_to_path(&input, &serde_json::to_string(&wire)?)?;
        let custody = fixture
            .store
            .import_initial_custody(&fixture.binding, &input, || Ok(()))?;
        *fixture
            .custody
            .lock()
            .map_err(|_| anyhow!("synthetic fixture unavailable"))? = Some(custody);
        Ok(fixture)
    }

    pub fn binding(&self) -> &ManagedHostKeyBinding {
        &self.binding
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn store(&self) -> &ManagedHostKeyStore {
        &self.store
    }

    /// One transfer only; this fixture never reimports from retained bytes.
    pub fn take_custody(&self) -> Result<InitialHostKeyCustody> {
        self.custody
            .lock()
            .map_err(|_| anyhow!("synthetic fixture unavailable"))?
            .take()
            .ok_or_else(|| anyhow!("synthetic fixture custody already taken"))
    }
}

impl Drop for SyntheticInitialCustodyFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthetic_fixture_is_one_shot_and_retains_private_file_lifetime() {
        let fixture = SyntheticInitialCustodyFixture::new().unwrap();
        let root = fixture.root().to_path_buf();
        let custody = fixture.take_custody().unwrap();
        assert_eq!(custody.binding(), fixture.binding());
        assert!(fixture.take_custody().is_err());
        custody.check_current(|| Ok(())).unwrap();
        drop(fixture);
        assert!(!root.exists());
        assert!(custody.check_current(|| Ok(())).is_err());
    }
}
