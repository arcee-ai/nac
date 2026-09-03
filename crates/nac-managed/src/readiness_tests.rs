use super::*;

#[test]
fn path_and_model_checks_require_owned_canonical_private_writable_inputs() {
    let root = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("nac-ready-{}", Uuid::new_v4().simple()));
    fs::create_dir(&root).unwrap();
    let credential = root.join("model-token");
    fs::write(&credential, "test-only-token").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        fs::set_permissions(&credential, fs::Permissions::from_mode(0o600)).unwrap();
        let metadata = fs::metadata(&root).unwrap();
        assert!(path_check("root", &root, metadata.uid(), metadata.gid()).ready);
        assert!(model_credential_check(&credential, metadata.uid(), metadata.gid()).ready);
        fs::set_permissions(&credential, fs::Permissions::from_mode(0o644)).unwrap();
        let failure = model_credential_check(&credential, metadata.uid(), metadata.gid());
        assert!(!failure.ready);
        assert!(!failure.detail.contains("test-only-token"));
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn runtime_inventory_reports_only_missing_tool_names() {
    let check = runtime_tools_check(&["this-tool-does-not-exist-nac"]);
    assert!(!check.ready);
    assert!(check.detail.contains("this-tool-does-not-exist-nac"));
}

#[cfg(unix)]
#[test]
fn runtime_ownership_accepts_owner_or_root_with_the_expected_group() {
    assert!(ownership_is_accepted(10_001, 10_001, 10_001, 10_001));
    assert!(ownership_is_accepted(0, 10_001, 10_001, 10_001));
    assert!(!ownership_is_accepted(20_001, 10_001, 10_001, 10_001));
    assert!(!ownership_is_accepted(0, 20_001, 10_001, 10_001));
}
