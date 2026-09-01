//! Credential-free liveness, managed readiness, and owner-facing host status.

use std::path::PathBuf;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use nac_managed::ReadinessCheck;
use serde::Serialize;

use crate::SessionManager;

const MANAGED_RUNTIME_UID: u32 = 10_001;
const MANAGED_RUNTIME_GID: u32 = 10_001;
const REQUIRED_RUNTIME_TOOLS: &[&str] = &[
    "bash",
    "git",
    "gh",
    "ssh",
    "curl",
    "jq",
    "rg",
    "fd",
    "rsync",
    "make",
    "pkg-config",
    "cmake",
    "cc",
    "python3",
    "uv",
    "node",
    "npm",
    "corepack",
    "rustc",
    "cargo",
    "rustfmt",
    "cargo-clippy",
    "go",
    "tar",
    "gzip",
    "xz",
    "zip",
    "unzip",
    "tini",
];

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct ReadinessResponse {
    status: &'static str,
    managed: bool,
    version: &'static str,
    schema_version: i64,
    checks: Vec<ReadinessCheck>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct ManagedHostStatusResponse {
    managed: bool,
    ready: bool,
    version: &'static str,
    schema_version: i64,
    logical_host_id: String,
    owner: Option<String>,
    public_hostname: String,
    #[schema(value_type = String)]
    repository_root: PathBuf,
    model_ready: bool,
    model: ManagedModelStatus,
    github_status: &'static str,
    secret_count: usize,
    project_count: usize,
    session_count: usize,
    checks: Vec<ReadinessCheck>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct ManagedModelStatus {
    backend: nac_core::model::BackendKind,
    id: String,
    endpoint: String,
    display_name: &'static str,
}

#[utoipa::path(
    get,
    path = "/healthz",
    operation_id = "get_healthz",
    tag = "system",
    responses((status = 200, description = "Server event loop is responsive", body = crate::HealthResponse, content_type = "application/json"))
)]
pub(crate) async fn healthz_handler() -> Json<crate::HealthResponse> {
    Json(crate::HealthResponse { status: "ok" })
}

#[utoipa::path(
    get,
    path = "/readyz",
    operation_id = "get_readyz",
    tag = "system",
    responses(
        (status = 200, description = "Durable store and selected runtime are ready", body = ReadinessResponse, content_type = "application/json"),
        (status = 503, description = "A required readiness check failed", body = ReadinessResponse, content_type = "application/json")
    )
)]
pub(crate) async fn readyz_handler(
    State(manager): State<SessionManager>,
) -> (StatusCode, Json<ReadinessResponse>) {
    let managed = manager.managed_host().is_some();
    let snapshot = tokio::task::spawn_blocking(move || readiness_snapshot(&manager)).await;
    let response = match snapshot {
        Ok(response) => response,
        Err(error) => ReadinessResponse {
            status: "unavailable",
            managed,
            version: env!("CARGO_PKG_VERSION"),
            schema_version: nac_core::store::schema_version(),
            checks: vec![ReadinessCheck::fail(
                "readiness-task",
                format!("readiness task failed: {error}"),
            )],
        },
    };
    let status = if response.status == "ok" {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(response))
}

#[utoipa::path(
    get,
    path = "/managed/status",
    operation_id = "get_managed_status",
    tag = "managed",
    responses(
        (status = 200, description = "Owner-facing managed host status without credential values", body = ManagedHostStatusResponse, content_type = "application/json"),
        (status = 404, description = "Managed NAC is not configured", body = crate::ApiErrorBody, content_type = "application/json")
    )
)]
pub(crate) async fn managed_status_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<ManagedHostStatusResponse>, crate::ApiError> {
    if manager.managed_host().is_none() {
        return Err(crate::ApiError {
            status: StatusCode::NOT_FOUND,
            message: "Managed NAC is not configured".to_string(),
        });
    }
    tokio::task::spawn_blocking(move || managed_status_snapshot(&manager))
        .await
        .map_err(|error| crate::ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("managed status task failed: {error}"),
        })?
        .map(Json)
        .map_err(|error| crate::ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
        })
}

