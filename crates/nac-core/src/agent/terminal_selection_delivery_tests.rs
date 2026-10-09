//! Actual active-run inbox delivery preserves identified evidence literally.
use super::transcript_log_tests::{store_snapshot_messages, transcript_test_agent};
use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::store::{
    TerminalSelectionDelivery, TerminalSelectionIntent, TerminalSelectionSourceKind,
};
#[tokio::test]
async fn terminal_selection_active_steer_delivery_is_literal_with_no_skill_or_command_resolution() {
    let path = std::env::temp_dir()
        .join(format!("nac-selection-live-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    crate::store::initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session");
    let run = uuid::Uuid::new_v4().to_string();
    let original = TerminalSelectionIntent {
        protocol_version: 1,
        source_kind: TerminalSelectionSourceKind::UserSuppliedRenderedSelection,
        admission_id: uuid::Uuid::new_v4().to_string(),
        capture_id: uuid::Uuid::new_v4().to_string(),
        source_session_id: "session".into(),
        terminal_id: "launch".into(),
        owner_instance_id: uuid::Uuid::new_v4().to_string(),
        client_capture_time_ms: None,
        text: " /compact\n$skill\n/mcp_prompt missing ".into(),
        user_text: Some(" $skill\n/goal\n/mcp_prompt missing ".into()),
        initial_delivery: TerminalSelectionDelivery::Steer,
        initial_expected_run_id: Some(run.clone()),
    };
    let envelope = original.envelope().unwrap();
    let response = |text: &str| {
        serde_json::json!({"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":text}]}],"usage":{"input_tokens":30,"output_tokens":5,"total_tokens":35}}).to_string()
    };
    let callback_path = path.clone();
    let callback_intent = original.clone();
    let server = ScriptedServer::start_observed(
        vec![
            ScriptedResponse::json("200 OK", response("first")),
            ScriptedResponse::json("200 OK", response("second")),
        ],
        move |index, _| {
            if index == 0 {
                crate::store::create_terminal_selection_intent(&callback_path, &callback_intent)
                    .unwrap();
            }
        },
    );
    let mut agent = transcript_test_agent(
        ModelClient::new_for_test_server(server.base_url.clone()),
        path.clone(),
        Some("session"),
        AgentMode::Direct,
    );
    store_snapshot_messages(&path, &agent.messages);
    agent.tool_runtime.skills = Some(Arc::new(crate::skills::SkillRegistry::load_for_test(vec![
        crate::skills::SkillRecord {
            name: "skill".into(),
            description: "fixture".into(),
            compatibility: None,
            skill_root_visible: PathBuf::from("/fixture"),
            body: "EXPANSION_MUST_NOT_RUN".into(),
            resources: Vec::new(),
        },
    ])));
    let crate::commands::PreparedUserInput::SubmitPrompt(control) =
        crate::commands::prepare_user_input(&envelope, agent.skills().as_deref())
    else {
        panic!("control preparation unavailable")
    };
    assert!(control.agent_prompt.contains("EXPANSION_MUST_NOT_RUN"));
    agent.set_steering_dispatch_id(Some(run));
    agent.send("ordinary first prompt").await.unwrap();
    assert_eq!(
        agent
            .messages
            .iter()
            .filter(|message| matches!(message,Message::User{content} if content==&envelope))
            .count(),
        1
    );
    assert!(!serde_json::to_string(&agent.messages)
        .unwrap()
        .contains("EXPANSION_MUST_NOT_RUN"));
    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    let request: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert!(request
        .to_string()
        .contains(&serde_json::to_string(&envelope).unwrap()));
    let replay = crate::store::load_terminal_selection_receipt(&path, &original)
        .unwrap()
        .unwrap();
    assert_eq!(replay.record.status, crate::store::InboxStatus::Delivered);
    assert_eq!(replay.record.content, envelope);
}
