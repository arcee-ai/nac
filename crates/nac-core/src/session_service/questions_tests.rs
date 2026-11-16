use super::*;
#[tokio::test]
async fn cached_idle_question_owner_cannot_answer_while_foreign_run_lease_is_live() {
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "question-foreign-owner",
        "target",
        crate::model::ModelClient::new_for_test(),
    );
    let run = uuid::Uuid::new_v4().to_string();
    let snapshot = crate::sessions::load_session(&path, "target").unwrap();
    crate::store::TranscriptLogWriter::new(&path)
        .unwrap()
        .append_run_prompt(
            "target",
            snapshot.messages.len() as u64,
            &crate::types::Message::User {
                content: "work".into(),
            },
            &run,
        )
        .unwrap();
    let question = crate::store::create_task_question(
        &path,
        &QuestionRequest {
            session_id: "target".into(),
            request_id: "exact".into(),
            run_id: run.clone(),
            generation: run,
            text: "Which format?".into(),
            choices: vec![],
            responder_class: crate::store::QuestionResponder::Information,
        },
        0,
    )
    .unwrap();
    let peer = sessions::SessionOperationLease::try_acquire(&path, "target").unwrap();
    let error = parts
        .service
        .answer_task_question(QuestionAnswer {
            request_id: "exact".into(),
            run_id: question.request.run_id.clone(),
            generation: question.request.generation.clone(),
            expected_revision: 1,
            answer: "CSV".into(),
        })
        .await
        .unwrap_err();
    assert_eq!(
        error.downcast_ref::<crate::store::QuestionError>(),
        Some(&crate::store::QuestionError::Conflict)
    );
    assert_eq!(
        crate::store::pending_task_question(&path, "target").unwrap(),
        Some(question)
    );
    drop(peer);
    drop(parts);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn human_response_honors_deny_and_skips_ask_without_approval_authority() {
    use crate::permissions::{PermissionBackend, PermissionEffect, PermissionRule};
    for effect in [PermissionEffect::Deny, PermissionEffect::Ask] {
        let (mut parts, path) = crate::session_service::tests::test_direct_active_service(
            "question-human-policy",
            "target",
            crate::model::ModelClient::new_for_test(),
        );
        parts.service.permission_broker =
            Some(Arc::new(crate::permissions::PermissionBroker::new(
                path.clone(),
                "target".into(),
                PermissionBackend::Local,
                0,
                [PermissionRule::new(
                    "task_question_*",
                    "session:target/question:exact%2Fdecision",
                    effect,
                )],
            )));
        for action in ["task_question_answer", "task_question_cancel"] {
            let result = parts
                .service
                .authorize_human_question_response(action, "exact/decision");
            if effect == PermissionEffect::Deny {
                assert_eq!(
                    result
                        .unwrap_err()
                        .downcast_ref::<crate::store::QuestionError>(),
                    Some(&crate::store::QuestionError::Denied)
                );
            } else {
                result.unwrap();
            }
        }
        if effect == PermissionEffect::Deny {
            let source = uuid::Uuid::new_v4().to_string();
            let denied = parts
                .service
                .answer_task_question(QuestionAnswer {
                    request_id: "exact/decision".into(),
                    run_id: source.clone(),
                    generation: source,
                    expected_revision: 1,
                    answer: "CSV".into(),
                })
                .await
                .unwrap_err();
            assert_eq!(
                denied.downcast_ref::<crate::store::QuestionError>(),
                Some(&crate::store::QuestionError::Denied)
            );
            let denied = parts
                .service
                .cancel_task_question("exact/decision".into(), 1)
                .await
                .unwrap_err();
            assert_eq!(
                denied.downcast_ref::<crate::store::QuestionError>(),
                Some(&crate::store::QuestionError::Denied)
            );
        }
        assert!(parts.service.list_permission_requests().unwrap().is_empty());
        assert!(parts.service.list_permission_grants().unwrap().is_empty());
        assert_eq!(
            parts.service.permission_approval_mode().await.unwrap(),
            crate::permissions::PermissionApprovalMode::Manual
        );
        let broker = parts.service.permission_broker.as_ref().unwrap();
        let mut resource = response_resource("task_question_answer", "target", "exact/decision");
        resource.hard_denial = Some("synthetic hard denial".into());
        assert!(broker
            .authorize_submitted_question_response(&SubmittedQuestionResponse { resource })
            .is_err());
        drop(parts);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
