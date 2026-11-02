//! Thin adapters over passive application observations. Existing router guards apply.
use super::presentation_bootstrap::PresentationBinding;
use crate::application::product_context::{
    ProductContext, ProductContextApplication, ProductNavigationRequest,
    ProductNavigationResolution,
};
use crate::{ApiError, SessionManager};
use axum::{
    extract::{Query, State},
    Extension, Json,
};
use serde::Deserialize;
use utoipa::IntoParams;

#[derive(Deserialize, IntoParams)]
#[serde(deny_unknown_fields)]
pub(crate) struct ContextQuery {
    session_id: Option<String>,
}

#[utoipa::path(get, path = "/product-context", operation_id = "get_product_context", params(ContextQuery, ("X-NAC-Presentation-Incarnation" = Option<String>, Header, description = "Optional standalone presentation lifetime fence; grants no authority")),
    responses((status = 200, description = "Sanitized passive product facts", body = ProductContext),
    (status = 404, description = "Context unavailable", body = crate::ApiErrorBody)))]
pub(super) async fn read(
    State(manager): State<SessionManager>,
    Query(query): Query<ContextQuery>,
    Extension(presentation): Extension<PresentationBinding>,
    headers: axum::http::HeaderMap,
) -> Result<
    (
        [(axum::http::HeaderName, &'static str); 1],
        Json<ProductContext>,
    ),
    ApiError,
> {
    if !presentation.matches_product_request(&headers) {
        return Err(ApiError::new(
            axum::http::StatusCode::NOT_FOUND,
            "Product context unavailable; presentation changed".into(),
        ));
    }
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

#[utoipa::path(post, path = "/product-destinations/resolve", operation_id = "resolve_product_destination", params(("X-NAC-Presentation-Incarnation" = Option<String>, Header, description = "Optional standalone presentation lifetime fence; grants no authority")), request_body = ProductNavigationRequest,
    responses((status = 200, description = "Validated logical destination; no browser action", body = ProductNavigationResolution),
    (status = 400, description = "Destination unavailable or stale", body = crate::ApiErrorBody)))]
pub(super) async fn resolve(
    State(manager): State<SessionManager>,
    Extension(presentation): Extension<PresentationBinding>,
    headers: axum::http::HeaderMap,
    Json(request): Json<ProductNavigationRequest>,
) -> Result<Json<ProductNavigationResolution>, ApiError> {
    if !presentation.matches_product_request(&headers) {
        return Err(ApiError::bad_request(
            "Destination unavailable; presentation changed".into(),
        ));
    }
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

#[cfg(test)]
mod incarnation_tests {
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn product_requests_are_fenced_by_the_exact_bootstrapped_serving_incarnation() {
        let root =
            std::env::temp_dir().join(format!("nac-context-incarnation-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let _env = crate::tests::ScopedModelEnv::isolated(&root.join("nac-home"), None);
        crate::tests::seed_direct_session(&root, "current");
        let manager = crate::tests::test_manager(&root);
        let first = crate::router(manager.clone());
        let html = first
            .clone()
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let html = String::from_utf8(
            to_bytes(html.into_body(), 64 * 1024)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        let data = html
            .split("id=\"nac-presentation-binding\" type=\"application/json\">")
            .nth(1)
            .unwrap()
            .split("</script>")
            .next()
            .unwrap();
        let data: serde_json::Value = serde_json::from_str(data).unwrap();
        let incarnation = data["scope"]["incarnation"].as_str().unwrap();
        let read = || {
            Request::builder()
                .uri("/product-context?session_id=current")
                .header("x-nac-presentation-incarnation", incarnation)
                .body(Body::empty())
                .unwrap()
        };
        assert_eq!(
            first.oneshot(read()).await.unwrap().status(),
            StatusCode::OK
        );
        // Same build, manager, store and session; only the serving router changed.
        let replacement = crate::router(manager.clone());
        assert_eq!(
            replacement.clone().oneshot(read()).await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
        let destination = serde_json::json!({"destination":"mcp-settings", "session_id":"current", "expected_build_id":crate::build_identity::current().build_id});
        let stale = replacement
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/product-destinations/resolve")
                    .header("x-nac-presentation-incarnation", incarnation)
                    .header("content-type", "application/json")
                    .body(Body::from(destination.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(stale.status(), StatusCode::BAD_REQUEST);
        let headless = replacement
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/product-destinations/resolve")
                    .header("content-type", "application/json")
                    .body(Body::from(destination.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(headless.status(), StatusCode::OK);
        let value: serde_json::Value =
            serde_json::from_slice(&to_bytes(headless.into_body(), 64 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(value["opened"], false);
        assert!(manager.inner.active_sessions.read().await.is_empty());
        drop(manager);
        std::fs::remove_dir_all(root).unwrap();
    }
}
