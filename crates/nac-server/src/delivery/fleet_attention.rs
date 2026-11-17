//! Browser fleet attention routes. These are ordinary web routes under the
//! shared Host/Origin/managed-admission layers; they never use or relax the
//! native `/attention/events` authority, seat or cursor.
use super::attention_contracts::{
    AttentionAvailabilityDto, AttentionDecisionDto, AttentionWorkDto,
};
use super::contracts::SessionLineageKind;
use crate::application::fleet_attention::{
    delta, visible, FleetAttentionEntry, FleetAttentionSubscribeError, FleetAttentionUnavailable,
    FleetAttentionView, FLEET_ATTENTION_MAX_STREAMS,
};
use crate::{ApiError, ApiErrorBody, SessionManager};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use nac_core::{
    events::AttentionOperation,
    store::{AttentionLineageKind, RunOutcomeDisposition},
};
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, sync::Arc, time::Duration};
use utoipa::ToSchema;

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct FleetAttentionQuery {
    /// Only sessions assigned to this project.
    pub project_id: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct FleetAttentionLineageDto {
    kind: SessionLineageKind,
    parent_session_id: String,
    root_session_id: String,
}

/// Current operation of a cached owner. `unknown` means no owner in this
/// process can be observed; it never means idle.
#[derive(Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum FleetAttentionActivityDto {
    Unknown,
    Idle,
    Run { run_id: String },
    Manual { operation_id: String },
    Compaction { compaction_id: String },
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FleetAttentionOutcomeKindDto {
    Completed,
    Failed,
    Cancelled,
}

/// The latest durable run outcome. History, not a claim the session is idle.
#[derive(Serialize, ToSchema)]
pub(crate) struct FleetAttentionOutcomeDto {
    run_id: String,
    disposition: FleetAttentionOutcomeKindDto,
}

/// Identity-only attention for one session. `pending` holds exact current
/// request identities; read `availability` before treating an empty list as
/// "nothing pending" (`unknown` / `unsupported` never mean none).
#[derive(Serialize, ToSchema)]
pub(crate) struct FleetAttentionSessionDto {
    session_id: String,
    revision: u64,
    #[schema(required)]
    project_id: Option<String>,
    #[schema(required)]
    lineage: Option<FleetAttentionLineageDto>,
    pending: Vec<AttentionDecisionDto>,
    #[schema(required)]
    work: Option<AttentionWorkDto>,
    availability: AttentionAvailabilityDto,
    activity: FleetAttentionActivityDto,
    #[schema(required)]
    last_outcome: Option<FleetAttentionOutcomeDto>,
    /// Durable queued input not yet admitted to a run.
    queued: bool,
    /// A durable run marker is unsettled (running elsewhere or awaiting recovery).
    recovery_pending: bool,
}

impl FleetAttentionSessionDto {
    fn new(session_id: &str, entry: &FleetAttentionEntry) -> Self {
        let facts = &entry.facts;
        Self {
            session_id: session_id.to_owned(),
            revision: entry.revision,
            project_id: facts.project_id.clone(),
            lineage: facts
                .lineage
                .as_ref()
                .map(|lineage| FleetAttentionLineageDto {
                    kind: match lineage.kind {
                        AttentionLineageKind::TraditionalChild => {
                            SessionLineageKind::TraditionalChild
                        }
                        AttentionLineageKind::ManagedOrchestrator => {
                            SessionLineageKind::ManagedOrchestrator
                        }
                    },
                    parent_session_id: lineage.parent_session_id.clone(),
                    root_session_id: lineage.root_session_id.clone(),
                }),
            pending: facts.attention.pending.iter().map(Into::into).collect(),
            work: facts.attention.work.as_ref().map(Into::into),
            availability: facts.attention.availability.into(),
            activity: match &facts.operation {
                None | Some(AttentionOperation::Unknown) => FleetAttentionActivityDto::Unknown,
                Some(AttentionOperation::Idle) => FleetAttentionActivityDto::Idle,
                Some(AttentionOperation::Run(run_id)) => FleetAttentionActivityDto::Run {
                    run_id: run_id.clone(),
                },
                Some(AttentionOperation::Manual(operation_id)) => {
                    FleetAttentionActivityDto::Manual {
                        operation_id: operation_id.clone(),
                    }
                }
                Some(AttentionOperation::Compaction(compaction_id)) => {
                    FleetAttentionActivityDto::Compaction {
                        compaction_id: compaction_id.clone(),
                    }
                }
            },
            last_outcome: facts
                .last_outcome
                .as_ref()
                .map(|outcome| FleetAttentionOutcomeDto {
                    run_id: outcome.run_id.clone(),
                    disposition: match outcome.disposition {
                        RunOutcomeDisposition::Completed => FleetAttentionOutcomeKindDto::Completed,
                        RunOutcomeDisposition::Failed => FleetAttentionOutcomeKindDto::Failed,
                        RunOutcomeDisposition::Cancelled => FleetAttentionOutcomeKindDto::Cancelled,
                    },
                }),
            queued: facts.inbox_pending,
            recovery_pending: facts.recovery_pending,
        }
    }
}

/// Every visible session at one fleet revision.
#[derive(Serialize, ToSchema)]
pub(crate) struct FleetAttentionSnapshotDto {
    /// Server incarnation of the revision sequence; a change means re-baseline.
    epoch: String,
    revision: u64,
    sessions: Vec<FleetAttentionSessionDto>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FleetAttentionUnavailableDto {
    Capacity,
    Store,
}

/// `snapshot` is always first on a connection; `changes` replace whole
/// session entries and list sessions that disappeared; `unavailable` ends the
/// stream and the client re-baselines (or polls) later.
#[derive(Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum FleetAttentionFrame {
    Snapshot {
        epoch: String,
        revision: u64,
        sessions: Vec<FleetAttentionSessionDto>,
    },
    Changes {
        epoch: String,
        revision: u64,
        upserts: Vec<FleetAttentionSessionDto>,
        removed: Vec<String>,
    },
    Unavailable {
        reason: FleetAttentionUnavailableDto,
    },
}

fn unavailable_dto(reason: FleetAttentionUnavailable) -> FleetAttentionUnavailableDto {
    match reason {
        FleetAttentionUnavailable::Capacity => FleetAttentionUnavailableDto::Capacity,
        FleetAttentionUnavailable::Store => FleetAttentionUnavailableDto::Store,
    }
}

fn unavailable(reason: FleetAttentionUnavailable) -> ApiError {
    ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        match reason {
            FleetAttentionUnavailable::Capacity => "fleet attention capacity exceeded".into(),
            FleetAttentionUnavailable::Store => "fleet attention is unavailable".into(),
        },
    )
}

