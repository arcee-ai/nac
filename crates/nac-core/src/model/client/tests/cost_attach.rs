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
async fn one_hour_cache_writes_bill_at_the_one_hour_rate() {
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

fn codex_completion(tier: Option<&str>) -> String {
    let mut response = json!({"status":"completed", "output":[], "usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}});
    if let Some(tier) = tier {
        response["service_tier"] = json!(tier);
    }
    format!(
        "data: {}\n\n",
        json!({"type":"response.completed", "response":response})
    )
}

#[tokio::test]
async fn codex_wire_captures_speed_independent_of_reasoning_and_served_receipt() {
    for effort in [None, Some(ReasoningEffort::High)] {
        for (preference, wire) in [
            (None, None),
            (Some(crate::model::ServiceTier::Standard), None),
            (Some(crate::model::ServiceTier::Fast), Some("priority")),
            (
                Some(crate::model::ServiceTier::Ultrafast),
                Some("ultrafast"),
            ),
        ] {
            let server = ScriptedServer::start(vec![ScriptedResponse::json(
                "200 OK",
                codex_completion(Some("default")),
            )
            .with_header("Content-Type", "text/event-stream")]);
            let mut client =
                ModelClient::new_for_codex_test_server(server.base_url.clone(), "gpt-5.5");
            // Neither an inherited selection nor explicit Standard may inject
            // an account catalog default into the outgoing legacy request.
            client.resolved_model.default_service_tier = Some("priority".into());
            client.service_tier = preference;
            client.reasoning_effort = effort;
            let response = client.send_turn(vec![], vec![]).await.unwrap();
            let requests = server.finish();
            assert_eq!(requests.len(), 1);
            let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
            assert_eq!(body.get("service_tier").and_then(Value::as_str), wire);
            assert_eq!(
                body["reasoning"].get("effort").and_then(Value::as_str),
                effort.map(|value| value.as_str())
            );
            assert_eq!(response.served_service_tier.as_deref(), Some("default"));
            assert_eq!(response.effective_service_tier.as_deref(), wire);
            assert_eq!(
                response.usage.unwrap().speed_tier_charges_excluded,
                wire.is_some()
            );
        }
    }
}

#[tokio::test]
async fn codex_missing_or_unknown_served_tier_stays_unknown_and_warns_for_standard() {
    for reported in [None, Some("future-unrecognized-tier")] {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            codex_completion(reported),
        )
        .with_header("Content-Type", "text/event-stream")]);
        let mut client = ModelClient::new_for_codex_test_server(server.base_url.clone(), "gpt-5.5");
        client.service_tier = Some(crate::model::ServiceTier::Standard);
        let response = client.send_turn(vec![], vec![]).await.unwrap();
        assert_eq!(server.finish().len(), 1);
        assert_eq!(response.served_service_tier, None);
        assert!(response.usage.unwrap().speed_tier_charges_excluded);
    }
}

#[tokio::test]
async fn codex_permanent_tier_denial_does_not_retry_or_fall_back() {
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json(
            "403 Forbidden",
            r#"{"error":{"message":"tier unavailable"}}"#,
        ),
        ScriptedResponse::json("200 OK", codex_completion(Some("default")))
            .with_header("Content-Type", "text/event-stream"),
    ]);
    let mut client = ModelClient::new_for_codex_test_server(server.base_url.clone(), "gpt-5.5");
    client.service_tier = Some(crate::model::ServiceTier::Fast);
    assert!(client.send_turn(vec![], vec![]).await.is_err());
    let requests = server.stop_and_finish();
    assert_eq!(requests.len(), 1);
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(body["service_tier"], "priority");
}

#[test]
fn native_cost_scope_uses_served_tier_and_retains_aggregate_limitations() {
    let mut client = test_model_client(
        BackendKind::OpenAiChatCompletions,
        "test-openai:http://127.0.0.1:1/v1".into(),
        Default::default(),
    );
    client.model = "gpt-5.4".into();
    client.resolved_model = catalog::resolve(BackendKind::OpenAiChatCompletions, "gpt-5.4");
    client.service_tier = Some(crate::model::ServiceTier::Fast);
    let mut combined = None;
    for (tier, excluded) in [
        (Some("default"), false),
        (Some("priority"), true),
        (Some("fast"), true),
        (Some("ultrafast"), true),
        (None, true),
        (Some("unrecognized"), true),
    ] {
        let mut value = json!({"choices":[{"finish_reason":"stop","message":{"content":"ok"}}],"usage":{"prompt_tokens":100,"completion_tokens":10,"total_tokens":110}});
        if let Some(tier) = tier {
            value["service_tier"] = json!(tier);
        }
        let response = client.with_usage_cost(
            crate::model::chat::parse_completions_response(&value, "test", "reasoning_content")
                .unwrap(),
        );
        let usage = response.usage.unwrap();
        assert_eq!(usage.speed_tier_charges_excluded, excluded, "{tier:?}");
        if tier == Some("priority") {
            combined = Some(usage);
        }
    }
    let mut aggregate = combined.unwrap();
    let value = json!({"choices":[{"finish_reason":"stop","message":{"content":"ok"}}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2},"service_tier":"default"});
    let standard = client
        .with_usage_cost(
            crate::model::chat::parse_completions_response(&value, "test", "reasoning_content")
                .unwrap(),
        )
        .usage
        .unwrap();
    aggregate.add_cost_saturating(&standard);
    assert!(aggregate.speed_tier_charges_excluded);
}
