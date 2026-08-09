use super::*;
use std::collections::HashSet;
use std::time::Duration;

fn test_store_path(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir()
        .join(format!("nac_agent_respond_live_{label}_{unique}"))
        .join("store.db")
}

fn scripted_text_response(text: &str) -> String {
    serde_json::json!({
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
    })
    .to_string()
}

fn orchestrator_agent(store_path: PathBuf, session_id: &str, server_url: String) -> Agent {
    Agent::with_config(
        ModelClient::new_for_test_server(server_url),
        AgentConfig {
            mode: AgentMode::Orchestrator,
            store_path,
            session_id: Some(session_id.to_string()),
            orchestrator_compaction_threshold: None,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: Some("run".to_string()),
            event_sink: EventSink::none(),
            workspace_cwd: PathBuf::from("."),
            config_cwd: PathBuf::from("."),
            working_directory: ".".to_string(),
            worker_executable: None,
            sandbox: None,
            ssh: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
        },
    )
    .unwrap()
}

#[tokio::test]
async fn respond_live_queued_user_hard_yields_and_preserves_completion() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    for attempt in 0..3 {
        let store_path = test_store_path(&format!("respond_live_queue_yield_{attempt}"));
        crate::store::initialize(&store_path).unwrap();
        crate::store::insert_test_session(&store_path, "session");
        crate::store::update_respond_live_preference(&store_path, "session", true, 0).unwrap();
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            scripted_text_response("queued handoff"),
        )]);
        let mut agent = orchestrator_agent(store_path.clone(), "session", server.base_url.clone());
        let run_id = crate::events::SessionRunId::new();
        agent.set_event_sink(EventSink::bus_with_context(
            crate::events::SessionEventBus::new(Some("session".to_string())),
            Some(run_id.clone()),
            None,
        ));
        let key = crate::tools::ThreadDispatchKey::new(
            run_id.clone(),
            "worker",
            "exact-dispatch",
            "origin-call",
        );
        let registry = agent.active_threads_handle();
        registry.set_live_thread_updates(true);
        assert!(registry.try_accept(key.clone()));

        let send = tokio::spawn(async move {
            let result = agent.send("work").await;
            (agent, result)
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let logged = crate::store::TranscriptLogWriter::new(&store_path)
                    .unwrap()
                    .read_from("session", 0)
                    .unwrap()
                    .into_iter()
                    .any(|(_, message)| {
                        matches!(message, Message::Assistant { tool_calls: Some(calls), .. }
                            if calls.iter().any(|call| call.id.starts_with("respond-live-")))
                    });
                if logged {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("automatic wait was not committed");
        crate::store::create_queued_run(
            &store_path,
            &crate::store::CreateQueuedRun {
                session_id: "session".to_string(),
                queued_run_id: uuid::Uuid::new_v4().to_string(),
                client_message_id: uuid::Uuid::new_v4().to_string(),
                display_prompt: "next".to_string(),
                agent_prompt: "next".to_string(),
                after_run_id: run_id.as_str().to_string(),
            },
        )
        .unwrap();
        registry
            .complete(
                &store_path,
                "session",
                crate::tools::ThreadCompletion {
                    key: key.clone(),
                    content: "completion must survive".to_string(),
                    is_error: false,
                },
            )
            .unwrap();
        registry.signal_activity();

        let (agent, result) = tokio::time::timeout(Duration::from_secs(2), send)
            .await
            .expect("queued user did not hard-yield")
            .unwrap();
        assert_eq!(result.unwrap(), "queued handoff");
        assert_eq!(
            server.finish().len(),
            1,
            "hard yield must not re-enter model"
        );
        let retained =
            registry.take_completions(&HashSet::new(), &HashSet::from([key.dispatch_id.clone()]));
        assert_eq!(retained.len(), 1);
        assert_eq!(retained[0].content, "completion must survive");
        drop(agent);
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }
}

#[tokio::test]
async fn respond_live_default_off_finishes_with_origin_work_active() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    let store_path = test_store_path("default_off");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        scripted_text_response("terminal"),
    )]);
    let mut agent = orchestrator_agent(store_path.clone(), "session", server.base_url.clone());
    let run_id = crate::events::SessionRunId::new();
    agent.set_event_sink(EventSink::bus_with_context(
        crate::events::SessionEventBus::new(Some("session".into())),
        Some(run_id.clone()),
        None,
    ));
    let key = crate::tools::ThreadDispatchKey::new(run_id, "worker", "exact", "call");
    let registry = agent.active_threads_handle();
    assert!(registry.try_accept(key.clone()));
    assert_eq!(agent.send("work").await.unwrap(), "terminal");
    assert!(registry.matches(&key));
    assert_eq!(server.finish().len(), 1);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn respond_live_delivers_exact_origin_completion_without_foreign_consumption() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    let store_path = test_store_path("delivery");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    crate::store::update_respond_live_preference(&store_path, "session", true, 0).unwrap();
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json("200 OK", scripted_text_response("waiting")),
        ScriptedResponse::json("200 OK", scripted_text_response("summary")),
    ]);
    let mut agent = orchestrator_agent(store_path.clone(), "session", server.base_url.clone());
    let run_id = crate::events::SessionRunId::new();
    agent.set_event_sink(EventSink::bus_with_context(
        crate::events::SessionEventBus::new(Some("session".into())),
        Some(run_id.clone()),
        None,
    ));
    let exact =
        crate::tools::ThreadDispatchKey::new(run_id, "worker", "exact-dispatch", "origin-call");
    let foreign = crate::tools::ThreadDispatchKey::new(
        crate::events::SessionRunId::new(),
        "foreign",
        "foreign-dispatch",
        "foreign-call",
    );
    let registry = agent.active_threads_handle();
    registry.set_live_thread_updates(true);
    for (key, content) in [(&exact, "exact episode"), (&foreign, "foreign episode")] {
        assert!(registry.try_accept(key.clone()));
        registry
            .complete(
                &store_path,
                "session",
                crate::tools::ThreadCompletion {
                    key: key.clone(),
                    content: content.into(),
                    is_error: false,
                },
            )
            .unwrap();
    }
    assert_eq!(agent.send("work").await.unwrap(), "summary");
    let requests = server.finish();
    let body = String::from_utf8(requests[1].body.clone()).unwrap();
    assert!(body.contains("exact-dispatch") && body.contains("exact episode"));
    assert!(!body.contains("foreign episode"));
    assert_eq!(
        registry
            .take_completions(&HashSet::new(), &HashSet::from([foreign.dispatch_id]))
            .len(),
        1
    );
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn terminal_decision_observes_latest_toggle_and_queued_user() {
    let store_path = test_store_path("terminal_decision");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session");
    let mut agent = orchestrator_agent(
        store_path.clone(),
        "session",
        "http://127.0.0.1:1".to_string(),
    );
    let run_id = crate::events::SessionRunId::new();
    agent.set_event_sink(EventSink::bus_with_context(
        crate::events::SessionEventBus::new(Some("session".into())),
        Some(run_id.clone()),
        None,
    ));
    let key = crate::tools::ThreadDispatchKey::new(
        run_id.clone(),
        "worker",
        "exact-dispatch",
        "origin-call",
    );
    assert!(agent.active_threads_handle().try_accept(key));
    assert!(agent.respond_live_dispatch_ids().await.unwrap().is_empty());

    crate::store::update_respond_live_preference(&store_path, "session", true, 0).unwrap();
    assert_eq!(
        agent.respond_live_dispatch_ids().await.unwrap(),
        ["exact-dispatch"]
    );

    crate::store::create_queued_run(
        &store_path,
        &crate::store::CreateQueuedRun {
            session_id: "session".into(),
            queued_run_id: uuid::Uuid::new_v4().to_string(),
            client_message_id: uuid::Uuid::new_v4().to_string(),
            display_prompt: "next".into(),
            agent_prompt: "next".into(),
            after_run_id: run_id.as_str().to_string(),
        },
    )
    .unwrap();
    assert!(agent.respond_live_dispatch_ids().await.unwrap().is_empty());
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}
