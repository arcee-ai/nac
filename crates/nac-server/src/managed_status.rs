//! Credential-free liveness, managed readiness, and owner-facing host status.

use std::path::PathBuf;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use nac_managed::ReadinessCheck;
use serde::Serialize;

use crate::{application::managed::ManagedReadinessPolicy, SessionManager};

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct ReadinessResponse {
    status: &'static str,
    managed: bool,
    version: &'static str,
    schema_version: i64,
    product_version: &'static str,
    build_id: &'static str,
    build_track: &'static str,
    source_revision: &'static str,
    supported_schema_version: i64,
    minimum_migratable_schema_version: i64,
    opened_schema_version: Option<i64>,
    migration_state: &'static str,
    migration_failure: Option<&'static str>,
    maintenance_state: &'static str,
    checks: Vec<ReadinessCheck>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct ManagedHostStatusResponse {
    managed: bool,
    ready: bool,
    version: &'static str,
    schema_version: i64,
    product_version: &'static str,
    build_id: &'static str,
    build_track: &'static str,
    source_revision: &'static str,
    supported_schema_version: i64,
    minimum_migratable_schema_version: i64,
    opened_schema_version: Option<i64>,
    migration_state: &'static str,
    migration_failure: Option<&'static str>,
    maintenance_state: &'static str,
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
    maintenance: Option<nac_core::store::ManagedMaintenanceSnapshot>,
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
        Err(error) => {
            let identity = crate::build_identity::current();
            ReadinessResponse {
                status: "unavailable",
                managed,
                version: identity.product_version,
                schema_version: nac_core::store::schema_version(),
                product_version: identity.product_version,
                build_id: identity.build_id,
                build_track: identity.track,
                source_revision: identity.source_revision,
                supported_schema_version: nac_core::store::schema_version(),
                minimum_migratable_schema_version:
                    nac_core::store::MINIMUM_MIGRATABLE_SCHEMA_VERSION,
                opened_schema_version: None,
                migration_state: "failed",
                migration_failure: Some("readiness-task-failed"),
                maintenance_state: "unavailable",
                checks: vec![ReadinessCheck::fail(
                    "readiness-task",
                    format!("readiness task failed: {error}"),
                )],
            }
        }
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
    let identity = crate::build_identity::current();
    let migration = nac_core::store::migration_status(&manager.inner.store_path);
    let maintenance = (migration.state == nac_core::store::StoreMigrationState::Current)
        .then(|| nac_core::store::managed_maintenance_snapshot(&manager.inner.store_path))
        .and_then(Result::ok);
    let checks = readiness_checks(manager);
    let recovery_only = manager.is_recovery_only();
    ReadinessResponse {
        status: if !recovery_only && checks.iter().all(|check| check.ready) {
            "ok"
        } else {
            "unavailable"
        },
        managed: manager.managed_host().is_some(),
        version: identity.product_version,
        schema_version: nac_core::store::schema_version(),
        product_version: identity.product_version,
        build_id: identity.build_id,
        build_track: identity.track,
        source_revision: identity.source_revision,
        supported_schema_version: migration.supported_schema_version,
        minimum_migratable_schema_version: nac_core::store::MINIMUM_MIGRATABLE_SCHEMA_VERSION,
        opened_schema_version: migration.opened_schema_version,
        migration_state: migration.state.as_str(),
        migration_failure: migration
            .failure
            .map(nac_core::store::StoreMigrationFailure::as_str),
        maintenance_state: maintenance_state(recovery_only, migration.state, maintenance.as_ref()),
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
    let identity = crate::build_identity::current();
    let migration = nac_core::store::migration_status(&manager.inner.store_path);
    let checks = readiness_checks(manager);
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
    let store_current = migration.state == nac_core::store::StoreMigrationState::Current;
    let recovery_only = manager.is_recovery_only();
    let project_count = if store_current {
        nac_core::store::list_projects(&manager.inner.store_path)?.len()
    } else {
        0
    };
    let session_count = if store_current {
        nac_core::sessions::list_sessions(&manager.inner.store_path)?.len()
    } else {
        0
    };
    let maintenance = store_current
        .then(|| nac_core::store::managed_maintenance_snapshot(&manager.inner.store_path))
        .transpose()?;
    Ok(ManagedHostStatusResponse {
        managed: true,
        ready: !recovery_only && checks.iter().all(|check| check.ready),
        version: identity.product_version,
        schema_version: nac_core::store::schema_version(),
        product_version: identity.product_version,
        build_id: identity.build_id,
        build_track: identity.track,
        source_revision: identity.source_revision,
        supported_schema_version: migration.supported_schema_version,
        minimum_migratable_schema_version: nac_core::store::MINIMUM_MIGRATABLE_SCHEMA_VERSION,
        opened_schema_version: migration.opened_schema_version,
        migration_state: migration.state.as_str(),
        migration_failure: migration
            .failure
            .map(nac_core::store::StoreMigrationFailure::as_str),
        maintenance_state: maintenance_state(recovery_only, migration.state, maintenance.as_ref()),
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
        maintenance,
        checks,
    })
}

fn maintenance_state(
    recovery_only: bool,
    migration_state: nac_core::store::StoreMigrationState,
    maintenance: Option<&nac_core::store::ManagedMaintenanceSnapshot>,
) -> &'static str {
    if recovery_only {
        return "recovery-only";
    }
    if migration_state != nac_core::store::StoreMigrationState::Current {
        return "unavailable";
    }
    match maintenance {
        Some(snapshot) if snapshot.state == nac_core::store::ManagedMaintenanceState::Serving => {
            "serving"
        }
        Some(snapshot)
            if snapshot.state == nac_core::store::ManagedMaintenanceState::Maintenance =>
        {
            "maintenance"
        }
        _ => "unavailable",
    }
}

fn readiness_checks(manager: &SessionManager) -> Vec<ReadinessCheck> {
    let mut checks = crate::application::managed::runtime_readiness_checks(
        manager,
        ManagedReadinessPolicy::production(),
    );
    checks.insert(
        1,
        match nac_core::store::managed_maintenance_snapshot(&manager.inner.store_path) {
            Ok(snapshot) if snapshot.state == nac_core::store::ManagedMaintenanceState::Serving => {
                ReadinessCheck::pass("maintenance", "host admission is open")
            }
            Ok(_) => ReadinessCheck::fail(
                "maintenance",
                "host is safely stopped for a managed upgrade",
            ),
            Err(_) => {
                ReadinessCheck::fail("maintenance", "managed maintenance state is unavailable")
            }
        },
    );
    checks
}

#[cfg(test)]
mod tests {
    use crate::application::managed::REQUIRED_RUNTIME_TOOLS;

    #[test]
    fn managed_readiness_requires_git_lfs_executable() {
        assert!(REQUIRED_RUNTIME_TOOLS.contains(&"git-lfs"));
    }
}
