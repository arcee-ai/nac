//! Strict legacy-compatible specification codec. Field order and omitted
//! calendar fields preserve the bytes used by retained interval command hashes.
use super::{HeartbeatCadence, HeartbeatCalendarRule, HeartbeatSpec};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub(super) struct HeartbeatSpecWire {
    name: String,
    instructions: String,
    #[serde(default)]
    skills: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    interval_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    calendar: Option<HeartbeatCalendarRule>,
    end_condition: String,
    goal_id: Option<String>,
    #[serde(default = "super::model::default_deadline")]
    execution_timeout_ms: i64,
    #[serde(default = "super::model::default_starts")]
    max_occurrences: i64,
    token_allowance: Option<i64>,
}

impl TryFrom<HeartbeatSpecWire> for HeartbeatSpec {
    type Error = anyhow::Error;
    fn try_from(wire: HeartbeatSpecWire) -> Result<Self> {
        let cadence = match (wire.interval_ms, wire.calendar) {
            (Some(interval_ms), None) => HeartbeatCadence::Interval { interval_ms },
            (None, Some(rule)) => HeartbeatCadence::Calendar(rule),
            _ => bail!("heartbeat requires exactly one of interval_ms or calendar"),
        };
        Ok(Self {
            name: wire.name,
            instructions: wire.instructions,
            skills: wire.skills,
            cadence,
            end_condition: wire.end_condition,
            goal_id: wire.goal_id,
            execution_timeout_ms: wire.execution_timeout_ms,
            max_occurrences: wire.max_occurrences,
            token_allowance: wire.token_allowance,
        })
    }
}

impl From<HeartbeatSpec> for HeartbeatSpecWire {
    fn from(spec: HeartbeatSpec) -> Self {
        let (interval_ms, calendar) = match spec.cadence {
            HeartbeatCadence::Interval { interval_ms } => (Some(interval_ms), None),
            HeartbeatCadence::Calendar(rule) => (None, Some(rule)),
        };
        Self {
            name: spec.name,
            instructions: spec.instructions,
            skills: spec.skills,
            interval_ms,
            calendar,
            end_condition: spec.end_condition,
            goal_id: spec.goal_id,
            execution_timeout_ms: spec.execution_timeout_ms,
            max_occurrences: spec.max_occurrences,
            token_allowance: spec.token_allowance,
        }
    }
}

#[cfg(feature = "openapi")]
impl utoipa::PartialSchema for HeartbeatSpec {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        use utoipa::openapi::schema::{
            AllOfBuilder, ObjectBuilder, OneOfBuilder, SchemaType, Type,
        };
        use utoipa::openapi::Ref;
        // Exactly one non-null recurrence, allowing nullable unused keys from
        // strict providers. The wire codec enforces the same runtime contract.
        let interval = ObjectBuilder::new()
            .property(
                "interval_ms",
                ObjectBuilder::new().schema_type(Type::Integer),
            )
            .required("interval_ms")
            .property(
                "calendar",
                ObjectBuilder::new().schema_type(SchemaType::Type(Type::Null)),
            );
        let calendar = ObjectBuilder::new()
            .property("calendar", Ref::from_schema_name("HeartbeatCalendarRule"))
            .required("calendar")
            .property(
                "interval_ms",
                ObjectBuilder::new().schema_type(SchemaType::Type(Type::Null)),
            );
        AllOfBuilder::new()
            .item(<HeartbeatSpecWire as utoipa::PartialSchema>::schema())
            .item(OneOfBuilder::new().item(interval).item(calendar))
            .into()
    }
}

#[cfg(feature = "openapi")]
impl utoipa::ToSchema for HeartbeatSpec {
    fn schemas(
        schemas: &mut Vec<(
            String,
            utoipa::openapi::RefOr<utoipa::openapi::schema::Schema>,
        )>,
    ) {
        <HeartbeatSpecWire as utoipa::ToSchema>::schemas(schemas);
    }
}
