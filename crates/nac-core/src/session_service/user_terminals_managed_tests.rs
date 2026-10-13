use super::*;
use crate::store::{
    self, ManagedAcceptedIdentity, ManagedControlAttemptAction, ManagedOperationBinding,
    ManagedPrepareOutcome, ManagedUpgradeBlocker, ManagedUpgradeTarget,
};

fn binding(id: &str, source: char) -> ManagedOperationBinding {
    ManagedOperationBinding {
        managed_host_id: "terminal-host".into(),
        host_incarnation_id: "terminal-incarnation".into(),
        issuer: "https://controller.example.test".into(),
        audience: "urn:nac:managed-control:terminal-host:terminal-incarnation".into(),
        authority_origin: "https://controller.example.test".into(),
        operation_id: id.into(),
        target: ManagedUpgradeTarget {
            release_id: format!("release-{source}"),
            source_sha: source.to_string().repeat(40),
            product_version: "0.2.0".into(),
            schema_version: store::schema_version(),
            minimum_schema_version: 0,
        },
        actor: "owner".into(),
        beneficiary: "owner".into(),
    }
}

fn identity(binding: &ManagedOperationBinding) -> ManagedAcceptedIdentity {
    ManagedAcceptedIdentity {
        managed_host_id: binding.managed_host_id.clone(),
        host_incarnation_id: binding.host_incarnation_id.clone(),
        operation_id: binding.operation_id.clone(),
        target: binding.target.clone(),
    }
}

fn expires() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        + 60
}

fn prepare(
    path: &Path,
    operation: &ManagedOperationBinding,
    blockers: Vec<ManagedUpgradeBlocker>,
) -> ManagedPrepareOutcome {
    store::prepare_managed_upgrade(
        path,
        &format!("jti-{}", operation.operation_id),
        operation,
        ManagedControlAttemptAction::Prepare,
        expires(),
        blockers,
    )
    .unwrap()
}

