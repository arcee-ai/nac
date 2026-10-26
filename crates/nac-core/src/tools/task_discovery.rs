//! Task discovery tools that read committed store state only, never live sessions.
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Value};

use super::kernel::{NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices};
use super::mutation::argument_error;
use super::ToolResult;
use crate::store::{self, TaskLookup, TaskSearch};
use crate::types::{FunctionDef, ToolDefinition};

const MAX_ID_BYTES: usize = 160;
const DEFAULT_LIMIT: usize = 10;
const APPROVALS_UNKNOWN: &str = "Approval requests live only in the target's live owner process and are not visible to a passive durable read. Absence here never means none are pending; open the task to see them.";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FindTasksInput {
    session_id: Option<String>,
    reference: Option<String>,
    text: Option<String>,
    project_id: Option<String>,
    after: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ReadTaskInput {
    session_id: String,
    project_id: Option<String>,
}

fn definition(name: &str, description: &str, parameters: Value) -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: name.to_string(),
            description: description.to_string(),
            parameters,
        },
    }
}

fn invalid(message: impl std::fmt::Display) -> ToolResult {
    argument_error(message.to_string())
}

fn unavailable(error: impl std::fmt::Display) -> ToolResult {
    ToolResult::text(
        json!({"status":"unavailable","detail":format!("task state is unavailable: {error}")})
            .to_string(),
        true,
    )
}

fn result(value: Value) -> ToolResult {
    ToolResult::text(value.to_string(), false)
}

fn check_id(label: &str, value: &str) -> Result<(), ToolResult> {
    if value.trim().is_empty() || value.len() > MAX_ID_BYTES {
        return Err(invalid(format!(
            "{label} must contain 1 to {MAX_ID_BYTES} bytes"
        )));
    }
    Ok(())
}

fn navigation(session_id: &str) -> String {
    let mut route = String::from("/session/");
    for byte in session_id.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            route.push(char::from(byte));
        } else {
            route.push_str(&format!("%{byte:02X}"));
        }
    }
    route
}

/// Only an attached, persisted direct primary may discover peers.
fn caller(services: ToolServices<'_>) -> Result<String, ToolResult> {
    match (
        services.runtime.permission_broker.as_ref(),
        services.runtime.session_id.as_deref(),
    ) {
        (Some(_), Some(session_id)) => Ok(session_id.to_owned()),
        _ => Err(ToolResult::text(
            "Error: task discovery is available only to a persisted direct chat",
            true,
        )),
    }
}

async fn store_call<R: Send + 'static>(
    services: ToolServices<'_>,
    operation: impl FnOnce(&std::path::Path) -> anyhow::Result<R> + Send + 'static,
) -> Result<R, ToolResult> {
    let path = services.runtime.store_path.clone();
    match store::spawn_blocking_store_caller(move || operation(&path)).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) | Err(error) => Err(unavailable(format!("{error:#}"))),
    }
}

fn task_resource(session_id: &str) -> PermissionResource {
    PermissionResource::new("task_read", format!("session:{session_id}"))
}

/// `project:current` is the caller's own project, stable because membership is immutable.
fn project_resource(project_id: Option<&str>) -> PermissionResource {
    PermissionResource::new(
        "task_read",
        format!("project:{}", project_id.unwrap_or("current")),
    )
}

/// Applies concrete `project:<id>` rules to a project resolved after kernel authorization.
async fn authorize_project(
    tool: &str,
    services: ToolServices<'_>,
    context: &ToolCallContext,
    project_id: &str,
) -> Result<(), ToolResult> {
    let broker = services
        .runtime
        .permission_broker
        .as_ref()
        .ok_or_else(|| ToolResult::text("Error: task discovery is unavailable", true))?;
    match broker
        .authorize(
            tool,
            &[project_resource(Some(project_id))],
            context,
            context.cancellation(services.runtime),
        )
        .await
    {
        crate::permissions::AuthorizationOutcome::Allowed => Ok(()),
        crate::permissions::AuthorizationOutcome::Denied(reason) => Err(ToolResult::text(
            format!("Error: permission denied for {tool}: {reason}"),
            true,
        )),
    }
}

fn found_task(snapshot: store::DirectTaskSnapshot) -> Value {
    json!({
        "session_id": snapshot.session_id,
        "project_id": snapshot.project_id,
        "behavior": snapshot.behavior,
        "title": snapshot.title,
        "navigation": navigation(&snapshot.session_id),
        "durable": {
            "last_prompt_excerpt": snapshot.last_prompt_excerpt,
            "run_count": snapshot.run_count,
            "visible_message_count": snapshot.visible_message_count,
            "current_run": snapshot.current_run,
            "pending_inbox_items": snapshot.pending_inbox_items,
            "goal": snapshot.goal,
            "prior_goals": snapshot.prior_goals,
            "run_outcomes": snapshot.run_outcomes,
            "created_at": snapshot.created_at,
            "updated_at": snapshot.updated_at,
        },
        "ephemeral": { "approvals": "unknown", "detail": APPROVALS_UNKNOWN },
    })
}

