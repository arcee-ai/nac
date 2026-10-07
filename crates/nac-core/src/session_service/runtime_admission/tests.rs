use super::*;
use crate::model::ModelClient;

fn required_service(behavior: sessions::SessionBehavior) -> (SessionServiceParts, PathBuf) {
    let session_id = Uuid::new_v4().to_string();
    let path = std::env::temp_dir()
        .join(format!("nac-required-admission-{}", Uuid::new_v4()))
        .join("store.db");
    crate::store::initialize(&path).unwrap();
    let client = ModelClient::new_for_test();
    let agent = crate::session_service::tests::test_agent(
        client.clone(),
        path.clone(),
        Some(session_id.clone()),
    );
    let mut snapshot = sessions::new_snapshot(
        session_id.clone(),
        PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_owned(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    snapshot.behavior = behavior;
    sessions::create_session(&path, &snapshot).unwrap();
    let config = OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id,
            store_path: path.clone(),
            snapshot,
        },
        sandbox_status: "off".into(),
        agents_md_status: "off".into(),
        workspace_display: "/repo".into(),
        workspace_git: None,
        resume_base_cwd: PathBuf::from("/repo"),
    }
    .with_required_runtime_effects();
    (SessionService::from_orchestrator_run_config(config), path)
}

#[tokio::test]
async fn required_session_rejects_conventional_runs_and_compaction_before_publication() {
    for behavior in [
        sessions::SessionBehavior::Orchestrator,
        sessions::SessionBehavior::Direct,
        sessions::SessionBehavior::DirectWithOrchestrator,
    ] {
        let (mut parts, path) = required_service(behavior);
        assert!(parts.service.runtime_effect_required);
        let session_id = parts.service.metadata.session_id.clone().unwrap();
        // The service and every attached client retain the selected intent;
        // maintenance enablement never clears it or supplies run authority.
        parts.service.enable_managed_admission(None);
        let client = parts.service.connect_client();
        let lease = sessions::SessionOperationLease::try_acquire(&path, &session_id).unwrap();
        assert!(matches!(
            parts.service.try_submit_prompt_for_client_with_lease(
                client.client_id().clone(),
                "unqualified prompt".into(),
                lease
            ),
            Err(SessionSubmitError::Coordination { .. })
        ));
        assert!(matches!(
            parts.service.try_submit_prompt("second prompt".into()),
            Err(SessionSubmitError::Coordination { .. })
        ));
        assert!(matches!(
            client.try_compact(),
            Err(SessionCompactionAdmissionError::Coordination { .. })
        ));
        assert_eq!(
            parts
                .service
                .queue_orchestrator_steering("new steer")
                .unwrap_err()
                .to_string(),
            "authenticated runtime operation admission required"
        );
        assert_eq!(
            parts
                .service
                .queue_thread_steering("worker", "new steer")
                .unwrap_err()
                .to_string(),
            "authenticated runtime operation admission required"
        );
        assert!(!parts.service.has_active_operation());
        assert!(parts.service.active_operation().is_none());
        assert!(parts.service.active_threads.names().is_empty());
        assert_eq!(
            serde_json::to_value(sessions::load_session(&path, &session_id).unwrap().messages)
                .unwrap(),
            serde_json::to_value(&parts.init.restored_messages).unwrap()
        );
        assert!(crate::store::load_run_recovery(&path, &session_id)
            .unwrap()
            .is_none());
        assert!(matches!(
            parts.events.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));
        // Required intent alone is not a host-key denial or permanent stop.
        assert!(parts.service.check_host_execution_authority().is_ok());
        assert!(!parts
            .service
            .stopping_admission
            .load(std::sync::atomic::Ordering::Acquire));
    }
}

#[tokio::test]
async fn required_session_cannot_replay_retained_inbox_or_goal_or_enqueue_successors() {
    for behavior in [
        sessions::SessionBehavior::Direct,
        sessions::SessionBehavior::DirectWithOrchestrator,
    ] {
        let (parts, path) = required_service(behavior);
        let session = parts.service.metadata.session_id.as_deref().unwrap();
        let queued = crate::store::create_session_inbox_item(
            &path,
            session,
            crate::store::InboxDelivery::Queue,
            "retained input",
            None,
            None,
        )
        .unwrap();
        let goal =
            crate::store::create_session_goal(&path, session, "retained goal", None, None).unwrap();
        assert!(parts.service.start_next_direct_inbox_item().await.is_err());
        assert!(parts
            .service
            .enqueue_direct_input(crate::store::InboxDelivery::Queue, "new input", None,)
            .await
            .is_err());
        assert!(parts
            .service
            .create_direct_goal("replacement", None)
            .await
            .is_err());
        assert_eq!(
            crate::store::list_session_inbox(&path, session).unwrap(),
            vec![queued]
        );
        assert_eq!(
            crate::store::load_session_goal(&path, session).unwrap(),
            Some(goal)
        );
        assert!(parts.service.active_operation().is_none());
        assert!(parts.service.goal_retry_wake.lock().unwrap().is_none());
        // Readback remains available, including after failed wake attempts.
        assert_eq!(parts.service.list_direct_inbox().unwrap().len(), 1);
        assert!(parts.service.direct_goal().unwrap().is_some());
    }
}
