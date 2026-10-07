//! Synthetic private authority shared by execution-boundary characterization tests.
use super::{
    ManagedHostExecutionAuthority, ManagedHostKeyBinding, ManagedHostKeyStore,
    TrustedManagedHostKey,
};
use std::path::PathBuf;

pub(crate) struct Fixture {
    pub root: PathBuf,
    pub authority: ManagedHostExecutionAuthority,
    original: Vec<u8>,
}

impl Fixture {
    pub fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("nac-execution-fence-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let binding: ManagedHostKeyBinding = serde_json::from_value(serde_json::json!({
            "bootstrap_id":"4712bc5e-30d5-421a-b416-8291d9f7d8f9",
            "managed_host_id":"21856443-8ed8-40ab-9036-72e837c99f27",
            "host_incarnation_id":"cr-uid-1", "pvc_uid":"pvc-uid-1",
            "organization_id":"11670cb3-ea82-4f66-96ca-d5b6542f8c2a",
            "owner_epoch":1, "key_generation":1,
            "local_key_id":"00d61e35-4d17-4949-888f-5f153b03a53b",
            "key_id":"provider-key-1", "clerk_instance_id":"instance-test",
            "inference_origin":"https://api.arcee.ai"
        }))
        .unwrap();
        let mut wire = serde_json::to_value(&binding).unwrap();
        wire["version"] = 3.into();
        wire["credential_kind"] = "clerk_api_key".into();
        wire["scopes"] = serde_json::json!(["managed:inference"]);
        wire["api_key"] = "synthetic-execution-canary".into();
        let input = root.join("bootstrap.json");
        nac_credential_store::write_auth_string_to_path(&input, &wire.to_string()).unwrap();
        ManagedHostKeyStore::new(&root)
            .import(&binding, &input)
            .unwrap();
        std::fs::remove_file(input).unwrap();
        let original = std::fs::read(root.join("managed_host_key.json")).unwrap();
        let authority = ManagedHostExecutionAuthority::new(
            TrustedManagedHostKey::new(&root, binding.clone()).unwrap(),
        );
        Self {
            root,
            authority,
            original,
        }
    }

    pub fn remove(&self) {
        std::fs::remove_file(self.root.join("managed_host_key.json")).unwrap();
    }

    pub fn restore(&self) {
        nac_credential_store::write_auth_string_to_path(
            &self.root.join("managed_host_key.json"),
            std::str::from_utf8(&self.original).unwrap(),
        )
        .unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
