use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Instant;
use anyhow::Result;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use tower_http::cors::CorsLayer;

mod podman;
mod task;

use task::{Task, TaskStatus, TaskStore};

#[derive(Clone)]
struct AppState {
    tasks: TaskStore,
    api_key: String,
    base_url: String,
    model: String,
    default_image: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    podman::check_available().await?;

    let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
    let base_url = std::env::var("OPENAI_BASE_URL").unwrap_or_default();
    let model = std::env::var("OPENAI_MODEL").unwrap_or_default();
    let default_image = std::env::var("NAC_DEFAULT_IMAGE").unwrap_or_else(|_| "nac:base".to_string());
    let port: u16 = std::env::var("NAC_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000);

    let state = AppState {
        tasks: task::open_store()?,
        api_key,
        base_url,
        model,
        default_image,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/tasks", post(create_task))
        .route("/tasks/{id}", get(get_task))
        .route("/tasks/{id}", delete(kill_task))
        .layer(CorsLayer::permissive())
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
struct CreateTaskRequest {
    prompt: String,
    repo_url: Option<String>,
    branch: Option<String>,
    image: Option<String>,
    parent_task_id: Option<String>,
}

async fn create_task(
    State(state): State<AppState>,
    Json(req): Json<CreateTaskRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, String)> {
    let task_id = uuid::Uuid::new_v4().to_string();
    let container_name = format!("nac-{}", &task_id[..8]);
    let image = req.image.unwrap_or(state.default_image.clone());
    let source_branch = req.branch.unwrap_or_else(|| "main".to_string());
    let task_branch = format!("nac/task-{}", &task_id[..8]);

    let mut context = String::new();
    if let Some(ref parent_id) = req.parent_task_id {
        if let Ok(Some(parent)) = task::get(&state.tasks, parent_id).await {
            if let Some(ref output) = parent.output {
                context = format!("Previous work:\n{}\n\n", output);
            }
        }
    }
    let full_prompt = format!("{}{}", context, req.prompt);

    let new_task = Task {
        id: task_id.clone(),
        container_name: container_name.clone(),
        status: TaskStatus::Running,
        prompt: req.prompt.clone(),
        output: None,
        branch: Some(task_branch.clone()),
        parent_task_id: req.parent_task_id.clone(),
    };
    task::insert(&state.tasks, &new_task).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db: {}", e)))?;

    eprintln!("[task] {} created | image={} | prompt={}", &task_id[..8], image, &req.prompt[..req.prompt.len().min(80)]);

    let task_state = state.clone();
    let repo_url = req.repo_url.clone();
    let parent_task_id = req.parent_task_id.clone();
    let spawn_task_id = task_id.clone();
    let spawn_container = container_name.clone();

    tokio::spawn(async move {
        let start = Instant::now();
        let params = TaskParams {
            container_name: &spawn_container,
            image: &image,
            repo_url: repo_url.as_deref(),
            source_branch: &source_branch,
            task_branch: &task_branch,
            parent_task_id: parent_task_id.as_deref(),
            prompt: &full_prompt,
        };
        let result = run_task(&task_state, &params).await;

        let elapsed = start.elapsed().as_secs();
        match result {
            Ok((output, branch)) => {
                let _ = task::update_completed(&task_state.tasks, &spawn_task_id, &output, branch.as_deref()).await;
                eprintln!("[task] {} completed | {}s", &spawn_task_id[..8], elapsed);
            }
            Err(e) => {
                let _ = task::update_failed(&task_state.tasks, &spawn_task_id, &e.to_string()).await;
                eprintln!("[task] {} failed | {}s | {}", &spawn_task_id[..8], elapsed, e);
            }
        }
    });

    Ok((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({"task_id": task_id})),
    ))
}

struct TaskParams<'a> {
    container_name: &'a str,
    image: &'a str,
    repo_url: Option<&'a str>,
    source_branch: &'a str,
    task_branch: &'a str,
    parent_task_id: Option<&'a str>,
    prompt: &'a str,
}

async fn run_task(state: &AppState, p: &TaskParams<'_>) -> Result<(String, Option<String>)> {
    let workspace = std::env::temp_dir().join(format!("nac-task-{}", &uuid::Uuid::new_v4().to_string()[..8]));
    std::fs::create_dir_all(&workspace)?;

    let _cleanup = WorkspaceCleanup(workspace.clone());

    if let Some(url) = p.repo_url {
        let checkout_branch = if p.parent_task_id.is_some() { p.task_branch } else { p.source_branch };
        git_clone(&workspace, url, checkout_branch).await?;
    }

    let mut env_vars: Vec<(&str, &str)> = vec![("OPENAI_API_KEY", &state.api_key)];
    if !state.base_url.is_empty() {
        env_vars.push(("OPENAI_BASE_URL", &state.base_url));
    }
    if !state.model.is_empty() {
        env_vars.push(("OPENAI_MODEL", &state.model));
    }

    let result = podman::run_ephemeral(p.container_name, p.image, &workspace, &env_vars, p.prompt).await?;

    let branch = if p.repo_url.is_some() {
        git_push_changes(&workspace, p.task_branch, &p.prompt[..p.prompt.len().min(72)]).await?
    } else {
        None
    };

    if result.exit_code != 0 && result.stdout.trim().is_empty() {
        anyhow::bail!("nac failed (exit {}):\n{}", result.exit_code, result.stderr);
    }

    Ok((result.stdout, branch))
}

async fn git_clone(workspace: &PathBuf, url: &str, branch: &str) -> Result<()> {
    let output = tokio::process::Command::new("git")
        .args(["clone", "-b", branch, url, "."])
        .current_dir(workspace)
        .output()
        .await?;

    if !output.status.success() {
        let output = tokio::process::Command::new("git")
            .args(["clone", url, "."])
            .current_dir(workspace)
            .output()
            .await?;
        if !output.status.success() {
            anyhow::bail!("git clone failed: {}", String::from_utf8_lossy(&output.stderr));
        }
    }
    Ok(())
}

async fn git_push_changes(workspace: &PathBuf, branch: &str, message: &str) -> Result<Option<String>> {
    let status = tokio::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(workspace)
        .output()
        .await?;

    if status.stdout.is_empty() {
        return Ok(None);
    }

    let commit_msg = format!("nac: {}", message);
    let push_ref = format!("HEAD:{}", branch);

    let commands: Vec<Vec<&str>> = vec![
        vec!["add", "-A"],
        vec!["commit", "-m", &commit_msg],
        vec!["push", "origin", &push_ref],
    ];

    for args in &commands {
        let output = tokio::process::Command::new("git")
            .args(args)
            .current_dir(workspace)
            .output()
            .await?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.contains("nothing to commit") {
                anyhow::bail!("git {} failed: {}", args[0], stderr);
            }
        }
    }

    Ok(Some(branch.to_string()))
}

struct WorkspaceCleanup(PathBuf);
impl Drop for WorkspaceCleanup {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn get_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let t = task::get(&state.tasks, &id).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db: {}", e)))?
        .ok_or((StatusCode::NOT_FOUND, format!("task '{}' not found", id)))?;

    Ok(Json(serde_json::json!({
        "task_id": t.id,
        "status": t.status,
        "prompt": t.prompt,
        "output": t.output,
        "branch": t.branch,
        "parent_task_id": t.parent_task_id,
    })))
}

async fn kill_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let t = task::get(&state.tasks, &id).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db: {}", e)))?
        .ok_or((StatusCode::NOT_FOUND, format!("task '{}' not found", id)))?;

    if matches!(t.status, TaskStatus::Running) {
        let _ = podman::kill_container(&t.container_name).await;
        let _ = task::update_failed(&state.tasks, &id, "killed by user").await;
        eprintln!("[task] {} killed", &id[..id.len().min(8)]);
    }

    Ok(StatusCode::NO_CONTENT)
}
