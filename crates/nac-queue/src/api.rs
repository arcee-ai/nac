//! REST API handlers for the nac-queue server.
//!
//! Endpoints:
//! - `POST /launch`   — start the pipeline
//! - `GET  /state`    — full pipeline state snapshot
//! - `GET  /events`   — SSE stream of state change events
//! - `POST /stop`     — stop the pipeline
//! - `GET  /task/{id}`— individual task details

use std::convert::Infallible;
use std::time::Duration;

use async_stream::stream;
use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Json, Response,
    },
};
use serde::Deserialize;
use tokio::sync::broadcast::error::RecvError;
use tracing::warn;

use crate::nac_client::NacWebClient;
use crate::types::PipelineStatus;
use crate::AppState;

// Embedded static assets.
const APP_CSS: &str = include_str!("../assets/app.css");
const APP_JS: &str = include_str!("../assets/app.js");

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

/// Body for `POST /launch`.
#[derive(Debug, Deserialize)]
pub struct LaunchRequest {
    pub cwd: String,
    pub concurrent_agents: usize,
    pub goal: String,
}

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

/// Build a JSON error response with a given status code.
fn error_response(status: StatusCode, message: impl Into<String>) -> Response {
    (
        status,
        Json(serde_json::json!({ "error": message.into() })),
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// `POST /launch` — start the pipeline.
pub async fn launch(
    State(app): State<AppState>,
    Json(req): Json<LaunchRequest>,
) -> Response {
    // 1. Check that the pipeline is not already running.
    let snapshot = app.pipeline.get_snapshot().await;
    if snapshot.status != PipelineStatus::Idle {
        return error_response(StatusCode::CONFLICT, "pipeline is already running");
    }

    // 2. Check that nac-web is reachable.
    let client = NacWebClient::new(&app.nac_web_url);
    match client.check_health().await {
        Ok(true) => {}
        Ok(false) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                format!("nac-web server is not reachable at {}", app.nac_web_url),
            );
        }
        Err(e) => {
            warn!("nac-web health check failed: {e}");
            return error_response(
                StatusCode::BAD_REQUEST,
                format!("nac-web server is not reachable at {}", app.nac_web_url),
            );
        }
    }

    // 3. Start the pipeline state.
    app
        .pipeline
        .start(req.goal, req.cwd, req.concurrent_agents)
        .await;

    // 4. Spawn the pipeline orchestration task.
    let pipeline = app.pipeline.clone();
    let nac_web_url = app.nac_web_url.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::pipeline::run_pipeline(pipeline, nac_web_url).await {
            tracing::error!("pipeline task ended with error: {e}");
        }
    });

    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "status": "started" })),
    )
        .into_response()
}

/// `GET /state` — return the full pipeline state snapshot.
pub async fn get_state(State(app): State<AppState>) -> Response {
    let snapshot = app.pipeline.get_snapshot().await;
    Json(snapshot).into_response()
}

/// `GET /events` — SSE stream of state change events.
pub async fn events(
    State(app): State<AppState>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let mut rx = app.pipeline.subscribe();

    let event_stream = stream! {
        loop {
            match rx.recv().await {
                Ok(state_event) => {
                    let data = serde_json::to_string(&state_event)
                        .unwrap_or_else(|e| {
                            serde_json::json!({ "error": format!("serialize error: {e}") })
                                .to_string()
                        });
                    yield Ok(Event::default()
                        .event("state_event")
                        .data(data));
                }
                Err(RecvError::Lagged(count)) => {
                    let payload = serde_json::json!({ "missed": count });
                    let data = payload.to_string();
                    yield Ok(Event::default()
                        .event("lagged")
                        .data(data));
                }
                Err(RecvError::Closed) => {
                    break;
                }
            }
        }
    };

    Sse::new(event_stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

/// `POST /stop` — stop the pipeline.
pub async fn stop(State(app): State<AppState>) -> Response {
    let snapshot = app.pipeline.get_snapshot().await;
    if snapshot.status == PipelineStatus::Idle {
        return error_response(StatusCode::CONFLICT, "pipeline is not running");
    }

    app.pipeline.stop().await;

    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "status": "stopping" })),
    )
        .into_response()
}

/// `GET /task/{id}` — get a single task by ID.
pub async fn get_task(
    State(app): State<AppState>,
    AxumPath(task_id): AxumPath<String>,
) -> Response {
    let snapshot = app.pipeline.get_snapshot().await;
    match snapshot.all_tasks.get(&task_id) {
        Some(task) => Json(task).into_response(),
        None => error_response(StatusCode::NOT_FOUND, "task not found"),
    }
}

/// `GET /assets/app.css` — embedded stylesheet.
pub async fn app_css() -> Response {
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "text/css; charset=utf-8")],
        APP_CSS,
    )
        .into_response()
}

/// `GET /assets/app.js` — embedded client-side JavaScript.
pub async fn app_js() -> Response {
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
        APP_JS,
    )
        .into_response()
}