/// Withholds a target outside the caller's project unless that project is named.
async fn exact_lookup(
    tool: &str,
    services: ToolServices<'_>,
    context: &ToolCallContext,
    caller: String,
    session_id: String,
    explicit_project: Option<String>,
) -> Result<Value, ToolResult> {
    let target = session_id.clone();
    let (caller_project, lookup) = store_call(services, move |path| {
        Ok((
            store::load_session_project_id(path, &caller)?,
            store::load_direct_task(path, &target)?,
        ))
    })
    .await?;
    Ok(match lookup {
        TaskLookup::NotFound => json!({
            "status": "not_found",
            "session_id": session_id,
            "detail": "No session with this ID exists in this store. It may never have existed or may have been deleted; the store keeps no tombstone to tell them apart.",
        }),
        TaskLookup::NotIndependentTask(kind) => json!({
            "status": "not_independent_task",
            "session_id": session_id,
            "kind": kind,
            "detail": "This session belongs to another topology and is not an independent direct task.",
        }),
        TaskLookup::Found(snapshot) => {
            let in_scope = match explicit_project.as_deref() {
                Some(project) => snapshot.project_id.as_deref() == Some(project),
                None => snapshot.project_id == caller_project,
            };
            if in_scope {
                if let (None, Some(project)) = (&explicit_project, &snapshot.project_id) {
                    authorize_project(tool, services, context, project).await?;
                }
                json!({"status": "found", "task": found_task(*snapshot)})
            } else {
                json!({
                    "status": "outside_scope",
                    "session_id": session_id,
                    "detail": match explicit_project {
                        Some(_) => "This task is not in the named project.",
                        None => "This task is not in this chat's saved project. Crossing projects requires naming the task's project_id explicitly.",
                    },
                })
            }
        }
    })
}

fn with_receipt(mut value: Value) -> Value {
    value["as_of"] = json!(store::now_utc());
    value["provenance"] = json!("committed durable store state read in one transaction; this read never attached, recovered, woke or subscribed to the task");
    value
}

pub(crate) struct FindTasksTool;

