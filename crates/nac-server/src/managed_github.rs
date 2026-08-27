//! Managed GitHub browser authorization and repository discovery HTTP surface.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use axum::Json;
use nac_core::managed_github::{
    GitHubAuthError, GitHubAuthFailureKind, GitHubConnectionStatus, GitHubRepository,
    ManagedGitHubAuth,
};
use serde::Serialize;

use crate::{ApiError, SessionManager};

const COMPLETED_RETENTION: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct GitHubStatusResponse {
    pub configured: bool,
    pub connected: bool,
    pub login: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub organization: Option<String>,
    pub expires_at_ms: Option<u64>,
    pub git_name: Option<String>,
    pub git_email: Option<String>,
    pub git_configured: bool,
}

impl From<GitHubConnectionStatus> for GitHubStatusResponse {
    fn from(status: GitHubConnectionStatus) -> Self {
        Self {
            configured: true,
            connected: status.connected,
            login: status.login,
            name: status.name,
            avatar_url: status.avatar_url,
            organization: status.organization,
            expires_at_ms: status.expires_at_ms,
            git_name: status.git_name,
            git_email: status.git_email,
            git_configured: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct GitIdentityResponse {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, serde::Deserialize, utoipa::ToSchema)]
pub struct UpdateGitIdentityRequest {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct GitHubLoginStartedResponse {
    pub login_id: String,
    pub verification_uri: String,
    pub user_code: String,
    pub expires_in_secs: u64,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum GitHubLoginStateResponse {
    Pending,
    Complete { auth: GitHubStatusResponse },
    Failed { error: String },
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct GitHubRepositoryListResponse {
    pub repositories: Vec<GitHubRepositoryResponse>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct GitHubRepositoryResponse {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub can_read: bool,
    pub can_write: bool,
    pub default_branch: String,
    pub clone_url: String,
    pub html_url: String,
}

impl From<GitHubRepository> for GitHubRepositoryResponse {
    fn from(repository: GitHubRepository) -> Self {
        Self {
            id: repository.id,
            name: repository.name,
            full_name: repository.full_name,
            private: repository.private,
            can_read: repository.can_read,
            can_write: repository.can_write,
            default_branch: repository.default_branch,
            clone_url: repository.clone_url,
            html_url: repository.html_url,
        }
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct GitHubBranchListResponse {
    pub branches: Vec<String>,
}

enum LoginOutcome {
    Pending,
    Complete(GitHubConnectionStatus),
    Failed(String),
}

struct PendingLogin {
    outcome: Arc<StdMutex<LoginOutcome>>,
    task: tokio::task::JoinHandle<()>,
    started: Instant,
    lifetime: Duration,
}

#[derive(Default)]
pub(crate) struct ManagedGitHubLoginRegistry {
    entries: StdMutex<HashMap<String, PendingLogin>>,
}

impl ManagedGitHubLoginRegistry {
    fn insert(&self, id: String, login: PendingLogin) {
        let mut entries = self.entries.lock().expect("managed GitHub login registry");
        entries.insert(id, login);
        let now = Instant::now();
        entries.retain(|_, entry| {
            let finished = !matches!(
                *entry.outcome.lock().expect("managed GitHub login outcome"),
                LoginOutcome::Pending
            );
            let budget = if finished {
                COMPLETED_RETENTION
            } else {
                entry.lifetime
            };
            let keep = now.duration_since(entry.started) <= budget;
            if !keep {
                entry.task.abort();
            }
            keep
        });
    }

    fn take(&self, id: &str) -> Result<GitHubLoginStateResponse, ApiError> {
        let mut entries = self.entries.lock().expect("managed GitHub login registry");
        let entry = entries.get(id).ok_or_else(|| ApiError {
            status: StatusCode::NOT_FOUND,
            message: format!("no GitHub login in progress with id '{id}'"),
        })?;
        let state = match &*entry.outcome.lock().expect("managed GitHub login outcome") {
            LoginOutcome::Pending => None,
            LoginOutcome::Complete(status) => Some(GitHubLoginStateResponse::Complete {
                auth: status.clone().into(),
            }),
            LoginOutcome::Failed(error) => Some(GitHubLoginStateResponse::Failed {
                error: error.clone(),
            }),
        };
        if state.is_some() {
            entries.remove(id);
        }
        Ok(state.unwrap_or(GitHubLoginStateResponse::Pending))
    }

    fn cancel(&self, id: &str) -> bool {
        self.entries
            .lock()
            .expect("managed GitHub login registry")
            .remove(id)
            .map(|entry| entry.task.abort())
            .is_some()
    }
}

impl SessionManager {
    pub(crate) fn managed_github_auth(&self) -> Result<ManagedGitHubAuth, ApiError> {
        self.managed_host()
            .ok_or_else(|| ApiError {
                status: StatusCode::NOT_FOUND,
                message: "Managed NAC is not configured".to_string(),
            })?
            .github_auth()
            .map_err(ApiError::from)
    }

    async fn start_github_login(&self) -> Result<GitHubLoginStartedResponse, ApiError> {
        let pending = self.managed_github_auth()?.begin_device_login().await?;
        let prompt = pending.prompt();
        let outcome = Arc::new(StdMutex::new(LoginOutcome::Pending));
        let task = tokio::spawn({
            let outcome = Arc::clone(&outcome);
            let manager = self.clone();
            async move {
                let result = pending.complete().await;
                *outcome.lock().expect("managed GitHub login outcome") = match result {
                    Ok(status) => match manager.ensure_managed_git_config(&status).await {
                        Ok(_) => LoginOutcome::Complete(status),
                        Err(error) => LoginOutcome::Failed(error.message),
                    },
                    Err(error) => LoginOutcome::Failed(public_github_error(&error)),
                };
            }
        });
        let login_id = uuid::Uuid::new_v4().simple().to_string();
        self.inner.managed_github_logins.insert(
            login_id.clone(),
            PendingLogin {
                outcome,
                task,
                started: Instant::now(),
                lifetime: Duration::from_secs(prompt.expires_in_secs),
            },
        );
        Ok(GitHubLoginStartedResponse {
            login_id,
            verification_uri: prompt.verification_uri,
            user_code: prompt.user_code,
            expires_in_secs: prompt.expires_in_secs,
        })
    }

    async fn ensure_managed_git_config(
        &self,
        status: &GitHubConnectionStatus,
    ) -> Result<GitIdentityResponse, ApiError> {
        let managed = self.managed_host().cloned().ok_or_else(|| ApiError {
            status: StatusCode::NOT_FOUND,
            message: "Managed NAC is not configured".to_string(),
        })?;
        let executable = self.inner.worker_executable.clone();
        let status = status.clone();
        let identity = tokio::task::spawn_blocking(move || {
            configure_git_defaults(&managed, &executable, &status)
        })
        .await
        .map_err(|error| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("managed Git configuration task failed: {error}"),
        })??;
        Ok(identity)
    }

    async fn managed_git_identity(&self) -> Result<Option<GitIdentityResponse>, ApiError> {
        let auth = self.managed_github_auth()?;
        let status = auth.status()?;
        if !status.connected {
            return Ok(None);
        }
        self.ensure_managed_git_config(&status).await.map(Some)
    }
}

fn configure_git_defaults(
    managed: &nac_core::managed::ManagedHostConfig,
    executable: &Path,
    status: &GitHubConnectionStatus,
) -> Result<GitIdentityResponse, ApiError> {
    std::fs::create_dir_all(&managed.home_root).map_err(internal_io_error)?;
    let config_path = managed.home_root.join(".gitconfig");
    let helper = format!(
        "!{} __github-credential --state-root {} --client-id {}",
        shell_quote(executable),
        shell_quote(&managed.state_root),
        shell_quote_text(&managed.github_client_id)
    );
    set_git_config(
        &config_path,
        "credential.https://github.com.helper",
        &helper,
    )?;
    set_git_config(
        &config_path,
        "credential.https://github.com.useHttpPath",
        "false",
    )?;

    let current_name = get_git_config(&config_path, "user.name")?;
    let current_email = get_git_config(&config_path, "user.email")?;
    let name = match current_name {
        Some(name) => name,
        None => {
            let name = status.git_name.as_deref().ok_or_else(|| {
                ApiError::bad_request("GitHub identity has no author name".to_string())
            })?;
            validate_identity("name", name)?;
            set_git_config(&config_path, "user.name", name)?;
            name.to_string()
        }
    };
    let email = match current_email {
        Some(email) => email,
        None => {
            let email = status.git_email.as_deref().ok_or_else(|| {
                ApiError::bad_request("GitHub identity has no author email".to_string())
            })?;
            validate_identity("email", email)?;
            set_git_config(&config_path, "user.email", email)?;
            email.to_string()
        }
    };
    Ok(GitIdentityResponse { name, email })
}

fn update_git_identity(
    config_path: PathBuf,
    request: UpdateGitIdentityRequest,
) -> Result<GitIdentityResponse, ApiError> {
    validate_identity("name", &request.name)?;
    validate_identity("email", &request.email)?;
    if !request.email.contains('@') {
        return Err(ApiError::bad_request(
            "Git author email must contain '@'".to_string(),
        ));
    }
    set_git_config(&config_path, "user.name", request.name.trim())?;
    set_git_config(&config_path, "user.email", request.email.trim())?;
    Ok(GitIdentityResponse {
        name: request.name.trim().to_string(),
        email: request.email.trim().to_string(),
    })
}

fn validate_identity(label: &str, value: &str) -> Result<(), ApiError> {
    let value = value.trim();
    if value.is_empty() || value.len() > 320 || value.chars().any(char::is_control) {
        return Err(ApiError::bad_request(format!(
            "Git author {label} must be nonblank, at most 320 bytes, and contain no control characters"
        )));
    }
    Ok(())
}

fn get_git_config(path: &Path, key: &str) -> Result<Option<String>, ApiError> {
    let output = Command::new("git")
        .args(["config", "--file"])
        .arg(path)
        .args(["--get", key])
        .output()
        .map_err(internal_io_error)?;
    if output.status.success() {
        return Ok(Some(
            String::from_utf8(output.stdout)
                .map_err(|_| {
                    ApiError::bad_request("Git configuration is not valid UTF-8".to_string())
                })?
                .trim_end()
                .to_string(),
        ));
    }
    if output.status.code() == Some(1) {
        return Ok(None);
    }
    Err(ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("git config could not read managed host key '{key}'"),
    })
}

fn set_git_config(path: &Path, key: &str, value: &str) -> Result<(), ApiError> {
    let status = Command::new("git")
        .args(["config", "--file"])
        .arg(path)
        .args([key, value])
        .status()
        .map_err(internal_io_error)?;
    if status.success() {
        Ok(())
    } else {
        Err(ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("git config could not update managed host key '{key}'"),
        })
    }
}

fn shell_quote(path: &Path) -> String {
    shell_quote_text(&path.to_string_lossy())
}

fn shell_quote_text(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn internal_io_error(error: std::io::Error) -> ApiError {
    ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("managed Git configuration failed: {error}"),
    }
}

fn public_github_error(error: &anyhow::Error) -> String {
    if let Some(github) = error.downcast_ref::<GitHubAuthError>() {
        match github.authorization_url() {
            Some(url) => format!("{github} ({url})"),
            None => github.to_string(),
        }
    } else {
        error.to_string()
    }
}

pub(crate) fn map_github_error(error: anyhow::Error) -> ApiError {
    let status = error
        .downcast_ref::<GitHubAuthError>()
        .map(|error| match error.kind() {
            GitHubAuthFailureKind::Reconnect => StatusCode::UNAUTHORIZED,
            GitHubAuthFailureKind::SamlRequired => StatusCode::FORBIDDEN,
            GitHubAuthFailureKind::AppNotInstalled => StatusCode::CONFLICT,
            GitHubAuthFailureKind::Provider => StatusCode::BAD_GATEWAY,
        })
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    ApiError {
        status,
        message: public_github_error(&error),
    }
}

#[utoipa::path(
    get,
    path = "/managed/github",
    operation_id = "get_managed_github",
    tag = "managed",
    responses((status = 200, body = GitHubStatusResponse), (status = 404, body = crate::ApiErrorBody), (status = 500, body = crate::ApiErrorBody))
)]
pub(crate) async fn status_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<GitHubStatusResponse>, ApiError> {
    let mut response: GitHubStatusResponse = manager.managed_github_auth()?.status()?.into();
    if response.connected {
        if let Some(identity) = manager.managed_git_identity().await? {
            response.git_name = Some(identity.name);
            response.git_email = Some(identity.email);
            response.git_configured = true;
        }
    }
    Ok(Json(response))
}

#[utoipa::path(
    post,
    path = "/managed/github/login",
    operation_id = "post_managed_github_login",
    tag = "managed",
    responses((status = 200, body = GitHubLoginStartedResponse), (status = 404, body = crate::ApiErrorBody), (status = 502, body = crate::ApiErrorBody))
)]
pub(crate) async fn start_login_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<GitHubLoginStartedResponse>, ApiError> {
    Ok(Json(manager.start_github_login().await?))
}

#[utoipa::path(
    get,
    path = "/managed/github/login/{login_id}",
    operation_id = "get_managed_github_login_login_id",
    tag = "managed",
    params(("login_id" = String, Path)),
    responses((status = 200, body = GitHubLoginStateResponse), (status = 404, body = crate::ApiErrorBody))
)]
pub(crate) async fn poll_login_handler(
    State(manager): State<SessionManager>,
    AxumPath(login_id): AxumPath<String>,
) -> Result<Json<GitHubLoginStateResponse>, ApiError> {
    manager.managed_github_auth()?;
    Ok(Json(manager.inner.managed_github_logins.take(&login_id)?))
}

