//! Thin adapters over passive application observations. Existing router guards apply.
use crate::application::product_context::{
    ProductContext, ProductContextApplication, ProductNavigationRequest,
    ProductNavigationResolution,
};
use crate::{ApiError, SessionManager};
use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;
use utoipa::IntoParams;

#[derive(Deserialize, IntoParams)]
#[serde(deny_unknown_fields)]
pub(crate) struct ContextQuery {
    session_id: Option<String>,
}

#[utoipa::path(get, path = "/product-context", operation_id = "get_product_context", params(ContextQuery),
    responses((status = 200, description = "Sanitized passive product facts", body = ProductContext),
    (status = 404, description = "Context unavailable", body = crate::ApiErrorBody)))]
pub(crate) async fn read(
    State(manager): State<SessionManager>,
    Query(query): Query<ContextQuery>,
) -> Result<
    (
        [(axum::http::HeaderName, &'static str); 1],
        Json<ProductContext>,
    ),
    ApiError,
> {
    ProductContextApplication::new(manager)
        .read(query.session_id.as_deref())
        .await
        .map(|context| {
            (
                [(axum::http::header::CACHE_CONTROL, "no-store")],
                Json(context),
            )
        })
        .map_err(|_| {
            ApiError::new(
                axum::http::StatusCode::NOT_FOUND,
                "Product context unavailable".into(),
            )
        })
}

#[utoipa::path(post, path = "/product-destinations/resolve", operation_id = "resolve_product_destination", request_body = ProductNavigationRequest,
    responses((status = 200, description = "Validated logical destination; no browser action", body = ProductNavigationResolution),
    (status = 400, description = "Destination unavailable or stale", body = crate::ApiErrorBody)))]
pub(crate) async fn resolve(
    State(manager): State<SessionManager>,
    Json(request): Json<ProductNavigationRequest>,
) -> Result<Json<ProductNavigationResolution>, ApiError> {
    ProductContextApplication::new(manager)
        .resolve(request)
        .await
        .map(Json)
        .map_err(|_| {
            ApiError::bad_request(
                "Destination unavailable or stale; inspect product context again".into(),
            )
        })
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn delivery_is_passive_private_and_keeps_origin_and_host_guards() {
        let root = std::env::temp_dir().join(format!("nac-context-http-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let _env = crate::tests::ScopedModelEnv::isolated(&root.join("nac-home"), None);
        crate::tests::seed_direct_session(&root, "current");
        let manager = crate::tests::test_manager(&root);
        let app = crate::router(manager.clone());
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/product-context?session_id=current")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let json: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 64 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(json["session"]["behavior"], "direct");
        let request = serde_json::json!({"destination":"mcp-settings", "session_id":"current", "expected_build_id":json["build"]["build_id"]});
        let foreign = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/product-destinations/resolve")
                    .header("content-type", "application/json")
                    .header("origin", "https://foreign.invalid")
                    .header("host", "localhost")
                    .body(Body::from(request.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(foreign.status(), StatusCode::FORBIDDEN);
        let forbidden_host = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/product-context")
                    .header("host", "foreign.invalid")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(forbidden_host.status(), StatusCode::FORBIDDEN);
        let missing = app
            .oneshot(
                Request::builder()
                    .uri("/product-context?session_id=other-owner-canary")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
        let text =
            String::from_utf8(to_bytes(missing.into_body(), 4096).await.unwrap().to_vec()).unwrap();
        assert!(!text.contains("other-owner-canary"));
        assert!(manager.inner.active_sessions.read().await.is_empty());
        drop(manager);
        std::fs::remove_dir_all(root).unwrap();
    }
}
