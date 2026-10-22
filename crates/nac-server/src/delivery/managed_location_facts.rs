//! Separate private D-service fact receiver. D owns fresh machine/persisted
//! operation/resource/deadline admission; this endpoint requires its actual
//! pinned mTLS peer and checks native purpose/target before observing paths.
use axum::{
    body::to_bytes,
    extract::{ConnectInfo, Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::managed_runtime_tls::{
    serve_authenticated_runtime, AuthenticatedRuntimePeer, RuntimeTlsListener,
};
use crate::{
    ManagedLocationBinding, ManagedLocationFact, ManagedLocationFactError, ManagedLocationSelector,
    SessionManager,
};

#[path = "managed_host_observation.rs"]
mod host_observation;
pub use host_observation::{MANAGED_HOST_OBSERVATION_PATH, MANAGED_HOST_OBSERVATION_PURPOSE};
#[path = "managed_session_create.rs"]
mod session_create;
#[path = "managed_session_observation.rs"]
mod session_observation;
pub use session_observation::{
    MANAGED_SESSION_OBSERVATION_PATH, MANAGED_SESSION_OBSERVATION_PURPOSE,
};

pub const MANAGED_LOCATION_FACT_PATH: &str = "/internal/v1/managed-location-facts";
pub const MANAGED_LOCATION_FACT_PURPOSE: &str = "working-location-facts.v1";
const MAX_BODY_BYTES: usize = 32 * 1024;
const EXPIRY_HEADER: &str = "x-nac-expires-at-epoch-ms";

struct FactDeadline {
    epoch_ms: i64,
    monotonic: tokio::time::Instant,
}

#[derive(Clone)]
struct ObservationShutdown(tokio::sync::watch::Receiver<bool>);

fn utc_epoch_ms() -> Option<i64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|value| i64::try_from(value.as_millis()).ok())
}

fn single_header<'a>(headers: &'a axum::http::HeaderMap, name: &str) -> Option<&'a str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    value.to_str().ok()
}

impl FactDeadline {
    fn from_headers(headers: &axum::http::HeaderMap) -> Option<Self> {
        let text = single_header(headers, EXPIRY_HEADER)?;
        if text.is_empty()
            || text.len() > 19
            || !text.bytes().all(|byte| byte.is_ascii_digit())
            || (text.len() > 1 && text.starts_with('0'))
        {
            return None;
        }
        let epoch_ms = text.parse::<i64>().ok()?;
        let remaining = epoch_ms.checked_sub(utc_epoch_ms()?)?;
        if !(1..=60_000).contains(&remaining) {
            return None;
        }
        Some(Self {
            epoch_ms,
            monotonic: tokio::time::Instant::now() + Duration::from_millis(remaining as u64),
        })
    }
    fn is_live(&self) -> bool {
        tokio::time::Instant::now() < self.monotonic
            && utc_epoch_ms().is_some_and(|now| {
                self.epoch_ms
                    .checked_sub(now)
                    .is_some_and(|remaining| (1..=60_000).contains(&remaining))
            })
    }
}

/// The tagged shape makes prior_fact required for resolve and forbidden for
/// observe. The existing serde parser rejects unknown/duplicate fields.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum FactRequest {
    Observe {
        schema: String,
        purpose: String,
        request_id: String,
        target: ManagedLocationBinding,
        selector: ManagedLocationSelector,
    },
    Resolve {
        schema: String,
        purpose: String,
        request_id: String,
        target: ManagedLocationBinding,
        selector: ManagedLocationSelector,
        prior_fact: Box<ManagedLocationFact>,
    },
}

#[derive(Serialize)]
struct FactReply {
    schema: &'static str,
    purpose: &'static str,
    request_id: String,
    action: &'static str,
    fact: ManagedLocationFact,
}

#[derive(Serialize)]
struct FactErrorReply<'a> {
    schema: &'static str,
    purpose: &'static str,
    request_id: &'a str,
    error: &'static str,
}

fn refusal(request_id: &str, status: StatusCode, error: &'static str) -> Response {
    (
        status,
        Json(FactErrorReply {
            schema: MANAGED_LOCATION_FACT_PURPOSE,
            purpose: MANAGED_LOCATION_FACT_PURPOSE,
            request_id,
            error,
        }),
    )
        .into_response()
}

fn router(manager: SessionManager) -> Router {
    Router::new()
        .route(MANAGED_LOCATION_FACT_PATH, post(handle))
        .route(
            MANAGED_HOST_OBSERVATION_PATH,
            post(host_observation::handle),
        )
        .route(
            MANAGED_SESSION_OBSERVATION_PATH,
            post(session_observation::handle),
        )
        .route(session_create::PATH, post(session_create::handle))
        .route(session_create::ACK_PATH, post(session_create::acknowledge))
        .with_state(manager)
        .layer(axum::Extension(
            super::ui_configuration::UiConfiguration::from_environment(),
        ))
}