#[utoipa::path(
    delete,
    path = "/managed/github/login/{login_id}",
    operation_id = "delete_managed_github_login_login_id",
    tag = "managed",
    params(("login_id" = String, Path)),
    responses((status = 204), (status = 404, body = crate::ApiErrorBody))
)]
pub(crate) async fn cancel_login_handler(
    State(manager): State<SessionManager>,
    AxumPath(login_id): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    manager.managed_github_auth()?;
    if manager.inner.managed_github_logins.cancel(&login_id) {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError {
            status: StatusCode::NOT_FOUND,
            message: format!("no GitHub login in progress with id '{login_id}'"),
        })
    }
}

#[utoipa::path(
    delete,
    path = "/managed/github",
    operation_id = "delete_managed_github",
    tag = "managed",
    responses((status = 200, body = GitHubStatusResponse), (status = 404, body = crate::ApiErrorBody))
)]
pub(crate) async fn disconnect_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<GitHubStatusResponse>, ApiError> {
    let auth = manager.managed_github_auth()?;
    auth.disconnect()?;
    Ok(Json(auth.status()?.into()))
}

#[utoipa::path(
    get,
    path = "/managed/github/repositories",
    operation_id = "get_managed_github_repositories",
    tag = "managed",
    responses((status = 200, body = GitHubRepositoryListResponse), (status = 401, body = crate::ApiErrorBody), (status = 403, body = crate::ApiErrorBody), (status = 404, body = crate::ApiErrorBody), (status = 409, body = crate::ApiErrorBody), (status = 502, body = crate::ApiErrorBody))
)]
pub(crate) async fn repositories_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<GitHubRepositoryListResponse>, ApiError> {
    let repositories = manager
        .managed_github_auth()?
        .repositories()
        .await
        .map_err(map_github_error)?
        .into_iter()
        .map(Into::into)
        .collect();
    Ok(Json(GitHubRepositoryListResponse { repositories }))
}

