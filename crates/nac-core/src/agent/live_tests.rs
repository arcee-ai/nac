use super::Agent;
use crate::model::{BackendKind, EffectiveModelSettings, ModelClient};
use std::collections::BTreeMap;

fn live_openai_settings() -> EffectiveModelSettings {
    EffectiveModelSettings::new(
        BackendKind::OpenAiResponses,
        "gpt-5.5".to_string(),
        "https://api.openai.com/v1".to_string(),
        None,
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    )
    .expect("live test settings must be valid")
}

#[tokio::test]
#[ignore = "requires OPENAI_API_KEY"]
async fn test_simple_prompt() {
    let client = ModelClient::from_effective_settings(live_openai_settings())
        .expect("Need OPENAI_API_KEY selected through api_key_env");
    let mut agent = Agent::default(client);
    let result = agent.send("What is 2+2? Reply with just the number.").await;

    assert!(result.is_ok(), "Agent failed: {:?}", result.err());
    let response = result.expect("expected successful response");
    assert!(
        response.contains('4'),
        "Expected '4' in response, got: {}",
        response
    );
}

#[tokio::test]
#[ignore = "requires OPENAI_API_KEY"]
async fn test_tool_usage() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("agent_task5_test_{}.txt", unique));
    std::fs::write(&path, "hello from test file").expect("failed to create temp file");

    let client = ModelClient::from_effective_settings(live_openai_settings())
        .expect("Need OPENAI_API_KEY selected through api_key_env");
    let mut agent = Agent::default(client);
    let result = agent
        .send(&format!(
            "Read the file {} and tell me what it says",
            path.display()
        ))
        .await;

    let _ = std::fs::remove_file(&path);

    assert!(result.is_ok(), "Agent failed: {:?}", result.err());
    let response = result.expect("expected successful response");
    assert!(
        response.contains("hello from test"),
        "Expected file content in response, got: {}",
        response
    );
}