fn readiness_snapshot(manager: &SessionManager) -> ReadinessResponse {
    let checks = readiness_checks(
        manager,
        MANAGED_RUNTIME_UID,
        MANAGED_RUNTIME_GID,
        REQUIRED_RUNTIME_TOOLS,
    );
    ReadinessResponse {
        status: if checks.iter().all(|check| check.ready) {
            "ok"
        } else {
            "unavailable"
        },
        managed: manager.managed_host().is_some(),
        version: env!("CARGO_PKG_VERSION"),
        schema_version: nac_core::store::schema_version(),
        checks,
    }
}

fn managed_status_snapshot(manager: &SessionManager) -> anyhow::Result<ManagedHostStatusResponse> {
    let managed = manager
        .managed_host()
        .ok_or_else(|| anyhow::anyhow!("Managed NAC is not configured"))?;
    let model = manager
        .managed_model()
        .ok_or_else(|| anyhow::anyhow!("managed model profile is unavailable"))?;
    let checks = readiness_checks(
        manager,
        MANAGED_RUNTIME_UID,
        MANAGED_RUNTIME_GID,
        REQUIRED_RUNTIME_TOOLS,
    );
    let model_ready = checks
        .iter()
        .find(|check| check.name == "model-credential")
        .is_some_and(|check| check.ready);
    let github_status = match managed.github_auth()?.status() {
        Ok(status) if status.connected => "connected",
        Ok(_) => "disconnected",
        Err(_) => "reauth-required",
    };
    let secret_count = managed.secret_store().list()?.len();
    let project_count = nac_core::store::list_projects(&manager.inner.store_path)?.len();
    let session_count = nac_core::sessions::list_sessions(&manager.inner.store_path)?.len();
    Ok(ManagedHostStatusResponse {
        managed: true,
        ready: checks.iter().all(|check| check.ready),
        version: env!("CARGO_PKG_VERSION"),
        schema_version: nac_core::store::schema_version(),
        logical_host_id: managed.logical_host_id.clone(),
        owner: managed.owner.clone(),
        public_hostname: managed.public_hostname.clone(),
        repository_root: managed.repository_root.clone(),
        model_ready,
        model: ManagedModelStatus {
            backend: model.backend,
            id: model.model_id.clone(),
            endpoint: model.endpoint.clone(),
            display_name: "Managed Arcee",
        },
        github_status,
        secret_count,
        project_count,
        session_count,
        checks,
    })
}

fn readiness_checks(
    manager: &SessionManager,
    expected_uid: u32,
    expected_gid: u32,
    required_tools: &[&str],
) -> Vec<ReadinessCheck> {
    let mut checks = vec![
        match nac_core::store::check_readiness(&manager.inner.store_path) {
            Ok(()) => ReadinessCheck::pass("store", "SQLite store is open and migrated"),
            Err(error) => {
                ReadinessCheck::fail("store", format!("SQLite store is unavailable: {error}"))
            }
        },
    ];

    let Some(managed) = manager.managed_host() else {
        return checks;
    };

    checks.extend(nac_managed::host_checks(
        managed,
        expected_uid,
        expected_gid,
        required_tools,
    ));
    if let Some(model) = manager.managed_model() {
        if model.credential_source == nac_managed::ManagedModelCredentialSource::ManagedBootstrap {
            checks.push(match model.credential_ready(managed) {
                Ok(()) => ReadinessCheck::pass(
                    "model-credential",
                    "durable managed model authorization is present",
                ),
                Err(error) => ReadinessCheck::fail(
                    "model-credential",
                    format!("durable managed model authorization is unavailable: {error}"),
                ),
            });
        }
    }
    checks
}
