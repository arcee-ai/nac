use super::*;
use crate::model::ModelClient;
use crate::session_service::tests::{
    seed_log_tail, test_active_service, test_direct_active_service,
};
use crate::types::{FunctionCall, ToolCall};

const EXACT_SECRET: &str = "managed-exact-canary-value";

struct ExactSecret;

impl nac_contracts::CommandEnvironmentProvider for ExactSecret {
    fn snapshot(&self) -> nac_contracts::CommandEnvironmentFuture<'_> {
        Box::pin(async { self.redaction_snapshot() })
    }
    fn redaction_snapshot(&self) -> Result<nac_contracts::CommandEnvironmentSnapshot> {
        Ok(nac_contracts::CommandEnvironmentSnapshot::from_parts(
            BTreeMap::new(),
            vec![EXACT_SECRET.into()],
        ))
    }
    fn worker_environment(&self) -> nac_contracts::WorkerEnvironment {
        Default::default()
    }
}

fn assistant(calls: &[(&str, &str)]) -> Message {
    Message::Assistant {
        content: None,
        reasoning_text: None,
        reasoning_details: None,
        tool_calls: Some(
            calls
                .iter()
                .map(|(id, arguments)| ToolCall {
                    id: (*id).into(),
                    call_type: "function".into(),
                    function: FunctionCall {
                        name: "fetch".into(),
                        arguments: (*arguments).into(),
                    },
                })
                .collect(),
        ),
        duration_ms: None,
        model_origin: None,
        reasoning_field: None,
    }
}

fn result(call_id: &str, text: impl Into<String>) -> Message {
    Message::Tool {
        tool_call_id: call_id.into(),
        content: ToolContent::text(text),
    }
}

#[tokio::test]
async fn known_call_returns_full_redacted_arguments_and_output() {
    let (mut parts, store_path) =
        test_direct_active_service("tool_call_content", "session", ModelClient::new_for_test());
    parts
        .service
        .shell_runtime
        .as_mut()
        .unwrap()
        .command_environment = Some(Arc::new(ExactSecret));
    seed_log_tail(
        &parts,
        vec![
            assistant(&[
                (
                    "call-fetch",
                    r#"{"header":"Authorization: Bearer sk-live-canary-123","url":"https://api.example.test/v1"}"#,
                ),
                ("call-pending", r#"{"url":"https://api.example.test/slow"}"#),
            ]),
            result(
                "call-fetch",
                format!(
                    "GET /v1 x-api-key: sk-live-output-456\n\
                     cloning https://deploy:hunter2@git.example.test/repo.git\n\
                     using {EXACT_SECRET}\ndone\n"
                ),
            ),
        ],
    )
    .await;

    let content = parts
        .service
        .tool_call_content("call-fetch")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        content,
        ToolCallContent {
            call_id: "call-fetch".into(),
            arguments:
                r#"{"header":"Authorization: [REDACTED]","url":"https://api.example.test/v1"}"#
                    .into(),
            arguments_truncated: false,
            output: Some(
                "GET /v1 x-api-key: [REDACTED]\n\
                 cloning https://[REDACTED]@git.example.test/repo.git\n\
                 using [REDACTED]\ndone\n"
                    .into()
            ),
            output_truncated: false,
        }
    );
    let pending = parts
        .service
        .tool_call_content("call-pending")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        pending.arguments,
        r#"{"url":"https://api.example.test/slow"}"#
    );
    assert_eq!(pending.output, None);
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn oversized_fields_are_redacted_before_char_boundary_bound() {
    let (parts, store_path) = test_active_service("tool_call_content_bound", "session");
    // The bound falls three bytes into the token; bounding first would leak "AbC".
    let arguments = format!(
        "{} Bearer AbCdEf0123456789",
        "a".repeat(MAX_TOOL_CALL_CONTENT_BYTES - 11)
    );
    seed_log_tail(
        &parts,
        vec![
            assistant(&[("call-large", &arguments)]),
            result("call-large", "€".repeat(MAX_TOOL_CALL_CONTENT_BYTES)),
        ],
    )
    .await;

    let content = parts
        .service
        .tool_call_content("call-large")
        .await
        .unwrap()
        .unwrap();
    assert!(content.arguments_truncated);
    assert_eq!(content.arguments.len(), MAX_TOOL_CALL_CONTENT_BYTES);
    assert!(content.arguments.ends_with(" Bearer [RE"));
    assert!(content.output_truncated);
    let output = content.output.unwrap();
    assert_eq!(output.len(), MAX_TOOL_CALL_CONTENT_BYTES / 3 * 3);
    assert!(output.chars().all(|character| character == '€'));
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn unknown_call_id_yields_none() {
    let (parts, store_path) = test_active_service("tool_call_content_unknown", "session");
    seed_log_tail(
        &parts,
        vec![
            assistant(&[("call-known", "{}")]),
            result("call-known", "ok"),
        ],
    )
    .await;

    assert_eq!(
        parts
            .service
            .tool_call_content("call-missing")
            .await
            .unwrap(),
        None
    );
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}