fn sessions(view: &FleetAttentionView, project: Option<&str>) -> Vec<FleetAttentionSessionDto> {
    view.entries
        .iter()
        .filter(|(_, entry)| visible(entry, project))
        .map(|(id, entry)| FleetAttentionSessionDto::new(id, entry))
        .collect()
}

fn event(view: &FleetAttentionView, frame: &FleetAttentionFrame) -> Result<Event, Infallible> {
    let event = Event::default()
        .event("fleet_attention")
        .id(format!("{}:{}", view.epoch, view.revision));
    Ok(event.json_data(frame).unwrap_or_else(|_| {
        Event::default()
            .event("fleet_attention")
            .data(r#"{"kind":"unavailable","reason":"store"}"#)
    }))
}

#[utoipa::path(get, path = "/attention", operation_id = "get_attention", tag = "sessions",
    params(FleetAttentionQuery),
    responses(
        (status = 200, description = "Identity-only attention for every session, from the shared attention classification. Passive: never attaches, wakes, answers or counts as an interactive client.", body = FleetAttentionSnapshotDto),
        (status = 503, description = "The attention census is unavailable", body = ApiErrorBody),
    ))]
pub(crate) async fn snapshot(
    State(manager): State<SessionManager>,
    Query(query): Query<FleetAttentionQuery>,
) -> Result<Json<FleetAttentionSnapshotDto>, ApiError> {
    let view = manager
        .inner
        .fleet_attention
        .snapshot(&manager)
        .await
        .map_err(unavailable)?;
    Ok(Json(FleetAttentionSnapshotDto {
        epoch: view.epoch.to_string(),
        revision: view.revision,
        sessions: sessions(&view, query.project_id.as_deref()),
    }))
}

#[utoipa::path(get, path = "/attention/stream", operation_id = "get_attention_stream", tag = "sessions",
    params(FleetAttentionQuery),
    responses(
        (status = 200, description = "Server-sent `fleet_attention` events (FleetAttentionFrame): a snapshot, then coalesced changes. Many concurrent browser streams share one refresher. Every connection starts with a fresh snapshot; the SSE id is informational. Never gzip-compressed.", body = FleetAttentionFrame, content_type = "text/event-stream"),
        (status = 503, description = "The census is unavailable or the stream limit is reached; poll GET /attention instead", body = ApiErrorBody),
    ))]
pub(crate) async fn stream(
    State(manager): State<SessionManager>,
    Query(query): Query<FleetAttentionQuery>,
) -> Result<Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let mut subscription = manager
        .inner
        .fleet_attention
        .subscribe(&manager)
        .await
        .map_err(|error| match error {
            FleetAttentionSubscribeError::Busy => ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                format!("fleet attention allows {FLEET_ATTENTION_MAX_STREAMS} concurrent streams"),
            ),
            FleetAttentionSubscribeError::Unavailable(reason) => unavailable(reason),
        })?;
    let project = query.project_id;
    Ok(Sse::new(async_stream::stream! {
        let mut last: Arc<FleetAttentionView> = Arc::clone(&subscription.receiver.borrow_and_update());
        yield event(&last, &FleetAttentionFrame::Snapshot {
            epoch: last.epoch.to_string(),
            revision: last.revision,
            sessions: sessions(&last, project.as_deref()),
        });
        while subscription.receiver.changed().await.is_ok() {
            let next = Arc::clone(&subscription.receiver.borrow_and_update());
            if let Some(reason) = next.unavailable {
                yield event(&next, &FleetAttentionFrame::Unavailable { reason: unavailable_dto(reason) });
                break;
            }
            let change = delta(&last, &next, project.as_deref());
            if !change.upserts.is_empty() || !change.removed.is_empty() {
                yield event(&next, &FleetAttentionFrame::Changes {
                    epoch: next.epoch.to_string(),
                    revision: next.revision,
                    upserts: change.upserts.iter().map(|(id, entry)| FleetAttentionSessionDto::new(id, entry)).collect(),
                    removed: change.removed,
                });
            }
            last = next;
        }
    })
    .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("keep-alive")))
}

#[cfg(test)]
#[path = "fleet_attention_tests.rs"]
mod tests;