impl NativeTool for FindTasksTool {
    type Input = FindTasksInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "find_tasks",
            "Find existing independent direct tasks (separate visible chats) without launching, waking or attaching them. Defaults to this chat's saved project; pass project_id to search another project explicitly. Give at most one of: session_id for an exact lookup, reference for a work-unit/ticket token such as ALL-469 (whole-token, case-insensitive, in title or last prompt), or text for a case-insensitive substring. With none, lists recent tasks. Every candidate is a separate attempt; several matches are not duplicates and a match is discovery evidence, not identity. Session ID is task identity: use read_task with it for a full snapshot. Pages are bounded; continue with next_after. scan_limit_reached means more rows remain unexamined.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "session_id": {"type":"string","maxLength":MAX_ID_BYTES,"description":"Exact task session ID"},
                    "reference": {"type":"string","maxLength":store::MAX_TASK_REFERENCE_BYTES,"description":"Work-unit or ticket reference matched as a whole token"},
                    "text": {"type":"string","maxLength":store::MAX_TASK_TEXT_BYTES,"description":"Case-insensitive substring of title or last prompt"},
                    "project_id": {"type":"string","maxLength":MAX_ID_BYTES,"description":"Saved project to search instead of this chat's own"},
                    "after": {"type":"string","maxLength":512,"description":"next_after from the previous page"},
                    "limit": {"type":"integer","minimum":1,"maximum":store::MAX_TASK_SEARCH_LIMIT,"default":DEFAULT_LIMIT}
                }
            }),
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        let input: FindTasksInput = serde_json::from_value(input)
            .map_err(|error| invalid(format!("invalid find_tasks arguments: {error}")))?;
        let selectors = [&input.session_id, &input.reference, &input.text]
            .into_iter()
            .filter(|value| value.is_some())
            .count();
        if selectors > 1 {
            return Err(invalid(
                "give at most one of session_id, reference and text",
            ));
        }
        if let Some(session_id) = &input.session_id {
            check_id("session_id", session_id)?;
            if input.after.is_some() {
                return Err(invalid(
                    "after does not apply to an exact session_id lookup",
                ));
            }
        }
        if let Some(project_id) = &input.project_id {
            check_id("project_id", project_id)?;
        }
        for (label, value, max) in [
            (
                "reference",
                &input.reference,
                store::MAX_TASK_REFERENCE_BYTES,
            ),
            ("text", &input.text, store::MAX_TASK_TEXT_BYTES),
        ] {
            if value
                .as_deref()
                .is_some_and(|value| value.trim().is_empty() || value.len() > max)
            {
                return Err(invalid(format!("{label} must contain 1 to {max} bytes")));
            }
        }
        if input
            .after
            .as_deref()
            .is_some_and(|after| after.len() > 512 || store::decode_task_cursor(after).is_none())
        {
            return Err(invalid(
                "after must be a next_after value from a previous page",
            ));
        }
        if input
            .limit
            .is_some_and(|limit| limit == 0 || limit > store::MAX_TASK_SEARCH_LIMIT)
        {
            return Err(invalid(format!(
                "limit must be between 1 and {}",
                store::MAX_TASK_SEARCH_LIMIT
            )));
        }
        Ok(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        caller(services)?;
        let mut resources = vec![project_resource(input.project_id.as_deref())];
        if let Some(session_id) = &input.session_id {
            resources.push(task_resource(session_id));
        }
        Ok(resources)
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let caller = match caller(services) {
                Ok(caller) => caller,
                Err(error) => return error,
            };
            if let Some(session_id) = input.session_id {
                return match exact_lookup(
                    "find_tasks",
                    services,
                    context,
                    caller,
                    session_id,
                    input.project_id,
                )
                .await
                {
                    Ok(value) => result(with_receipt(value)),
                    Err(error) => error,
                };
            }
            let explicit = input.project_id.is_some();
            let filtered = input.reference.is_some() || input.text.is_some();
            let project_id = match input.project_id {
                Some(project_id) => project_id,
                None => {
                    let caller_session = caller.clone();
                    match store_call(services, move |path| {
                        store::load_session_project_id(path, &caller_session)
                    })
                    .await
                    {
                        Ok(Some(project_id)) => project_id,
                        Ok(None) => {
                            return ToolResult::text(
                                json!({"status":"no_project","detail":"This chat is not in a saved project. Pass project_id to choose which project to search."}).to_string(),
                                true,
                            )
                        }
                        Err(error) => return error,
                    }
                }
            };
            if !explicit {
                if let Err(error) =
                    authorize_project("find_tasks", services, context, &project_id).await
                {
                    return error;
                }
            }
            let search = TaskSearch {
                project_id: project_id.clone(),
                reference: input.reference,
                text: input.text,
                exclude_session_id: Some(caller),
                after: input.after,
                limit: input.limit.unwrap_or(DEFAULT_LIMIT),
            };
            let page = match store_call(services, move |path| {
                store::search_direct_tasks(path, &search)
            })
            .await
            {
                Ok(page) => page,
                Err(error) => return error,
            };
            let Some(page) = page else {
                return result(with_receipt(json!({
                    "status": "project_not_found",
                    "project_id": project_id,
                    "detail": "No saved project with this ID exists in this store.",
                })));
            };
            let Some(broker) = services.runtime.permission_broker.as_ref() else {
                return ToolResult::text("Error: task discovery is unavailable", true);
            };
            let matched = page.candidates.len();
            let mut visible = Vec::with_capacity(matched);
            for candidate in page.candidates {
                if broker
                    .allows_without_prompt(&[task_resource(&candidate.session_id)])
                    .await
                {
                    visible.push(candidate);
                }
            }
            let withheld = visible.len() < matched;
            let ambiguous = filtered && visible.len() > 1;
            let candidates = visible
                .into_iter()
                .map(|candidate| {
                    let navigation = navigation(&candidate.session_id);
                    let mut value = json!(candidate);
                    value["navigation"] = json!(navigation);
                    value
                })
                .collect::<Vec<_>>();
            result(with_receipt(json!({
                "status": "ok",
                "scope": {"project_id": project_id, "explicit": explicit},
                "ambiguous": ambiguous,
                "candidates": candidates,
                "withheld": withheld,
                "next_after": page.next_after,
                "scanned_rows": page.scanned_rows,
                "scan_limit_reached": page.scan_limit_reached,
            })))
        })
    }
}

pub(crate) struct ReadTaskTool;

impl NativeTool for ReadTaskTool {
    type Input = ReadTaskInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "read_task",
            "Read a bounded passive snapshot of one exact independent direct task by session_id without attaching, waking, recovering or steering it. Returns durable facts (current run, pending inbox count, current goal with ID/version/status, recent prior goal outcomes, recent run outcomes with result excerpts, navigation route) separately from ephemeral approval state, which is always unknown to this read. Tasks outside this chat's saved project need their project_id named explicitly. A goal-free run ending is a result, not proof an objective was completed.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["session_id"],
                "properties": {
                    "session_id": {"type":"string","maxLength":MAX_ID_BYTES,"description":"Exact task session ID"},
                    "project_id": {"type":"string","maxLength":MAX_ID_BYTES,"description":"The task's saved project, required to read across projects"}
                }
            }),
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        let input: ReadTaskInput = serde_json::from_value(input)
            .map_err(|error| invalid(format!("invalid read_task arguments: {error}")))?;
        check_id("session_id", &input.session_id)?;
        if let Some(project_id) = &input.project_id {
            check_id("project_id", project_id)?;
        }
        Ok(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        caller(services)?;
        let mut resources = vec![task_resource(&input.session_id)];
        if input.project_id.is_some() {
            resources.push(project_resource(input.project_id.as_deref()));
        }
        Ok(resources)
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let caller = match caller(services) {
                Ok(caller) => caller,
                Err(error) => return error,
            };
            match exact_lookup(
                "read_task",
                services,
                context,
                caller,
                input.session_id,
                input.project_id,
            )
            .await
            {
                Ok(value) => result(with_receipt(value)),
                Err(error) => error,
            }
        })
    }
}

#[cfg(test)]
#[path = "task_discovery_tests.rs"]
mod tests;
