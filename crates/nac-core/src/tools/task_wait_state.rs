//! Exact selectors and replay suppression. Cursors are untrusted observation
//! hints, never authorization, acknowledgements, or a second evidence store.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::LazyLock;

use super::task_discovery::invalid;
use super::ToolResult;

pub(super) static EPOCH: LazyLock<String> = LazyLock::new(|| uuid::Uuid::new_v4().to_string());

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum Mode {
    #[default]
    Run,
    Goal,
}

// The advertised default remains run mode when a provider supplies null.
fn mode_or_default<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Mode, D::Error> {
    Ok(Option::<Mode>::deserialize(deserializer)?.unwrap_or_default())
}

/// Closed, disjoint provider shapes keep irrelevant identities explicitly null.
/// Native decoding remains flat and accepts omitted optional fields for callers
/// that already use the original compact form.
pub(super) fn target_schema(mode: Mode) -> Value {
    let identity = json!({"type":["string","null"],"minLength":1,"maxLength":160});
    let unused = json!({"type":"null"});
    let (run_id, goal_id) = match mode {
        Mode::Run => (&identity, &unused),
        Mode::Goal => (&unused, &identity),
    };
    json!({
        "type":"object","additionalProperties":false,
        "required":["session_id","project_id","mode","run_id","goal_id","after_cursor"],
        "properties":{
            "session_id":{"type":"string","minLength":1,"maxLength":160},
            "project_id":identity,
            "mode":match mode {
                Mode::Run => json!({"type":["string","null"],"enum":["run",null],"default":"run"}),
                Mode::Goal => json!({"type":"string","enum":["goal"]}),
            },
            "run_id":run_id,
            "goal_id":goal_id,
            "after_cursor":{"type":["string","null"],"minLength":1,"maxLength":4096}
        }
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Target {
    pub session_id: String,
    pub project_id: Option<String>,
    #[serde(default, deserialize_with = "mode_or_default")]
    pub mode: Mode,
    pub run_id: Option<String>,
    pub goal_id: Option<String>,
    pub after_cursor: Option<String>,
    #[serde(skip)]
    pub resolved: Option<String>,
    #[serde(skip)]
    pub pinned: bool,
    #[serde(skip)]
    pub previous: Option<Cursor>,
    #[serde(skip)]
    pub resync: bool,
    #[serde(skip)]
    pub authorized_project: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Cursor {
    caller: String,
    session: String,
    project: Option<String>,
    mode: Mode,
    identity: Option<String>,
    fingerprint: String,
    epoch: String,
}

impl Target {
    pub fn bind_cursor(&mut self, caller: &str) -> Result<(), ToolResult> {
        if let Some(token) = &self.after_cursor {
            let cursor: Cursor = serde_json::from_str(token)
                .map_err(|_| invalid("after_cursor must be a returned wait_tasks cursor"))?;
            if cursor.caller != caller
                || cursor.session != self.session_id
                || cursor.project != self.project_id
                || cursor.mode != self.mode
            {
                return Err(invalid(
                    "after_cursor belongs to a different caller, target or scope",
                ));
            }
            let explicit = match self.mode {
                Mode::Run => &self.run_id,
                Mode::Goal => &self.goal_id,
            };
            if explicit
                .as_ref()
                .is_some_and(|id| Some(id) != cursor.identity.as_ref())
            {
                return Err(invalid("exact identity conflicts with after_cursor"));
            }
            self.resolved = cursor.identity.clone();
            self.pinned = true;
            self.resync = cursor.epoch != *EPOCH;
            self.previous = Some(cursor);
        }
        Ok(())
    }

    pub fn observe(&mut self, lookup: &Value) -> Value {
        if lookup["status"] != "found" {
            if !self.pinned {
                self.resolved = match self.mode {
                    Mode::Run => self.run_id.clone(),
                    Mode::Goal => self.goal_id.clone(),
                };
                self.pinned = true;
            }
            return json!({"status": lookup["status"], "detail":lookup["detail"]});
        }
        let durable = &lookup["task"]["durable"];
        if !self.pinned {
            self.resolved = match self.mode {
                Mode::Run => self.run_id.clone().or_else(|| {
                    durable["current_run"]["run_id"]
                        .as_str()
                        .or_else(|| durable["run_outcomes"][0]["run_id"].as_str())
                        .map(str::to_owned)
                }),
                Mode::Goal => self
                    .goal_id
                    .clone()
                    .or_else(|| durable["goal"]["goal_id"].as_str().map(str::to_owned)),
            };
            self.pinned = true;
        }
        let Some(id) = self.resolved.as_deref() else {
            return json!({"status":"unavailable", "detail":"No current identity existed when this selector was resolved; it will not advance to later work."});
        };
        let question = &durable["pending_question"];
        let relevant = match self.mode {
            Mode::Run => question["request"]["run_id"] == id,
            Mode::Goal => question["goal_id"] == id && durable["goal"]["goal_id"] == id,
        };
        if relevant && question["status"] == "pending" {
            let request = &question["request"];
            let request_id = request["request_id"].as_str().unwrap_or_default();
            return json!({"status":"question_attention","attention":{
                "session_id":self.session_id,"request_id":request_id,"run_id":request["run_id"],
                "generation":request["generation"],"revision":question["revision"],
                "text":request["text"],"choices":request["choices"],"responder_class":request["responder_class"],
                "navigation":format!("{}/insights?question_request={}",super::task_discovery::navigation(&self.session_id),super::task_discovery::url_component(request_id))
            }});
        }
        match self.mode {
            Mode::Run => {
                if let Some(outcome) = durable["run_outcomes"]
                    .as_array()
                    .and_then(|runs| runs.iter().find(|run| run["run_id"] == id))
                {
                    let status = match outcome["disposition"].as_str() {
                        Some("completed") => "result_available",
                        Some("failed") => "failed",
                        _ => "cancelled",
                    };
                    let excerpt = outcome["result_excerpt"]
                        .as_str()
                        .map(|s| s.chars().take(500).collect::<String>());
                    return json!({"status":status,"proof":{
                        "run_id":id,"disposition":outcome["disposition"],
                        "finished_at":outcome["finished_at"],"result_excerpt":excerpt,
                        "result_truncated":outcome["result_truncated"].as_bool().unwrap_or(false)
                            || outcome["result_excerpt"].as_str().is_some_and(|s| s.chars().count()>500),
                        "failure":outcome["failure"],
                    }});
                }
                let current = &durable["current_run"];
                if current["run_id"] == id {
                    return match current["status"].as_str() {
                        Some("active") => json!({"status":"active"}),
                        Some("failed") => json!({"status":"failed","proof":current}),
                        _ => {
                            json!({"status":"unavailable","detail":"The exact run was interrupted; no retained terminal result is available."})
                        }
                    };
                }
                json!({"status":"unavailable","detail":"Exact run is not current or retained; it may have been replaced or aged out. Inspect read_task; no later run was selected."})
            }
            Mode::Goal => {
                let current = &durable["goal"];
                let (goal, retained, last_run) = if current["goal_id"] == id {
                    let last_run = if current["accounting_run_id"].is_string() {
                        &current["accounting_run_id"]
                    } else {
                        &durable["goal_last_run_id"]
                    };
                    (Some(current), false, last_run)
                } else {
                    let old = durable["prior_goals"]
                        .as_array()
                        .and_then(|goals| goals.iter().find(|goal| goal["goal_id"] == id));
                    (old, true, &Value::Null)
                };
                match goal {
                    Some(goal) => {
                        let status = if retained && goal["status"] == "active" {
                            goal["retirement"].as_str().unwrap_or("replaced").to_owned()
                        } else if goal["status"] == "active" {
                            "active".into()
                        } else {
                            format!("goal_{}", goal["status"].as_str().unwrap_or("unavailable"))
                        };
                        json!({"status":status,"proof":{
                            "goal_id":id,"version":goal["version"],"goal_status":goal["status"],
                            "retained":retained,"retirement":goal["retirement"],
                            "last_run_id":if retained { &goal["last_run_id"] } else {last_run},
                            "failure":goal["last_failure"],
                        }})
                    }
                    None => {
                        json!({"status":"unavailable","detail":"Exact goal is neither current nor retained; it may have been cleared, replaced or aged out. No replacement goal was selected."})
                    }
                }
            }
        }
    }

    pub fn report(&self, caller: &str, mut observation: Value) -> (Value, bool) {
        // Active accounting/progress changes are deliberately quiet.
        let fingerprint = if observation["status"] == "active" {
            "active".to_owned()
        } else if observation["status"] == "goal_complete" {
            "goal_complete".to_owned()
        } else {
            format!("{:x}", Sha256::digest(observation.to_string().as_bytes()))
        };
        let changed = self
            .previous
            .as_ref()
            .is_none_or(|previous| previous.fingerprint != fingerprint);
        let actionable = observation["status"] != "active" && changed;
        if !changed {
            if let Some(object) = observation.as_object_mut() {
                object.remove("proof");
                object.remove("attention");
                object.insert("unchanged".into(), json!(true));
            }
        }
        let cursor = Cursor {
            caller: caller.to_owned(),
            session: self.session_id.clone(),
            project: self.project_id.clone(),
            mode: self.mode,
            identity: self.resolved.clone(),
            fingerprint,
            epoch: EPOCH.clone(),
        };
        observation["session_id"] = json!(self.session_id);
        observation["mode"] = json!(self.mode);
        observation["resolved_identity"] = json!(self.resolved);
        observation["after_cursor"] = json!(json!(cursor).to_string());
        observation["resync"] = json!(self.resync);
        observation["navigation"] = json!(super::task_discovery::navigation(&self.session_id));
        (observation, actionable)
    }
}
