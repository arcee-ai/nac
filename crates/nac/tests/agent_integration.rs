use nac::{agent::Agent, api::OpenAiClient};

#[tokio::test]
#[ignore = "requires OPENAI_API_KEY"]
async fn test_simple_prompt() {
    let client = OpenAiClient::from_env().expect("Need OPENAI_API_KEY");
    let mut agent = Agent::new(client);
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

    let client = OpenAiClient::from_env().expect("Need OPENAI_API_KEY");
    let mut agent = Agent::new(client);
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