#[utoipa::path(
    get,
    path = "/managed/github/repositories/{owner}/{repository}/branches",
    operation_id = "get_managed_github_repository_branches",
    tag = "managed",
    params(("owner" = String, Path), ("repository" = String, Path)),
    responses((status = 200, body = GitHubBranchListResponse), (status = 400, body = crate::ApiErrorBody), (status = 401, body = crate::ApiErrorBody), (status = 403, body = crate::ApiErrorBody), (status = 404, body = crate::ApiErrorBody), (status = 502, body = crate::ApiErrorBody))
)]
pub(crate) async fn branches_handler(
    State(manager): State<SessionManager>,
    AxumPath((owner, repository)): AxumPath<(String, String)>,
) -> Result<Json<GitHubBranchListResponse>, ApiError> {
    let branches = manager
        .managed_github_auth()?
        .branches(&owner, &repository)
        .await
        .map_err(map_github_error)?;
    Ok(Json(GitHubBranchListResponse { branches }))
}

#[utoipa::path(
    get,
    path = "/managed/github/git-identity",
    operation_id = "get_managed_github_git_identity",
    tag = "managed",
    responses((status = 200, body = GitIdentityResponse), (status = 401, body = crate::ApiErrorBody), (status = 404, body = crate::ApiErrorBody))
)]
pub(crate) async fn git_identity_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<GitIdentityResponse>, ApiError> {
    manager
        .managed_git_identity()
        .await?
        .map(Json)
        .ok_or_else(|| ApiError {
            status: StatusCode::UNAUTHORIZED,
            message: "GitHub is not connected; connect GitHub".to_string(),
        })
}

