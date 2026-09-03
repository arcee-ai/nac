use super::*;

#[test]
fn saved_ssh_use_cases_preserve_tri_state_updates_and_validation() {
    let root = std::env::temp_dir().join(format!("nac-ssh-application-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let store_path = root.join("store.db");
    let application = SshConfigurationApplication::new(&store_path);

    let created = application
        .create(CreateSshConfiguration {
            name: "Build host".to_string(),
            ssh_host: "build.example.test".to_string(),
            ssh_port: Some(2222),
            ssh_identity_file: Some("keys/build".to_string()),
        })
        .unwrap();
    assert_eq!(application.list().unwrap(), vec![created.clone()]);

    let updated = application
        .update(
            &created.config_id,
            UpdateSshConfiguration {
                name: Field::Unchanged,
                ssh_host: Field::Set("replacement.example.test".to_string()),
                ssh_port: Field::Clear,
                ssh_identity_file: Field::Unchanged,
            },
        )
        .unwrap();
    assert_eq!(updated.name, "Build host");
    assert_eq!(updated.ssh_host, "replacement.example.test");
    assert_eq!(updated.ssh_port, None);
    assert_eq!(updated.ssh_identity_file.as_deref(), Some("keys/build"));

    let error = application
        .update(
            &created.config_id,
            UpdateSshConfiguration {
                name: Field::Clear,
                ssh_host: Field::Unchanged,
                ssh_port: Field::Unchanged,
                ssh_identity_file: Field::Unchanged,
            },
        )
        .unwrap_err();
    assert!(matches!(error, SshConfigurationStoreError::InvalidInput(_)));

    application.delete(&created.config_id).unwrap();
    assert!(application.list().unwrap().is_empty());
    let missing = application.delete(&created.config_id).unwrap_err();
    assert!(matches!(missing, SshConfigurationStoreError::NotFound(_)));

    let _ = std::fs::remove_dir_all(root);
}
