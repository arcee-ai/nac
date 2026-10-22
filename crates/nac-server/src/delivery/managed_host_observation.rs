//! Metadata-only observation on the existing private fact-service boundary.
//! The platform owns principal admission, semantic read scope and revocation.
use super::*;

pub const MANAGED_HOST_OBSERVATION_PATH: &str = "/internal/v1/managed-host-observation";
pub const MANAGED_HOST_OBSERVATION_PURPOSE: &str = "managed-host-observation.v1";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Target {
    logical_host_id: String,
    host_incarnation_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ObservationRequest {
    schema: String,
    purpose: String,
    request_id: String,
    target: Target,
}

#[derive(Serialize)]
struct ObservationReply<'a> {
    schema: &'static str,
    purpose: &'static str,
    request_id: &'a str,
    binding: &'a ManagedLocationBinding,
    store_ready: bool,
    maintenance_state: &'static str,
    migration_state: &'static str,
    opened_schema_version: Option<i64>,
    replacement_state: &'static str,
}

fn refused(status: StatusCode) -> Response {
    // Errors contain neither supplied identity values nor internal diagnostics.
    (
        status,
        Json(serde_json::json!({"error": "observation unavailable"})),
    )
        .into_response()
}

pub(super) async fn handle(State(manager): State<SessionManager>, request: Request) -> Response {
    if request
        .extensions()
        .get::<ConnectInfo<AuthenticatedRuntimePeer>>()
        .is_none()
        || request.uri().query().is_some()
        || single_header(request.headers(), "content-type") != Some("application/json")
        || single_header(request.headers(), "accept") != Some("application/json")
        || [
            "authorization",
            "cookie",
            "origin",
            "x-nac-operation-id",
            "x-nac-operation-expires-at-epoch-ms",
        ]
        .iter()
        .any(|name| request.headers().contains_key(*name))
    {
        return refused(StatusCode::FORBIDDEN);
    }
    let Some(correlation) = single_header(request.headers(), "x-nac-request-id")
        .filter(|s| !s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control))
        .map(str::to_owned)
    else {
        return refused(StatusCode::FORBIDDEN);
    };
    let Some(deadline) = FactDeadline::from_headers(request.headers()) else {
        return refused(StatusCode::FORBIDDEN);
    };
    match tokio::time::timeout_at(
        deadline.monotonic,
        observe(manager, request, &correlation, &deadline),
    )
    .await
    {
        Ok(response) if deadline.is_live() => response,
        _ => refused(StatusCode::SERVICE_UNAVAILABLE),
    }
}

async fn observe(
    manager: SessionManager,
    request: Request,
    correlation: &str,
    deadline: &FactDeadline,
) -> Response {
    let Ok(bytes) = to_bytes(request.into_body(), 4096).await else {
        return refused(StatusCode::FORBIDDEN);
    };
    let Ok(input) = serde_json::from_slice::<ObservationRequest>(&bytes) else {
        return refused(StatusCode::FORBIDDEN);
    };
    if input.schema != MANAGED_HOST_OBSERVATION_PURPOSE
        || input.purpose != MANAGED_HOST_OBSERVATION_PURPOSE
        || input.request_id != correlation
        || !deadline.is_live()
    {
        return refused(StatusCode::FORBIDDEN);
    }
    let Ok(configured) = manager.managed_location_binding() else {
        return refused(StatusCode::SERVICE_UNAVAILABLE);
    };
    if input.target.logical_host_id != configured.logical_host_id
        || input.target.host_incarnation_id != configured.host_incarnation_id
    {
        return refused(StatusCode::CONFLICT);
    }
    let Ok(snapshot) = crate::managed_status::managed_binding_snapshot(manager).await else {
        return refused(StatusCode::SERVICE_UNAVAILABLE);
    };
    if snapshot.binding != configured || !deadline.is_live() {
        return refused(StatusCode::CONFLICT);
    }
    // Json serializes synchronously while snapshot still owns the original
    // replacement guard. No guard/capability escapes in the response bytes.
    let response = Json(ObservationReply {
        schema: MANAGED_HOST_OBSERVATION_PURPOSE,
        purpose: MANAGED_HOST_OBSERVATION_PURPOSE,
        request_id: correlation,
        binding: &snapshot.binding,
        store_ready: snapshot.store_ready,
        maintenance_state: snapshot.maintenance_state,
        migration_state: snapshot.migration_state,
        opened_schema_version: snapshot.opened_schema_version,
        replacement_state: snapshot.replacement_state,
    })
    .into_response();
    drop(snapshot);
    response
}

#[cfg(all(test, unix))]
#[path = "managed_host_observation_tests.rs"]
pub(super) mod tests;