#[utoipa::path(
    put,
    path = "/managed/github/git-identity",
    operation_id = "put_managed_github_git_identity",
    tag = "managed",
    request_body(content = UpdateGitIdentityRequest, content_type = "application/json"),
    responses((status = 200, body = GitIdentityResponse), (status = 400, body = crate::ApiErrorBody), (status = 401, body = crate::ApiErrorBody), (status = 404, body = crate::ApiErrorBody))
)]
pub(crate) async fn update_git_identity_handler(
    State(manager): State<SessionManager>,
    Json(request): Json<UpdateGitIdentityRequest>,
) -> Result<Json<GitIdentityResponse>, ApiError> {
    if !manager.managed_github_auth()?.status()?.connected {
        return Err(ApiError {
            status: StatusCode::UNAUTHORIZED,
            message: "GitHub is not connected; connect GitHub".to_string(),
        });
    }
    let config_path = manager
        .managed_host()
        .expect("managed auth requires managed config")
        .home_root
        .join(".gitconfig");
    let identity = tokio::task::spawn_blocking(move || update_git_identity(config_path, request))
        .await
        .map_err(|error| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("managed Git identity task failed: {error}"),
        })??;
    Ok(Json(identity))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn managed_config(root: &Path) -> nac_core::managed::ManagedHostConfig {
        let config = nac_core::managed::ManagedHostConfig {
            version: nac_core::managed::MANAGED_CONFIG_VERSION,
            logical_host_id: "git-config-test".to_string(),
            owner: Some("owner@example.test".to_string()),
            public_hostname: "nac.example.test".to_string(),
            repository_root: root.join("repositories"),
            state_root: root.join("state"),
            home_root: root.join("home"),
            github_client_id: "Iv1.test".to_string(),
            model_endpoint: "https://models.example.test/v1".to_string(),
            model_credential_file: root.join("model-token"),
            model_credential_environment_names: Vec::new(),
        };
        for path in [
            &config.repository_root,
            &config.state_root,
            &config.home_root,
        ] {
            std::fs::create_dir_all(path).unwrap();
        }
        config.validate().unwrap();
        config
    }

    fn connected_status(name: &str, email: &str) -> GitHubConnectionStatus {
        GitHubConnectionStatus {
            connected: true,
            login: Some("octocat".to_string()),
            name: Some("Octo Cat".to_string()),
            avatar_url: None,
            organization: Some("arcee-ai".to_string()),
            expires_at_ms: Some(u64::MAX),
            git_name: Some(name.to_string()),
            git_email: Some(email.to_string()),
        }
    }

    #[test]
    fn git_defaults_are_scoped_preserve_user_edits_and_never_contain_tokens() {
        let root = std::env::temp_dir().join(format!(
            "nac-managed-git-config-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let managed = managed_config(&root);
        let executable = std::env::current_exe().unwrap();
        let identity = configure_git_defaults(
            &managed,
            &executable,
            &connected_status("Octo Cat", "42+octocat@users.noreply.github.com"),
        )
        .unwrap();
        assert_eq!(identity.name, "Octo Cat");
        assert_eq!(identity.email, "42+octocat@users.noreply.github.com");

        let config_path = managed.home_root.join(".gitconfig");
        let helper = get_git_config(&config_path, "credential.https://github.com.helper")
            .unwrap()
            .unwrap();
        assert!(helper.contains("__github-credential"));
        assert!(helper.contains(&managed.state_root.display().to_string()));
        assert!(get_git_config(&config_path, "credential.helper")
            .unwrap()
            .is_none());
        let raw = std::fs::read_to_string(&config_path).unwrap();
        assert!(!raw.contains("access-token"));
        assert!(!raw.contains("refresh-token"));

        let edited = update_git_identity(
            config_path.clone(),
            UpdateGitIdentityRequest {
                name: "Owner Override".to_string(),
                email: "owner@example.test".to_string(),
            },
        )
        .unwrap();
        assert_eq!(edited.name, "Owner Override");
        configure_git_defaults(
            &managed,
            &executable,
            &connected_status("Different Default", "99+different@users.noreply.github.com"),
        )
        .unwrap();
        assert_eq!(
            get_git_config(&config_path, "user.name")
                .unwrap()
                .as_deref(),
            Some("Owner Override")
        );
        assert_eq!(
            get_git_config(&config_path, "user.email")
                .unwrap()
                .as_deref(),
            Some("owner@example.test")
        );

        let _ = std::fs::remove_dir_all(root);
    }
}
