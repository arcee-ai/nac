//! Server-owned presentation policy, captured once when the router is built.
use axum::{Extension, Json};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, ToSchema)]
pub(crate) struct UiConfiguration {
    pub orchestration_enabled: bool,
    pub diagnostic: Option<String>,
}

impl UiConfiguration {
    fn parse(value: Option<&str>) -> Self {
        Self {
            orchestration_enabled: value == Some("1"),
            diagnostic: match value {
                None | Some("0" | "1") => None,
                Some(_) => Some("NAC_ORCHESTRATION must be exactly 1 (enable) or 0 (disable), or unset. Orchestration UI is disabled; correct the setting and restart nac-web.".into()),
            },
        }
    }

    pub(crate) fn from_environment() -> Self {
        let value = std::env::var_os("NAC_ORCHESTRATION");
        let config = Self::parse(
            value
                .as_ref()
                .map(|value| value.to_str().unwrap_or("invalid")),
        );
        if let Some(diagnostic) = &config.diagnostic {
            eprintln!("nac: {diagnostic}");
        }
        config
    }
}

#[utoipa::path(get, path = "/ui-config", operation_id = "get_ui_configuration",
    responses((status = 200, description = "Runtime browser presentation policy", body = UiConfiguration)))]
pub(crate) async fn get_ui_configuration(
    Extension(config): Extension<UiConfiguration>,
) -> (
    [(axum::http::HeaderName, &'static str); 1],
    Json<UiConfiguration>,
) {
    (
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(config),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_numeric_one_enables_orchestration() {
        for value in [
            None,
            Some("0"),
            Some("1"),
            Some("true"),
            Some("enabled"),
            Some(""),
            Some(" 1"),
            Some("01"),
            Some("false"),
        ] {
            let config = UiConfiguration::parse(value);
            assert_eq!(config.orchestration_enabled, value == Some("1"));
            assert_eq!(
                config.diagnostic.is_none(),
                matches!(value, None | Some("0" | "1"))
            );
        }
    }
    #[tokio::test]
    async fn bootstrap_serves_the_captured_policy_without_cache_or_health_coupling() {
        use axum::{
            body::{to_bytes, Body},
            http::Request,
            routing::get,
            Router,
        };
        use tower::ServiceExt;
        for value in [None, Some("0"), Some("1"), Some("enabled")] {
            let config = UiConfiguration::parse(value);
            let app = Router::new()
                .route("/ui-config", get(get_ui_configuration))
                .layer(Extension(config.clone()));
            let response = app
                .oneshot(
                    Request::builder()
                        .uri("/ui-config")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), axum::http::StatusCode::OK);
            assert_eq!(
                response.headers()[axum::http::header::CACHE_CONTROL],
                "no-store"
            );
            let body = to_bytes(response.into_body(), 4096).await.unwrap();
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
                serde_json::to_value(config).unwrap()
            );
        }
    }
}
