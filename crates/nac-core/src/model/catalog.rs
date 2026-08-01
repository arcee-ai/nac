//! Provider defaults and model discovery.
//!
//! The launch UI lets a user pick a provider and paste a key instead of hand
//! writing a base URL, so each API-key backend needs a canonical inference URL
//! and a way to turn a key into the list of models it can actually reach.
//! Discovery doubles as key validation: the same request that lists models
//! fails when the key is wrong.

use super::*;

/// Discovery is interactive — the user is watching a spinner — so it gives up
/// well before the generous timeouts used for inference.
const MODEL_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(20);

/// Provider error bodies are echoed back to help diagnose a rejected key, but
/// only far enough to carry the message.
const MAX_PROVIDER_ERROR_BODY: usize = 400;

/// The inference URL used when a provider is chosen by name rather than by URL.
///
/// This is deliberately separate from [`managed_backend_base_url`], which feeds
/// the resolution of an *omitted* base URL and must keep returning `None` for
/// API-key backends so an incomplete configuration still fails loudly.
pub fn provider_default_base_url(backend: BackendKind) -> Option<&'static str> {
    match backend {
        BackendKind::OpenAiResponses => Some("https://api.openai.com/v1"),
        BackendKind::AnthropicMessages => Some("https://api.anthropic.com"),
        BackendKind::DeepSeekChat => Some("https://api.deepseek.com/v1"),
        BackendKind::FireworksChat => Some("https://api.fireworks.ai/inference/v1"),
        BackendKind::TogetherChat => Some("https://api.together.xyz/v1"),
        BackendKind::ArceeApi | BackendKind::ArceeAuth => Some(ARCEE_AUTH_CANONICAL_BASE_URL),
        BackendKind::ChatGptCodexResponses => Some(CHATGPT_CODEX_CANONICAL_BASE_URL),
    }
}