/// Opt-in serving requires an actual configured pinned-D TLS listener. The
/// ordinary router/maintenance listener never mounts this endpoint. Caller owns
/// shutdown and actual certificate/config loading; no listener is started here
/// until it explicitly supplies that construction capability.
pub async fn serve_managed_location_facts(
    listener: RuntimeTlsListener,
    manager: SessionManager,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()> {
    manager.managed_location_binding()?;
    let (stopping, stopped) = tokio::sync::watch::channel(false);
    let app = router(manager).layer(axum::Extension(ObservationShutdown(stopped)));
    serve_authenticated_runtime(listener, app, async move {
        shutdown.await;
        let _ = stopping.send(true);
    })
    .await
}

async fn handle(State(manager): State<SessionManager>, request: Request) -> Response {
    // Transport-created Rust type with private fields. Forwarded certificate
    // headers, an operation UUID, or a body 'verified' flag cannot substitute.
    if request
        .extensions()
        .get::<ConnectInfo<AuthenticatedRuntimePeer>>()
        .is_none()
    {
        return refusal("", StatusCode::FORBIDDEN, "refused");
    }
    let request_id = single_header(request.headers(), "x-nac-request-id")
        .filter(|value| value.len() <= 128 && !value.is_empty())
        .map(str::to_owned);
    let Some(correlation) = request_id else {
        return refusal("", StatusCode::FORBIDDEN, "refused");
    };
    if request.uri().query().is_some() {
        return refusal(&correlation, StatusCode::FORBIDDEN, "refused");
    }
    if single_header(request.headers(), "content-type") != Some("application/json")
        || single_header(request.headers(), "accept") != Some("application/json")
    {
        return refusal(&correlation, StatusCode::FORBIDDEN, "refused");
    }
    if [
        "authorization",
        "cookie",
        "origin",
        "x-nac-operation-id",
        "x-nac-operation-expires-at-epoch-ms",
    ]
    .iter()
    .any(|name| request.headers().contains_key(*name))
    {
        return refusal(&correlation, StatusCode::FORBIDDEN, "refused");
    }
    let Some(deadline) = FactDeadline::from_headers(request.headers()) else {
        return refusal(&correlation, StatusCode::FORBIDDEN, "refused");
    };
    match tokio::time::timeout_at(
        deadline.monotonic,
        handle_bound(manager, request, &correlation, &deadline),
    )
    .await
    {
        // Include response serialization in the final expiry check; a future
        // can finish CPU work without yielding to Tokio's timeout poll.
        Ok(response) if deadline.is_live() => response,
        Ok(_) => refusal(&correlation, StatusCode::FORBIDDEN, "refused"),
        Err(_) => refusal(&correlation, StatusCode::SERVICE_UNAVAILABLE, "unavailable"),
    }
}

async fn handle_bound(
    manager: SessionManager,
    request: Request,
    correlation: &str,
    deadline: &FactDeadline,
) -> Response {
    let bytes = match to_bytes(request.into_body(), MAX_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(_) => return refusal(correlation, StatusCode::FORBIDDEN, "refused"),
    };
    let parsed = match serde_json::from_slice::<FactRequest>(&bytes) {
        Ok(parsed) => parsed,
        Err(_) => return refusal(correlation, StatusCode::FORBIDDEN, "refused"),
    };
    let (schema, purpose, request_id, target, selector, prior, action) = match parsed {
        FactRequest::Observe {
            schema,
            purpose,
            request_id,
            target,
            selector,
        } => (
            schema, purpose, request_id, target, selector, None, "observe",
        ),
        FactRequest::Resolve {
            schema,
            purpose,
            request_id,
            target,
            selector,
            prior_fact,
        } => (
            schema,
            purpose,
            request_id,
            target,
            selector,
            Some(prior_fact),
            "resolve",
        ),
    };
    if schema != MANAGED_LOCATION_FACT_PURPOSE
        || purpose != MANAGED_LOCATION_FACT_PURPOSE
        || request_id != correlation
    {
        return refusal(correlation, StatusCode::FORBIDDEN, "refused");
    }
    if !deadline.is_live() {
        return refusal(correlation, StatusCode::FORBIDDEN, "refused");
    }
    let binding = match manager.managed_location_binding() {
        Ok(binding) => binding,
        Err(error) => return fact_error(correlation, error),
    };
    if target != binding {
        return refusal(correlation, StatusCode::FORBIDDEN, "refused");
    }
    let current = match manager.managed_location_fact(selector.clone()).await {
        Ok(current) => current,
        Err(error) => return fact_error(correlation, error),
    };
    if target != current.binding {
        return refusal(correlation, StatusCode::FORBIDDEN, "refused");
    }
    let fact = if let Some(prior) = prior {
        if prior.selector != selector || prior.binding != target {
            return refusal(correlation, StatusCode::FORBIDDEN, "refused");
        }
        match manager.resolve_managed_location_fact(*prior).await {
            Ok(resolution) => resolution.fact().clone(),
            Err(error) => return fact_error(correlation, error),
        }
    } else {
        current
    };
    if !deadline.is_live() {
        return refusal(correlation, StatusCode::FORBIDDEN, "refused");
    }
    Json(FactReply {
        schema: MANAGED_LOCATION_FACT_PURPOSE,
        purpose: MANAGED_LOCATION_FACT_PURPOSE,
        request_id,
        action,
        fact,
    })
    .into_response()
}

fn fact_error(request_id: &str, error: ManagedLocationFactError) -> Response {
    use ManagedLocationFactError as Error;
    let (status, code) = match error {
        Error::Changed => (StatusCode::CONFLICT, "changed"),
        Error::InvalidSelector | Error::OutsideRepository | Error::RemoteProject => {
            (StatusCode::FORBIDDEN, "refused")
        }
        Error::Unmanaged
        | Error::UnboundHost
        | Error::ProjectUnavailable
        | Error::DirectoryUnavailable => (StatusCode::SERVICE_UNAVAILABLE, "unavailable"),
    };
    refusal(request_id, status, code)
}

#[cfg(all(test, unix))]
#[path = "managed_location_facts_tests.rs"]
mod tests;
