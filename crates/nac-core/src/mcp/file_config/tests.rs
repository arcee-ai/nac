use super::*;

fn temp_config() -> PathBuf {
    crate::mcp::test_support::unique_temp_dir("nac-mcp-file-config").join("config.toml")
}

fn http_server(name: &str) -> McpServerConfigurationRecord {
    McpServerConfigurationRecord {
        name: name.to_string(),
        enabled: true,
        transport: MCP_TRANSPORT_STREAMABLE_HTTP.to_string(),
        command: None,
        args: Vec::new(),
        env: BTreeMap::new(),
        url: Some("https://mcp.example.com/mcp".to_string()),
        headers: BTreeMap::from([(
            "Authorization".to_string(),
            "Bearer secret-token".to_string(),
        )]),
        library_id: Some("example".to_string()),
        allowed_tools: Some(vec!["read".to_string(), "publish".to_string()]),
        denied_tools: vec!["publish".to_string()],
        approval: McpToolApproval::Allow,
        tool_approvals: BTreeMap::from([("read".to_string(), McpToolApproval::Ask)]),
        ..McpServerConfigurationRecord::default()
    }
}

#[test]
fn extended_operability_fields_roundtrip_without_touching_global_defaults() {
    let path = temp_config();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(
        &path,
        "[mcp]\nstartup_timeout_ms = 9000\n\n[unrelated]\nkeep = true\n",
    )
    .unwrap();
    let mut server = http_server("operable");
    server.required = true;
    server.startup_timeout_ms = Some(1_200);
    server.catalog_timeout_ms = Some(2_300);
    server.execution_timeout_ms = Some(3_400);
    server.protocol = McpProtocolSelection::Current;
    server.env_headers = BTreeMap::from([("X-Key".to_string(), "MCP_KEY".to_string())]);
    server.bearer_token_env_var = Some("MCP_TOKEN".to_string());
    server.header_helper = Some(McpHeaderHelperConfig {
        command: "refresh-headers".to_string(),
        args: vec!["--json".to_string()],
        cwd: Some("helpers".to_string()),
        env: BTreeMap::from([("TOKEN".to_string(), "secret".to_string())]),
        env_vars: vec!["HOME".to_string()],
        timeout_ms: Some(800),
    });

    let created = insert_mcp_server_configuration(&path, server).unwrap();
    assert_eq!(
        load_mcp_server_configuration(&path, "operable").unwrap(),
        created
    );
    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(raw.contains("startup_timeout_ms = 9000"));
    assert!(raw.contains("[unrelated]"));
    assert!(raw.contains("header_helper"));
    assert!(raw.contains("protocol = \"current\""));
    let strict: super::config::McpConfigFile = toml::from_str(&raw).unwrap();
    assert_eq!(strict.mcp.startup_timeout_ms, Some(9_000));
    assert!(strict.mcp_servers["operable"].required);
    assert_eq!(
        strict.mcp_servers["operable"].protocol,
        McpProtocolSelection::Current
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn global_defaults_load_without_deserializing_unrelated_server_rows() {
    let path = std::env::temp_dir()
        .join(format!("nac-mcp-defaults-{}", uuid::Uuid::new_v4()))
        .join("config.toml");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(
        &path,
        r#"
[mcp]
startup_timeout_ms = 321
catalog_timeout_ms = 654
execution_timeout_ms = 987

[mcp_servers.unrelated]
transport = "stdio"
args = ["missing-command-is-tolerated-by-default-loader"]
"#,
    )
    .unwrap();

    let defaults = load_mcp_defaults(&path).unwrap();
    assert_eq!(defaults.startup_timeout_ms, Some(321));
    assert_eq!(defaults.catalog_timeout_ms, Some(654));
    assert_eq!(defaults.execution_timeout_ms, Some(987));

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn hand_edit_after_read_is_never_overwritten_by_stale_publication() {
    let path = temp_config();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "model = \"before\"\n").unwrap();

    let (mut document, revision) = read_document_snapshot(&path).unwrap();
    let servers = servers_table(&mut document).unwrap();
    servers["example"] = Item::Table(table_of(&http_server("example")));

    let hand_edit = "model = \"from-editor\"\n# must survive\n";
    std::fs::write(&path, hand_edit).unwrap();
    assert!(matches!(
        write_document(&path, &document, revision).unwrap_err(),
        McpServerConfigurationStoreError::ConcurrentModification
    ));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), hand_edit);
    assert!(std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .filter_map(Result::ok)
        .all(|entry| !entry.file_name().to_string_lossy().contains(".tmp")));

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn stale_record_patch_cannot_restore_fields_after_editor_save() {
    let path = temp_config();
    insert_mcp_server_configuration(&path, http_server("example")).unwrap();
    let (mut stale, revision) = load_mcp_server_configuration_snapshot(&path, "example").unwrap();

    let mut editor = http_server("example");
    editor.url = Some("https://editor.example/mcp".to_string());
    update_mcp_server_configuration(&path, "example", editor.clone()).unwrap();

    stale.enabled = false;
    assert!(matches!(
        update_mcp_server_configuration_at_revision(&path, "example", stale, revision).unwrap_err(),
        McpServerConfigurationStoreError::ConcurrentModification
    ));
    assert_eq!(
        load_mcp_server_configuration(&path, "example").unwrap(),
        editor
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn conflict_never_erases_a_second_editor_save() {
    let path = temp_config();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "model = \"a\"\n").unwrap();
    let (mut document, revision) = read_document_snapshot(&path).unwrap();
    document["model"] = toml_edit::value("candidate");

    let first_path = path.clone();
    BEFORE_EXCHANGE_HOOK.with(|slot| {
        *slot.borrow_mut() = Some(Box::new(move || {
            std::fs::write(&first_path, "model = \"b\"\n").unwrap();
        }));
    });
    let second_path = path.clone();
    AFTER_EXCHANGE_HOOK.with(|slot| {
        *slot.borrow_mut() = Some(Box::new(move || {
            std::fs::write(&second_path, "model = \"d\"\n").unwrap();
        }));
    });

    assert!(matches!(
        write_document(&path, &document, revision).unwrap_err(),
        McpServerConfigurationStoreError::RecoveryRequired { .. }
    ));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "model = \"d\"\n");
    assert!(transaction_path(&path).exists());
    let preserved: Vec<PathBuf> = std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|candidate| candidate.extension().is_some_and(|value| value == "tmp"))
        .collect();
    assert_eq!(preserved.len(), 1);
    assert_eq!(
        std::fs::read_to_string(&preserved[0]).unwrap(),
        "model = \"b\"\n"
    );
    assert_eq!(
        read_mcp_configuration_consistently(&path).unwrap(),
        "model = \"d\"\n"
    );
    assert!(!preserved[0].exists());
    assert!(!transaction_path(&path).exists());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

fn prepare_crash_transaction(
    path: &Path,
    expected_revision: [u8; 32],
    candidate: &str,
) -> (PathBuf, PublicationTransaction) {
    let temp = path.with_extension(format!("toml.{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temp, candidate).unwrap();
    let candidate_revision = current_document_revision(&temp).unwrap();
    let expected_identity = current_document_revision(path).unwrap().identity;
    let transaction = PublicationTransaction {
        version: PUBLICATION_TRANSACTION_VERSION,
        expected_revision,
        expected_identity,
        candidate_revision: candidate_revision.digest.unwrap(),
        candidate_identity: candidate_revision.identity,
        temp_name: temp.file_name().unwrap().to_str().unwrap().to_string(),
        phase: PublicationPhase::Prepared,
    };
    persist_transaction(path, &transaction).unwrap();
    (temp, transaction)
}

#[test]
fn recovery_aborts_a_crash_after_journal_before_exchange() {
    let path = temp_config();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "model = \"a\"\n").unwrap();
    let expected = current_document_revision(&path).unwrap().digest.unwrap();
    let (temp, _) = prepare_crash_transaction(&path, expected, "model = \"candidate\"\n");

    assert_eq!(
        read_mcp_configuration_consistently(&path).unwrap(),
        "model = \"a\"\n"
    );
    assert!(!temp.exists());
    assert!(!transaction_path(&path).exists());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn recovery_commits_a_crash_after_a_valid_exchange() {
    let path = temp_config();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "model = \"a\"\n").unwrap();
    let expected = current_document_revision(&path).unwrap().digest.unwrap();
    let (temp, _) = prepare_crash_transaction(&path, expected, "model = \"candidate\"\n");
    exchange_paths(&temp, &path).unwrap();

    assert_eq!(
        read_mcp_configuration_consistently(&path).unwrap(),
        "model = \"candidate\"\n"
    );
    assert!(!temp.exists());
    assert!(!transaction_path(&path).exists());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn legacy_identity_free_journal_is_quarantined_but_remains_recoverable() {
    let path = temp_config();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "model = \"a\"\n").unwrap();
    let expected = current_document_revision(&path).unwrap().digest.unwrap();
    let (temp, mut transaction) =
        prepare_crash_transaction(&path, expected, "model = \"candidate\"\n");
    transaction.expected_identity = None;
    transaction.candidate_identity = None;
    persist_transaction(&path, &transaction).unwrap();
    exchange_paths(&temp, &path).unwrap();

    assert!(matches!(
        read_mcp_configuration_consistently(&path).unwrap_err(),
        McpServerConfigurationStoreError::RecoveryRequired { .. }
    ));
    let replacement = path.with_extension("toml.operator-resolution");
    std::fs::write(&replacement, "model = \"chosen\"\n").unwrap();
    std::fs::rename(&replacement, &path).unwrap();
    assert_eq!(
        read_mcp_configuration_consistently(&path).unwrap(),
        "model = \"chosen\"\n"
    );
    assert!(!temp.exists());
    assert!(!transaction_path(&path).exists());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn legacy_identity_free_conflict_accepts_distinct_canonical_recovery() {
    let path = temp_config();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "model = \"a\"\n").unwrap();
    let expected = current_document_revision(&path).unwrap().digest.unwrap();
    let (temp, mut transaction) =
        prepare_crash_transaction(&path, expected, "model = \"candidate\"\n");
    exchange_paths(&temp, &path).unwrap();
    let displaced_revision = current_document_revision(&temp).unwrap().digest.unwrap();
    transaction.expected_identity = None;
    transaction.candidate_identity = None;
    transaction.phase = PublicationPhase::Conflict {
        displaced_revision,
        displaced_identity: None,
    };
    persist_transaction(&path, &transaction).unwrap();

    assert!(matches!(
        read_mcp_configuration_consistently(&path).unwrap_err(),
        McpServerConfigurationStoreError::RecoveryRequired { .. }
    ));
    let replacement = path.with_extension("toml.operator-resolution");
    std::fs::write(&replacement, "model = \"chosen\"\n").unwrap();
    std::fs::rename(&replacement, &path).unwrap();
    assert_eq!(
        read_mcp_configuration_consistently(&path).unwrap(),
        "model = \"chosen\"\n"
    );
    assert!(!temp.exists());
    assert!(!transaction_path(&path).exists());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn legacy_identity_free_conflict_rejects_preserved_equal_canonical_content() {
    let path = crate::mcp::test_support::unique_temp_dir("nac-mcp-file-config-preserved-equal")
        .join("config.toml");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "model = \"a\"\n").unwrap();
    let expected = current_document_revision(&path).unwrap().digest.unwrap();
    let (temp, mut transaction) =
        prepare_crash_transaction(&path, expected, "model = \"candidate\"\n");
    exchange_paths(&temp, &path).unwrap();
    let displaced_revision = current_document_revision(&temp).unwrap().digest.unwrap();
    transaction.expected_identity = None;
    transaction.candidate_identity = None;
    transaction.phase = PublicationPhase::Conflict {
        displaced_revision,
        displaced_identity: None,
    };
    persist_transaction(&path, &transaction).unwrap();

    let replacement = path.with_extension("toml.operator-resolution");
    std::fs::copy(&temp, &replacement).unwrap();
    std::fs::rename(&replacement, &path).unwrap();
    assert!(matches!(
        read_mcp_configuration_consistently(&path).unwrap_err(),
        McpServerConfigurationStoreError::RecoveryRequired { .. }
    ));
    assert!(temp.exists());
    assert!(transaction_path(&path).exists());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn recovery_quarantines_a_crash_after_a_conflicting_exchange() {
    let path = temp_config();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "model = \"a\"\n").unwrap();
    let expected = current_document_revision(&path).unwrap().digest.unwrap();
    let (temp, _) = prepare_crash_transaction(&path, expected, "model = \"candidate\"\n");
    std::fs::write(&path, "model = \"b\"\n").unwrap();
    exchange_paths(&temp, &path).unwrap();

    assert!(read_mcp_configuration_consistently(&path).is_err());
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "model = \"candidate\"\n"
    );
    assert_eq!(std::fs::read_to_string(&temp).unwrap(), "model = \"b\"\n");
    assert!(transaction_path(&path).exists());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn check_exchange_race_preserves_both_files_and_blocks_readers() {
    let path = temp_config();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "model = \"a\"\n").unwrap();
    let (mut document, revision) = read_document_snapshot(&path).unwrap();
    document["model"] = toml_edit::value("candidate");

    let first_path = path.clone();
    BEFORE_EXCHANGE_HOOK.with(|slot| {
        *slot.borrow_mut() = Some(Box::new(move || {
            std::fs::write(&first_path, "model = \"b\"\n").unwrap();
        }));
    });
    let error = write_document(&path, &document, revision).unwrap_err();
    assert!(matches!(
        error,
        McpServerConfigurationStoreError::RecoveryRequired { .. }
    ));
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "model = \"candidate\"\n"
    );
    let preserved: Vec<PathBuf> = std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|candidate| candidate.extension().is_some_and(|value| value == "tmp"))
        .collect();
    assert_eq!(preserved.len(), 1);
    assert_eq!(
        std::fs::read_to_string(&preserved[0]).unwrap(),
        "model = \"b\"\n"
    );
    assert!(transaction_path(&path).exists());
    assert!(read_mcp_configuration_consistently(&path).is_err());
    assert!(preserved[0].exists());
    assert!(transaction_path(&path).exists());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn equal_content_atomic_replacement_is_quarantined_by_file_identity() {
    let path = temp_config();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let original = "model = \"a\"\n";
    std::fs::write(&path, original).unwrap();
    let (mut document, revision) = read_document_snapshot(&path).unwrap();
    document["model"] = toml_edit::value("candidate");

    let replacement = path.with_extension("toml.editor-replacement");
    std::fs::write(&replacement, original).unwrap();
    let target = path.clone();
    BEFORE_EXCHANGE_HOOK.with(|slot| {
        *slot.borrow_mut() = Some(Box::new(move || {
            std::fs::rename(&replacement, &target).unwrap();
        }));
    });

    assert!(matches!(
        write_document(&path, &document, revision).unwrap_err(),
        McpServerConfigurationStoreError::RecoveryRequired { .. }
    ));
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "model = \"candidate\"\n"
    );
    assert!(read_mcp_configuration_consistently(&path).is_err());
    let preserved = std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|candidate| candidate.extension().is_some_and(|value| value == "tmp"))
        .expect("equal-content replacement must remain preserved");
    assert_eq!(std::fs::read_to_string(&preserved).unwrap(), original);

    let identical_save = path.with_extension("toml.identical-save");
    std::fs::write(&identical_save, "model = \"candidate\"\n").unwrap();
    std::fs::rename(&identical_save, &path).unwrap();
    assert!(
        read_mcp_configuration_consistently(&path).is_err(),
        "a byte-identical save remains ambiguous even with a new file identity"
    );

    std::fs::remove_file(&preserved).unwrap();
    assert_eq!(
        read_mcp_configuration_consistently(&path).unwrap(),
        "model = \"candidate\"\n",
        "removing the preserved file explicitly keeps the canonical document"
    );
    assert!(!transaction_path(&path).exists());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[cfg(unix)]
