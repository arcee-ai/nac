//! Per-response cost attachment (S3): the client bills parsed usage at
//! the resolved catalog rates, including the Anthropic 1h-cache rule and
//! the unknown-pricing-is-zero contract.

use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};

fn anthropic_cost_test_client(server_url: &str, cache_ttl: Option<&'static str>) -> ModelClient {
    let mut client = test_model_client(
        BackendKind::AnthropicMessages,
        server_url.to_string(),
        std::collections::BTreeMap::new(),
    );
    client.model = "claude-opus-4-6".to_string();
    client.resolved_model = catalog::resolve(BackendKind::AnthropicMessages, "claude-opus-4-6");
    client.with_cache_ttl(cache_ttl)
}

fn anthropic_usage_server() -> ScriptedServer {
    ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        json!({
            "content": [{"type": "text", "text": "done"}],
            "stop_reason": "end_turn",
            "usage": {
                "input_tokens": 100,
                "output_tokens": 50,
                "cache_read_input_tokens": 200,
                "cache_creation_input_tokens": 32
            }
        })
        .to_string(),
    )])
}

#[tokio::test]
async fn send_turn_attaches_catalog_cost_to_the_usage() {
    let server = anthropic_usage_server();
    let client = anthropic_cost_test_client(&server.base_url, None);

    let response = client
        .send_turn(
            vec![Message::User {
                content: "hi".to_string(),
            }],
            vec![],
        )
        .await
        .expect("anthropic response should parse");
    server.finish();

    // claude-opus-4-6 catalog rates ($/1M): 5 / 25 / 0.5 / 6.25; 5-minute
    // cache writes bill at the standard cache_write rate.
    let usage = response.usage.expect("usage should parse");
    assert_eq!(usage.cost.input, 500);
    assert_eq!(usage.cost.output, 1_250);
    assert_eq!(usage.cost.cache_read, 100);
    assert_eq!(usage.cost.cache_write, 200);
    assert_eq!(usage.cost.total, 2_050);
}

#[tokio::test]
async fn orchestrator_1h_cache_writes_bill_at_the_1h_rate() {
    let server = anthropic_usage_server();
    let client = anthropic_cost_test_client(&server.base_url, Some("1h"));

    let response = client
        .send_turn(
            vec![Message::User {
                content: "hi".to_string(),
            }],
            vec![],
        )
        .await
        .expect("anthropic response should parse");
    server.finish();

    // The catalog carries no explicit 1h rate, so the 2x-input default
    // applies: 32 tokens x $10/1M = 320 micros (vs 200 at the 5-min rate).
    let usage = response.usage.expect("usage should parse");
    assert_eq!(usage.cost.cache_write, 320);
    assert_eq!(usage.cost.total, 2_170);
}

#[tokio::test]
async fn unknown_pricing_yields_zero_cost_not_an_error() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        json!({
            "choices": [{
                "finish_reason": "stop",
                "message": {"content": "done", "tool_calls": null}
            }],
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "total_tokens": 150
            }
        })
        .to_string(),
    )]);
    // "test-model" resolves through the provider default: zero (unknown)
    // rates.
    let client = test_model_client(
        BackendKind::DeepSeekChat,
        server.base_url.clone(),
        std::collections::BTreeMap::new(),
    );
    assert_eq!(
        client.resolved_model.cost,
        catalog::ModelCostRates::default()
    );

    let response = client
        .send_turn(
            vec![Message::User {
                content: "hi".to_string(),
            }],
            vec![],
        )
        .await
        .expect("deepseek response should parse");
    server.finish();

    let usage = response.usage.expect("usage should parse");
    assert_eq!(usage.input_tokens, 100);
    assert_eq!(usage.cost, TokenCostMicros::default());
}
