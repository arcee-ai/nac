use std::net::SocketAddr;
use anyhow::Result;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

mod podman;
mod session;

use session::{Session, SessionStore};

#[derive(Clone)]
struct AppState {
    sessions: SessionStore,
    api_key: String,
    default_image: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    podman::check_available().await?;

    let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
    let default_image = std::env::var("NAC_DEFAULT_IMAGE").unwrap_or_else(|_| "nac:base".to_string());
    let port: u16 = std::env::var("NAC_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000);

    let state = AppState {
        sessions: session::new_store(),
        api_key,
        default_image,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/sessions", post(create_session))
        .route("/sessions/{id}/message", post(send_message))
        .route("/sessions/{id}", delete(delete_session))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    eprintln!("nacserver listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({"status": "ok"}))
}

#[derive(Deserialize)]
struct CreateSessionRequest {
    repo_url: Option<String>,
    image: Option<String>,
}

#[derive(Serialize)]
struct CreateSessionResponse {
    session_id: String,
    status: String,
}

async fn create_session(
    State(state): State<AppState>,
    Json(req): Json<CreateSessionRequest>,
) -> Result<(StatusCode, Json<CreateSessionResponse>), (StatusCode, String)> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let container_name = format!("nac-{}", &session_id[..8]);
    let image = req.image.unwrap_or(state.default_image.clone());

    let workspace = std::env::temp_dir().join(format!("nac-workspace-{}", &session_id[..8]));
    std::fs::create_dir_all(&workspace)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("workspace: {}", e)))?;

    if let Some(ref repo_url) = req.repo_url {
        let output = tokio::process::Command::new("git")
            .args(["clone", repo_url, "."])
            .current_dir(&workspace)
            .output()
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("git: {}", e)))?;
        if !output.status.success() {
            let _ = std::fs::remove_dir_all(&workspace);
            return Err((StatusCode::INTERNAL_SERVER_ERROR,
                format!("git clone failed: {}", String::from_utf8_lossy(&output.stderr))));
        }
    }

    podman::run_container(&container_name, &image, &workspace, &state.api_key)
        .await
        .map_err(|e| {
            let _ = std::fs::remove_dir_all(&workspace);
            (StatusCode::INTERNAL_SERVER_ERROR, format!("container: {}", e))
        })?;

    let session = Session {
        container_name,
        workspace_path: workspace,
        image,
        repo_url: req.repo_url,
        created_at: std::time::Instant::now(),
    };
    state.sessions.lock().await.insert(session_id.clone(), session);

    Ok((StatusCode::CREATED, Json(CreateSessionResponse {
        session_id,
        status: "running".to_string(),
    })))
}

#[derive(Deserialize)]
struct MessageRequest {
    prompt: String,
}

#[derive(Serialize)]
struct MessageResponse {
    response: String,
    stderr: String,
    exit_code: i32,
}

async fn send_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<MessageRequest>,
) -> Result<Json<MessageResponse>, (StatusCode, String)> {
    let sessions = state.sessions.lock().await;
    let session = sessions.get(&id)
        .ok_or((StatusCode::NOT_FOUND, format!("session '{}' not found", id)))?;

    let result = podman::exec_in_container(&session.container_name, &req.prompt)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("exec: {}", e)))?;

    Ok(Json(MessageResponse {
        response: result.stdout,
        stderr: result.stderr,
        exit_code: result.exit_code,
    }))
}

async fn delete_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let mut sessions = state.sessions.lock().await;
    let session = sessions.remove(&id)
        .ok_or((StatusCode::NOT_FOUND, format!("session '{}' not found", id)))?;

    let _ = podman::remove_container(&session.container_name).await;
    let _ = std::fs::remove_dir_all(&session.workspace_path);
    Ok(StatusCode::NO_CONTENT)
}
