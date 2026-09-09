//! Authenticated private controller-to-NAC maintenance surface.
//!
//! This router is deliberately absent from the ordinary public router and its
//! OpenAPI document. The raw assertion is consumed from the header and never
//! persisted, reflected, or included in errors.

use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use nac_core::store::{
    ManagedControlAttemptAction, ManagedMaintenanceError, ManagedOperationBinding,
    ManagedPrepareOutcome, ManagedUpgradeTarget,
};
use nac_managed::{ManagedControlAction, ManagedControlRequest, ManagedControlVerifier};

use crate::{ApiErrorBody, SessionManager};

const MAX_CONTROL_BODY_BYTES: usize = 32 * 1024;

pub(crate) fn router(manager: SessionManager) -> Router {
    Router::new()
        .route("/v1/upgrade/status", post(status))
        .route("/v1/upgrade/prepare", post(prepare))
        .route("/v1/upgrade/retry", post(retry))
        .layer(DefaultBodyLimit::max(MAX_CONTROL_BODY_BYTES))
        .with_state(manager)
}

async fn status(
    State(manager): State<SessionManager>,
    headers: HeaderMap,
    Json(request): Json<ManagedControlRequest>,
) -> Response {
    let assertion = match validate(&manager, &headers, ManagedControlAction::Status, &request) {
        Ok(assertion) => assertion,
        Err(response) => return response,
    };
    let _host_admission = match manager.managed_completion_admission() {
        Ok(Some(admission)) => admission,
        _ => return internal_error(),
    };
    let blockers = match manager.managed_upgrade_blockers() {
        Ok(blockers) => blockers,
        Err(_) => return internal_error(),
    };
    let path = manager.inner.store_path.clone();
    let binding = match operation_binding(&manager, &request) {
        Ok(binding) => binding,
        Err(status) => return control_configuration_error(status),
    };
    match tokio::task::spawn_blocking(move || {
        nac_core::store::record_managed_status(
            &path,
            &assertion.jti,
            &binding,
            assertion.expires_at,
            blockers,
        )
    })
    .await
    {
        Ok(Ok(snapshot)) => Json(snapshot).into_response(),
        Ok(Err(error)) => maintenance_error(error),
        Err(_) => internal_error(),
    }
}

async fn prepare(
    State(manager): State<SessionManager>,
    headers: HeaderMap,
    Json(request): Json<ManagedControlRequest>,
) -> Response {
    prepare_for_action(manager, headers, request, ManagedControlAction::Prepare).await
}

async fn retry(
    State(manager): State<SessionManager>,
    headers: HeaderMap,
    Json(request): Json<ManagedControlRequest>,
) -> Response {
    prepare_for_action(manager, headers, request, ManagedControlAction::Retry).await
}

async fn prepare_for_action(
    manager: SessionManager,
    headers: HeaderMap,
    request: ManagedControlRequest,
    action: ManagedControlAction,
) -> Response {
    let assertion = match validate(&manager, &headers, action, &request) {
        Ok(assertion) => assertion,
        Err(response) => return response,
    };
    let process_gate = Arc::clone(&manager.inner.maintenance_gate)
        .try_write_owned()
        .ok();
    let mut blockers = match manager.managed_upgrade_blockers() {
        Ok(blockers) => blockers,
        Err(_) => return internal_error(),
    };
    if process_gate.is_none() {
        blockers.push(nac_core::store::ManagedUpgradeBlocker {
            kind: nac_core::store::ManagedBlockerKind::OperationLease,
            id: "process-admission".to_string(),
            session_id: None,
            detail: "this process is admitting work".to_string(),
        });
        blockers.extend(manager.active_admission_blockers());
    }
    let path = manager.inner.store_path.clone();
    let binding = match operation_binding(&manager, &request) {
        Ok(binding) => binding,
        Err(status) => return control_configuration_error(status),
    };
    let Some(expected_identity) = manager.managed_identity().cloned() else {
        return internal_error();
    };
    let result = tokio::task::spawn_blocking(move || {
        let _process_gate = process_gate;
        let attempt_action = match action {
            ManagedControlAction::Prepare => ManagedControlAttemptAction::Prepare,
            ManagedControlAction::Retry => ManagedControlAttemptAction::Retry,
            ManagedControlAction::Status => unreachable!("status uses its dedicated endpoint"),
        };
        nac_core::store::prepare_managed_upgrade_for_identity(
            &path,
            &assertion.jti,
            &binding,
            attempt_action,
            assertion.expires_at,
            blockers,
            &expected_identity,
        )
    })
    .await;
    match result {
        Ok(Ok(outcome @ ManagedPrepareOutcome::SafeToStop { .. })) => {
            (StatusCode::OK, Json(outcome)).into_response()
        }
        Ok(Ok(outcome @ ManagedPrepareOutcome::Blocked { .. })) => {
            (StatusCode::CONFLICT, Json(outcome)).into_response()
        }
        Ok(Err(error)) => maintenance_error(error),
        Err(_) => internal_error(),
    }
}