/// Whether the provider authenticates with a user-supplied API key rather than
/// a stored login.
pub fn provider_uses_api_key(backend: BackendKind) -> bool {
    backend::api_key_backend(backend)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProviderModel {
    pub id: String,
    pub display_name: Option<String>,
}

/// Where a backend lists the models a key may use.
///
/// Anthropic mounts its REST surface under `/v1`, matching how the messages
/// endpoint is built; every other supported provider speaks the OpenAI shape
/// where the base URL already includes any version segment.
fn models_url(backend: BackendKind, base_url: &str) -> Option<String> {
    let trimmed = base_url.trim_end_matches('/');
    match backend {
        BackendKind::AnthropicMessages => Some(format!("{trimmed}/v1/models")),
        BackendKind::OpenAiResponses
        | BackendKind::DeepSeekChat
        | BackendKind::FireworksChat
        | BackendKind::TogetherChat
        | BackendKind::ArceeApi => Some(format!("{trimmed}/models")),
        // Codex and managed Arcee logins have no key to validate and no model
        // index to read.
        BackendKind::ChatGptCodexResponses | BackendKind::ArceeAuth => None,
    }
}

fn model_from_value(value: &Value) -> Option<ProviderModel> {
    if let Some(id) = value.as_str() {
        return Some(ProviderModel {
            id: id.to_string(),
            display_name: None,
        });
    }
    let id = value.get("id").and_then(Value::as_str)?;
    Some(ProviderModel {
        id: id.to_string(),
        display_name: value
            .get("display_name")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// Providers disagree on the envelope: OpenAI-compatible APIs wrap the list in
/// `data`, while some return the array on its own.
fn parse_model_list(body: &str) -> Result<Vec<ProviderModel>> {
    let parsed: Value = serde_json::from_str(body)
        .map_err(|error| anyhow!("provider returned a model list that is not JSON: {error}"))?;
    let items = parsed
        .get("data")
        .or_else(|| parsed.get("models"))
        .unwrap_or(&parsed)
        .as_array()
        .ok_or_else(|| anyhow!("provider returned a model list without an array of models"))?;

    let mut models: Vec<ProviderModel> = items.iter().filter_map(model_from_value).collect();
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    Ok(models)
}

fn truncated_body(body: &str) -> String {
    let trimmed = body.trim();
    match trimmed.char_indices().nth(MAX_PROVIDER_ERROR_BODY) {
        Some((index, _)) => format!("{}…", &trimmed[..index]),
        None => trimmed.to_string(),
    }
}

/// Ask a provider which models the key may use.
///
/// The caller is responsible for having approved `base_url` as a credential
/// destination; this function only checks that the URL is a well-formed https
/// endpoint before attaching the key.
pub async fn list_provider_models(
    backend: BackendKind,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<ProviderModel>> {
    let base_url = resolve_model_base_url(backend, Some(base_url.to_string()))?;
    let url = models_url(backend, &base_url).ok_or_else(|| {
        anyhow!("backend '{backend}' authenticates with a stored login and has no model index")
    })?;

    let request = client::no_redirect_model_client()?
        .get(&url)
        .timeout(MODEL_DISCOVERY_TIMEOUT);
    let request = match backend {
        BackendKind::AnthropicMessages => request
            .header("x-api-key", api_key)
            .header("anthropic-version", anthropic::ANTHROPIC_VERSION),
        _ => request.bearer_auth(api_key),
    };

    // Provider hostnames and status codes are safe to surface; the request
    // itself is never echoed, because it carries the key.
    let response = request
        .send()
        .await
        .map_err(|error| anyhow!("could not reach the provider at {base_url}: {error}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(anyhow!("the provider rejected this API key ({status})"));
    }
    if !status.is_success() {
        return Err(anyhow!(
            "the provider returned {status} for the model list: {}",
            truncated_body(&body)
        ));
    }

    let models = parse_model_list(&body)?;
    if models.is_empty() {
        return Err(anyhow!("the provider returned an empty model list"));
    }
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    use serde_json::json;

    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    const ALL_BACKENDS: [BackendKind; 8] = [
        BackendKind::OpenAiResponses,
        BackendKind::ChatGptCodexResponses,
        BackendKind::AnthropicMessages,
        BackendKind::DeepSeekChat,
        BackendKind::FireworksChat,
        BackendKind::TogetherChat,
        BackendKind::ArceeAuth,
        BackendKind::ArceeApi,
    ];

    /// Restates the classification the launch UI depends on. A new backend has
    /// to be triaged here, because the match below stops compiling without it.
    fn expects_api_key(backend: BackendKind) -> bool {
        match backend {
            BackendKind::OpenAiResponses
            | BackendKind::AnthropicMessages
            | BackendKind::DeepSeekChat
            | BackendKind::FireworksChat
            | BackendKind::TogetherChat
            | BackendKind::ArceeApi => true,
            BackendKind::ChatGptCodexResponses | BackendKind::ArceeAuth => false,
        }
    }

    #[test]
    fn every_backend_offers_a_default_url_the_launch_modal_can_preselect() {
        for backend in ALL_BACKENDS {
            let default = provider_default_base_url(backend)
                .unwrap_or_else(|| panic!("{backend} has no default base URL"));
            assert!(
                default.starts_with("https://"),
                "{backend} defaults to a plaintext URL: {default}"
            );
            resolve_model_base_url(backend, Some(default.to_string()))
                .unwrap_or_else(|error| panic!("{backend} default URL is unusable: {error}"));
        }
    }

    #[test]
    fn only_key_authenticated_backends_expose_a_model_index() {
        for backend in ALL_BACKENDS {
            assert_eq!(
                provider_uses_api_key(backend),
                expects_api_key(backend),
                "{backend} is classified inconsistently"
            );
            let base_url = provider_default_base_url(backend).expect("default base URL");
            assert_eq!(
                models_url(backend, base_url).is_some(),
                expects_api_key(backend),
                "{backend} disagrees on having a model index"
            );
        }
    }

    #[test]
    fn model_index_follows_each_provider_rest_shape() {
        assert_eq!(
            models_url(BackendKind::AnthropicMessages, "https://api.anthropic.com"),
            Some("https://api.anthropic.com/v1/models".to_string())
        );
        assert_eq!(
            models_url(BackendKind::OpenAiResponses, "https://api.openai.com/v1"),
            Some("https://api.openai.com/v1/models".to_string())
        );
        // A pasted URL often carries a trailing slash; it must not double up.
        assert_eq!(
            models_url(BackendKind::TogetherChat, "https://api.together.xyz/v1/"),
            Some("https://api.together.xyz/v1/models".to_string())
        );
        assert_eq!(
            models_url(BackendKind::ChatGptCodexResponses, "https://chatgpt.com"),
            None
        );
    }

    #[test]
    fn model_lists_parse_from_every_envelope_providers_use() {
        let expected = vec![
            ProviderModel {
                id: "a-model".to_string(),
                display_name: None,
            },
            ProviderModel {
                id: "b-model".to_string(),
                display_name: None,
            },
        ];
        let bodies = [
            json!({"data": [{"id": "b-model"}, {"id": "a-model"}]}),
            json!({"models": [{"id": "b-model"}, {"id": "a-model"}]}),
            json!([{"id": "b-model"}, {"id": "a-model"}]),
            json!(["b-model", "a-model"]),
        ];
        for body in bodies {
            assert_eq!(parse_model_list(&body.to_string()).unwrap(), expected);
        }
    }

    #[test]
    fn model_lists_are_sorted_deduplicated_and_keep_display_names() {
        let body = json!({
            "data": [
                {"id": "zeta", "display_name": "Zeta"},
                {"id": "alpha"},
                {"id": "zeta"},
                {"unnamed": true},
            ]
        });

        let models = parse_model_list(&body.to_string()).unwrap();

        assert_eq!(
            models,
            vec![
                ProviderModel {
                    id: "alpha".to_string(),
                    display_name: None,
                },
                ProviderModel {
                    id: "zeta".to_string(),
                    display_name: Some("Zeta".to_string()),
                },
            ]
        );
    }

    #[test]
    fn unusable_model_lists_are_reported_rather_than_silently_empty() {
        let error = parse_model_list("not json at all").unwrap_err().to_string();
        assert!(error.contains("not JSON"), "unexpected error: {error}");

        let error = parse_model_list(&json!({"data": {"id": "x"}}).to_string())
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("without an array"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn long_error_bodies_are_truncated_without_splitting_a_character() {
        let short = truncated_body("  provider said no  ");
        assert_eq!(short, "provider said no");

        // Multibyte input would panic if the cut were made at a byte offset.
        let long = truncated_body(&"ą".repeat(MAX_PROVIDER_ERROR_BODY + 50));
        assert_eq!(long.chars().count(), MAX_PROVIDER_ERROR_BODY + 1);
        assert!(long.ends_with('…'));
    }

    #[tokio::test]
    async fn discovery_authenticates_with_a_bearer_token_and_returns_the_models() {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            json!({"data": [{"id": "gpt-5.5"}, {"id": "gpt-5.5-mini"}]}).to_string(),
        )]);

        let models =
            list_provider_models(BackendKind::OpenAiResponses, &server.base_url, "sk-test")
                .await
                .expect("the model list should parse");
        let requests = server.finish();

        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec!["gpt-5.5", "gpt-5.5-mini"]
        );
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, "GET");
        assert_eq!(requests[0].path, "/models");
        assert_eq!(
            requests[0].headers.get("authorization").map(String::as_str),
            Some("Bearer sk-test")
        );
    }

    #[tokio::test]
    async fn anthropic_discovery_uses_its_own_key_header_and_api_version() {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            json!({"data": [{"id": "claude-4", "display_name": "Claude 4"}]}).to_string(),
        )]);

        let models =
            list_provider_models(BackendKind::AnthropicMessages, &server.base_url, "ant-test")
                .await
                .expect("the model list should parse");
        let requests = server.finish();

        assert_eq!(models[0].display_name.as_deref(), Some("Claude 4"));
        assert_eq!(requests[0].path, "/v1/models");
        assert_eq!(
            requests[0].headers.get("x-api-key").map(String::as_str),
            Some("ant-test")
        );
        assert_eq!(
            requests[0]
                .headers
                .get("anthropic-version")
                .map(String::as_str),
            Some(anthropic::ANTHROPIC_VERSION)
        );
        assert!(
            !requests[0].headers.contains_key("authorization"),
            "the bearer header must not be sent alongside x-api-key"
        );
    }

    #[tokio::test]
    async fn a_refused_key_is_reported_as_a_rejection_not_as_a_provider_fault() {
        for status in ["401 Unauthorized", "403 Forbidden"] {
            let server = ScriptedServer::start(vec![ScriptedResponse::json(
                status,
                json!({"error": {"message": "invalid api key"}}).to_string(),
            )]);

            let error =
                list_provider_models(BackendKind::OpenAiResponses, &server.base_url, "sk-wrong")
                    .await
                    .expect_err("a refused key must not resolve");
            server.finish();

            let message = error.to_string();
            assert!(
                message.contains("rejected this API key"),
                "unexpected error for {status}: {message}"
            );
            assert!(
                !message.contains("sk-wrong"),
                "the key leaked into the error: {message}"
            );
        }
    }

    #[tokio::test]
    async fn other_provider_failures_carry_the_status_and_the_body() {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "500 Internal Server Error",
            "upstream exploded",
        )]);

        let error = list_provider_models(BackendKind::DeepSeekChat, &server.base_url, "key")
            .await
            .expect_err("a failed lookup must not resolve");
        server.finish();

        let message = error.to_string();
        assert!(message.contains("500"), "unexpected error: {message}");
        assert!(
            message.contains("upstream exploded"),
            "unexpected error: {message}"
        );
    }

    #[tokio::test]
    async fn an_empty_model_list_is_treated_as_a_failed_lookup() {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            json!({"data": []}).to_string(),
        )]);

        let error = list_provider_models(BackendKind::TogetherChat, &server.base_url, "key")
            .await
            .expect_err("an empty list gives the user nothing to pick");
        server.finish();

        assert!(error.to_string().contains("empty model list"));
    }

    #[tokio::test]
    async fn stored_login_backends_are_refused_before_any_request() {
        let error = list_provider_models(
            BackendKind::ArceeAuth,
            ARCEE_AUTH_CANONICAL_BASE_URL,
            "unused",
        )
        .await
        .expect_err("a stored login has no key to validate");

        assert!(error.to_string().contains("stored login"));
    }
}
