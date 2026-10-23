use super::*;
use crate::model::ModelClient;
use crate::session_service::tests::test_direct_active_service;

fn abandoned_child(
    label: &str,
    recovery_run: Option<&str>,
) -> (SessionService, PathBuf, TraditionalChildRecord) {
    let (parts, path) = test_direct_active_service(label, "child", ModelClient::new_for_test());
    let mut parent = sessions::load_session(&path, "child").unwrap();
    parent.session_id = "parent".to_owned();
    sessions::create_session(&path, &parent).unwrap();
    crate::store::create_traditional_child_relationship(
        &path,
        "parent",
        "child",
        "general",
        "abandoned child",
    )
    .unwrap();
    let child = crate::store::begin_traditional_child_run(
        &path,
        "child",
        "relationship-run",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    if let Some(run_id) = recovery_run {
        let start = sessions::load_session(&path, "child")
            .unwrap()
            .messages
            .len() as u64;
        crate::store::TranscriptLogWriter::new(&path)
            .unwrap()
            .append_run_prompt(
                "child",
                start,
                &Message::User {
                    content: "durable prompt".to_owned(),
                },
                run_id,
            )
            .unwrap();
    }
    (parts.service, path, child)
}

#[tokio::test(flavor = "current_thread")]
async fn mismatched_child_recovery_rejects_input_without_looping_or_changing_projection() {
    let (service, path, original) = abandoned_child(
        "child_input_mismatched_recovery",
        Some("different-recovery-run"),
    );
    // The owned executor provides real async admission boundaries, so the
    // timeout also bounds this regression if a future change restores the loop.
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let error = tokio::time::timeout(
        Duration::from_secs(2),
        service.submit_or_steer_traditional_child(
            "parent",
            "must not be queued to an unowned run".to_owned(),
            TraditionalChildExecutionMode::Foreground,
        ),
    )
    .await
    .expect("mismatched child recovery must terminate rather than retry without progress")
    .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("remains running after recovery; input was not admitted"),
        "{error:#}"
    );
    assert_eq!(
        owner
            .load_traditional_child("child".to_owned())
            .await
            .unwrap(),
        Some(original)
    );
    assert!(owner
        .list_session_inbox("child".to_owned())
        .await
        .unwrap()
        .is_empty());
    assert!(service.active_run().is_none());
    // Error return releases the operation lease; recovery never invents owner authority.
    let lease = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    drop(lease);
    owner.shutdown().await.unwrap();
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn child_input_recovery_accepts_a_terminal_pre_prompt_projection() {
    let (service, path, original) = abandoned_child("child_input_pre_prompt_recovery", None);
    let lease = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    service
        .recover_child_input_for_admission(&lease)
        .await
        .unwrap();
    let recovered = crate::store::load_traditional_child(&path, "child")
        .unwrap()
        .unwrap();
    assert_eq!(recovered.generation, original.generation);
    assert_eq!(recovered.run_id, original.run_id);
    assert_eq!(
        recovered.status,
        crate::store::TraditionalChildStatus::Interrupted
    );
    assert_eq!(
        crate::store::load_traditional_child_terminal_receipt(&path, "child", recovered.generation)
            .unwrap(),
        Some(recovered)
    );
    assert!(crate::store::list_session_inbox(&path, "child")
        .unwrap()
        .is_empty());
    drop(lease);
    assert!(sessions::SessionOperationLease::try_acquire(&path, "child").is_ok());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
