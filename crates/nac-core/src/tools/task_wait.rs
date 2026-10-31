//! Bounded observation of independent tasks. Dropping this future has no
//! target cancellation, goal mutation, inbox acknowledgement or lease effect.
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

use super::kernel::{
    NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices, ToolTimeout,
};
use super::task_discovery::{self as read, check_id, invalid};
use super::task_wait_state::{Mode, Target};
use super::ToolResult;
use crate::store;

pub(super) const MAX_TARGETS: usize = 8;
pub(super) const MAX_TIMEOUT_MS: u64 = 60_000;
pub(super) const MAX_OUTPUT_BYTES: usize = 128 * 1024;
const REVALIDATE: Duration = Duration::from_millis(250);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WaitInput {
    targets: Vec<Target>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(skip)]
    authorized_project: Option<String>,
}

pub(crate) struct WaitTasksTool;

fn relevant_goal_hint(
    hint: &store::goal_changes::TaskChange,
    path: &std::path::Path,
    targets: &[Target],
) -> bool {
    match hint {
        store::goal_changes::TaskChange::Goal(hint) => {
            hint.store_path == path
                && hint.version >= 0
                && (hint.status != store::GoalStatus::Active
                    || hint.kind != store::goal_changes::GoalChangeKind::Current)
                && targets.iter().any(|target| {
                    target.session_id == hint.session_id
                        && target.mode == Mode::Goal
                        && target.resolved.as_ref() == Some(&hint.goal_id)
                })
        }
        store::goal_changes::TaskChange::Question {
            store_path,
            session_id,
            run_id,
            goal_id,
        } => {
            store_path == path
                && targets.iter().any(|target| {
                    target.session_id == *session_id
                        && match target.mode {
                            Mode::Run => target.resolved.as_ref() == Some(run_id),
                            Mode::Goal => target.resolved.as_ref() == goal_id.as_ref(),
                        }
                })
        }
    }
}

impl NativeTool for WaitTasksTool {
    type Input = WaitInput;

