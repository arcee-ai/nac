use super::*;
use crate::model::ModelClient;
use crate::permissions::{PermissionBackend, PermissionBroker, PermissionEffect, PermissionRule};
use crate::store::TaskFollowupAction;

fn fixture(label: &str) -> (SessionServiceParts, PathBuf) {
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        label,
        "caller",
        ModelClient::new_for_test(),
    );
    crate::store::insert_test_session(&path, "target");
    crate::store::open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior='direct' WHERE session_id='target'",
            [],
        )
        .unwrap();
    (parts, path)
}

fn request() -> TaskFollowupDelegationRequest {
    TaskFollowupDelegationRequest {
        request_id: "human-request".into(),
        target_session_id: "target".into(),
        action: TaskFollowupAction::Auto,
        project_id: None,
    }
}

#[tokio::test]
async fn followup_human_issuance_is_invocation_only_and_never_wakes_or_changes_agent_permissions() {
    let (parts, path) = fixture("delegation_human");
    drop(parts.events);
    let before = parts.service.permission_approval_mode().await.unwrap();
    let granted = parts
        .service
        .issue_task_followup_delegation(request())
        .await
        .unwrap();
    assert_eq!(granted.caller_session_id, "caller");
    assert_eq!(granted.origin, "human_product_request");
    assert_eq!(granted.issued_config_version, 0);
    assert_eq!(
        parts.service.permission_approval_mode().await.unwrap(),
        before
    );
    assert!(parts.service.list_permission_grants().unwrap().is_empty());
    assert!(parts.service.list_permission_requests().unwrap().is_empty());
    assert!(!parts.service.has_active_operation());
    assert!(crate::store::list_session_inbox(&path, "target")
        .unwrap()
        .is_empty());
    assert_eq!(
        crate::sessions::reviewable_intent(path, "caller".into()).await,
        crate::sessions::ReviewIntent::NeverRecorded
    );
}

#[tokio::test]
async fn followup_human_issuance_keeps_deny_backend_and_shutdown_fences() {
    for (backend, effect, foreign_store) in [
        (PermissionBackend::Local, PermissionEffect::Deny, false),
        (PermissionBackend::Ssh, PermissionEffect::Allow, false),
        (PermissionBackend::Local, PermissionEffect::Allow, true),
    ] {
        let (mut parts, path) = fixture("delegation_denied");
        parts.service.permission_broker = Some(Arc::new(PermissionBroker::new(
            if foreign_store {
                path.with_extension("foreign.db")
            } else {
                path.clone()
            },
            "caller".into(),
            backend,
            0,
            vec![PermissionRule::new(
                "task_followup_auto",
                "session:target",
                effect,
            )],
        )));
        let error = parts
            .service
            .issue_task_followup_delegation(request())
            .await
            .unwrap_err();
        assert_eq!(
            error.downcast_ref(),
            Some(&if effect == PermissionEffect::Deny {
                TaskFollowupError::Denied
            } else {
                TaskFollowupError::Unavailable
            })
        );
        assert_eq!(
            crate::store::open_runtime_connection(&path)
                .unwrap()
                .query_row("SELECT COUNT(*) FROM task_followup_delegations", [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
    }
    let (parts, path) = fixture("delegation_shutdown");
    parts.service.stop_run_admission().await.unwrap();
    assert_eq!(
        parts
            .service
            .issue_task_followup_delegation(request())
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::Stopping)
    );
    assert!(crate::store::list_session_inbox(&path, "target")
        .unwrap()
        .is_empty());
}

#[test]
fn followup_delegation_request_cannot_assert_trusted_origin_or_issuer() {
    for field in [
        "origin",
        "caller_session_id",
        "issued_config_version",
        "id",
        "human",
    ] {
        let mut value = serde_json::to_value(request()).unwrap();
        value[field] = serde_json::json!("forged");
        assert!(serde_json::from_value::<TaskFollowupDelegationRequest>(value).is_err());
    }
}
