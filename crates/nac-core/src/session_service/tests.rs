    use super::*;
    use crate::agent::{AgentConfig, AgentMode};
    use crate::model::ModelClient;
    use crate::types::{FunctionCall, ToolCall};
    use std::collections::BTreeMap;

    #[test]
    fn response_timing_cumulative_usage_preserves_context_precedence_and_saturates() {
        let client = ModelClient::new_for_test();
        let mut snapshot = sessions::new_snapshot(
            "timing".into(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            Vec::new(),
            None,
            BTreeMap::new(),
        );
        snapshot.token_usages = vec![Some(crate::model::TokenUsage {
            input_tokens: u64::MAX - 1,
            orchestrator_context_tokens: 41,
            ..Default::default()
        })];
        snapshot.unattributed_token_usage = Some(crate::model::TokenUsage {
            input_tokens: 5,
            ..Default::default()
        });

        let cumulative = ResponseTimingSnapshot::from(&snapshot)
            .cumulative_token_usage
            .unwrap();
        assert_eq!(cumulative.input_tokens, u64::MAX);
        assert_eq!(cumulative.orchestrator_context_tokens, 41);

        snapshot
            .unattributed_token_usage
            .as_mut()
            .unwrap()
            .orchestrator_context_tokens = 73;
        assert_eq!(
            ResponseTimingSnapshot::from(&snapshot)
                .cumulative_token_usage
                .unwrap()
                .orchestrator_context_tokens,
            73
        );
    }

    #[test]
    fn response_timing_cumulative_usage_preserves_empty_semantics() {
        let client = ModelClient::new_for_test();
        let mut snapshot = sessions::new_snapshot(
            "timing-empty".into(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            Vec::new(),
            None,
            BTreeMap::new(),
        );
        assert!(
            ResponseTimingSnapshot::from(&snapshot)
                .cumulative_token_usage
                .is_none()
        );

        snapshot.unattributed_token_usage = Some(Default::default());
        assert_eq!(
            ResponseTimingSnapshot::from(&snapshot).cumulative_token_usage,
            Some(Default::default())
        );
    }

    fn thread_call(id: &str, arguments: &str) -> ToolCall {
        ToolCall {
            id: id.to_string(),
            call_type: "function".to_string(),
            function: FunctionCall {
                name: "thread".to_string(),
                arguments: arguments.to_string(),
            },
        }
    }

    fn mixed_message_history() -> Vec<Message> {
        vec![
            Message::System {
                content: "system-one".to_string(),
            },
            Message::User {
                content: "older request".to_string(),
            },
            Message::Assistant {
                content: None,
                reasoning_text: Some("reasoning without visible content".to_string()),
                reasoning_details: Some(serde_json::json!({"type": "reasoning"})),
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            Message::Tool {
                tool_call_id: "older-tool".to_string(),
                content: "older result".to_string(),
            },
            Message::System {
                content: "system-two".to_string(),
            },
            Message::User {
                content: "latest request".to_string(),
            },
            Message::Assistant {
                content: None,
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: Some(vec![
                    thread_call(
                        "thread-zeta",
                        r#"{"name":" zeta ","action":"outside the returned tail"}"#,
                    ),
                    thread_call("thread-malformed", r#"{"name":"broken"#),
                    thread_call("thread-empty", r#"{"name":"   "}"#),
                ]),
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            Message::Tool {
                tool_call_id: "thread-zeta".to_string(),
                content: "zeta started".to_string(),
            },
            Message::Assistant {
                content: None,
                reasoning_text: Some("new reasoning".to_string()),
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            Message::System {
                content: "system-three".to_string(),
            },
            Message::Assistant {
                content: None,
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: Some(vec![thread_call(
                    "thread-alpha",
                    r#"{"name":"alpha","action":"inside the cycle"}"#,
                )]),
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            Message::Tool {
                tool_call_id: "thread-alpha".to_string(),
                content: "alpha started".to_string(),
            },
            Message::Assistant {
                content: Some("latest answer".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
        ]
    }

    fn legacy_page_messages(
        messages: &[Message],
        request: MessagePageRequest,
    ) -> MessagesPageSnapshot {
        let visible = messages
            .iter()
            .filter(|message| request.include_system || !matches!(message, Message::System { .. }))
            .cloned()
            .collect::<Vec<_>>();
        let total = visible.len();
        let end = request.before.unwrap_or(total).min(total);
        let start = end.saturating_sub(request.limit.max(1));
        MessagesPageSnapshot {
            messages: visible[start..end].to_vec(),
            created_at: Vec::new(),
            page: MessagePageMetadata {
                start,
                end,
                total,
                has_older: start > 0,
            },
        }
    }

    #[test]
    fn paged_messages_match_legacy_windows_for_mixed_history_and_cursor_bounds() {
        let messages = mixed_message_history();
        for include_system in [false, true] {
            for before in [None, Some(0), Some(1), Some(3), Some(usize::MAX)] {
                for limit in [0, 1, 4, 100] {
                    let request = MessagePageRequest {
                        before,
                        limit,
                        include_system,
                    };
                    let expected = legacy_page_messages(&messages, request);
                    let actual = page_messages(&messages, request);
                    assert_eq!(actual.page, expected.page, "request: {request:?}");
                    assert_eq!(
                        serde_json::to_value(&actual.messages).unwrap(),
                        serde_json::to_value(&expected.messages).unwrap(),
                        "request: {request:?}"
                    );
                }
            }
        }

        let beyond_end = page_messages(
            &messages,
            MessagePageRequest {
                before: Some(usize::MAX),
                limit: 4,
                include_system: false,
            },
        );
        assert_eq!(beyond_end.page.end, beyond_end.page.total);
        assert_eq!(beyond_end.page.total, 10);
        assert_eq!(beyond_end.messages.len(), 4);
    }

    #[test]
    fn thread_tool_call_names_ignore_malformed_and_non_thread_calls() {
        let messages = mixed_message_history();
        // Names come from `thread` tool calls only; malformed arguments,
        // blank names, and non-thread calls are ignored, and names are
        // sorted and deduplicated.
        assert_eq!(
            thread_tool_call_names(&messages[6..]),
            vec!["alpha".to_string(), "zeta".to_string()]
        );
        assert!(thread_tool_call_names(&messages[..2]).is_empty());
        assert!(thread_tool_call_names(&[Message::System {
            content: "only system".to_string(),
        }])
        .is_empty());
    }

    pub(super) fn test_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_session_service_{label}_{unique}"))
            .join("store.db")
    }

    pub(super) fn test_agent(
        client: ModelClient,
        store_path: PathBuf,
        session_id: Option<String>,
    ) -> Agent {
        test_agent_with_compaction_threshold(client, store_path, session_id, None)
    }

    pub(super) fn test_agent_with_compaction_threshold(
        client: ModelClient,
        store_path: PathBuf,
        session_id: Option<String>,
        orchestrator_compaction_threshold: Option<u64>,
    ) -> Agent {
        Agent::with_config(
            client,
            AgentConfig {
                command_output_limits: crate::terminal::CommandOutputLimits::default(),
                mode: AgentMode::Orchestrator,
                store_path,
                session_id,
                orchestrator_compaction_threshold,
                initial_messages: Vec::new(),
                thread_name: None,
                dispatch_id: None,
                event_sink: EventSink::none(),
                workspace_cwd: PathBuf::from("/repo"),
                config_cwd: PathBuf::from("/repo"),
                working_directory: "/repo".to_string(),
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
        .expect("agent config must be valid")
    }

    pub(super) fn test_active_service(
        label: &str,
        session_id: &str,
    ) -> (SessionServiceParts, PathBuf) {
        let store_path = test_store_path(label);
        let client = ModelClient::new_for_test();
        let agent = test_agent(
            client.clone(),
            store_path.clone(),
            Some(session_id.to_string()),
        );
        let snapshot = sessions::new_snapshot(
            session_id.to_string(),
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
            session: OrchestratorSession {
                session_id: session_id.to_string(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_git: Some(GitTarget::local("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });
        (parts, store_path)
    }

    /// Seed the store transcript's legacy prefix: the snapshot blob (what the
    /// store-backed read paths serve) plus the agent vec, so later log
    /// appends land at the right absolute idx.
    pub(super) async fn seed_store_transcript(parts: &SessionServiceParts, messages: Vec<Message>) {
        parts
            .service
            .session_snapshot
            .lock()
            .await
            .as_mut()
            .unwrap()
            .messages = messages.clone();
        parts.service.agent.lock().await.messages = messages.clone();
        let connection =
            crate::store::open_runtime_connection(&parts.service.metadata.store_path).unwrap();
        connection
            .execute(
                "UPDATE sessions
                 SET messages_json = ?1, visible_message_count = ?2, last_user_prompt = ?3
                 WHERE session_id = ?4",
                rusqlite::params![
                    serde_json::to_string(&messages).unwrap(),
                    sessions::visible_message_count(&messages) as i64,
                    sessions::last_user_prompt(&messages),
                    parts.service.metadata.session_id.as_deref().unwrap()
                ],
            )
            .unwrap();
    }

    /// Append to the transcript log tail exactly like a commit point (the
    /// store-backed read paths serve it immediately; the agent vec is not
    /// required for reads).
    pub(super) async fn seed_log_tail(parts: &SessionServiceParts, messages: Vec<Message>) {
        let writer = parts
            .service
            .transcript_log
            .as_ref()
            .expect("active service has a transcript log")
            .clone();
        let session_id = parts.service.metadata.session_id.clone().unwrap();
        let start_idx = parts
            .service
            .session_snapshot
            .lock()
            .await
            .as_ref()
            .map(|snapshot| snapshot.messages.len() as u64)
            .unwrap_or(0);
        tokio::task::spawn_blocking(move || writer.append_batch(&session_id, start_idx, &messages))
            .await
            .unwrap()
            .unwrap();
    }

    pub(super) fn compaction_messages() -> Vec<Message> {
        vec![
            Message::System {
                content: "system policy".to_string(),
            },
            Message::User {
                content: "old request".to_string(),
            },
            Message::Assistant {
                content: Some("old answer".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            Message::User {
                content: "recent request".to_string(),
            },
            Message::User {
                content: "current request".to_string(),
            },
        ]
    }

    pub(super) fn compaction_response(text: &str) -> String {
        serde_json::json!({
            "status": "completed",
            "output": [{
                "type": "message",
                "content": [{"type": "output_text", "text": text}]
            }],
            "usage": {
                "input_tokens": 30,
                "input_tokens_details": {"cached_tokens": 4},
                "output_tokens": 5,
                "total_tokens": 39
            }
        })
        .to_string()
    }

    pub(super) fn test_compaction_service(
        label: &str,
        session_id: &str,
        client: ModelClient,
    ) -> (SessionServiceParts, PathBuf) {
        let store_path = test_store_path(label);
        let mut agent = test_agent(
            client.clone(),
            store_path.clone(),
            Some(session_id.to_string()),
        );
        agent.messages = compaction_messages();
        agent.last_usage = Some(crate::model::TokenUsage {
            input_tokens: 91,
            output_tokens: 7,
            orchestrator_context_tokens: 123,
            ..crate::model::TokenUsage::default()
        });
        let mut snapshot = sessions::new_snapshot(
            session_id.to_string(),
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
        snapshot.last_response_duration_ms = Some(123);
        snapshot.previous_response_duration_ms = Some(45);
        snapshot.response_durations_ms = Some(vec![Some(123)]);
        snapshot.token_usages = vec![Some(crate::model::TokenUsage {
            input_tokens: 11,
            output_tokens: 2,
            orchestrator_context_tokens: 13,
            ..crate::model::TokenUsage::default()
        })];
        sessions::create_session(&store_path, &snapshot).unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession {
                session_id: session_id.to_string(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_git: Some(GitTarget::local("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });
        (parts, store_path)
    }

    #[tokio::test]
    async fn frontend_snapshot_reuses_one_runtime_connection() {
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
        assert_eq!(crate::store::tracked_connection_opens(&store_path), 1);
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    #[ignore = "manual latency benchmark; run with --ignored --nocapture"]
    async fn benchmark_frontend_snapshot_latency() {
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

        const ITERATIONS: usize = 100;
        let (mut parts, store_path) =
            test_active_service("snapshot_benchmark", "benchmark-session");
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
            session: OrchestratorSession {
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
            crate::store::append_thread_event(
                &store_path,
                "events-session",
                thread_name,
                event_json,
            )
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

    #[test]
    fn public_submission_rejects_external_process_lease() {
        let (parts, store_path) = test_active_service("external_lease", "leased-session");
        let _lease =
            sessions::SessionOperationLease::try_acquire(&store_path, "leased-session").unwrap();
        assert!(matches!(
            parts.service.try_submit_prompt("must not run".to_string()),
            Err(SessionSubmitError::ExternalBusy { session_id }) if session_id == "leased-session"
        ));
        assert!(parts.service.active_run().is_none());
        drop(_lease);
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn steering_requires_an_active_run_and_active_target_thread() {
        let (parts, store_path) = test_active_service("steering", "session-steering");
        let service = parts.service;
        let no_run = service
            .queue_thread_steering("impl/ui", "make the layout denser")
            .await
            .unwrap_err();
        assert!(no_run.to_string().contains("no active run"));

        *service
            .active_operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) =
            Some(ActiveSessionOperation::Run(ActiveRunState {
                snapshot: ActiveRunSnapshot {
                    run_id: SessionRunId::new(),
                    client_id: None,
                    prompt_preview: "revamp the UI".to_string(),
                    submitted_user_message: None,
                    started_at_epoch_ms: 0,
                },
                started_at: Instant::now(),
                finishing: false,
                task: None,
                transcript_baseline: None,
                _operation_lease: None,
            }));
        let inactive = service
            .queue_thread_steering("impl/ui", "make the layout denser")
            .await
            .unwrap_err();
        assert!(inactive.to_string().contains("not active"));

        service.active_threads.mark("impl/ui", "worker-dispatch");
        let queued = service
            .queue_thread_steering("impl/ui", "make the layout denser")
            .await
            .unwrap();
        assert_eq!(queued.status, "queued");
        assert_eq!(queued.dispatch_id, "worker-dispatch");
        assert_eq!(
            crate::store::list_thread_steering(&store_path, "session-steering").unwrap(),
            vec![queued]
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn orchestrator_steering_requires_an_active_run_and_expires_at_run_end() {
        let (parts, store_path) =
            test_active_service("orchestrator_steering", "session-orchestrator-steering");
        let service = parts.service;
        let no_run = service
            .queue_orchestrator_steering("change direction")
            .unwrap_err();
        assert!(no_run.to_string().contains("no active run"));

        let active = service.try_begin_run(None, "initial direction").unwrap();
        let queued = service
            .queue_orchestrator_steering("change direction")
            .unwrap();
        assert_eq!(
            queued.thread_name,
            crate::store::ORCHESTRATOR_STEERING_TARGET
        );
        assert_eq!(queued.status, "queued");
        assert_eq!(queued.dispatch_id, active.run_id.as_str());

        assert!(
            service
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Completed("done".to_string(), None)
                )
                .await
        );
        let steering =
            crate::store::list_thread_steering(&store_path, "session-orchestrator-steering")
                .unwrap();
        assert_eq!(steering.len(), 1);
        assert_eq!(steering[0].status, "expired");

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    fn steering_record(
        id: i64,
        thread_name: &str,
        status: &str,
        instruction: &str,
    ) -> crate::store::ThreadSteeringRecord {
        crate::store::ThreadSteeringRecord {
            id,
            session_id: "session".to_string(),
            thread_name: thread_name.to_string(),
            dispatch_id: "run".to_string(),
            instruction: instruction.to_string(),
            status: status.to_string(),
            created_at: "2026-07-31T10:00:00Z".to_string(),
            claimed_at: None,
            delivered_at: None,
            expired_at: None,
        }
    }

    #[test]
    fn covered_orchestrator_steering_ids_require_delivery_and_a_verbatim_message() {
        let orchestrator = crate::store::ORCHESTRATOR_STEERING_TARGET;
        let user = |content: &str| Message::User {
            content: content.to_string(),
        };
        let records = vec![
            steering_record(1, orchestrator, "delivered", "covered"),
            steering_record(2, orchestrator, "delivered", "lost to a crash"),
            steering_record(3, orchestrator, "queued", "covered"),
            steering_record(4, orchestrator, "expired", "covered"),
            steering_record(5, "worker/a", "delivered", "covered"),
        ];
        let transcript = vec![user("covered")];
        assert_eq!(
            covered_orchestrator_steering_ids(&records, &transcript),
            vec![1],
            "only a delivered orchestrator record with a verbatim transcript message is covered"
        );

        // Duplicate instructions: each surviving transcript copy belongs to the
        // newest delivery, so a crash-lost earlier copy keeps its record visible.
        let duplicates = vec![
            steering_record(6, orchestrator, "delivered", "same"),
            steering_record(7, orchestrator, "delivered", "same"),
        ];
        assert_eq!(
            covered_orchestrator_steering_ids(&duplicates, &[user("same")]),
            vec![7]
        );
        assert_eq!(
            covered_orchestrator_steering_ids(&duplicates, &[user("same"), user("same")]),
            vec![6, 7]
        );
    }

    #[test]
    fn covered_ids_from_scan_matches_the_reference_pairing() {
        let orchestrator = crate::store::ORCHESTRATOR_STEERING_TARGET;
        let user = |content: &str| Message::User {
            content: content.to_string(),
        };
        let assistant = || Message::Assistant {
            content: Some("answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        };
        let cases: Vec<(Vec<crate::store::ThreadSteeringRecord>, Vec<Message>)> = vec![
            (vec![], vec![]),
            (vec![], vec![user("orphan")]),
            (
                vec![
                    steering_record(1, orchestrator, "delivered", "covered"),
                    steering_record(2, orchestrator, "delivered", "lost to a crash"),
                    steering_record(3, orchestrator, "queued", "covered"),
                    steering_record(4, orchestrator, "expired", "covered"),
                    steering_record(5, "worker/a", "delivered", "covered"),
                ],
                vec![user("covered")],
            ),
            // Duplicate instructions pair with the newest deliveries first.
            (
                vec![
                    steering_record(6, orchestrator, "delivered", "same"),
                    steering_record(7, orchestrator, "delivered", "same"),
                ],
                vec![user("same")],
            ),
            (
                vec![
                    steering_record(6, orchestrator, "delivered", "same"),
                    steering_record(7, orchestrator, "delivered", "same"),
                ],
                vec![user("same"), assistant(), user("same")],
            ),
            (
                vec![
                    steering_record(8, orchestrator, "delivered", "alpha"),
                    steering_record(9, orchestrator, "delivered", "beta"),
                    steering_record(10, orchestrator, "delivered", "alpha"),
                ],
                vec![user("beta"), assistant(), user("alpha"), user("alpha")],
            ),
        ];
        for (records, transcript) in cases {
            let scan = TranscriptScanCache::from_transcript(&transcript);
            assert_eq!(
                covered_ids_from_scan(&records, &scan),
                covered_orchestrator_steering_ids(&records, &transcript),
                "incremental coverage must match the reference pairing"
            );
        }
    }

    #[tokio::test]
    async fn frontend_snapshot_reconciles_steering_delivered_during_workspace_load() {
        let (mut parts, store_path) =
            test_active_service("steering_workspace_race", "session-steering-workspace-race");
        let queued = crate::store::queue_thread_steering(
            &store_path,
            "session-steering-workspace-race",
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            "run-1",
            "change direction",
        )
        .unwrap();
        crate::store::claim_thread_steering(
            &store_path,
            "session-steering-workspace-race",
            "run-1",
        )
        .unwrap();

        let gate = Arc::new(FrontendSnapshotAfterWorkspaceGate::default());
        parts.service.frontend_snapshot_after_workspace_gate = Some(Arc::clone(&gate));
        let snapshot_service = parts.service.clone();
        let snapshot_task =
            tokio::spawn(async move { snapshot_service.frontend_snapshot().await.unwrap() });
        let reached = tokio::time::timeout(Duration::from_secs(5), async {
            while !gate.reached.load(std::sync::atomic::Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await;
        if reached.is_err() {
            gate.resume.store(true, std::sync::atomic::Ordering::SeqCst);
            let _ = snapshot_task.await;
            panic!("snapshot did not finish workspace inspection");
        }

        crate::store::acknowledge_thread_steering_batch(
            &store_path,
            &[queued.id],
            "session-steering-workspace-race",
            "run-1",
        )
        .unwrap();
        seed_log_tail(
            &parts,
            vec![Message::User {
                content: "change direction".to_string(),
            }],
        )
        .await;
        gate.resume.store(true, std::sync::atomic::Ordering::SeqCst);

        let snapshot = snapshot_task.await.unwrap();
        assert_eq!(snapshot.covered_orchestrator_steering_ids, vec![queued.id]);
        assert_eq!(
            snapshot
                .thread_steering
                .iter()
                .find(|record| record.id == queued.id)
                .map(|record| record.status.as_str()),
            Some("delivered")
        );
        assert!(
            matches!(
                snapshot.messages.last(),
                Some(Message::User { content }) if content == "change direction"
            ),
            "the canonical message must cover steering delivered during workspace inspection"
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn frontend_snapshot_coverage_is_immediate_from_the_store_transcript() {
        let (parts, store_path) = test_active_service("steering_coverage", "session-coverage");
        let service = parts.service.clone();
        let queued = crate::store::queue_thread_steering(
            &store_path,
            "session-coverage",
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            "run-1",
            "change direction",
        )
        .unwrap();
        crate::store::claim_thread_steering(&store_path, "session-coverage", "run-1").unwrap();
        crate::store::acknowledge_thread_steering_batch(
            &store_path,
            &[queued.id],
            "session-coverage",
            "run-1",
        )
        .unwrap();

        // Crash case: the record is delivered but the store transcript never
        // gained the message, so the record keeps rendering.
        let snapshot = service.frontend_snapshot().await.unwrap();
        assert!(snapshot.covered_orchestrator_steering_ids.is_empty());

        // Immediate case: the moment the delivery lands in the transcript
        // log (ack + append at the steering commit point), coverage hides
        // the record — no run-end persist, and a held agent lock (a busy
        // run) is irrelevant because coverage reads the store.
        let agent_guard = service.agent.lock().await;
        seed_log_tail(
            &parts,
            vec![Message::User {
                content: "change direction".to_string(),
            }],
        )
        .await;
        let snapshot = service.frontend_snapshot().await.unwrap();
        assert_eq!(snapshot.covered_orchestrator_steering_ids, vec![queued.id]);
        assert!(
            matches!(
                snapshot.messages.last(),
                Some(Message::User { content }) if content == "change direction"
            ),
            "the canonical message is visible in the same snapshot that covers the record"
        );
        drop(agent_guard);

        // Persisted case: a blob-carried verbatim message (a run-end persist
        // covered the log row) keeps the record covered across services.
        let (parts, blob_store_path) =
            test_active_service("steering_coverage_blob", "session-coverage-blob");
        let service = parts.service.clone();
        let queued = crate::store::queue_thread_steering(
            &blob_store_path,
            "session-coverage-blob",
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            "run-1",
            "change direction",
        )
        .unwrap();
        crate::store::claim_thread_steering(&blob_store_path, "session-coverage-blob", "run-1")
            .unwrap();
        crate::store::acknowledge_thread_steering_batch(
            &blob_store_path,
            &[queued.id],
            "session-coverage-blob",
            "run-1",
        )
        .unwrap();
        let mut blob = vec![Message::System {
            content: "system".to_string(),
        }];
        blob.push(Message::User {
            content: "change direction".to_string(),
        });
        seed_store_transcript(&parts, blob).await;
        let snapshot = service.frontend_snapshot().await.unwrap();
        assert_eq!(snapshot.covered_orchestrator_steering_ids, vec![queued.id]);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
        let _ = std::fs::remove_dir_all(blob_store_path.parent().unwrap());
    }

    #[test]
    fn public_submission_rejects_stale_config_revision() {
        let (parts, store_path) = test_active_service("stale_revision", "stale-session");
        let mut stored = sessions::load_session(&store_path, "stale-session").unwrap();
        stored.model = "externally-updated-model".to_string();
        sessions::update_session_config(&store_path, &stored).unwrap();

        let error = match parts
            .service
            .try_submit_prompt("must not use stale config".to_string())
        {
            Ok(_) => panic!("stale service unexpectedly started a run"),
            Err(error) => error,
        };
        assert!(matches!(
            error,
            SessionSubmitError::Coordination {
                message: SessionCoordinationError::StaleConfiguration { .. },
            }
        ));
        assert!(parts.service.active_run().is_none());
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    fn assert_run_started_event(
        envelope: SessionEventEnvelope,
        active_run: &ActiveRunSnapshot,
        prompt_preview: &str,
    ) {
        assert_eq!(envelope.client_id.as_ref(), active_run.client_id.as_ref());
        assert_eq!(envelope.run_id.as_ref(), Some(&active_run.run_id));
        match envelope.event {
            SessionEvent::RunStarted {
                prompt_preview: emitted_preview,
                submitted_user_message,
                started_at_epoch_ms,
            } => {
                assert_eq!(emitted_preview, prompt_preview);
                assert_eq!(submitted_user_message, active_run.submitted_user_message);
                assert_eq!(started_at_epoch_ms, active_run.started_at_epoch_ms);
            }
            other => panic!("expected run started, got {other:?}"),
        }
    }

    #[test]
    fn from_orchestrator_run_config_exposes_metadata_and_init_snapshot() {
        let store_path = test_store_path("active_init");
        let client = ModelClient::new_for_test();
        let session_id = "session-1".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let mut snapshot = sessions::new_snapshot(
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
        snapshot.last_response_duration_ms = Some(200);
        snapshot.previous_response_duration_ms = Some(100);
        snapshot.response_durations_ms = Some(vec![Some(100), Some(200)]);

        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "loaded".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_git: Some(GitTarget::local("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });

        assert_eq!(parts.init.metadata.store_path, store_path);
        assert_eq!(parts.init.metadata.session_id.as_deref(), Some("session-1"));
        assert_eq!(parts.init.metadata.model, "gpt-5.5");
        assert_eq!(parts.init.metadata.backend, "openai-responses");
        assert_eq!(parts.init.restored_messages.len(), 1);
        assert_eq!(
            parts.init.response_timing.last_response_duration_ms,
            Some(200)
        );
        assert_eq!(
            parts.init.response_timing.response_durations_ms,
            Some(vec![Some(100), Some(200)])
        );
    }

    #[tokio::test]
    async fn finish_run_persists_snapshot_before_completion_event() {
        let store_path = test_store_path("active_finish_persist");
        let client = ModelClient::new_for_test();
        let session_id = "session-finish-persist".to_string();
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
            session: OrchestratorSession {
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
        let client = parts.service.connect_client();
        let active = parts
            .service
            .try_begin_run(Some(client.client_id().clone()), "prompt")
            .unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent
                .push_and_log_for_test(Message::User {
                    content: "prompt".to_string(),
                })
                .await
                .unwrap();
            agent
                .push_and_log_for_test(Message::Assistant {
                    content: Some("done".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                })
                .await
                .unwrap();
        }

        assert!(
            parts
                .service
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Completed("done".to_string(), None)
                )
                .await
        );

        let started = events.recv().await.unwrap();
        assert_eq!(started.sequence_id, 1);
        assert_run_started_event(started, &active, "prompt");

        // The commit-point live signals (step 3) precede the run-end save.
        for (sequence_id, transcript_len) in [(2, 2), (3, 3)] {
            let appended = events.recv().await.unwrap();
            assert_eq!(appended.sequence_id, sequence_id);
            assert_eq!(
                appended.event,
                SessionEvent::TranscriptAppended { transcript_len }
            );
        }

        let saved_event = events.recv().await.unwrap();
        assert_eq!(saved_event.session_id.as_deref(), Some(session_id.as_str()));
        assert_eq!(saved_event.sequence_id, 4);
        assert_eq!(saved_event.client_id.as_ref(), active.client_id.as_ref());
        assert_eq!(saved_event.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(
            saved_event.event,
            SessionEvent::SnapshotSaved {
                session_id: session_id.clone()
            }
        );

        let completion = events.recv().await.unwrap();
        assert_eq!(completion.sequence_id, 5);
        assert_eq!(completion.client_id.as_ref(), active.client_id.as_ref());
        assert_eq!(completion.run_id.as_ref(), Some(&active.run_id));
        let duration_ms = match completion.event {
            SessionEvent::RunCompleted {
                response,
                duration_ms,
            } => {
                assert_eq!(response, "done");
                duration_ms.expect("completed run should include duration")
            }
            other => panic!("expected run completion, got {other:?}"),
        };

        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(loaded.last_response_duration_ms, Some(duration_ms));
        assert_eq!(loaded.previous_response_duration_ms, None);
        assert_eq!(loaded.response_durations_ms, Some(vec![Some(duration_ms)]));
        // Never-fold (step 4): the run end did not rewrite the blob...
        assert_eq!(
            serde_json::to_value(&loaded.messages).unwrap(),
            serde_json::to_value(&parts.init.restored_messages).unwrap()
        );
        // ...the run's messages are served from the transcript log.
        let transcript = parts.service.messages_snapshot().await.unwrap();
        assert_eq!(transcript.len(), parts.init.restored_messages.len() + 2);
        assert!(matches!(
            transcript.last(),
            Some(Message::Assistant { content: Some(text), .. }) if text == "done"
        ));
        assert!(parts.service.active_run().is_none());

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn run_end_persists_run_state_without_rewriting_messages_json() {
        let (parts, store_path) = test_active_service("never_fold_run_end", "session-never-fold");
        let session_id = "session-never-fold";
        let raw_messages_json = || {
            crate::store::open_connection(&store_path)
                .unwrap()
                .query_row(
                    "SELECT messages_json FROM sessions WHERE session_id = ?1",
                    rusqlite::params![session_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap()
        };
        let blob_before = raw_messages_json();

        // Two full runs: the blob stays byte-identical (never-fold) while
        // the run-state bookkeeping accumulates per visible response.
        for (loaded_visible_response_count, (prompt, response, input_tokens)) in [
            ("first prompt", "first done", 10_u64),
            ("second prompt", "second done", 20_u64),
        ]
        .into_iter()
        .enumerate()
        {
            let active = parts.service.try_begin_run(None, prompt).unwrap();
            parts
                .service
                .set_run_transcript_baseline(&active.run_id, loaded_visible_response_count);
            {
                let mut agent = parts.service.agent.lock().await;
                agent
                    .push_and_log_for_test(Message::User {
                        content: prompt.to_string(),
                    })
                    .await
                    .unwrap();
                agent
                    .push_and_log_for_test(Message::Assistant {
                        content: Some(response.to_string()),
                        reasoning_text: None,
                        reasoning_details: None,
                        tool_calls: None,
                        duration_ms: None,
                        model_origin: None,
                        reasoning_field: None,
                    })
                    .await
                    .unwrap();
            }
            let usage = crate::model::TokenUsage {
                input_tokens,
                output_tokens: 5,
                ..crate::model::TokenUsage::default()
            };
            assert!(
                parts
                    .service
                    .finish_run_once(
                        &active.run_id,
                        RunOutcome::Completed(response.to_string(), Some(usage)),
                    )
                    .await
            );
            assert_eq!(
                raw_messages_json(),
                blob_before,
                "run end must never rewrite messages_json (never-fold)"
            );
        }

        let loaded = sessions::load_session(&store_path, session_id).unwrap();
        let durations = loaded
            .response_durations_ms
            .as_ref()
            .expect("duration history should be persisted");
        assert_eq!(durations.len(), 2);
        assert!(durations.iter().all(|entry| entry.is_some()));
        assert_eq!(loaded.last_response_duration_ms, durations[1]);
        assert_eq!(loaded.previous_response_duration_ms, durations[0]);
        assert_eq!(loaded.token_usages.len(), 2);
        assert_eq!(
            loaded.token_usages[0].as_ref().unwrap().input_tokens,
            10,
            "the first run's usage stays on the first visible response"
        );
        assert_eq!(
            loaded.token_usages[1].as_ref().unwrap().input_tokens,
            20,
            "the second run's usage lands on the final visible response"
        );

        // The full transcript is served from the store: blob ++ log.
        let transcript = parts.service.messages_snapshot().await.unwrap();
        assert_eq!(transcript.len(), parts.init.restored_messages.len() + 4);
        assert!(matches!(
            transcript.last(),
            Some(Message::Assistant { content: Some(text), .. }) if text == "second done"
        ));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn real_run_diffs_token_timing_from_the_run_start_store_count() {
        use crate::model::test_http::{ScriptedResponse, ScriptedServer};

        let store_path = test_store_path("baseline_real_run");
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "new answer"}]}],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            })
            .to_string(),
        )]);
        let client = ModelClient::new_for_test_server(server.base_url.clone());
        let session_id = "baseline-session".to_string();
        let mut agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        // Legacy-shaped history: the prior transcript lives in the blob and
        // the row carries scalar last/previous durations but NO duration
        // history vector (a pre-feature row resumed under this build).
        agent.messages.push(Message::User {
            content: "legacy prompt".to_string(),
        });
        agent.messages.push(Message::Assistant {
            content: Some("legacy answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        });
        let mut snapshot = sessions::new_snapshot(
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
        snapshot.last_response_duration_ms = Some(999);
        snapshot.previous_response_duration_ms = Some(888);
        snapshot.response_durations_ms = None;
        sessions::create_session(&store_path, &snapshot).unwrap();
        let blob_json_before: String = crate::store::open_connection(&store_path)
            .unwrap()
            .query_row(
                "SELECT messages_json FROM sessions WHERE session_id = ?1",
                rusqlite::params![session_id],
                |row| row.get(0),
            )
            .unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession {
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

        let handle = parts
            .service
            .try_submit_prompt("new prompt".to_string())
            .unwrap();
        for _ in 0..100 {
            if parts.service.active_run().is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(parts.service.active_run().is_none());
        drop(handle);

        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        let durations = loaded
            .response_durations_ms
            .as_ref()
            .expect("the run end persists a duration history");
        assert_eq!(durations.len(), 2);
        assert_eq!(
            durations[0],
            Some(999),
            "the legacy last-duration stays on the pre-run response: the \
             diff base is the visible-response count at run START (1), not \
             the run-end count"
        );
        assert!(
            durations[1].is_some(),
            "the completed run's duration lands on the final visible response"
        );
        assert_eq!(loaded.last_response_duration_ms, durations[1]);
        assert_eq!(loaded.previous_response_duration_ms, Some(999));
        assert_eq!(loaded.token_usages.len(), 2);
        assert!(loaded.token_usages[0].is_none());
        assert_eq!(loaded.token_usages[1].as_ref().unwrap().input_tokens, 10);
        let blob_json_after: String = crate::store::open_connection(&store_path)
            .unwrap()
            .query_row(
                "SELECT messages_json FROM sessions WHERE session_id = ?1",
                rusqlite::params![session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            blob_json_after, blob_json_before,
            "a real run end never rewrites messages_json (never-fold)"
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn finish_run_persists_token_usage() {
        let store_path = test_store_path("active_finish_token_usage");
        let client = ModelClient::new_for_test();
        let session_id = "session-finish-token-usage".to_string();
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
            session: OrchestratorSession {
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

        let active = parts.service.try_begin_run(None, "prompt").unwrap();
        parts.service.set_run_transcript_baseline(&active.run_id, 0);
        {
            let mut agent = parts.service.agent.lock().await;
            agent
                .push_and_log_for_test(Message::User {
                    content: "prompt".to_string(),
                })
                .await
                .unwrap();
            agent
                .push_and_log_for_test(Message::Assistant {
                    content: Some("done".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                })
                .await
                .unwrap();
        }

        let test_usage = crate::model::TokenUsage {
            input_tokens: 500,
            output_tokens: 120,
            cache_read_tokens: 80,
            cache_write_tokens: 15,
            reasoning_tokens: 0,
            orchestrator_context_tokens: 715,
            cost: crate::model::TokenCostMicros::default(),
        };
        assert!(
            parts
                .service
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Completed("done".to_string(), Some(test_usage.clone())),
                )
                .await
        );

        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(loaded.token_usages.len(), 1);
        let persisted = loaded.token_usages[0]
            .as_ref()
            .expect("token usage should be persisted");
        assert_eq!(persisted.input_tokens, 500);
        assert_eq!(persisted.output_tokens, 120);
        assert_eq!(persisted.cache_read_tokens, 80);
        assert_eq!(persisted.cache_write_tokens, 15);
        assert_eq!(persisted.orchestrator_context_tokens, 715);

        // Frontend snapshot should expose the usage
        let frontend = parts.service.frontend_snapshot().await.unwrap();
        assert_eq!(
            frontend
                .response_timing
                .last_token_usage
                .as_ref()
                .unwrap()
                .orchestrator_context_tokens,
            715
        );
        assert_eq!(
            frontend
                .response_timing
                .token_usages
                .as_ref()
                .unwrap()
                .len(),
            1
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn failed_run_without_visible_response_round_trips_token_usage() {
        // Regression test: when a run fails (e.g. model API error after a tool
        // round that dispatched workers), the accumulated token usage —
        // including worker thread tokens — must still be persisted so it is
        // not permanently lost.
        let store_path = test_store_path("active_failed_token_usage");
        let client = ModelClient::new_for_test();
        let session_id = "session-failed-token-usage".to_string();
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
            session: OrchestratorSession {
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

        let active = parts.service.try_begin_run(None, "prompt").unwrap();
        parts.service.set_run_transcript_baseline(&active.run_id, 0);
        {
            let mut agent = parts.service.agent.lock().await;
            agent
                .push_and_log_for_test(Message::User {
                    content: "prompt".to_string(),
                })
                .await
                .unwrap();
        }

        // Simulate usage that was accumulated during the run (including
        // worker thread tokens from a prior tool round) before the run failed.
        let test_usage = crate::model::TokenUsage {
            input_tokens: 500,
            output_tokens: 120,
            cache_read_tokens: 80,
            cache_write_tokens: 15,
            reasoning_tokens: 0,
            orchestrator_context_tokens: 715,
            cost: crate::model::TokenCostMicros::default(),
        };
        assert!(
            parts
                .service
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Failed("model API error".to_string(), Some(test_usage.clone())),
                )
                .await
        );

        // The response-indexed history stays empty, while the failed run's
        // accounting round-trips through the extended token accounting JSON.
        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert!(loaded.token_usages.is_empty());
        let persisted = loaded
            .unattributed_token_usage
            .as_ref()
            .expect("failed usage should persist without a visible response");
        assert_eq!(persisted.input_tokens, 500);
        assert_eq!(persisted.output_tokens, 120);
        assert_eq!(persisted.cache_read_tokens, 80);
        assert_eq!(persisted.cache_write_tokens, 15);
        assert_eq!(persisted.orchestrator_context_tokens, 715);

        let frontend = parts.service.frontend_snapshot().await.unwrap();
        assert!(frontend.response_timing.token_usages.unwrap().is_empty());
        assert_eq!(
            frontend
                .response_timing
                .cumulative_token_usage
                .unwrap()
                .input_tokens,
            500
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn successful_response_replaces_failed_run_context_gauge_after_round_trip() {
        let store_path = test_store_path("failed_then_successful_token_usage");
        let client = ModelClient::new_for_test();
        let session_id = "session-failed-then-successful";
        let mut snapshot = sessions::new_snapshot(
            session_id.to_string(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            Vec::new(),
            None,
            BTreeMap::new(),
        );
        snapshot.unattributed_token_usage = Some(crate::model::TokenUsage {
            input_tokens: 500,
            output_tokens: 120,
            cache_read_tokens: 80,
            cache_write_tokens: 15,
            orchestrator_context_tokens: 715,
            cost: crate::model::TokenCostMicros {
                input: 1_000,
                output: 480,
                total: 1_480,
                ..crate::model::TokenCostMicros::default()
            },
            ..crate::model::TokenUsage::default()
        });
        sessions::create_session(&store_path, &snapshot).unwrap();

        let successful_usage = crate::model::TokenUsage {
            input_tokens: 700,
            output_tokens: 200,
            cache_read_tokens: 100,
            cache_write_tokens: 0,
            orchestrator_context_tokens: 1_000,
            cost: crate::model::TokenCostMicros {
                input: 1_400,
                output: 800,
                total: 2_200,
                ..crate::model::TokenCostMicros::default()
            },
            ..crate::model::TokenUsage::default()
        };
        let token_usages = token_usages_after_run(&[], 0, 1, Some(successful_usage.clone()));
        let unattributed_token_usage = unattributed_usage_after_run(
            snapshot.unattributed_token_usage.clone(),
            true,
            Some(successful_usage.clone()),
        );
        let update = snapshot.apply_run_state(sessions::SessionRunState {
            last_response_duration_ms: None,
            previous_response_duration_ms: None,
            response_durations_ms: None,
            token_usages,
            unattributed_token_usage,
        });
        sessions::save_session_run_state(&store_path, &update).unwrap();

        let loaded = sessions::load_session(&store_path, session_id).unwrap();
        let unattributed = loaded.unattributed_token_usage.as_ref().unwrap();
        assert_eq!(unattributed.input_tokens, 500);
        assert_eq!(unattributed.output_tokens, 120);
        assert_eq!(unattributed.cache_read_tokens, 80);
        assert_eq!(unattributed.cache_write_tokens, 15);
        assert_eq!(unattributed.cost.total, 1_480);
        assert_eq!(unattributed.orchestrator_context_tokens, 0);

        let timing = ResponseTimingSnapshot::from(&loaded);
        assert_eq!(
            timing
                .last_token_usage
                .as_ref()
                .unwrap()
                .orchestrator_context_tokens,
            1_000
        );
        let cumulative = timing.cumulative_token_usage.unwrap();
        assert_eq!(cumulative.input_tokens, 1_200);
        assert_eq!(cumulative.output_tokens, 320);
        assert_eq!(cumulative.cache_read_tokens, 180);
        assert_eq!(cumulative.cache_write_tokens, 15);
        assert_eq!(cumulative.cost.total, 3_680);
        assert_eq!(cumulative.orchestrator_context_tokens, 1_000);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn failed_run_without_new_visible_response_preserves_and_accumulates_usage() {
        let previous_usage = crate::model::TokenUsage {
            input_tokens: 100,
            output_tokens: 20,
            cost: crate::model::TokenCostMicros {
                input: 200,
                output: 80,
                total: 280,
                ..crate::model::TokenCostMicros::default()
            },
            ..crate::model::TokenUsage::default()
        };
        let failed_usage = crate::model::TokenUsage {
            input_tokens: 900,
            output_tokens: 70,
            cost: crate::model::TokenCostMicros {
                input: 1_800,
                output: 280,
                total: 2_080,
                ..crate::model::TokenCostMicros::default()
            },
            ..crate::model::TokenUsage::default()
        };

        let usages = token_usages_after_run(
            &[Some(previous_usage.clone())],
            1,
            1,
            Some(failed_usage.clone()),
        );
        let unattributed =
            unattributed_usage_after_run(None, false, Some(failed_usage.clone())).unwrap();
        let accumulated =
            unattributed_usage_after_run(Some(unattributed), false, Some(failed_usage.clone()))
                .unwrap();

        assert_eq!(usages, vec![Some(previous_usage)]);
        assert_eq!(accumulated.input_tokens, failed_usage.input_tokens * 2);
        assert_eq!(accumulated.output_tokens, failed_usage.output_tokens * 2);
        assert_eq!(accumulated.cost.total, failed_usage.cost.total * 2);
    }

    #[tokio::test]
    async fn failed_run_normalizes_the_dangling_tool_turn_for_the_next_run() {
        use crate::model::test_http::{ScriptedResponse, ScriptedServer};

        // Regression test (transcript review): a run that fails at the
        // tool-result commit point leaves the assistant tool-call message in
        // the long-lived agent's vec AND the log with its tool results in
        // neither. The next run reuses that agent, and providers reject a
        // transcript whose assistant tool calls have no tool results — the
        // run-failure path must trim the dangling turn from both stores.
        let store_path = test_store_path("failed_run_normalizes");
        let server = ScriptedServer::start(vec![
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
                    "output": [{"type": "message", "content": [{"type": "output_text", "text": "recovered"}]}],
                    "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
                })
                .to_string(),
            ),
        ]);
        let client = ModelClient::new_for_test_server(server.base_url.clone());
        let session_id = "session-failed-normalizes".to_string();
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
            session: OrchestratorSession {
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
        // Inject the log failure precisely at the tool-result commit point:
        // only tool-kind transcript rows fail to insert (the prompt and
        // assistant appends succeed).
        let connection = rusqlite::Connection::open(&store_path).unwrap();
        connection
            .execute_batch(
                "CREATE TRIGGER fail_tool_log_appends
                 BEFORE INSERT ON thread_events
                 WHEN NEW.event_json LIKE '%\"kind\":\"tool\"%'
                 BEGIN
                     SELECT RAISE(ABORT, 'injected tool batch log failure');
                 END;",
            )
            .unwrap();

        let mut events = parts.service.subscribe_events();
        parts
            .service
            .try_submit_prompt("prompt one".to_string())
            .unwrap();
        let terminal = loop {
            let envelope = tokio::time::timeout(Duration::from_secs(5), events.recv())
                .await
                .expect("timed out waiting for the first run's terminal event")
                .unwrap();
            if matches!(
                envelope.event,
                SessionEvent::RunFailed { .. } | SessionEvent::RunCompleted { .. }
            ) {
                break envelope;
            }
        };
        assert!(
            matches!(terminal.event, SessionEvent::RunFailed { .. }),
            "the injected log failure must fail the first run: {:?}",
            terminal.event
        );
        for _ in 0..100 {
            if parts.service.active_run().is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(parts.service.active_run().is_none());

        // The dangling assistant tool-call turn is trimmed from the vec AND
        // the log: both end at the failed run's prompt.
        {
            let agent = parts.service.agent.lock().await;
            assert_eq!(agent.messages.len(), 2);
            assert!(
                matches!(agent.messages[1], Message::User { ref content } if content == "prompt one")
            );
        }
        let log = crate::store::TranscriptLogWriter::new(&store_path)
            .unwrap()
            .read_from(&session_id, 0)
            .unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].0, 1);
        assert!(matches!(log[0].1, Message::User { ref content } if content == "prompt one"));

        // The next run reuses the same agent: with the dangling turn gone,
        // the provider view is clean and the run completes.
        connection
            .execute_batch("DROP TRIGGER fail_tool_log_appends")
            .unwrap();
        parts
            .service
            .try_submit_prompt("prompt two".to_string())
            .unwrap();
        let terminal = loop {
            let envelope = tokio::time::timeout(Duration::from_secs(5), events.recv())
                .await
                .expect("timed out waiting for the second run's terminal event")
                .unwrap();
            if matches!(
                envelope.event,
                SessionEvent::RunFailed { .. } | SessionEvent::RunCompleted { .. }
            ) {
                break envelope;
            }
        };
        assert!(
            matches!(
                terminal.event,
                SessionEvent::RunCompleted { ref response, .. } if response == "recovered"
            ),
            "the second run must complete once the dangling turn is trimmed: {:?}",
            terminal.event
        );
        for _ in 0..100 {
            if parts.service.active_run().is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(parts.service.active_run().is_none());

        let requests = server.finish();
        assert_eq!(requests.len(), 2);
        let second_request: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
        assert!(
            !second_request["input"]
                .to_string()
                .contains("function_call"),
            "the second run's provider view must not carry the dangling tool call"
        );
        // The log stays contiguous across the normalization: prompt one@1,
        // prompt two@2, assistant@3.
        let log = crate::store::TranscriptLogWriter::new(&store_path)
            .unwrap()
            .read_from(&session_id, 0)
            .unwrap();
        assert_eq!(log.len(), 3);
        assert_eq!(log[1].0, 2);
        assert!(matches!(log[1].1, Message::User { ref content } if content == "prompt two"));
        assert_eq!(log[2].0, 3);
        assert!(
            matches!(log[2].1, Message::Assistant { content: Some(ref text), .. } if text == "recovered")
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn completed_run_reports_failure_when_snapshot_persistence_fails() {
        let store_path = test_store_path("active_persist_failure");
        let store_parent = store_path.parent().unwrap().to_path_buf();
        // The store must be usable at agent construction time (the transcript
        // log writer opens it eagerly); break the path afterwards so only the
        // snapshot save at run end fails.
        crate::store::initialize(&store_path).unwrap();
        let client = ModelClient::new_for_test();
        let session_id = "session-persist-failure".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id,
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
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession {
                session_id: snapshot.session_id.clone(),
                store_path,
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_git: Some(GitTarget::local("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });

        // Inject the persistence failure: replace the store directory with a
        // plain file so `save_session` can no longer open the database.
        std::fs::remove_dir_all(&store_parent).unwrap();
        std::fs::write(&store_parent, "not a directory").unwrap();

        let mut events = parts.service.subscribe_events();
        let active = parts.service.try_begin_run(None, "prompt").unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages.push(Message::User {
                content: "prompt".to_string(),
            });
            agent.messages.push(Message::Assistant {
                content: Some("done".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            });
        }

        assert!(
            parts
                .service
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Completed("done".to_string(), None)
                )
                .await
        );
        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "prompt");

        let terminal = events.recv().await.unwrap();
        assert_eq!(terminal.sequence_id, 2);
        assert_eq!(terminal.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(terminal.client_id.as_ref(), active.client_id.as_ref());
        assert_eq!(
            terminal.event,
            SessionEvent::RunFailed {
                message: "run failed".to_string()
            }
        );
        assert!(matches!(
            events.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));
        assert!(parts.service.active_run().is_none());

        let _ = std::fs::remove_file(store_parent);
    }

    #[tokio::test]
    async fn cancelled_run_stays_cancelled_when_snapshot_persistence_fails() {
        let store_path = test_store_path("cancel_persist_failure");
        let store_parent = store_path.parent().unwrap().to_path_buf();
        crate::store::initialize(&store_path).unwrap();
        let client = ModelClient::new_for_test();
        let session_id = "session-cancel-persist-failure".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id,
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
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession {
                session_id: snapshot.session_id.clone(),
                store_path,
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_git: Some(GitTarget::local("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });

        std::fs::remove_dir_all(&store_parent).unwrap();
        std::fs::write(&store_parent, "not a directory").unwrap();
        let active = parts.service.try_begin_run(None, "cancel prompt").unwrap();
        parts.service.request_cancel(&active.run_id).await.unwrap();

        let terminal_events = parts
            .service
            .recent_events(None, 32)
            .into_iter()
            .filter(|envelope| {
                matches!(
                    envelope.event,
                    SessionEvent::RunCompleted { .. }
                        | SessionEvent::RunFailed { .. }
                        | SessionEvent::RunCancelled
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(terminal_events.len(), 1);
        assert_eq!(terminal_events[0].event, SessionEvent::RunCancelled);
        assert!(parts.service.active_run().is_none());
        let _ = std::fs::remove_file(store_parent);
    }

    #[tokio::test]
    async fn subscribe_agent_events_filters_agent_envelopes() {
        let store_path = test_store_path("agent_event_adapter");
        let client = ModelClient::new_for_test();
        let session_id = "session-agent-events".to_string();
        crate::store::insert_test_session(&store_path, &session_id);
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
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession {
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
        let mut agent_events = parts.service.subscribe_agent_events();
        let agent_event = AgentEvent::RunFinished {
            thread_name: Some("impl".to_string()),
        };

        parts.service.event_bus.emit(SessionEvent::SnapshotSaved {
            session_id: session_id.clone(),
        });
        parts.service.event_bus.emit_agent(agent_event.clone());

        assert_eq!(agent_events.recv().await, Some(agent_event));
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn client_subscribers_receive_same_events_with_unique_identity() {
        let (mut parts, _store_path) =
            test_active_service("client_subscribers", "client_subscribers-session");
        parts.service.workspace_git = None;
        let first_client = parts.service.connect_client();
        let second_client = parts.service.connect_client();
        let mut first_events = first_client.subscribe_events();
        let mut second_events = second_client.subscribe_events();

        assert_ne!(first_client.client_id(), second_client.client_id());
        assert_eq!(&first_events.client_id, first_client.client_id());
        assert_eq!(&second_events.client_id, second_client.client_id());
        assert_ne!(first_events.subscription_id, second_events.subscription_id);

        let agent_event = AgentEvent::RunFinished {
            thread_name: Some("impl".to_string()),
        };
        parts.service.event_bus.emit_agent(agent_event.clone());

        let first = first_events.receiver.recv().await.unwrap();
        let second = second_events.receiver.recv().await.unwrap();
        assert_eq!(first, second);
        assert_eq!(first.sequence_id, 1);
        assert_eq!(first.event, SessionEvent::Agent { event: agent_event });
    }

    #[tokio::test]
    async fn frontend_snapshot_does_not_wait_for_agent_lock_while_active_run() {
        let (mut parts, _store_path) =
            test_active_service("snapshot_nonblocking", "snapshot_nonblocking-session");
        parts.service.workspace_git = None;
        let agent_guard = parts.service.agent.lock().await;
        let active = parts.service.try_begin_run(None, "blocked prompt").unwrap();

        let snapshot = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            parts.service.frontend_snapshot(),
        )
        .await
        .expect("frontend snapshot should not wait for the held agent mutex")
        .unwrap();

        assert_eq!(snapshot.active_run, Some(active.clone()));
        let submitted = snapshot
            .active_run
            .as_ref()
            .and_then(|active_run| active_run.submitted_user_message.as_ref())
            .expect("active run should expose server-submitted user message");
        assert_eq!(submitted.run_id, active.run_id);
        assert_eq!(submitted.content, "blocked prompt");
        // Submission metadata is available without the agent lock, but the
        // prompt is not part of the persisted transcript until the agent can
        // acquire that lock and append it.
        assert!(!snapshot.messages.iter().any(
            |message| matches!(message, Message::User { content } if content == "blocked prompt")
        ));

        drop(agent_guard);
        assert!(
            parts
                .service
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Failed("cleanup".to_string(), None)
                )
                .await
        );
        let _ = std::fs::remove_dir_all(parts.init.metadata.store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn mark_run_finishing_clears_submitted_user_message_before_persistence() {
        let store_path = test_store_path("active_pending_cleared_on_finish");
        let client = ModelClient::new_for_test();
        let session_id = "session-pending-clear".to_string();
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
            session: OrchestratorSession {
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
        let active = parts
            .service
            .try_begin_run(None, "persisted prompt")
            .unwrap();
        assert!(active.submitted_user_message.is_some());
        assert_eq!(parts.service.active_run(), Some(active.clone()));
        {
            let mut agent = parts.service.agent.lock().await;
            agent
                .push_and_log_for_test(Message::User {
                    content: "persisted prompt".to_string(),
                })
                .await
                .unwrap();
        }

        let finishing = parts
            .service
            .mark_run_finishing(&active.run_id)
            .expect("run should transition to finishing");
        assert_eq!(finishing.snapshot.run_id, active.run_id);
        assert!(finishing.snapshot.submitted_user_message.is_none());
        let active_after_finishing = parts.service.active_run().unwrap();
        assert_eq!(active_after_finishing.run_id, active.run_id);
        assert!(active_after_finishing.submitted_user_message.is_none());

        let frontend_before_persist = parts.service.frontend_snapshot().await.unwrap();
        assert!(frontend_before_persist
            .active_run
            .as_ref()
            .unwrap()
            .submitted_user_message
            .is_none());
        assert!(matches!(
            frontend_before_persist.messages.last(),
            Some(Message::User { content }) if content == "persisted prompt"
        ));

        parts
            .service
            .persist_run_snapshot(
                &finishing.snapshot,
                finishing.transcript_baseline,
                Some(42),
                None,
            )
            .await
            .unwrap();

        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "persisted prompt");
        // The commit-point log append emits the live transcript signal before
        // the run-end snapshot save. The run id travels only inside send()
        // (the run-context sink), so this direct append carries none.
        let appended = events.recv().await.unwrap();
        assert_eq!(
            appended.event,
            SessionEvent::TranscriptAppended { transcript_len: 2 }
        );
        let saved = events.recv().await.unwrap();
        assert_eq!(saved.run_id.as_ref(), Some(&active.run_id));
        assert!(matches!(saved.event, SessionEvent::SnapshotSaved { .. }));
        let active_after_save = parts.service.active_run().unwrap();
        assert_eq!(active_after_save.run_id, active.run_id);
        assert!(active_after_save.submitted_user_message.is_none());

        let frontend_after_persist = parts.service.frontend_snapshot().await.unwrap();
        assert!(frontend_after_persist
            .active_run
            .as_ref()
            .unwrap()
            .submitted_user_message
            .is_none());
        assert!(matches!(
            frontend_after_persist.messages.last(),
            Some(Message::User { content }) if content == "persisted prompt"
        ));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn mark_run_cancelling_clears_submitted_user_message() {
        let (mut parts, _store_path) = test_active_service(
            "active_pending_cleared_on_cancel",
            "active_pending_cleared_on_cancel-session",
        );
        parts.service.workspace_git = None;
        let active = parts.service.try_begin_run(None, "cancel prompt").unwrap();
        assert!(active.submitted_user_message.is_some());

        let cancelling = parts
            .service
            .mark_run_cancelling(&active.run_id)
            .expect("run should transition to cancelling");

        assert_eq!(cancelling.snapshot.run_id, active.run_id);
        assert!(cancelling.snapshot.submitted_user_message.is_none());
        let active_after_cancelling = parts.service.active_run().unwrap();
        assert_eq!(active_after_cancelling.run_id, active.run_id);
        assert!(active_after_cancelling.submitted_user_message.is_none());
        let _ = std::fs::remove_dir_all(parts.init.metadata.store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn cancel_and_completion_race_has_exactly_one_terminal_owner() {
        let (mut parts, _store_path) =
            test_active_service("cancel_completion_race", "cancel_completion_race-session");
        parts.service.workspace_git = None;
        let active = parts.service.try_begin_run(None, "race prompt").unwrap();
        let barrier = Arc::new(tokio::sync::Barrier::new(3));

        let cancel_service = parts.service.clone();
        let cancel_run_id = active.run_id.clone();
        let cancel_barrier = barrier.clone();
        let cancel = tokio::spawn(async move {
            cancel_barrier.wait().await;
            cancel_service.request_cancel(&cancel_run_id).await
        });
        let finish_service = parts.service.clone();
        let finish_run_id = active.run_id.clone();
        let finish_barrier = barrier.clone();
        let finish = tokio::spawn(async move {
            finish_barrier.wait().await;
            finish_service
                .finish_run_once(
                    &finish_run_id,
                    RunOutcome::Completed("done".to_string(), None),
                )
                .await
        });
        barrier.wait().await;
        let _ = cancel.await.unwrap();
        let _ = finish.await.unwrap();

        let terminal_events = parts
            .service
            .recent_events(None, 16)
            .into_iter()
            .filter(|envelope| {
                matches!(
                    envelope.event,
                    SessionEvent::RunCompleted { .. }
                        | SessionEvent::RunFailed { .. }
                        | SessionEvent::RunCancelled
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(terminal_events.len(), 1);
        assert!(matches!(
            terminal_events[0].event,
            SessionEvent::RunCompleted { .. } | SessionEvent::RunCancelled
        ));
        assert!(parts.service.active_run().is_none());
        let _ = std::fs::remove_dir_all(parts.init.metadata.store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn busy_run_rejects_concurrent_submission_and_clears_once() {
        let (mut parts, _store_path) =
            test_active_service("busy_rejection", "busy_rejection-session");
        parts.service.workspace_git = None;
        let client = parts.service.connect_client();
        let mut events = parts.service.subscribe_events();
        let first = parts
            .service
            .try_begin_run(Some(client.client_id().clone()), "first prompt")
            .unwrap();

        assert_eq!(parts.service.active_run(), Some(first.clone()));
        let first_started = events.recv().await.unwrap();
        assert_eq!(first_started.sequence_id, 1);
        assert_run_started_event(first_started, &first, "first prompt");
        assert!(matches!(
            parts.service.try_begin_run(None, "second prompt"),
            Err(SessionSubmitError::Busy { active_run }) if active_run == first
        ));

        assert!(
            parts
                .service
                .finish_run_once(
                    &first.run_id,
                    RunOutcome::Completed("done".to_string(), None)
                )
                .await
        );
        let completion = loop {
            let event = events.recv().await.unwrap();
            if matches!(event.event, SessionEvent::RunCompleted { .. }) {
                break event;
            }
        };
        assert_eq!(completion.run_id.as_ref(), Some(&first.run_id));
        assert_eq!(completion.client_id.as_ref(), first.client_id.as_ref());
        assert!(matches!(
            completion.event,
            SessionEvent::RunCompleted {
                response,
                duration_ms: Some(_),
            } if response == "done"
        ));
        assert!(parts.service.active_run().is_none());

        assert!(
            !parts
                .service
                .finish_run_once(
                    &first.run_id,
                    RunOutcome::Completed("duplicate".to_string(), None)
                )
                .await
        );
        assert!(matches!(
            events.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));

        let second = parts.service.try_begin_run(None, "second prompt").unwrap();
        let second_started = events.recv().await.unwrap();
        assert_run_started_event(second_started, &second, "second prompt");
        assert!(
            parts
                .service
                .finish_run_once(&second.run_id, RunOutcome::Failed("boom".to_string(), None))
                .await
        );
        let failed = loop {
            let event = events.recv().await.unwrap();
            if matches!(event.event, SessionEvent::RunFailed { .. }) {
                break event;
            }
        };
        assert_eq!(failed.run_id.as_ref(), Some(&second.run_id));
        assert!(failed.client_id.is_none());
        assert_eq!(
            failed.event,
            SessionEvent::RunFailed {
                message: "run failed".to_string()
            }
        );
        assert!(parts.service.active_run().is_none());
    }

    #[tokio::test]
    async fn failed_run_persists_messages_without_recording_new_duration() {
        let store_path = test_store_path("active_failed_persist");
        let client = ModelClient::new_for_test();
        let session_id = "session-failed-persist".to_string();
        let mut agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        agent.messages.push(Message::User {
            content: "old prompt".to_string(),
        });
        agent.messages.push(Message::Assistant {
            content: Some("old response".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        });
        let mut snapshot = sessions::new_snapshot(
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
        snapshot.last_response_duration_ms = Some(123);
        snapshot.response_durations_ms = Some(vec![Some(123)]);
        sessions::create_session(&store_path, &snapshot).unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession {
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
        let active = parts.service.try_begin_run(None, "failed prompt").unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent
                .push_and_log_for_test(Message::User {
                    content: "failed prompt".to_string(),
                })
                .await
                .unwrap();
        }

        assert!(
            parts
                .service
                .finish_run_once(&active.run_id, RunOutcome::Failed("boom".to_string(), None))
                .await
        );
        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "failed prompt");
        // The prompt commit point's live signal precedes the run-end save.
        let appended = events.recv().await.unwrap();
        assert_eq!(
            appended.event,
            SessionEvent::TranscriptAppended { transcript_len: 4 }
        );
        let saved = events.recv().await.unwrap();
        assert_eq!(saved.run_id.as_ref(), Some(&active.run_id));
        assert!(matches!(saved.event, SessionEvent::SnapshotSaved { .. }));
        let failed = events.recv().await.unwrap();
        assert_eq!(failed.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(
            failed.event,
            SessionEvent::RunFailed {
                message: "run failed".to_string()
            }
        );

        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(loaded.last_response_duration_ms, Some(123));
        assert_eq!(loaded.previous_response_duration_ms, None);
        assert_eq!(loaded.response_durations_ms, Some(vec![Some(123)]));
        // Never-fold (step 4): the failed run's prompt persists in the
        // transcript log, not the blob.
        assert_eq!(
            serde_json::to_value(&loaded.messages).unwrap(),
            serde_json::to_value(&parts.init.restored_messages).unwrap()
        );
        let transcript = parts.service.messages_snapshot().await.unwrap();
        assert_eq!(transcript.len(), parts.init.restored_messages.len() + 1);
        assert!(matches!(
            transcript.last(),
            Some(Message::User { content }) if content == "failed prompt"
        ));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn request_cancel_persists_marker_and_emits_terminal_event() {
        let store_path = test_store_path("active_cancel_persist");
        let client = ModelClient::new_for_test();
        let session_id = "session-cancel-persist".to_string();
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
            session: OrchestratorSession {
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
        let active = parts.service.try_begin_run(None, "cancel prompt").unwrap();
        assert!(parts
            .service
            .active_threads
            .mark("worker", "worker-dispatch"));
        crate::store::queue_thread_steering(
            &store_path,
            &session_id,
            "worker",
            "worker-dispatch",
            "worker direction",
        )
        .unwrap();
        crate::store::queue_thread_steering(
            &store_path,
            &session_id,
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            active.run_id.as_str(),
            "orchestrator direction",
        )
        .unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent
                .push_and_log_for_test(Message::User {
                    content: "cancel prompt".to_string(),
                })
                .await
                .unwrap();
            agent.last_usage = Some(crate::model::TokenUsage {
                input_tokens: 40,
                output_tokens: 10,
                cost: crate::model::TokenCostMicros {
                    input: 80,
                    output: 40,
                    total: 120,
                    ..crate::model::TokenCostMicros::default()
                },
                ..crate::model::TokenUsage::default()
            });
        }

        parts.service.request_cancel(&active.run_id).await.unwrap();

        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "cancel prompt");
        // The prompt commit point's live signal fires before the cancel.
        let appended = events.recv().await.unwrap();
        assert_eq!(
            appended.event,
            SessionEvent::TranscriptAppended { transcript_len: 2 }
        );
        let steering_events = [
            events.recv().await.unwrap().event,
            events.recv().await.unwrap().event,
        ];
        assert!(steering_events.iter().any(|event| matches!(
            event,
            SessionEvent::Agent {
                event: AgentEvent::OrchestratorSteeringExpired { .. }
            }
        )));
        assert!(steering_events.iter().any(|event| matches!(
            event,
            SessionEvent::Agent {
                event: AgentEvent::ThreadSteeringExpired { .. }
            }
        )));
        // The cancellation marker is a transcript commit point: the live
        // signal fires before the snapshot save (the cancel path runs outside
        // send(), so it carries no run context).
        let appended = events.recv().await.unwrap();
        assert_eq!(
            appended.event,
            SessionEvent::TranscriptAppended { transcript_len: 3 }
        );
        let saved = events.recv().await.unwrap();
        assert_eq!(saved.run_id.as_ref(), Some(&active.run_id));
        assert!(matches!(saved.event, SessionEvent::SnapshotSaved { .. }));
        let cancelled = events.recv().await.unwrap();
        assert_eq!(cancelled.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(cancelled.event, SessionEvent::RunCancelled);
        assert!(parts.service.active_run().is_none());
        assert!(parts.service.active_thread_names().await.is_empty());
        assert!(crate::store::list_thread_steering(&store_path, &session_id)
            .unwrap()
            .iter()
            .all(|record| record.status == "expired"));

        // Never-fold (step 4): the cancel path persists bookkeeping only —
        // the blob keeps the system head and the cancellation marker lives
        // in the transcript log.
        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(loaded.token_usages.len(), 1);
        let cancellation_usage = loaded.token_usages[0]
            .as_ref()
            .expect("early cancellation usage should be attributed to its marker");
        assert_eq!(cancellation_usage.input_tokens, 40);
        assert_eq!(cancellation_usage.output_tokens, 10);
        assert_eq!(cancellation_usage.cost.total, 120);
        assert_eq!(
            serde_json::to_value(&loaded.messages).unwrap(),
            serde_json::to_value(&parts.init.restored_messages).unwrap()
        );
        let transcript = parts.service.messages_snapshot().await.unwrap();
        assert!(matches!(
            transcript.last(),
            Some(Message::Assistant {
                content: Some(content),
                ..
            }) if content == "[run cancelled by user]"
        ));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }
