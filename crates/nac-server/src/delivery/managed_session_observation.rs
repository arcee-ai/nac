//! Purpose-scoped passive session reads on the existing enrolled fact listener.
//! The platform retains principal admission/revocation; this is not runtime access.
use super::*;
use axum::response::sse::Sse;
use nac_core::{
    events::SessionEventBoundary,
    session_service::{FrontendSnapshotLoadOptions, FrontendSnapshotMessages, MessagePageRequest},
};

use crate::application::session_observation::SessionObservation;

pub const MANAGED_SESSION_OBSERVATION_PATH: &str = "/internal/v1/managed-session-observation";
pub const MANAGED_SESSION_OBSERVATION_PURPOSE: &str = "managed-session-observation.v1";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Target {
    logical_host_id: String,
    host_incarnation_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    epoch_id: String,
    sequence_id: u64,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Observation {
    Snapshot {
        thread_event_limit: Option<usize>,
        include_sessions: Option<bool>,
        message_limit: Option<usize>,
        #[serde(default)]
        include_system: bool,
    },
    Events {
        cursor: Option<Cursor>,
        limit: Option<usize>,
    },
    Stream {
        cursor: Option<Cursor>,
        limit: Option<usize>,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    schema: String,
    purpose: String,
    request_id: String,
    target: Target,
    session_id: String,
    observation: Observation,
}

fn refused(status: StatusCode) -> Response {
    (
        status,
        [("cache-control", "no-store")],
        Json(serde_json::json!({"error":"session observation unavailable"})),
    )
        .into_response()
}

fn safe_id(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 128
        && text
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
}

pub(super) async fn handle(State(manager): State<SessionManager>, request: Request) -> Response {
    if request
        .extensions()
        .get::<ConnectInfo<AuthenticatedRuntimePeer>>()
        .is_none()
        || request.uri().query().is_some()
        || single_header(request.headers(), "content-type") != Some("application/json")
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
        .filter(|text| safe_id(text))
        .map(str::to_owned)
    else {
        return refused(StatusCode::FORBIDDEN);
    };
    let accept = single_header(request.headers(), "accept")
        .unwrap_or("")
        .to_owned();
    let Ok(correlation_header) = axum::http::HeaderValue::from_str(&correlation) else {
        return refused(StatusCode::FORBIDDEN);
    };
    let Some(deadline) = FactDeadline::from_headers(request.headers()) else {
        return refused(StatusCode::FORBIDDEN);
    };
    let Some(stopping) = request
        .extensions()
        .get::<ObservationShutdown>()
        .map(|s| s.0.clone())
    else {
        return refused(StatusCode::SERVICE_UNAVAILABLE);
    };
    if *stopping.borrow() || stopping.has_changed().is_err() {
        return refused(StatusCode::SERVICE_UNAVAILABLE);
    }
    let expires = deadline.monotonic;
    let response = tokio::time::timeout_at(
        expires,
        observe(
            manager,
            request,
            &correlation,
            &accept,
            deadline,
            stopping.clone(),
        ),
    )
    .await;
    match response {
        Ok(mut response)
            if tokio::time::Instant::now() < expires
                && !*stopping.borrow()
                && stopping.has_changed().is_ok() =>
        {
            response.headers_mut().insert(
                "cache-control",
                axum::http::HeaderValue::from_static("no-store"),
            );
            response
                .headers_mut()
                .insert("x-nac-request-id", correlation_header);
            response
        }
        _ => refused(StatusCode::SERVICE_UNAVAILABLE),
    }
}

async fn observe(
    manager: SessionManager,
    request: Request,
    correlation: &str,
    accept: &str,
    deadline: FactDeadline,
    mut stopping: tokio::sync::watch::Receiver<bool>,
) -> Response {
    let Ok(bytes) = to_bytes(request.into_body(), 4096).await else {
        return refused(StatusCode::FORBIDDEN);
    };
    let Ok(input) = serde_json::from_slice::<Input>(&bytes) else {
        return refused(StatusCode::FORBIDDEN);
    };
    if input.schema != MANAGED_SESSION_OBSERVATION_PURPOSE
        || input.purpose != MANAGED_SESSION_OBSERVATION_PURPOSE
        || input.request_id != correlation
        || !safe_id(&input.session_id)
        || !deadline.is_live()
        || accept
            != if matches!(input.observation, Observation::Stream { .. }) {
                "text/event-stream"
            } else {
                "application/json"
            }
    {
        return refused(StatusCode::FORBIDDEN);
    }
    let Ok(binding) = crate::managed_status::managed_binding_snapshot(manager.clone()).await else {
        return refused(StatusCode::SERVICE_UNAVAILABLE);
    };
    if input.target.logical_host_id != binding.binding.logical_host_id
        || input.target.host_incarnation_id != binding.binding.host_incarnation_id
    {
        return refused(StatusCode::CONFLICT);
    }
    if !binding.store_ready || !deadline.is_live() {
        return refused(StatusCode::SERVICE_UNAVAILABLE);
    }
    let Ok(session) = SessionObservation::resolve(manager.clone(), &input.session_id).await else {
        // No cached current owner is a refusal, never a reason to attach.
        return refused(StatusCode::SERVICE_UNAVAILABLE);
    };
    match input.observation {
        Observation::Snapshot {
            thread_event_limit,
            include_sessions,
            message_limit,
            include_system,
        } => {
            // The bounded original worker owns the replacement guard through
            // every underlying read and serialization. Timeout/disconnect can
            // abandon the wait, never the still-running read's guard.
            let runtime = tokio::runtime::Handle::current();
            crate::managed_status::run_probe(move || {
                runtime.block_on(async move {
                    let mut options = FrontendSnapshotLoadOptions::default();
                    options.thread_event_limit = thread_event_limit
                        .unwrap_or(options.thread_event_limit)
                        .clamp(1, crate::MAX_THREAD_EVENT_PAGE_LIMIT);
                    options.include_sessions = include_sessions.unwrap_or(true);
                    if let Some(limit) = message_limit {
                        options.messages = FrontendSnapshotMessages::Page(MessagePageRequest {
                            before: None,
                            limit: limit.clamp(1, crate::MAX_MESSAGE_PAGE_LIMIT),
                            include_system,
                        });
                    }
                    let Ok(loaded) = session.snapshot(options).await else {
                        return refused(StatusCode::SERVICE_UNAVAILABLE);
                    };
                    let lineage_manager = manager.clone();
                    let id = input.session_id;
                    let Ok(Ok(lineage)) = manager
                        .inner
                        ._store_ownership
                        .call_legacy(move || lineage_manager.session_lineage(&id))
                        .await
                    else {
                        return refused(StatusCode::SERVICE_UNAVAILABLE);
                    };
                    if !deadline.is_live() || session.require_current().await.is_err() {
                        return refused(StatusCode::SERVICE_UNAVAILABLE);
                    }
                    // Serialize while retaining the original replacement guard.
                    let response = Json(crate::SessionSnapshotResponse {
                        terminal_selection_attributions:
                            super::super::contracts::selection_message_references(
                                loaded.terminal_selection_attributions,
                                &loaded.snapshot.messages,
                                &loaded.canonical_message_indices,
                            ),
                        snapshot: loaded.snapshot,
                        lineage,
                        message_page: loaded.message_page.map(Into::into),
                        message_cycle: loaded.message_cycle.map(Into::into),
                    })
                    .into_response();
                    drop(binding);
                    response
                })
            })
            .await
            .unwrap_or_else(|_| refused(StatusCode::SERVICE_UNAVAILABLE))
        }
        Observation::Events { cursor, limit } | Observation::Stream { cursor, limit } => {
            let cursor = match cursor {
                Some(cursor) if safe_id(&cursor.epoch_id) => Some(SessionEventBoundary {
                    epoch_id: cursor.epoch_id,
                    sequence_id: cursor.sequence_id,
                }),
                Some(_) => return refused(StatusCode::FORBIDDEN),
                None => None,
            };
            // SDK baseline capture uses limit=0 to read only the actual epoch.
            let limit = limit
                .unwrap_or(crate::DEFAULT_REPLAY_LIMIT)
                .min(crate::DEFAULT_REPLAY_LIMIT);
            if accept == "application/json" {
                let Ok((boundary, events)) = session.events(cursor.as_ref(), limit).await else {
                    return refused(StatusCode::SERVICE_UNAVAILABLE);
                };
                let response =
                    Json(crate::RecentEventsResponse { boundary, events }).into_response();
                drop(binding);
                return response;
            }
            let Ok((epoch, boundary, gap, replay, receiver, deltas)) =
                session.subscribe(cursor.as_ref(), limit).await
            else {
                return refused(StatusCode::SERVICE_UNAVAILABLE);
            };
            let events = super::super::session_runs::session_event_stream(
                epoch, boundary, gap, replay, receiver, deltas,
            );
            let stream = async_stream::stream! {
                let _replacement = binding;
                tokio::pin!(events);
                let mut recheck = tokio::time::interval(Duration::from_secs(1));
                loop {
                    let next = tokio::select! {
                        biased;
                        _ = stopping.changed() => break,
                        _ = tokio::time::sleep_until(deadline.monotonic) => break,
                        _ = recheck.tick() => { if !deadline.is_live()
                            || !matches!(tokio::time::timeout_at(deadline.monotonic, session.require_current())
                                .await, Ok(Ok(()))) {break;} continue; },
                        next = std::future::poll_fn(|cx| futures_core::Stream::poll_next(events.as_mut(), cx)) => next,
                    };
                    let Some(event) = next else {break;};
                    if *stopping.borrow() || !deadline.is_live() || !matches!(tokio::time::timeout_at(deadline.monotonic, session.require_current())
                        .await, Ok(Ok(()))) {break;}
                    yield event;
                }
            };
            Sse::new(stream).into_response()
        }
    }
}

#[cfg(all(test, unix))]
#[path = "managed_session_observation_tests.rs"]
mod tests;