#[test]
fn saves_create_and_repair_private_file_permissions() {
    use std::os::unix::fs::PermissionsExt;

    let path = temp_config();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    insert_mcp_server_configuration(&path, http_server("example")).unwrap();
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    update_mcp_server_configuration(&path, "example", http_server("example")).unwrap();
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .filter_map(Result::ok)
        .all(|entry| !entry.file_name().to_string_lossy().contains(".tmp")));
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn mcp_config_process_helper() {
    let Some(path) = std::env::var_os("NAC_TEST_MCP_CONFIG_PATH") else {
        return;
    };
    let name = std::env::var("NAC_TEST_MCP_CONFIG_NAME").unwrap();
    let path = PathBuf::from(path);
    let _lease = acquire_mcp_configuration_write_lease(&path).unwrap();
    insert_mcp_server_configuration(&path, http_server(&name)).unwrap();
}

#[test]
fn cross_process_writers_preserve_both_whole_document_updates() {
    // Spawning the test binary inherits the process environment. Keep it
    // from racing tests that temporarily redirect NAC_HOME or MCP config.
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let path = temp_config();
    let executable = std::env::current_exe().unwrap();
    let spawn = |name: &str| {
        std::process::Command::new(&executable)
            .args([
                "--exact",
                "mcp::file_config::tests::mcp_config_process_helper",
                "--nocapture",
            ])
            .env("NAC_TEST_MCP_CONFIG_PATH", &path)
            .env("NAC_TEST_MCP_CONFIG_NAME", name)
            .spawn()
            .unwrap()
    };
    let mut first = spawn("first");
    let mut second = spawn("second");
    assert!(first.wait().unwrap().success());
    assert!(second.wait().unwrap().success());
    let names = list_mcp_server_configurations(&path)
        .unwrap()
        .into_iter()
        .map(|record| record.name)
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(names, ["first".to_string(), "second".to_string()].into());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn saved_entries_parse_as_registry_config_and_the_rest_of_the_file_survives() {
    let path = temp_config();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(
            &path,
            "# hand-written\nmodel = \"gpt\"\n\n[mcp_servers.existing]\ntransport = \"stdio\"\ncommand = \"npx\" # keep me\n",
        )
        .unwrap();

    let stdio = McpServerConfigurationRecord {
        name: "local".to_string(),
        enabled: false,
        transport: MCP_TRANSPORT_STDIO.to_string(),
        command: Some("npx".to_string()),
        args: vec!["-y".to_string(), "some-mcp".to_string()],
        env: BTreeMap::from([("TOKEN".to_string(), "${TOKEN}".to_string())]),
        url: None,
        headers: BTreeMap::new(),
        library_id: None,
        ..McpServerConfigurationRecord::default()
    };
    insert_mcp_server_configuration(&path, stdio).unwrap();
    insert_mcp_server_configuration(&path, http_server("example")).unwrap();

    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(raw.contains("# hand-written"));
    assert!(raw.contains("model = \"gpt\""));
    assert!(raw.contains("# keep me"));

    // The connect path parses the same file with the strict typed config.
    let parsed: super::config::McpConfigFile = toml::from_str(&raw).unwrap();
    assert_eq!(parsed.mcp_servers.len(), 3);
    let local = &parsed.mcp_servers["local"];
    assert!(!local.enabled);
    assert!(matches!(
        &local.transport,
        McpTransportConfig::Stdio {
            command, args, env, ..
        }
            if command == "npx" && args.len() == 2 && env["TOKEN"] == "${TOKEN}"
    ));
    let example = &parsed.mcp_servers["example"];
    assert!(matches!(
        &example.transport,
        McpTransportConfig::StreamableHttp { url, headers, .. }
            if url == "https://mcp.example.com/mcp"
                && headers["Authorization"] == "Bearer secret-token"
    ));
    assert_eq!(
        example.allowed_tools.as_deref(),
        Some(&["read".to_string(), "publish".to_string()][..])
    );
    assert_eq!(example.denied_tools, ["publish"]);
    assert_eq!(example.approval, McpToolApproval::Allow);
    assert_eq!(example.tool_approvals["read"], McpToolApproval::Ask);

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn an_inline_mcp_servers_table_survives_a_save() {
    let path = temp_config();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(
        &path,
        "mcp_servers = { existing = { transport = \"stdio\", command = \"npx\" } }\n",
    )
    .unwrap();

    insert_mcp_server_configuration(&path, http_server("example")).unwrap();

    let names: Vec<String> = list_mcp_server_configurations(&path)
        .unwrap()
        .into_iter()
        .map(|record| record.name)
        .collect();
    assert_eq!(names, vec!["existing".to_string(), "example".to_string()]);

    std::fs::write(&path, "mcp_servers = \"not a table\"\n").unwrap();
    assert!(matches!(
        insert_mcp_server_configuration(&path, http_server("example")).unwrap_err(),
        McpServerConfigurationStoreError::InvalidInput(_)
    ));
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn duplicate_names_are_rejected() {
    let path = temp_config();

    insert_mcp_server_configuration(&path, http_server("example")).unwrap();
    assert!(matches!(
        insert_mcp_server_configuration(&path, http_server("example")).unwrap_err(),
        McpServerConfigurationStoreError::DuplicateName(_)
    ));

    insert_mcp_server_configuration(&path, http_server("other")).unwrap();
    assert!(matches!(
        update_mcp_server_configuration(&path, "other", http_server("example")).unwrap_err(),
        McpServerConfigurationStoreError::DuplicateName(_)
    ));
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn transport_fields_are_validated() {
    let path = temp_config();

    let mut missing_url = http_server("bad");
    missing_url.url = None;
    assert!(matches!(
        insert_mcp_server_configuration(&path, missing_url).unwrap_err(),
        McpServerConfigurationStoreError::InvalidInput(_)
    ));

    let mut bad_transport = http_server("bad");
    bad_transport.transport = "websocket".to_string();
    assert!(matches!(
        insert_mcp_server_configuration(&path, bad_transport).unwrap_err(),
        McpServerConfigurationStoreError::InvalidInput(_)
    ));
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn missing_entries_report_not_found() {
    let path = temp_config();
    assert!(matches!(
        load_mcp_server_configuration(&path, "ghost").unwrap_err(),
        McpServerConfigurationStoreError::NotFound(_)
    ));
    assert!(matches!(
        update_mcp_server_configuration(&path, "ghost", http_server("ghost")).unwrap_err(),
        McpServerConfigurationStoreError::NotFound(_)
    ));
    assert!(!delete_mcp_server_configuration(&path, "ghost").unwrap());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
