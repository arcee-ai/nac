use super::*;

#[tokio::test]
async fn frontend_snapshot_uses_three_operation_scoped_connections() {
    let (parts, store_path) =
        test_active_service("snapshot_connection_reuse", "connection-session");
    for index in 0..3 {
        crate::store::define_workset(
            &store_path,
            "connection-session",
            &crate::store::WorksetDefinition {
                id: format!("workset-{index}"),
                goal: "verify connection reuse".to_string(),
                status: "active".to_string(),
                summary: String::new(),
                verification_recipe: None,
                items: Vec::new(),
            },
        )
        .unwrap();
    }
    crate::store::append_episode(
        &store_path,
        "connection-session",
        "worker",
        "implementation",
        "retained episode",
    )
    .unwrap();
    let event_json = serde_json::to_string(&AgentEvent::AssistantMessage {
        thread_name: Some("worker".to_string()),
        content: "retained event".to_string(),
        usage: None,
    })
    .unwrap();
    crate::store::append_thread_event(&store_path, "connection-session", "worker", &event_json)
        .unwrap();
    crate::store::queue_thread_steering(
        &store_path,
        "connection-session",
        "worker",
        "dispatch",
        "retained steering",
    )
    .unwrap();
    crate::store::track_connection_opens(&store_path);

    let snapshot = parts.service.frontend_snapshot().await.unwrap();

    assert_eq!(snapshot.sessions.len(), 1);
    assert_eq!(snapshot.threads.len(), 1);
    assert_eq!(snapshot.thread_episodes["worker"].len(), 1);
    assert_eq!(snapshot.thread_events["worker"].len(), 1);
    assert_eq!(snapshot.thread_steering.len(), 1);
    assert_eq!(snapshot.worksets.items.len(), 3);
    // One checkout covers the relational dashboard data; the path-backed
    // transcript writer checks out once for messages and once for row times.
    assert_eq!(crate::store::tracked_connection_opens(&store_path), 3);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[test]
fn latest_thread_event_page_waits_for_capacity_before_event_state() {
    let (parts, store_path) =
        test_active_service("thread_event_page_lock_order", "connection-session");
    let held_connections = (0..4)
        .map(|_| {
            parts
                .service
                .event_bus
                .hold_thread_event_connection_for_test()
                .unwrap()
        })
        .collect::<Vec<_>>();
    let service = parts.service.clone();
    let (started_sender, started_receiver) = std::sync::mpsc::channel();
    let page = std::thread::spawn(move || {
        started_sender.send(()).unwrap();
        service.thread_events_page("worker", None, 10)
    });

    started_receiver.recv().unwrap();
    std::thread::sleep(Duration::from_millis(100));
    assert!(
        parts.service.event_bus.event_state_is_available_for_test(),
        "latest-page loading held event state while waiting for connection capacity"
    );

    drop(held_connections);
    let page = page.join().unwrap().unwrap();
    assert!(page.events.is_empty());
    assert!(page.thread_event_boundary.is_some());
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
#[ignore = "manual latency benchmark; run with --ignored --nocapture"]
async fn benchmark_frontend_snapshot_latency() {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

    const ITERATIONS: usize = 100;
    let (mut parts, store_path) = test_active_service("snapshot_benchmark", "benchmark-session");
    let workspace = store_path.parent().unwrap().join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(&workspace)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    git(&["init", "--quiet"]);
    for index in 0..64 {
        std::fs::write(
            workspace.join(format!("file-{index}.txt")),
            format!("baseline {index}\n"),
        )
        .unwrap();
    }
    git(&["add", "."]);
    git(&[
        "-c",
        "user.name=nac benchmark",
        "-c",
        "user.email=nac-benchmark@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "benchmark fixture",
    ]);
    for index in 0..16 {
        std::fs::write(
            workspace.join(format!("file-{index}.txt")),
            format!("modified {index}\n"),
        )
        .unwrap();
    }
    let metadata = Arc::make_mut(&mut parts.service.metadata);
    metadata.cwd = workspace.display().to_string();
    metadata.workspace_host_path = Some(workspace);
    for thread_index in 0..16 {
        let thread_name = format!("worker-{thread_index}");
        for episode_index in 0..8 {
            crate::store::append_episode(
                &store_path,
                "benchmark-session",
                &thread_name,
                "implementation",
                &format!("episode {episode_index}"),
            )
            .unwrap();
        }
        for event_index in 0..32 {
            let event_json = serde_json::to_string(&AgentEvent::AssistantMessage {
                thread_name: Some(thread_name.clone()),
                content: format!("event {event_index}"),
                usage: None,
            })
            .unwrap();
            crate::store::append_thread_event(
                &store_path,
                "benchmark-session",
                &thread_name,
                &event_json,
            )
            .unwrap();
        }
    }
    for workset_index in 0..4 {
        crate::store::define_workset(
            &store_path,
            "benchmark-session",
            &crate::store::WorksetDefinition {
                id: format!("workset-{workset_index}"),
                goal: "measure dashboard reads".to_string(),
                status: "active".to_string(),
                summary: "benchmark fixture".to_string(),
                verification_recipe: None,
                items: (0..8)
                    .map(|item_index| crate::store::WorksetItemDefinition {
                        title: format!("item-{item_index}"),
                        scope: "crates/nac-core".to_string(),
                        description: "exercise workset detail reads".to_string(),
                        role: "implementation".to_string(),
                        depends_on: Vec::new(),
                        acceptance: "snapshot includes this item".to_string(),
                        notes: None,
                    })
                    .collect(),
            },
        )
        .unwrap();
    }
    seed_store_transcript(
        &parts,
        (0..128)
            .map(|index| Message::User {
                content: format!("benchmark message {index}"),
            })
            .collect(),
    )
    .await;

    for _ in 0..10 {
        parts.service.frontend_snapshot().await.unwrap();
    }

    let stop = Arc::new(AtomicBool::new(false));
    let max_scheduler_gap_us = Arc::new(AtomicU64::new(0));
    let ticker_stop = Arc::clone(&stop);
    let ticker_gap = Arc::clone(&max_scheduler_gap_us);
    let ticker = tokio::spawn(async move {
        let mut previous = Instant::now();
        while !ticker_stop.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_millis(1)).await;
            let now = Instant::now();
            let lateness_us =
                (now.duration_since(previous).as_micros() as u64).saturating_sub(1_000);
            ticker_gap.fetch_max(lateness_us, Ordering::Relaxed);
            previous = now;
        }
    });

    let mut latency_us = Vec::with_capacity(ITERATIONS);
    for _ in 0..ITERATIONS {
        let started = Instant::now();
        parts.service.frontend_snapshot().await.unwrap();
        latency_us.push(started.elapsed().as_micros() as u64);
    }
    stop.store(true, Ordering::Relaxed);
    ticker.await.unwrap();
    latency_us.sort_unstable();
    let p95_index = (ITERATIONS * 95).div_ceil(100) - 1;
    eprintln!(
            "frontend_snapshot_benchmark iterations={ITERATIONS} median_us={} p95_us={} max_scheduler_lateness_us={}",
            latency_us[ITERATIONS / 2],
            latency_us[p95_index],
            max_scheduler_gap_us.load(Ordering::Relaxed)
        );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn focused_snapshot_options_page_messages_and_preserve_default_wrapper_contract() {
    let (parts, store_path) = test_active_service("paged_snapshot", "paged-session");
    let messages = mixed_message_history();
    seed_store_transcript(&parts, messages.clone()).await;
    let request = MessagePageRequest {
        before: None,
        limit: 2,
        include_system: false,
    };
    let expected_page = page_messages(&messages, request);

    let loaded = parts
        .service
        .frontend_snapshot_with_options(FrontendSnapshotLoadOptions {
            thread_event_limit: 0,
            include_sessions: false,
            messages: FrontendSnapshotMessages::Page(request),
        })
        .await
        .unwrap();
    assert!(loaded.snapshot.sessions.is_empty());
    assert!(loaded.snapshot.thread_events.is_empty());
    assert_eq!(loaded.message_page, Some(expected_page.page));
    assert_eq!(
        loaded.message_cycle,
        Some(MessageCycleMetadata {
            marker: "history:2:5".to_string(),
            thread_names: vec!["alpha".to_string(), "zeta".to_string()],
        })
    );
    assert_eq!(
        serde_json::to_value(&loaded.snapshot.messages).unwrap(),
        serde_json::to_value(&expected_page.messages).unwrap()
    );

    let full = parts
        .service
        .frontend_snapshot_with_thread_event_limit(0)
        .await
        .unwrap();
    assert_eq!(full.sessions.len(), 1);
    assert_eq!(
        serde_json::to_value(&full.messages).unwrap(),
        serde_json::to_value(&messages).unwrap()
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn store_backed_pages_are_live_mid_run_while_the_agent_is_busy() {
    let (parts, store_path) = test_active_service("paged_live", "live-session");
    let persisted_messages = mixed_message_history();
    seed_store_transcript(&parts, persisted_messages.clone()).await;
    let request = MessagePageRequest {
        before: Some(usize::MAX),
        limit: 3,
        include_system: false,
    };
    let expected = page_messages(&persisted_messages, request);
    let agent_guard = parts.service.agent.lock().await;

    // The held agent lock is irrelevant: pages read the store (blob ++
    // log), never the agent vec, so they never wait for a run.
    let direct = tokio::time::timeout(
        Duration::from_millis(500),
        parts.service.messages_page(request),
    )
    .await
    .expect("paged messages should not wait for the held agent mutex")
    .unwrap();
    assert_eq!(direct.page, expected.page);
    assert_eq!(
        serde_json::to_value(&direct.messages).unwrap(),
        serde_json::to_value(&expected.messages).unwrap()
    );

    let loaded = tokio::time::timeout(
        Duration::from_secs(2),
        parts
            .service
            .frontend_snapshot_with_options(FrontendSnapshotLoadOptions {
                thread_event_limit: 0,
                include_sessions: false,
                messages: FrontendSnapshotMessages::Page(request),
            }),
    )
    .await
    .expect("paged snapshot should not wait for the held agent mutex")
    .unwrap();
    assert_eq!(loaded.message_page, Some(expected.page));
    assert_eq!(
        serde_json::to_value(&loaded.snapshot.messages).unwrap(),
        serde_json::to_value(&expected.messages).unwrap()
    );

    // Mid-run appends to the log are visible immediately — the snapshot
    // blob is unchanged and the agent lock is still held.
    seed_log_tail(
        &parts,
        vec![
            Message::User {
                content: "mid-run prompt".to_string(),
            },
            Message::Assistant {
                content: Some("mid-run answer".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
        ],
    )
    .await;
    let mut expected_live = persisted_messages.clone();
    expected_live.push(Message::User {
        content: "mid-run prompt".to_string(),
    });
    expected_live.push(Message::Assistant {
        content: Some("mid-run answer".to_string()),
        reasoning_text: None,
        reasoning_details: None,
        tool_calls: None,
        duration_ms: None,
        model_origin: None,
        reasoning_field: None,
    });
    let expected_live = page_messages(&expected_live, request);
    let live = parts.service.messages_page(request).await.unwrap();
    assert_eq!(live.page, expected_live.page);
    assert_eq!(
        serde_json::to_value(&live.messages).unwrap(),
        serde_json::to_value(&expected_live.messages).unwrap()
    );
    // The cycle metadata follows the store transcript too: the mid-run
    // prompt is the latest user message, at its absolute raw index.
    let loaded = parts
        .service
        .frontend_snapshot_with_options(FrontendSnapshotLoadOptions {
            thread_event_limit: 0,
            include_sessions: false,
            messages: FrontendSnapshotMessages::Page(request),
        })
        .await
        .unwrap();
    assert_eq!(
        loaded.message_cycle,
        Some(MessageCycleMetadata {
            marker: format!("history:3:{}", persisted_messages.len()),
            thread_names: Vec::new(),
        })
    );
    assert_eq!(
        serde_json::to_value(&loaded.snapshot.messages).unwrap(),
        serde_json::to_value(&expected_live.messages).unwrap()
    );

    drop(agent_guard);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn store_backed_snapshot_is_live_during_a_real_run() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let store_path = test_store_path("real_run_live");
    let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
    let (hit_tx, hit_rx) = std::sync::mpsc::channel::<()>();
    let server = ScriptedServer::start_observed(
            vec![
                ScriptedResponse::json(
                    "200 OK",
                    serde_json::json!({
                        "status": "completed",
                        "output": [{
                            "type": "function_call",
                            "call_id": "call-1",
                            "name": "unknown_alpha",
                            "arguments": "{}"
                        }],
                        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
                    })
                    .to_string(),
                ),
                ScriptedResponse::json(
                    "200 OK",
                    serde_json::json!({
                        "status": "completed",
                        "output": [{"type": "message", "content": [{"type": "output_text", "text": "done"}]}],
                        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
                    })
                    .to_string(),
                ),
            ],
            move |index, _| {
                if index == 1 {
                    hit_tx.send(()).unwrap();
                    // Hold the run mid-flight: the second model response
                    // stays unserved until the test releases it.
                    release_rx.recv().unwrap();
                }
            },
        );
    let client = ModelClient::new_for_test_server(server.base_url.clone());
    let session_id = "real-run-session".to_string();
    let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
    let snapshot = sessions::new_snapshot(
        session_id.clone(),
        PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    sessions::create_session(&store_path, &snapshot).unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: session_id.clone(),
            store_path: store_path.clone(),
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });
    let mut events = parts.service.subscribe_events();

    let handle = parts
        .service
        .try_submit_prompt("mid-run prompt".to_string())
        .unwrap();
    // The run is blocked on the second model call: the prompt, the
    // assistant tool call, and the tool result are already committed to
    // the transcript log, and the run task holds the agent lock. The
    // channel wait must not block the current-thread runtime.
    tokio::task::spawn_blocking(move || hit_rx.recv_timeout(Duration::from_secs(5)))
        .await
        .unwrap()
        .expect("the run should reach the second model call");

    let snapshot = parts.service.frontend_snapshot().await.unwrap();
    assert!(snapshot.active_run.is_some());
    assert_eq!(
        crate::store::load_run_recovery(&store_path, &session_id)
            .unwrap()
            .unwrap()
            .run_id,
        handle.run_id.as_str()
    );
    let roles: Vec<&str> = snapshot
        .messages
        .iter()
        .map(|message| match message {
            Message::System { .. } => "system",
            Message::User { .. } => "user",
            Message::Assistant { .. } => "assistant",
            Message::Tool { .. } => "tool",
        })
        .collect();
    assert_eq!(
        roles,
        vec!["system", "user", "assistant", "tool"],
        "the mid-run snapshot reads the live store transcript"
    );
    assert!(
        matches!(&snapshot.messages[1], Message::User { content } if content == "mid-run prompt")
    );

    release_tx.send(()).unwrap();
    for _ in 0..100 {
        if parts.service.active_run().is_none() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(parts.service.active_run().is_none());
    let snapshot = parts.service.frontend_snapshot().await.unwrap();
    assert_eq!(snapshot.messages.len(), 5);
    assert!(
        matches!(&snapshot.messages[4], Message::Assistant { content: Some(text), .. } if text == "done")
    );
    assert!(
        crate::store::load_run_recovery(&store_path, &session_id)
            .unwrap()
            .is_none(),
        "the canonical terminal save clears the active marker atomically"
    );

    // The live trigger fired once per commit point across the run.
    let mut appended_lens = Vec::new();
    while let Ok(envelope) = events.try_recv() {
        if let SessionEvent::TranscriptAppended { transcript_len } = envelope.event {
            appended_lens.push(transcript_len);
        }
    }
    assert_eq!(appended_lens, vec![2, 3, 4, 5]);
    drop(handle);

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn skill_references_expand_into_the_agent_prompt_only() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        serde_json::json!({
            "status": "completed",
            "output": [{"type": "message", "content": [{"type": "output_text", "text": "done"}]}],
            "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
        })
        .to_string(),
    )]);
    let client = ModelClient::new_for_test_server(server.base_url.clone());
    let registry = Arc::new(SkillRegistry::load_for_test(vec![
        crate::skills::SkillRecord {
            name: "demo".to_string(),
            description: "demo skill".to_string(),
            compatibility: None,
            skill_root_visible: PathBuf::from("/skills/demo"),
            body: "DEMO SKILL BODY".to_string(),
            resources: Vec::new(),
        },
    ]));
    let (parts, store_path) = test_active_service_with_skills(
        "skill_prompt_expansion",
        "skill-expansion-session",
        client,
        Some(registry),
    );
    assert_eq!(
        parts.service.skill_catalog_entries(),
        vec![crate::skill_catalog::SkillCatalogEntry {
            name: "demo".to_string(),
            description: "demo skill".to_string(),
            compatibility: None,
        }]
    );

    // Preparation keeps the raw/display prompt exactly as typed and
    // appends the rendered skill to the agent-facing prompt only.
    let raw = "Use $demo to say hi";
    let PreparedUserInput::SubmitPrompt(prompt) = parts.service.prepare_user_input(raw) else {
        panic!("expected a submittable prompt");
    };
    assert_eq!(prompt.raw_prompt, raw);
    assert_eq!(prompt.display_prompt, raw);
    assert!(prompt.agent_prompt.starts_with(raw));
    // The sentinel strings in this test are intentionally hardcoded
    // byte literals, not the commands::INVOKED_SKILLS_* consts (which
    // are private to commands.rs): they pin the wire format the
    // frontend mirrors byte-for-byte, so drifting the Rust consts
    // fails this test.
    assert!(prompt.agent_prompt.contains("\n\n<invoked_skills>\n"));
    assert!(prompt
        .agent_prompt
        .contains("<skill_content name=\"demo\">"));
    assert!(prompt.agent_prompt.contains("DEMO SKILL BODY"));
    assert!(prompt.agent_prompt.ends_with("</invoked_skills>"));
    let expanded = prompt.agent_prompt.clone();

    let handle = parts.service.try_submit_prepared_prompt(prompt).unwrap();
    // The run preview shows what the user typed, not the expanded
    // prompt, even though the run carries the expanded form.
    assert_eq!(parts.service.active_run().unwrap().prompt_preview, raw);
    for _ in 0..100 {
        if parts.service.active_run().is_none() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(parts.service.active_run().is_none());
    drop(handle);

    // The provider request carried the expanded prompt.
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    let body = String::from_utf8(requests[0].body.clone()).unwrap();
    assert!(body.contains("Use $demo to say hi"));
    assert!(body.contains("DEMO SKILL BODY"));
    assert!(body.contains("<invoked_skills>"));

    // The stored transcript holds the expanded form...
    let transcript = parts.service.store_backed_transcript().await.unwrap();
    let message_idx = transcript
        .iter()
        .position(|message| matches!(message, Message::User { .. }))
        .expect("the run committed a user message");
    assert!(matches!(&transcript[message_idx], Message::User { content } if content == &expanded));

    // ...while the resend read path collapses it back to the raw input,
    // and re-preparing that collapses-then-expands exactly once (no
    // nested wrappers).
    let collapsed = parts.service.user_input_at(message_idx).await.unwrap();
    assert_eq!(collapsed, raw);
    let PreparedUserInput::SubmitPrompt(reprepared) = parts.service.prepare_user_input(&collapsed)
    else {
        panic!("expected a submittable prompt");
    };
    assert_eq!(reprepared.agent_prompt, expanded);
    assert_eq!(
        reprepared.agent_prompt.matches("<invoked_skills>").count(),
        1
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn malformed_internal_and_future_thread_events_are_nonfatal_and_advance_raw_cursor() {
    let (parts, store_path) = test_active_service("tolerant_events", "events-session");
    let valid = serde_json::to_string(&AgentEvent::AssistantMessage {
        thread_name: Some("worker-a".to_string()),
        content: "safe response".to_string(),
        usage: None,
    })
    .unwrap();
    for (thread_name, event_json) in [
        ("worker-a", valid.as_str()),
        ("worker-a", "{malformed event json"),
        (
            "worker-b",
            r#"{"type":"model_call_started","thread_name":"worker-b","iteration":1}"#,
        ),
        (
            "worker-c",
            r#"{"type":"future_event","payload":"CANARY_UNKNOWN"}"#,
        ),
        (
            "worker-d",
            r#"{"type":"tool_call_started","thread_name":"worker-d","call_id":"call-api","name":"exec_command","args_preview":"CANARY_COMMAND","args_detail":"{\"cmd\":\"echo safe_cmd\",\"workdir\":\"/safe/api\"}"}"#,
        ),
    ] {
        crate::store::append_thread_event(&store_path, "events-session", thread_name, event_json)
            .unwrap();
    }

    let snapshot = parts.service.frontend_snapshot().await.unwrap();
    assert_eq!(snapshot.thread_events["worker-a"].len(), 1);
    assert_eq!(snapshot.thread_events["worker-d"].len(), 1);
    assert_eq!(snapshot.thread_event_diagnostics.len(), 3);
    assert!(!snapshot.thread_event_boundary.epoch_id.is_empty());
    let serialized = serde_json::to_string(&snapshot).unwrap();
    assert!(!serialized.contains("CANARY"));
    assert!(serialized.contains("/safe/api"));
    assert!(!snapshot
        .thread_event_diagnostics
        .iter()
        .any(|diagnostic| diagnostic.error.contains('{')));

    let first_page = parts
        .service
        .thread_events_page("worker-a", None, 1)
        .unwrap();
    assert!(first_page.events.is_empty());
    assert_eq!(first_page.diagnostics.len(), 1);
    assert!(first_page.has_older);
    assert!(first_page.thread_event_boundary.is_some());
    let malformed_id = first_page.next_before_id.unwrap();
    let older_page = parts
        .service
        .thread_events_page("worker-a", Some(malformed_id), 1)
        .unwrap();
    assert_eq!(older_page.events.len(), 1);
    assert!(older_page.thread_event_boundary.is_none());
    assert!(older_page.next_before_id.unwrap() < malformed_id);

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn frontend_snapshot_restores_persisted_thread_activity() {
    let (mut parts, store_path) = test_active_service("thread_activity", "activity-session");
    Arc::make_mut(&mut parts.service.metadata)
        .extra_headers
        .insert("Authorization".to_string(), "CANARY_HEADER".to_string());
    parts
        .service
        .event_bus
        .emit_agent(AgentEvent::ThreadStarted {
            name: "impl/ui".to_string(),
            action: "Build the interface".to_string(),
            source_threads: Vec::new(),
        });
    parts
        .service
        .event_bus
        .emit_agent(AgentEvent::ToolCallStarted {
            thread_name: Some("impl/ui".to_string()),
            call_id: "call-1".to_string(),
            name: "read".to_string(),
            args_preview: r#"{"path":"index.html"}"#.to_string(),
            key_arg_preview: None,
            args_detail: None,
        });
    parts
        .service
        .event_bus
        .emit_agent(AgentEvent::ToolCallFinished {
            thread_name: Some("impl/ui".to_string()),
            call_id: "call-1".to_string(),
            name: "read".to_string(),
            content_preview: "done".to_string(),
            is_error: false,
            command_status: None,
            exit_code: None,
        });

    let snapshot = parts.service.frontend_snapshot().await.unwrap();
    assert!(snapshot.metadata.extra_headers.is_empty());
    assert_eq!(
        parts.service.metadata().extra_headers["Authorization"],
        "CANARY_HEADER"
    );
    let events = &snapshot.thread_events["impl/ui"];
    assert_eq!(events.len(), 3);
    assert!(matches!(events[0], AgentEvent::ThreadStarted { .. }));
    assert!(matches!(events[2], AgentEvent::ToolCallFinished { .. }));

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}
