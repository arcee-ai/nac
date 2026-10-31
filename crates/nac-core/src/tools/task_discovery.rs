//! Task discovery tools that read committed store state only, never live sessions.
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Value};

use super::kernel::{NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices};
use super::mutation::argument_error;
use super::ToolResult;
use crate::permissions::PermissionBroker;
use crate::store::{self, TaskLookup, TaskSearch};
use crate::types::{FunctionDef, ToolDefinition};
use std::collections::VecDeque;
use std::sync::{Arc, LazyLock, Mutex as StdMutex};

const MAX_ID_BYTES: usize = 160;
const DEFAULT_LIMIT: usize = 10;
const MAX_CURSORS_PER_CHAT: usize = 32;
const MAX_CURSORS: usize = 4_096;
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
    #[serde(skip)]
    authorized_project: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ReadTaskInput {
    session_id: String,
    project_id: Option<String>,
    #[serde(skip)]
    authorized_project: Option<String>,
}

pub(super) fn definition(name: &str, description: &str, parameters: Value) -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: name.to_string(),
            description: description.to_string(),
            parameters,
        },
    }
}

pub(super) fn invalid(message: impl std::fmt::Display) -> ToolResult {
    argument_error(message.to_string())
}

pub(super) fn unavailable(error: impl std::fmt::Display) -> ToolResult {
    ToolResult::text(
        json!({"status":"unavailable","detail":format!("task state is unavailable: {error}")})
            .to_string(),
        true,
    )
}

/// Store positions stay in-process; callers see only a token bound to chat and project.
struct SealedCursor {
    token: String,
    caller: String,
    project_id: String,
    position: String,
}

static CURSORS: LazyLock<StdMutex<VecDeque<SealedCursor>>> =
    LazyLock::new(|| StdMutex::new(VecDeque::new()));

fn seal_cursor(caller: &str, project_id: &str, position: String) -> String {
    let token = uuid::Uuid::new_v4().simple().to_string();
    let mut cursors = CURSORS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if cursors
        .iter()
        .filter(|cursor| cursor.caller == caller)
        .count()
        == MAX_CURSORS_PER_CHAT
    {
        let oldest = cursors.iter().position(|cursor| cursor.caller == caller);
        oldest.map(|index| cursors.remove(index));
    }
    if cursors.len() == MAX_CURSORS {
        cursors.pop_front();
    }
    cursors.push_back(SealedCursor {
        token: token.clone(),
        caller: caller.to_owned(),
        project_id: project_id.to_owned(),
        position,
    });
    token
}

fn open_cursor(caller: &str, project_id: &str, token: &str) -> Option<String> {
    CURSORS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .iter()
        .find(|cursor| {
            cursor.token == token && cursor.caller == caller && cursor.project_id == project_id
        })
        .map(|cursor| cursor.position.clone())
}

pub(super) fn result(value: Value) -> ToolResult {
    ToolResult::text(value.to_string(), false)
}

pub(super) fn check_id(label: &str, value: &str) -> Result<(), ToolResult> {
    if value.trim().is_empty() || value.len() > MAX_ID_BYTES {
        return Err(invalid(format!(
            "{label} must contain 1 to {MAX_ID_BYTES} bytes"
        )));
    }
    Ok(())
}

pub(super) fn navigation(session_id: &str) -> String {
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
pub(super) fn caller(
    services: ToolServices<'_>,
) -> Result<(String, Arc<PermissionBroker>), ToolResult> {
    match (
        services.runtime.permission_broker.as_ref(),
        services.runtime.session_id.as_deref(),
    ) {
        (Some(broker), Some(session_id)) => Ok((session_id.to_owned(), Arc::clone(broker))),
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

pub(super) fn task_resource(session_id: &str) -> PermissionResource {
    PermissionResource::new("task_read", format!("session:{session_id}"))
}

/// `project:current` stands in only until the caller's project is known to the broker.
pub(super) fn project_resource(project_id: Option<&str>) -> PermissionResource {
    PermissionResource::new(
        "task_read",
        format!("project:{}", project_id.unwrap_or("current")),
    )
}

/// The project resource the kernel actually authorized for this invocation.
pub(super) fn authorized_project(resources: &[PermissionResource]) -> Option<String> {
    resources
        .iter()
        .find_map(|resource| resource.resource.strip_prefix("project:"))
        .map(str::to_owned)
}

/// Applies concrete `project:<id>` rules unless the kernel already authorized that project.
async fn authorize_project(
    tool: &str,
    services: ToolServices<'_>,
    (broker, authorized): (&Arc<PermissionBroker>, Option<&str>),
    context: &ToolCallContext,
    project_id: &str,
) -> Result<(), ToolResult> {
    broker.remember_caller_project(project_id);
    if authorized == Some(project_id) {
        return Ok(());
    }
    match context
        .authorize_during_execution(broker.authorize(
            tool,
            &[project_resource(Some(project_id))],
            context,
            context.cancellation(services.runtime),
        ))
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
            "goal_objective_truncated": snapshot.goal_objective_truncated,
            "goal_last_run_id": snapshot.goal_last_run_id,
            "prior_goals": snapshot.prior_goals,
            "run_outcomes": snapshot.run_outcomes,
            "created_at": snapshot.created_at,
            "updated_at": snapshot.updated_at,
        },
        "ephemeral": { "approvals": "unknown", "detail": APPROVALS_UNKNOWN },
    })
}