#[expect(
    clippy::result_large_err,
    reason = "the private handler returns complete sanitized HTTP responses at its validation boundary"
)]
fn validate(
    manager: &SessionManager,
    headers: &HeaderMap,
    action: ManagedControlAction,
    request: &ManagedControlRequest,
) -> Result<nac_managed::ManagedControlAssertion, Response> {
    let managed = manager.managed_host().ok_or_else(not_found)?;
    let control = managed
        .managed_control()
        .map_err(|_| internal_error())?
        .ok_or_else(not_found)?;
    let assertion = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty() && !value.contains(char::is_whitespace))
        .ok_or_else(unauthorized)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| internal_error())?
        .as_secs()
        .try_into()
        .map_err(|_| internal_error())?;
    ManagedControlVerifier::new(
        &control.jwks_file,
        control.issuer,
        managed.logical_host_id.clone(),
        control.host_incarnation_id,
    )
    .verify(assertion, action, request, now)
    .map_err(|error| {
        eprintln!("nac: managed control assertion rejected: {error}");
        unauthorized()
    })
}

fn operation_binding(
    manager: &SessionManager,
    request: &ManagedControlRequest,
) -> Result<ManagedOperationBinding, StatusCode> {
    let managed = manager.managed_host().ok_or(StatusCode::NOT_FOUND)?;
    let control = managed
        .managed_control()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let audience = format!(
        "urn:nac:managed-control:{}:{}",
        managed.logical_host_id, control.host_incarnation_id
    );
    Ok(ManagedOperationBinding {
        managed_host_id: request.managed_host_id.clone(),
        host_incarnation_id: request.host_incarnation_id.clone(),
        issuer: control.issuer.clone(),
        audience,
        authority_origin: control.issuer,
        operation_id: request.operation_id.clone(),
        target: ManagedUpgradeTarget {
            release_id: request.target.release_id.clone(),
            source_sha: request.target.source_sha.clone(),
            product_version: request.target.product_version.clone(),
            schema_version: request.target.schema_version,
            minimum_schema_version: request.target.minimum_schema_version,
        },
        actor: request.actor.clone(),
        beneficiary: request.beneficiary.clone(),
    })
}

fn control_configuration_error(status: StatusCode) -> Response {
    if status == StatusCode::NOT_FOUND {
        not_found()
    } else {
        internal_error()
    }
}

fn error(status: StatusCode, message: &'static str) -> Response {
    (
        status,
        Json(ApiErrorBody {
            error: message.to_string(),
        }),
    )
        .into_response()
}

fn unauthorized() -> Response {
    error(
        StatusCode::UNAUTHORIZED,
        "Managed control authorization failed",
    )
}

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Managed control is not configured")
}

fn internal_error() -> Response {
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Managed control request failed",
    )
}

fn maintenance_error(error_value: ManagedMaintenanceError) -> Response {
    let status = match error_value {
        ManagedMaintenanceError::OperationBindingConflict
        | ManagedMaintenanceError::ReplayConflict
        | ManagedMaintenanceError::MaintenanceConflict
        | ManagedMaintenanceError::IncompatibleTarget
        | ManagedMaintenanceError::OperationCapacity
        | ManagedMaintenanceError::AttemptCapacity => StatusCode::CONFLICT,
        ManagedMaintenanceError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    error(status, "Managed control request could not be applied")
}

#[cfg(test)]
#[path = "managed_control_tests.rs"]
mod tests;