    fn definition(&self) -> crate::types::ToolDefinition {
        read::definition("wait_tasks", "Passively observe exact independent direct task runs or human-created goals. timeout_ms=0 takes a snapshot; a bounded wait wakes on a new result, stopped goal, failure, existing approval, or this coordinator's pending input. Status/commentary alone stays quiet. Each current selector resolves ONCE; use returned resolved_identity or after_cursor to keep it pinned. Run end is result availability, never objective completion. Repeated cursors suppress replayed proofs; read_task retains inspectable evidence. No attach, recovery, delta approver subscription, acknowledgement, target cancellation or goal mutation. Foreign/unattached owner approvals are unknown. Cursors are untrusted observation hints; resync means authoritative state was re-read after restart or a notification gap.", json!({
            "type":"object","additionalProperties":false,"required":["targets","timeout_ms"],
            "properties":{
                "targets":{"type":"array","minItems":1,"maxItems":MAX_TARGETS,"items":{
                    "anyOf":[super::task_wait_state::target_schema(Mode::Run),super::task_wait_state::target_schema(Mode::Goal)]
                }},
                "timeout_ms":{"type":["integer","null"],"minimum":0,"maximum":MAX_TIMEOUT_MS,"default":0}
            }
        }))
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn timeout(
        &self,
        input: &mut Value,
        requested: Option<Duration>,
    ) -> Result<ToolTimeout, ToolResult> {
        let wait = input["timeout_ms"]
            .as_u64()
            .unwrap_or(0)
            .min(MAX_TIMEOUT_MS);
        Ok(ToolTimeout::bounded(
            requested.unwrap_or(Duration::from_millis(wait + 5_000)),
        ))
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        let input: WaitInput = serde_json::from_value(input)
            .map_err(|error| invalid(format!("invalid wait_tasks arguments: {error}")))?;
        if input.targets.is_empty() || input.targets.len() > MAX_TARGETS {
            return Err(invalid(format!(
                "targets must contain 1 to {MAX_TARGETS} entries"
            )));
        }
        if input
            .timeout_ms
            .is_some_and(|timeout| timeout > MAX_TIMEOUT_MS)
        {
            return Err(invalid("timeout_ms exceeds 60000"));
        }
        for target in &input.targets {
            check_id("session_id", &target.session_id)?;
            for (name, id) in [
                ("project_id", &target.project_id),
                ("run_id", &target.run_id),
                ("goal_id", &target.goal_id),
            ] {
                if let Some(id) = id {
                    check_id(name, id)?;
                }
            }
            if (target.mode == Mode::Run && target.goal_id.is_some())
                || (target.mode == Mode::Goal && target.run_id.is_some())
            {
                return Err(invalid("the identity must match mode"));
            }
            if target
                .after_cursor
                .as_ref()
                .is_some_and(|token| token.len() > 4096)
            {
                return Err(invalid("after_cursor exceeds 4096 bytes"));
            }
        }
        Ok(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        let (_, broker) = read::caller(services)?;
        let mut resources = Vec::new();
        for target in &input.targets {
            resources.push(read::task_resource(&target.session_id));
            resources.push(read::project_resource(
                target.project_id.as_deref().or(broker.caller_project()),
            ));
        }
        Ok(resources)
    }

    fn bind_authorized_resources(
        &self,
        input: &mut Self::Input,
        resources: &[PermissionResource],
        _services: ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        input.authorized_project = read::authorized_project(resources);
        Ok(())
    }

    fn execute<'a>(
        &'a self,
        mut input: Self::Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let timeout_ms = input.timeout_ms.unwrap_or(0);
            let (caller, broker) = match read::caller(services) {
                Ok(identity) => identity,
                Err(error) => return error,
            };
            for target in &mut input.targets {
                if let Err(error) = target.bind_cursor(&caller) {
                    return error;
                }
            }
            // Subscribe before the first snapshot; hints only trigger a read.
            let mut goals = store::goal_changes::subscribe(&services.runtime.store_path);
            let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
            loop {
                let mut reports = Vec::new();
                let mut actionable = false;
                for target in &mut input.targets {
                    let lookup = match read::exact_lookup(
                        "wait_tasks",
                        services,
                        context,
                        (caller.clone(), Arc::clone(&broker)),
                        target.session_id.clone(),
                        (
                            target.project_id.clone(),
                            target
                                .authorized_project
                                .clone()
                                .or_else(|| input.authorized_project.clone()),
                        ),
                    )
                    .await
                    {
                        Ok(value) => value,
                        Err(error) => return error,
                    };
                    if lookup["status"] == "found" {
                        target.authorized_project =
                            lookup["task"]["project_id"].as_str().map(str::to_owned);
                    }
                    let mut observed = target.observe(&lookup);
                    if observed["status"] == "active" {
                        let pending = crate::permissions::task_observation::pending(
                            &services.runtime.store_path,
                            &target.session_id,
                            lookup["task"]["durable"]["current_run"]["run_id"].as_str(),
                        );
                        observed["approvals"] = json!(if pending.is_some() {
                            "local_owner"
                        } else {
                            "unknown"
                        });
                        // Pending authority is process local. A run selector may only
                        // report attention while that exact run is still current.
                        if let Some(requests) = pending.filter(|_| {
                            target.mode == Mode::Goal
                                || lookup["task"]["durable"]["current_run"]["run_id"].as_str()
                                    == target.resolved.as_deref()
                        }) {
                            if let Some(request) = requests.first() {
                                let check = match read::exact_lookup(
                                    "wait_tasks",
                                    services,
                                    context,
                                    (caller.clone(), Arc::clone(&broker)),
                                    target.session_id.clone(),
                                    (target.project_id.clone(), target.authorized_project.clone()),
                                )
                                .await
                                {
                                    Ok(value) => value,
                                    Err(error) => return error,
                                };
                                let same_run = check["task"]["durable"]["current_run"]
                                    == lookup["task"]["durable"]["current_run"];
                                let still_active = target.observe(&check)["status"] == "active";
                                let still_pending = crate::permissions::task_observation::pending(
                                    &services.runtime.store_path,
                                    &target.session_id,
                                    check["task"]["durable"]["current_run"]["run_id"].as_str(),
                                )
                                .is_some_and(|pending| pending.iter().any(|p| p.id == request.id));
                                if same_run && still_active && still_pending {
                                    observed["status"] = json!("approval_attention");
                                    observed["attention"] = json!({"request_id":request.id,"session_id":request.session_id,
                                    "navigation":format!("{}/insights?permission_request={}",read::navigation(&target.session_id),request.id),
                                    "detail":"Existing approval only. Opening or answering revalidates this exact request; wait_tasks cannot answer it."});
                                }
                            }
                        }
                    }
                    let (report, ready) = target.report(&caller, observed);
                    reports.push(report);
                    actionable |= ready;
                }
                let path = services.runtime.store_path.clone();
                let coordinator = caller.clone();
                let interrupted = match store::spawn_blocking_store_caller(move || {
                    store::next_pending_session_inbox_item(&path, &coordinator)
                })
                .await
                {
                    Ok(Ok(item)) => item.is_some(),
                    Ok(Err(error)) | Err(error) => return read::unavailable(error),
                };
                let now = tokio::time::Instant::now();
                // Inspect buffered delivery before returning even when the first
                // read exhausted the deadline. Gaps still require explicit resync.
                let revalidate = match goals.try_recv() {
                    Ok(hint) => {
                        relevant_goal_hint(&hint, &services.runtime.store_path, &input.targets)
                    }
                    Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_)) => {
                        for (target, report) in input.targets.iter_mut().zip(&mut reports) {
                            target.resync = true;
                            report["resync"] = json!(true);
                        }
                        true
                    }
                    _ => false,
                };
                if revalidate && !actionable && !interrupted && timeout_ms > 0 && now < deadline {
                    continue;
                }
                let reason = if interrupted {
                    Some("coordinator_input")
                } else if actionable {
                    Some("target_changed")
                } else if timeout_ms == 0 {
                    Some("snapshot")
                } else if now >= deadline {
                    Some("timeout")
                } else {
                    None
                };
                if let Some(reason) = reason {
                    let output = json!({"status":reason,"as_of":store::now_utc(),"targets":reports,
                        "provenance":"authoritative passive durable reads; approvals separately observed only from an existing process-local owner; no evidence acknowledged"}).to_string();
                    if output.len() > MAX_OUTPUT_BYTES {
                        return invalid(
                            "wait_tasks output exceeds 131072 bytes; request fewer targets",
                        );
                    }
                    return ToolResult::text(output, false);
                }
                let next_read = now + REVALIDATE;
                loop {
                    tokio::select! {
                        _ = context.cancellation(services.runtime).cancelled() => {
                            return ToolResult::text(json!({"status":"cancelled","targets":reports}).to_string(),false);
                        }
                        _ = tokio::time::sleep_until(next_read.min(deadline)) => { break; }
                        hint = goals.recv() => {
                            match hint {
                                Ok(hint) => {
                                    let relevant = relevant_goal_hint(&hint,&services.runtime.store_path,&input.targets);
                                    if !relevant { continue; }
                                        break;
                                }
                                Err(_) => { for target in &mut input.targets { target.resync = true; } break; }
                            }
                        }
                    }
                }
            }
        })
    }
}

#[cfg(test)]
#[path = "task_wait_tests.rs"]
mod tests;
