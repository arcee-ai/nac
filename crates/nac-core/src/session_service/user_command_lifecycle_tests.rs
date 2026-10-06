use super::*;

/// Counts live processes whose command line contains `token`.
fn processes_matching(token: &str) -> usize {
    let output = std::process::Command::new("pgrep")
        .args(["-f", token])
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout).lines().count()
}

async fn wait_for_processes(token: &str, alive: bool) {
    for _ in 0..500 {
        if (processes_matching(token) > 0) == alive {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("processes matching {token} alive: {}", !alive);
}

/// A command whose backgrounded child ignores HUP and TERM, keyed by a unique sleep duration.
fn forking_command() -> (String, String) {
    let token = format!("sleep 900.{}", Uuid::new_v4().as_u128() % 1_000_000);
    (format!("trap \"\" HUP TERM; {token} & wait"), token)
}

async fn idle(service: &SessionService) {
    let store_path = service.metadata().store_path;
    for _ in 0..1_000 {
        let lease_free = sessions::SessionOperationLease::try_acquire(&store_path, SESSION).is_ok();
        if lease_free && !service.has_active_operation() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("session did not become idle");
}

fn response(text: &str) -> ScriptedResponse {
    ScriptedResponse::json(
        "200 OK",
        serde_json::json!({
            "status": "completed",
            "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
            "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
        })
        .to_string(),
    )
}

#[cfg(unix)]
#[tokio::test]
async fn traditional_child_submission_is_not_direct_primary_without_row_or_process() {
    let fixture = Fixture::new("child", ModelClient::new_for_test(), Vec::new());
    crate::store::insert_test_session(&fixture.store_path, "parent");
    crate::store::open_runtime_connection(&fixture.store_path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior = 'direct' WHERE session_id = 'parent'",
            [],
        )
        .unwrap();
    crate::store::create_traditional_child_relationship(
        &fixture.store_path,
        "parent",
        SESSION,
        crate::store::GENERAL_CHILD_PROFILE,
        "user command child",
    )
    .unwrap();

    assert_eq!(
        fixture.submit("child", COUNTED, None).unwrap_err(),
        UserCommandSubmitError::NotDirectPrimary
    );
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(fixture.rows().is_empty());
    assert_eq!(fixture.executions(), 0);
    assert!(fixture.service.active_user_command().is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn missing_working_directory_is_a_spawn_failure_without_a_started_process() {
    let fixture = Fixture::new("spawn-failed", ModelClient::new_for_test(), Vec::new());
    std::fs::remove_dir_all(&fixture.workspace).unwrap();

    fixture.submit("spawn", COUNTED, None).unwrap();
    let command = settled(&fixture.service, "spawn").await;

    assert_eq!(command.state, UserCommandState::SpawnFailed, "{command:?}");
    assert!(!command.process_started);
    assert_eq!(command.exit_code, None);
    assert_eq!(fixture.executions(), 0);
    assert_eq!(records(&fixture.service).await.len(), 1);
}

#[cfg(unix)]
#[tokio::test]
async fn cancel_and_timeout_terminate_backgrounded_descendants() {
    let fixture = Fixture::new("descendants", ModelClient::new_for_test(), Vec::new());

    let (command, token) = forking_command();
    fixture.submit("cancelled", &command, None).unwrap();
    wait_for_processes(&token, true).await;
    fixture
        .service
        .cancel_user_command("cancelled")
        .await
        .unwrap();
    let cancelled = settled(&fixture.service, "cancelled").await;
    assert_eq!(cancelled.state, UserCommandState::Cancelled);
    assert!(cancelled.process_started);
    wait_for_processes(&token, false).await;

    let (command, token) = forking_command();
    fixture.submit("timed-out", &command, Some(1_000)).unwrap();
    wait_for_processes(&token, true).await;
    let timed_out = settled(&fixture.service, "timed-out").await;
    assert_eq!(timed_out.state, UserCommandState::TimedOut);
    assert!(timed_out.process_started);
    wait_for_processes(&token, false).await;
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_submissions_admit_one_command_and_report_the_other_busy() {
    let fixture = Fixture::new("concurrent", ModelClient::new_for_test(), Vec::new());
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let attempts = ["left", "right"].map(|request_id| {
        let service = fixture.service.clone();
        let store_path = fixture.store_path.clone();
        let barrier = Arc::clone(&barrier);
        tokio::task::spawn_blocking(move || {
            barrier.wait();
            let Ok(lease) = sessions::SessionOperationLease::try_acquire(&store_path, SESSION)
            else {
                return None;
            };
            match service
                .submit_user_command_with_lease(request(request_id, "sleep 30", None), lease)
            {
                Ok(admission) => Some(admission.command.request_id),
                Err(
                    UserCommandSubmitError::ExternalBusy { .. }
                    | UserCommandSubmitError::Busy {
                        active_operation: ActiveSessionOperationSnapshot::UserCommand { .. },
                    },
                ) => None,
                Err(other) => panic!("unexpected submission error: {other:?}"),
            }
        })
    });
    let mut admitted = Vec::new();
    let mut busy = 0;
    for attempt in attempts {
        match attempt.await.unwrap() {
            Some(request_id) => admitted.push(request_id),
            None => busy += 1,
        }
    }
    assert_eq!((admitted.len(), busy), (1, 1));
    let rows = fixture.rows();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].request_id, admitted[0]);

    fixture
        .service
        .cancel_user_command(&admitted[0])
        .await
        .unwrap();
    settled(&fixture.service, &admitted[0]).await;
}

#[cfg(unix)]
#[tokio::test]
async fn compaction_keeps_the_record_position_and_attribution() {
    let server = ScriptedServer::start(vec![
        response("first answer"),
        response("second answer"),
        ScriptedResponse::json(
            "200 OK",
            super::super::super::tests::compaction_response("compacted summary"),
        ),
    ]);
    let fixture = Fixture::new(
        "compaction",
        ModelClient::new_for_test_server(server.base_url.clone()),
        Vec::new(),
    );
    fixture
        .service
        .try_submit_prompt("first prompt".to_string())
        .unwrap();
    idle(&fixture.service).await;
    fixture.submit("kept", "printf kept", None).unwrap();
    let command = settled(&fixture.service, "kept").await;
    fixture
        .service
        .try_submit_prompt("second prompt".to_string())
        .unwrap();
    idle(&fixture.service).await;
    let index = command.message_index.unwrap();
    let before = fixture.service.frontend_snapshot().await.unwrap();

    let result = fixture.service.try_compact().unwrap().wait().await;
    assert!(
        matches!(result, Ok(crate::agent::CompactionResult::Compacted { .. })),
        "{result:?}"
    );
    idle(&fixture.service).await;

    let after = fixture.service.frontend_snapshot().await.unwrap();
    assert_eq!(
        serde_json::to_value(&after.messages[index]).unwrap(),
        serde_json::to_value(&before.messages[index]).unwrap()
    );
    assert_eq!(after.user_commands, vec![command.clone()]);
    assert_eq!(
        fixture.service.user_command("kept").await.unwrap(),
        Some(command.clone())
    );

    let reloaded = fixture.reopen();
    let reloaded_snapshot = reloaded.frontend_snapshot().await.unwrap();
    assert_eq!(
        serde_json::to_value(&reloaded_snapshot.messages[index]).unwrap(),
        serde_json::to_value(&before.messages[index]).unwrap()
    );
    assert_eq!(reloaded_snapshot.user_commands, vec![command.clone()]);
    assert_eq!(reloaded.user_command("kept").await.unwrap(), Some(command));
    assert_eq!(server.finish().len(), 3);
}

#[cfg(unix)]
#[tokio::test]
async fn fork_carries_the_record_as_plain_user_content_without_a_command_row() {
    let fixture = Fixture::new("fork", ModelClient::new_for_test(), Vec::new());
    fixture.submit("first", "printf first", None).unwrap();
    let first = settled(&fixture.service, "first").await;
    fixture.submit("second", "printf second", None).unwrap();
    settled(&fixture.service, "second").await;
    let source = fixture.service.messages_snapshot().await.unwrap();
    let record = first.message_index.unwrap();

    for (fork_id, prefix_len) in [("fork-prefix", record + 1), ("fork-full", source.len())] {
        let prefix = &source[..prefix_len];
        let blob_len = prefix
            .iter()
            .take_while(|message| matches!(message, Message::System { .. }))
            .count();
        let client = ModelClient::new_for_test();
        let mut snapshot = sessions::new_snapshot(
            fork_id.to_string(),
            fixture.workspace.clone(),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            prefix[..blob_len].to_vec(),
            None,
            BTreeMap::new(),
        );
        snapshot.behavior = sessions::SessionBehavior::Direct;
        sessions::create_session(&fixture.store_path, &snapshot).unwrap();
        crate::store::TranscriptLogWriter::new(&fixture.store_path)
            .unwrap()
            .append_batch(fork_id, blob_len as u64, &prefix[blob_len..])
            .unwrap();
        crate::store::clone_session_conversation_artifacts(
            &fixture.store_path,
            SESSION,
            fork_id,
            prefix,
            source.len(),
        )
        .unwrap();

        let forked = crate::store::TranscriptLogWriter::new(&fixture.store_path)
            .unwrap()
            .read_from(fork_id, 0)
            .unwrap();
        let carried = forked
            .iter()
            .find(|(idx, _)| *idx == record as u64)
            .map(|(_, message)| serde_json::to_value(message).unwrap());
        assert_eq!(
            carried,
            Some(serde_json::to_value(&source[record]).unwrap())
        );
        assert!(
            matches!(&source[record], Message::User { content } if content.starts_with("<user_command>"))
        );
        assert!(
            crate::store::list_user_commands(&fixture.store_path, fork_id)
                .unwrap()
                .is_empty()
        );
    }
    assert_eq!(fixture.rows().len(), 2);
}
