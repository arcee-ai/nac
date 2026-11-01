//! HTTP-only shapes for the content-free native attention stream.
use crate::application::attention::*;
use nac_core::events::*;
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
pub(crate) struct AttentionCursor {
    engine: String,
    epoch: String,
    sequence: u64,
}
impl From<AttentionBoundary> for AttentionCursor {
    fn from(boundary: AttentionBoundary) -> Self {
        Self {
            engine: boundary.engine.to_string(),
            epoch: boundary.epoch.to_string(),
            sequence: boundary.sequence,
        }
    }
}
#[derive(Serialize, ToSchema)]
pub(crate) struct AttentionSourceDto {
    session_id: String,
    epoch: String,
}
impl From<&AttentionSource> for AttentionSourceDto {
    fn from(source: &AttentionSource) -> Self {
        Self {
            session_id: source.session_id.clone(),
            epoch: source.epoch.to_string(),
        }
    }
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AttentionFacetDto {
    Available,
    Unknown,
    Unsupported,
}
impl From<AttentionFacet> for AttentionFacetDto {
    fn from(facet: AttentionFacet) -> Self {
        match facet {
            AttentionFacet::Available => Self::Available,
            AttentionFacet::Unknown => Self::Unknown,
            AttentionFacet::Unsupported => Self::Unsupported,
        }
    }
}
#[derive(Serialize, ToSchema)]
pub(crate) struct AttentionAvailabilityDto {
    work: AttentionFacetDto,
    questions: AttentionFacetDto,
    permissions: AttentionFacetDto,
    reviews: AttentionFacetDto,
    topology: AttentionFacetDto,
}
impl From<AttentionAvailability> for AttentionAvailabilityDto {
    fn from(value: AttentionAvailability) -> Self {
        Self {
            work: value.work.into(),
            questions: value.questions.into(),
            permissions: value.permissions.into(),
            reviews: value.reviews.into(),
            topology: value.topology.into(),
        }
    }
}
#[derive(Serialize, ToSchema)]
pub(crate) struct AttentionGoalDto {
    id: String,
    version: u64,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AttentionDispositionDto {
    Completed,
    Continuing,
    WaitingForDecision,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct AttentionWorkDto {
    run_id: String,
    #[schema(required)]
    goal: Option<AttentionGoalDto>,
    disposition: AttentionDispositionDto,
}
impl From<&SettledWork> for AttentionWorkDto {
    fn from(work: &SettledWork) -> Self {
        Self {
            run_id: work.run_id.clone(),
            goal: work.goal.as_ref().map(|goal| AttentionGoalDto {
                id: goal.id.clone(),
                version: goal.version,
            }),
            disposition: match work.disposition {
                SettledWorkDisposition::Completed => AttentionDispositionDto::Completed,
                SettledWorkDisposition::Continuing => AttentionDispositionDto::Continuing,
                SettledWorkDisposition::WaitingForDecision => {
                    AttentionDispositionDto::WaitingForDecision
                }
            },
        }
    }
}
#[derive(Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum AttentionDecisionDto {
    Permission {
        request_id: String,
    },
    Review {
        review_id: String,
    },
    Question {
        request_id: String,
        run_id: String,
        generation: String,
        revision: u64,
    },
}
impl From<&AttentionDecision> for AttentionDecisionDto {
    fn from(decision: &AttentionDecision) -> Self {
        match decision {
            AttentionDecision::Permission { request_id } => Self::Permission {
                request_id: request_id.clone(),
            },
            AttentionDecision::Review { review_id } => Self::Review {
                review_id: review_id.clone(),
            },
            AttentionDecision::Question {
                request_id,
                run_id,
                generation,
                revision,
            } => Self::Question {
                request_id: request_id.clone(),
                run_id: run_id.clone(),
                generation: generation.clone(),
                revision: *revision,
            },
        }
    }
}
#[derive(Serialize, ToSchema)]
pub(crate) struct AttentionSnapshotDto {
    source: AttentionSourceDto,
    revision: u64,
    #[schema(required)]
    work: Option<AttentionWorkDto>,
    pending: Vec<AttentionDecisionDto>,
    availability: AttentionAvailabilityDto,
}
impl From<&AttentionSourceSnapshot> for AttentionSnapshotDto {
    fn from(snapshot: &AttentionSourceSnapshot) -> Self {
        Self {
            source: (&snapshot.source).into(),
            revision: snapshot.revision,
            work: snapshot.work.as_ref().map(Into::into),
            pending: snapshot.pending.iter().map(Into::into).collect(),
            availability: snapshot.availability.into(),
        }
    }
}
#[derive(Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum AttentionChangeDto {
    SourceReplaced {
        snapshot: AttentionSnapshotDto,
    },
    WorkSettled {
        work: AttentionWorkDto,
    },
    WorkCleared,
    DecisionPending {
        decision: AttentionDecisionDto,
    },
    DecisionResolved {
        decision: AttentionDecisionDto,
    },
    SessionDeleted,
    Availability {
        availability: AttentionAvailabilityDto,
    },
    Checkpoint,
}
impl From<&AttentionRecordChange> for AttentionChangeDto {
    fn from(change: &AttentionRecordChange) -> Self {
        match change {
            AttentionRecordChange::SourceReplaced(snapshot) => Self::SourceReplaced {
                snapshot: snapshot.into(),
            },
            AttentionRecordChange::Checkpoint => Self::Checkpoint,
            AttentionRecordChange::Fact(change) => match change {
                AttentionChange::WorkSettled(work) => Self::WorkSettled { work: work.into() },
                AttentionChange::WorkCleared => Self::WorkCleared,
                AttentionChange::DecisionPending(decision) => Self::DecisionPending {
                    decision: decision.into(),
                },
                AttentionChange::DecisionResolved(decision) => Self::DecisionResolved {
                    decision: decision.into(),
                },
                AttentionChange::SessionDeleted => Self::SessionDeleted,
                AttentionChange::Availability(availability) => Self::Availability {
                    availability: (*availability).into(),
                },
            },
        }
    }
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AttentionResetDto {
    Incarnation,
    ReplayGap,
    InvalidCursor,
}
impl From<AttentionReset> for AttentionResetDto {
    fn from(reason: AttentionReset) -> Self {
        match reason {
            AttentionReset::Incarnation => Self::Incarnation,
            AttentionReset::ReplayGap => Self::ReplayGap,
            AttentionReset::InvalidCursor => Self::InvalidCursor,
        }
    }
}
/// Current-state baselines are silent. Historical completion pages use their
/// own stable store frontier and never infer that a whole session is idle.
#[derive(Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum AttentionFrame {
    Completions {
        page: CompletionPageDto,
    },
    Baseline {
        boundary: AttentionCursor,
        sources: Vec<AttentionSnapshotDto>,
        #[schema(required)]
        reset: Option<AttentionResetDto>,
    },
    Record {
        boundary: AttentionCursor,
        source: AttentionSourceDto,
        source_revision: u64,
        change: AttentionChangeDto,
        new_attention: bool,
    },
    Reset {
        reason: AttentionResetDto,
    },
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CompletionKindDto {
    Request,
    Goal,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct CompletionOccurrenceDto {
    sequence: i64,
    session_id: String,
    run_id: String,
    behavior: String,
    kind: CompletionKindDto,
    #[schema(required)]
    goal_id: Option<String>,
    #[schema(required)]
    mark_version: Option<i64>,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct CompletionPageDto {
    store_id: String,
    cursor: i64,
    high_water: i64,
    baseline: bool,
    more: bool,
    items: Vec<CompletionOccurrenceDto>,
}
impl From<nac_core::store::CompletionPage> for CompletionPageDto {
    fn from(page: nac_core::store::CompletionPage) -> Self {
        Self {
            store_id: page.cursor.store,
            cursor: page.cursor.sequence,
            high_water: page.high_water,
            baseline: page.baseline,
            more: page.more,
            items: page
                .items
                .into_iter()
                .map(|item| CompletionOccurrenceDto {
                    sequence: item.sequence,
                    session_id: item.session_id,
                    run_id: item.run_id,
                    behavior: item.behavior,
                    kind: match item.kind {
                        nac_core::store::CompletionKind::Request => CompletionKindDto::Request,
                        nac_core::store::CompletionKind::Goal => CompletionKindDto::Goal,
                    },
                    goal_id: item.goal_id,
                    mark_version: item.mark_version,
                })
                .collect(),
        }
    }
}
impl AttentionFrame {
    pub fn baseline(initial: &AttentionInitial) -> Self {
        Self::Baseline {
            boundary: initial.boundary.into(),
            sources: initial.baseline.iter().map(Into::into).collect(),
            reset: initial.reset.map(Into::into),
        }
    }
    pub fn record(record: &AttentionRecord) -> Self {
        Self::Record {
            boundary: record.boundary.into(),
            source: (&record.source).into(),
            source_revision: record.source_revision,
            change: (&record.change).into(),
            new_attention: record.new_attention,
        }
    }
}