/// Withholds a target outside the caller's project unless that project is named.
pub(super) async fn exact_lookup(
    tool: &str,
    services: ToolServices<'_>,
    context: &ToolCallContext,
    (caller, broker): (String, Arc<PermissionBroker>),
    session_id: String,
    (explicit_project, authorized): (Option<String>, Option<String>),
) -> Result<Value, ToolResult> {
    let target = session_id.clone();
    let (caller_project, target_project, lookup) = store_call(services, move |path| {
        Ok((
            store::load_session_project_id(path, &caller)?,
            store::load_session_project_id(path, &target)?,
            store::load_direct_task(path, &target)?,
        ))
    })
    .await?;
    // A found task is scoped by the project in its own snapshot transaction.
    let target_project = match &lookup {
        TaskLookup::Found(snapshot) => snapshot.project_id.clone(),
        _ => target_project,
    };
    let in_scope = match explicit_project.as_deref() {
        Some(project) => target_project.as_deref() == Some(project),
        None => target_project == caller_project,
    };
    if !in_scope && !matches!(lookup, TaskLookup::NotFound) {
        return Ok(json!({
            "status": "outside_scope",
            "session_id": session_id,
            "detail": match explicit_project {
                Some(_) => "This task is not in the named project.",
                None => "This task is not in this chat's saved project. Crossing projects requires naming the task's project_id explicitly.",
            },
        }));
    }
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
            if let (None, Some(project)) = (&explicit_project, &snapshot.project_id) {
                authorize_project(
                    tool,
                    services,
                    (&broker, authorized.as_deref()),
                    context,
                    project,
                )
                .await?;
            }
            json!({"status": "found", "task": found_task(*snapshot)})
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
            .is_some_and(|after| after.is_empty() || after.len() > 512)
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
        let (_, broker) = caller(services)?;
        let project = input.project_id.as_deref().or(broker.caller_project());
        let mut resources = vec![project_resource(project)];
        if let Some(session_id) = &input.session_id {
            resources.push(task_resource(session_id));
        }
        Ok(resources)
    }

    fn bind_authorized_resources(
        &self,
        input: &mut Self::Input,
        resources: &[PermissionResource],
        _services: ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        input.authorized_project = authorized_project(resources);
        Ok(())
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let identity = match caller(services) {
                Ok(identity) => identity,
                Err(error) => return error,
            };
            if let Some(session_id) = input.session_id {
                return match exact_lookup(
                    "find_tasks",
                    services,
                    context,
                    identity,
                    session_id,
                    (input.project_id, input.authorized_project),
                )
                .await
                {
                    Ok(value) => result(with_receipt(value)),
                    Err(error) => error,
                };
            }
            let (caller, broker) = identity;
            let explicit = input.project_id.is_some();
            let filtered = input.reference.is_some() || input.text.is_some();
            let continuation = input.after.is_some();
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
                if let Err(error) = authorize_project(
                    "find_tasks",
                    services,
                    (&broker, input.authorized_project.as_deref()),
                    context,
                    &project_id,
                )
                .await
                {
                    return error;
                }
            }
            let Some(filter) = broker.passive_read_filter().await else {
                return unavailable("permission grants could not be read");
            };
            let after = match input.after.as_deref() {
                Some(token) => match open_cursor(&caller, &project_id, token) {
                    Some(position) => Some(position),
                    None => return invalid(
                        "after must be a next_after value from a previous page of this same search in this chat; cursors do not survive a restart",
                    ),
                },
                None => None,
            };
            let search = TaskSearch {
                project_id: project_id.clone(),
                reference: input.reference,
                text: input.text,
                exclude_session_id: Some(caller.clone()),
                after,
                limit: input.limit.unwrap_or(DEFAULT_LIMIT),
                visible: Some(Arc::new(move |session_id: &str| {
                    filter.allows(&[task_resource(session_id)])
                })),
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
            // False only when one page covered the whole search; otherwise unknown.
            let ambiguous = match page.candidates.len() {
                _ if !filtered => json!(false),
                2.. => json!(true),
                _ if continuation || page.next_after.is_some() => Value::Null,
                _ => json!(false),
            };
            let candidates = page
                .candidates
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
                "next_after": page.next_after.map(|position| seal_cursor(&caller, &project_id, position)),
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
        let (_, broker) = caller(services)?;
        let mut resources = vec![task_resource(&input.session_id)];
        if let Some(project) = input.project_id.as_deref().or(broker.caller_project()) {
            resources.push(project_resource(Some(project)));
        }
        Ok(resources)
    }

    fn bind_authorized_resources(
        &self,
        input: &mut Self::Input,
        resources: &[PermissionResource],
        _services: ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        input.authorized_project = authorized_project(resources);
        Ok(())
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let identity = match caller(services) {
                Ok(identity) => identity,
                Err(error) => return error,
            };
            match exact_lookup(
                "read_task",
                services,
                context,
                identity,
                input.session_id,
                (input.project_id, input.authorized_project),
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
pub(super) mod tests;
