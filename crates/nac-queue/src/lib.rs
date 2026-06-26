mod api;
mod git;
mod pipeline;
mod state;
mod types;

pub use state::{PipelineState, PipelineStateHandle};
pub use types::{
    PlannerResult, PlannerTask, PipelineStatus, QueueType, StateEvent, Task, TaskStatus,
};

pub mod nac_client;

use std::net::SocketAddr;

use anyhow::{Context, Result};
use axum::{
    response::Html,
    routing::{get, post},
    Json, Router,
};
use tower_http::cors::CorsLayer;

const INDEX_HTML: &str = include_str!("../assets/index.html");

/// CLI arguments for the nac-queue server.
#[derive(Debug, Clone)]
pub struct ServerCli {
    /// URL of the running nac-web server.
    pub nac_web_url: String,
    /// Address for nac-queue's own server.
    pub bind: SocketAddr,
}

/// Shared application state.
#[derive(Clone)]
pub struct AppState {
    pub nac_web_url: String,
    pub pipeline: PipelineStateHandle,
}

impl AppState {
    pub fn new(nac_web_url: String) -> Self {
        Self {
            nac_web_url,
            pipeline: PipelineStateHandle::new(),
        }
    }
}

/// Entry point — builds the router and starts the server.
pub async fn serve(cli: ServerCli) -> Result<()> {
    let state = AppState::new(cli.nac_web_url);
    let app = router(state);
    let listener = tokio::net::TcpListener::bind(cli.bind)
        .await
        .with_context(|| format!("failed to bind {}", cli.bind))?;
    axum::serve(listener, app)
        .await
        .context("server stopped unexpectedly")
}

/// Builds the axum router with all routes.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(index_html))
        .route("/health", get(health))
        // Pipeline control API
        .route("/launch", post(api::launch))
        .route("/state", get(api::get_state))
        .route("/events", get(api::events))
        .route("/stop", post(api::stop))
        .route("/task/{id}", get(api::get_task))
        // Static assets
        .route("/assets/app.css", get(api::app_css))
        .route("/assets/app.js", get(api::app_js))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn index_html() -> Html<&'static str> {
    Html(INDEX_HTML)
}