#[tokio::test]
async fn legacy_managed_live_terminal_blocks_prepare_and_retained_completion_remains_available() {
    let (mut parts, directory) = fixture();
    parts.service.enable_managed_admission(None);
    let service = &parts.service;
    let terminal = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    service
        .write_user_terminal_input(
            &terminal.id,
            b"printf '%s' \"$NAC_TEST_SECRET\"; printf REDACTION-END\r",
        )
        .await
        .unwrap();
    let output = wait_for(service, &terminal.id, b"[REDACTED]").await;
    assert!(!output
        .windows(b"synthetic-user-secret".len())
        .any(|bytes| bytes == b"synthetic-user-secret"));
    let blockers = service
        .live_terminal_names()
        .into_iter()
        .map(|id| ManagedUpgradeBlocker {
            kind: store::ManagedBlockerKind::TerminalProcess,
            id,
            session_id: Some("direct-terminal".into()),
            detail: "live terminal".into(),
        })
        .collect();
    assert!(matches!(
        prepare(
            &directory.join("store.db"),
            &binding("maintenance", 'b'),
            blockers
        ),
        ManagedPrepareOutcome::Blocked { .. }
    ));
    assert_eq!(
        store::managed_maintenance_snapshot(&directory.join("store.db"))
            .unwrap()
            .state,
        store::ManagedMaintenanceState::Serving
    );
    service.terminate_user_terminal(&terminal.id).await.unwrap();
    assert!(matches!(
        prepare(
            &directory.join("store.db"),
            &binding("after-close", 'c'),
            Vec::new()
        ),
        ManagedPrepareOutcome::SafeToStop { .. }
    ));
    assert!(service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .is_err());
    assert!(service
        .write_user_terminal_input(&terminal.id, b"must-not-execute\r")
        .await
        .is_err());
    assert!(service
        .list_user_terminals()
        .await
        .unwrap()
        .iter()
        .any(|status| status.id == terminal.id));
    assert!(
        !service
            .user_terminal_status(&terminal.id)
            .await
            .unwrap()
            .alive
    );
    assert!(service
        .resize_user_terminal(&terminal.id, 91, 31)
        .await
        .is_err());
    let page = service
        .read_user_terminal_output(&terminal.id, 0, 65536)
        .await
        .unwrap();
    service
        .wait_for_user_terminal_output(&terminal.id, page.retained_end, 0)
        .await
        .unwrap();
    service.terminate_user_terminal(&terminal.id).await.unwrap();
    assert!(
        !service
            .user_terminal_status(&terminal.id)
            .await
            .unwrap()
            .alive
    );
    // Retained replay still uses the original launch snapshot during completion.
    let retained = service
        .read_user_terminal_output(&terminal.id, 0, 65536)
        .await
        .unwrap();
    assert!(!retained
        .bytes
        .windows(b"synthetic-user-secret".len())
        .any(|bytes| bytes == b"synthetic-user-secret"));
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn managed_pre_spawn_retains_host_admission_until_launch_rejection() {
    let barrier = Arc::new(tokio::sync::Barrier::new(2));
    let (mut parts, directory) = fixture_with_provider(Some(Arc::new(PausedEnvironment {
        barrier: barrier.clone(),
        fail: true,
    })));
    parts.service.enable_managed_admission(None);
    let service = &parts.service;
    let launch = service.open_user_terminal(Uuid::new_v4(), 80, 24);
    let prepare_during_spawn = async {
        barrier.wait().await;
        let path = directory.join("store.db");
        let result =
            tokio::task::spawn_blocking(move || sessions::HostMaintenanceLease::try_acquire(&path))
                .await
                .unwrap();
        assert!(
            result.is_err(),
            "exclusive prepare cannot cross an admitted pre-spawn window"
        );
        assert!(service.list_user_terminals().await.unwrap().is_empty());
        assert!(service.list_permission_requests().unwrap().is_empty());
        barrier.wait().await;
    };
    let (launch, ()) = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::join!(launch, prepare_during_spawn)
    })
    .await
    .unwrap();
    assert!(launch
        .unwrap_err()
        .to_string()
        .contains("environment snapshot"));
    assert!(service.list_user_terminals().await.unwrap().is_empty());
    // Failed pre-spawn admission releases the host lease; prepare can now close admission.
    assert!(matches!(
        prepare(
            &directory.join("store.db"),
            &binding("after-rejection", 'b'),
            Vec::new()
        ),
        ManagedPrepareOutcome::SafeToStop { .. }
    ));
    assert!(service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .is_err());
    assert!(service.list_permission_requests().unwrap().is_empty());
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn accepted_replacement_fences_all_old_terminal_service_operations() {
    let (mut parts, directory) = fixture();
    let path = directory.join("store.db");
    let original = binding("original", 'a');
    assert!(matches!(
        prepare(&path, &original, Vec::new()),
        ManagedPrepareOutcome::SafeToStop { .. }
    ));
    assert!(store::accept_managed_forward_start(&path, &identity(&original)).unwrap());
    parts
        .service
        .enable_managed_admission(Some(identity(&original)));
    let service = &parts.service;
    let terminal = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    service
        .write_user_terminal_input(&terminal.id, b"printf FINAL-MARKER; exit 0\r")
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while !service
            .user_terminal_status(&terminal.id)
            .await
            .unwrap()
            .output_complete
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let replacement = binding("replacement", 'b');
    assert!(matches!(
        prepare(&path, &replacement, Vec::new()),
        ManagedPrepareOutcome::SafeToStop { .. }
    ));
    assert!(store::accept_managed_forward_start(&path, &identity(&replacement)).unwrap());
    assert!(service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .is_err());
    assert!(service
        .write_user_terminal_input(&terminal.id, b"x")
        .await
        .is_err());
    assert!(service.terminal_input_control(&terminal.id).await.is_err());
    assert!(service
        .transfer_terminal_input_control(
            &terminal.id,
            1,
            crate::terminal::InputController::Agent,
            false
        )
        .await
        .is_err());
    assert!(service
        .write_controlled_terminal_input(&terminal.id, 1, b"stale")
        .await
        .is_err());
    assert!(service.list_user_terminals().await.is_err());
    assert!(service.user_terminal_status(&terminal.id).await.is_err());
    assert!(service
        .read_user_terminal_output(&terminal.id, 0, 1024)
        .await
        .is_err());
    assert!(service
        .wait_for_user_terminal_output(&terminal.id, 0, 0)
        .await
        .is_err());
    assert!(service
        .resize_user_terminal(&terminal.id, 80, 24)
        .await
        .is_err());
    assert!(service.terminate_user_terminal(&terminal.id).await.is_err());
    assert!(service.terminate_terminal(&terminal.id).await.is_err());
    std::fs::remove_dir_all(directory).unwrap();
}
