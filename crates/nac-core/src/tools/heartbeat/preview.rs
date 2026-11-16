//! Passive exact-chat calendar preview through the prepared read capability.
use super::*;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PreviewInput {
    calendar: store::HeartbeatCalendarDraft,
    count: Option<usize>,
}

pub(crate) struct PreviewHeartbeatTool;
impl NativeTool for PreviewHeartbeatTool {
    type Input = PreviewInput;
    fn definition(&self) -> ToolDefinition {
        definition("preview_heartbeat","Read-only calendar preview before create/edit: explicit IANA zone, local hour/minute and daily/selected weekdays/weekly. Returns the exact pinned rule and UTC/local occurrences. Gaps skip; folds fire earliest once. No schedule, task, goal, attachment or wake is created. Save the returned data_version with the rule.",json!({"type":"object","additionalProperties":false,"required":["calendar"],"properties":{"calendar":schema::calendar(true),"count":{"type":["integer","null"],"minimum":1,"maximum":16,"description":"1..16 occurrences, default3."}}}))
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }
    fn decode(&self, mut value: Value) -> Result<Self::Input, ToolResult> {
        if let Some(rule) = value.get_mut("calendar") {
            schema::project_calendar(rule);
        }
        let input: PreviewInput = decode(value)?;
        input
            .calendar
            .clone()
            .into_rule()
            .preview(epoch_ms(), None, input.count.unwrap_or(3))
            .map_err(error)?;
        Ok(input)
    }
    fn permission_resources(
        &self,
        _: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(resource(services, "heartbeat_read"))
    }
    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            if let Err(e) = session(services).await {
                return e;
            }
            match input
                .calendar
                .into_rule()
                .preview(epoch_ms(), None, input.count.unwrap_or(3))
            {
                Ok(value) => result(value),
                Err(e) => error(e),
            }
        })
    }
}
