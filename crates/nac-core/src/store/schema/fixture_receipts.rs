//! Populate typed predecessor heartbeat receipts in synthetic migration fixtures.
//! Called during fixture construction, before the before-migration snapshots.
use super::*;
use rusqlite::OptionalExtension;
use serde_json::{json, Value};

pub(super) fn populate(conn: &Connection) {
    let exists = |name: &str| {
        conn.query_row::<bool, _, _>(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [name],
            |r| r.get(0),
        )
        .unwrap()
    };
    if !exists("heartbeat_schedules") {
        return;
    }
    let mut stmt = conn
        .prepare("SELECT schedule_id,session_id FROM heartbeat_schedules")
        .unwrap();
    let schedules = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    drop(stmt);
    for (id, session) in schedules {
        let fresh: Option<(String, Option<String>)> = if exists("heartbeat_fresh_destinations") {
            conn.query_row("SELECT project_id,creator_session_id FROM heartbeat_fresh_destinations WHERE schedule_id=?1", [&id], |r| Ok((r.get(0)?,r.get(1)?))).optional().unwrap()
        } else {
            None
        };
        let destination = fresh.as_ref().map(|(project,_)| json!({"project_id":project,"pinned_commit":null,"default_ref":null,"model_selection":null,"model":null,"reasoning_effort":null,"retained_limit":2}));
        let binding = json!({"config_version":0,"cwd":"/fixture","project_id":fresh.as_ref().map(|v| &v.0),"backend":"local","execution_cwd":null,"scheduling_request":"retained binding","seen_through_sequence":0,"fresh_task":destination,"creator_session_id":fresh.as_ref().and_then(|v| v.1.as_ref())});
        conn.execute(
            "UPDATE heartbeat_schedules SET binding_json=?1 WHERE schedule_id=?2",
            params![binding.to_string(), id],
        )
        .unwrap();
        if let Some(dest) = &destination {
            conn.execute("UPDATE heartbeat_fresh_destinations SET destination_json=?1,binding_json=?2 WHERE schedule_id=?3",params![dest.to_string(),binding.to_string(),id]).unwrap();
        }
        if exists("heartbeat_commands") {
            let mut query = conn
                .prepare(
                    "SELECT session_id,request_id FROM heartbeat_commands WHERE schedule_id=?1",
                )
                .unwrap();
            let commands = query
                .query_map([&id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            drop(query);
            for (scope, request) in commands {
                let receipt = json!({"request_id":request,"schedule":{"schedule_id":id,"session_id":session,"version":1,"state":"paused","binding":binding,"spec":{"name":"fixture","instructions":"fixture","interval_ms":60000,"end_condition":"done","goal_id":null,"token_allowance":null},"anchor_ms":0,"next_due_ms":60000,"reason":"retained response","starts":0,"tokens_used":0,"time_used_ms":0,"usage_unknown":false,"created_at_ms":0,"updated_at_ms":0},"occurrence":null,"active_occurrence":null});
                conn.execute("UPDATE heartbeat_commands SET response_json=?1 WHERE session_id=?2 AND request_id=?3",params![receipt.to_string(),scope,request]).unwrap();
            }
        }
        if let Some(dest) = destination {
            if exists("heartbeat_task_launches") {
                let mut query = conn.prepare("SELECT occurrence_id,request_id,project_id,session_id FROM heartbeat_task_launches WHERE schedule_id=?1").unwrap();
                let launches = query
                    .query_map([&id], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, Option<String>>(3)?,
                        ))
                    })
                    .unwrap()
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .unwrap();
                drop(query);
                for (occurrence, request, project, session_id) in launches {
                    let receipt: Value = json!({"receipt":{"occurrence_id":occurrence,"schedule_id":id,"request":{"request_id":request,"project_id":project,"invoking_session_id":null,"model_selection":null,"git_ref":null,"default_ref":null,"title":"Fixture","prompt":"retained launch"},"destination":dest,"binding":binding,"session_id":session_id.unwrap_or_else(||"deleted".into()),"first_input_id":null,"stop_requested":false,"initial_run_id":null,"initial_outcome":null,"shared_directory":null,"created_at_ms":0}});
                    conn.execute(
                        "UPDATE heartbeat_task_launches SET launch_json=?1 WHERE occurrence_id=?2",
                        params![receipt.to_string(), occurrence],
                    )
                    .unwrap();
                }
            }
        }
    }
}
