//! Version-54 model selection evidence retained by durable task receipts.
//!
//! Only exact, transactionally marked predecessor records may use this private
//! decoder; public request deserialization always uses the strict current type.
use super::*;
use serde::de::{DeserializeOwned, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use sha2::{Digest, Sha256};

const OLD: &str = "orchestrator_compaction_threshold";
const NEW: &str = "compaction_threshold";
const FIELDS: &[&str] = &[
    "backend",
    "model",
    "base_url",
    "allow_insecure_http",
    "api_key_env",
    "reasoning_effort",
    "extra_headers",
    OLD,
];

// A v54 writer could not emit duplicate JSON keys. Reject duplicates before
// forming a map, so contradictory old/current evidence cannot be hidden by
// serde_json's normal last-key-wins Value decoding.
struct UniqueValue(serde_json::Value);
impl<'de> Deserialize<'de> for UniqueValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        struct UniqueVisitor;
        impl<'de> Visitor<'de> for UniqueVisitor {
            type Value = UniqueValue;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("JSON without duplicate object keys")
            }
            fn visit_bool<E: serde::de::Error>(
                self,
                v: bool,
            ) -> std::result::Result<Self::Value, E> {
                Ok(UniqueValue(v.into()))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> std::result::Result<Self::Value, E> {
                Ok(UniqueValue(v.into()))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> std::result::Result<Self::Value, E> {
                Ok(UniqueValue(v.into()))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> std::result::Result<Self::Value, E> {
                serde_json::Number::from_f64(v)
                    .map(|n| UniqueValue(n.into()))
                    .ok_or_else(|| E::custom("invalid JSON number"))
            }
            fn visit_str<E: serde::de::Error>(
                self,
                v: &str,
            ) -> std::result::Result<Self::Value, E> {
                Ok(UniqueValue(v.into()))
            }
            fn visit_string<E: serde::de::Error>(
                self,
                v: String,
            ) -> std::result::Result<Self::Value, E> {
                Ok(UniqueValue(v.into()))
            }
            fn visit_unit<E: serde::de::Error>(self) -> std::result::Result<Self::Value, E> {
                Ok(UniqueValue(serde_json::Value::Null))
            }
            fn visit_none<E: serde::de::Error>(self) -> std::result::Result<Self::Value, E> {
                self.visit_unit()
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                while let Some(UniqueValue(value)) = seq.next_element()? {
                    values.push(value);
                }
                Ok(UniqueValue(values.into()))
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut map: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut values = serde_json::Map::new();
                while let Some((key, UniqueValue(value))) =
                    map.next_entry::<String, UniqueValue>()?
                {
                    if values.insert(key, value).is_some() {
                        return Err(serde::de::Error::custom("duplicate JSON object key"));
                    }
                }
                Ok(UniqueValue(values.into()))
            }
        }
        deserializer.deserialize_any(UniqueVisitor)
    }
}

#[derive(Clone, Copy)]
pub(super) enum Owner {
    Task,
    Native,
    Schedule,
    Launch,
    Command,
    Destination,
    DestinationBinding,
}
impl Owner {
    fn name(self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Native => "native",
            Self::Schedule => "schedule",
            Self::Launch => "launch",
            Self::Command => "command",
            Self::Destination => "destination",
            Self::DestinationBinding => "destination_binding",
        }
    }
    fn paths(self) -> &'static [&'static str] {
        match self {
            Self::Task => &["/model_selection"],
            Self::Native => &["/_nac_model_selection"],
            Self::Schedule | Self::DestinationBinding => &["/fresh_task/model_selection"],
            Self::Destination => &["/model_selection"],
            Self::Launch => &[
                "/receipt/request/model_selection",
                "/receipt/destination/model_selection",
                "/receipt/binding/fresh_task/model_selection",
            ],
            Self::Command => &["/schedule/binding/fresh_task/model_selection"],
        }
    }
    fn bound(self) -> Option<&'static str> {
        match self {
            Self::Schedule | Self::DestinationBinding => Some("/fresh_task"),
            Self::Launch => Some("/receipt"),
            _ => None,
        }
    }
}

fn parsed(raw: &str, owner: Owner) -> Result<(serde_json::Value, bool, String)> {
    let UniqueValue(mut value) = serde_json::from_str(raw)?;
    // Capture the predecessor's typed authority before changing its key.
    let evidence = match owner.bound() {
        Some(path) => value.pointer(path).map(serde_json::to_vec).transpose()?,
        None => Some(raw.as_bytes().to_vec()),
    };
    let mut legacy = false;
    let mut legacy_copies = 0;
    for path in owner.paths() {
        let Some(selection) = value.pointer_mut(path) else {
            continue;
        };
        if selection.is_null() {
            continue;
        }
        let object = selection
            .as_object_mut()
            .context("legacy task model selection must be an object or null")?;
        anyhow::ensure!(
            object.contains_key(OLD),
            "legacy task model selection is missing its v54 threshold"
        );
        anyhow::ensure!(
            !object.contains_key(NEW)
                && object.len() == FIELDS.len()
                && FIELDS.iter().all(|field| object.contains_key(*field)),
            "contradictory legacy task model selection"
        );
        let threshold = object
            .remove(OLD)
            .context("missing legacy task threshold")?;
        object.insert(NEW.into(), threshold);
        let _: crate::store::TaskModelSelection = serde_json::from_value(selection.clone())?;
        legacy = true;
        legacy_copies += 1;
    }
    anyhow::ensure!(
        !matches!(owner, Owner::Launch) || !legacy || legacy_copies == 3,
        "legacy scheduled task contains mixed model formats"
    );
    let digest = if legacy {
        format!(
            "{:x}",
            Sha256::digest(evidence.context("missing legacy receipt binding")?)
        )
    } else {
        String::new()
    };
    Ok((value, legacy, digest))
}

// v54 wrote the schedule and both destination copies in one transaction.
// Compare their typed authority fields, not mutable attention/progress data.
fn verify_schedule_destination(conn: &Connection, schedule_id: &str) -> Result<()> {
    let (session_id, schedule_raw): (Option<String>, String) = conn
        .query_row(
            "SELECT session_id,binding_json FROM heartbeat_schedules WHERE schedule_id=?1",
            [schedule_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .context("legacy fresh schedule owner is missing")?;
    anyhow::ensure!(
        session_id.is_none(),
        "legacy fresh schedule has a session owner"
    );
    let (project_id, creator_id, destination_raw, destination_binding_raw): (String,Option<String>,String,String) = conn.query_row(
        "SELECT project_id,creator_session_id,destination_json,binding_json FROM heartbeat_fresh_destinations WHERE schedule_id=?1",
        [schedule_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)),
    ).context("legacy fresh destination is missing")?;
    let (schedule, _, _) = parsed(&schedule_raw, Owner::Schedule)?;
    let (destination, _, _) = parsed(&destination_raw, Owner::Destination)?;
    let (destination_binding, _, _) = parsed(&destination_binding_raw, Owner::DestinationBinding)?;
    let schedule: HeartbeatBinding = serde_json::from_value(schedule)?;
    let destination: FreshTaskDestination = serde_json::from_value(destination)?;
    let destination_binding: HeartbeatBinding = serde_json::from_value(destination_binding)?;
    anyhow::ensure!(
        destination.project_id == project_id
            && schedule.project_id.as_deref() == Some(project_id.as_str())
            && destination_binding.project_id.as_deref() == Some(project_id.as_str())
            && schedule.creator_session_id == creator_id
            && destination_binding.creator_session_id == creator_id
            && schedule.fresh_task.as_ref() == Some(&destination)
            && destination_binding.fresh_task.as_ref() == Some(&destination),
        "legacy fresh schedule and destination ownership differs"
    );
    Ok(())
}

// A marker grants the bounded v54 decoder access to durable authority. Bind
// every identity that the original writer duplicated in the owning row and
// receipt before recording that provenance. Never infer missing owners.
fn verify_owner(
    conn: &Connection,
    owner: Owner,
    key1: &str,
    key2: &str,
    value: &serde_json::Value,
) -> Result<()> {
    fn same(value: &serde_json::Value, path: &str, expected: &str) -> Result<()> {
        anyhow::ensure!(
            value.pointer(path).and_then(serde_json::Value::as_str) == Some(expected),
            "legacy task receipt ownership differs at {path}"
        );
        Ok(())
    }
    fn project<'a>(value: &'a serde_json::Value, path: &str) -> Result<&'a str> {
        value
            .pointer(path)
            .and_then(serde_json::Value::as_str)
            .context("legacy task receipt has no project identity")
    }
    match owner {
        Owner::Task => {
            let id: String = conn.query_row(
                "SELECT project_id FROM task_launches WHERE request_id=?1",
                [key1],
                |r| r.get(0),
            )?;
            same(value, "/request_id", key1)?;
            same(value, "/project_id", &id)?;
        }
        Owner::Native => {
            let id: String = conn.query_row(
                "SELECT project_id FROM native_task_launches WHERE request_id=?1",
                [key1],
                |r| r.get(0),
            )?;
            same(value, "/request_id", key1)?;
            if let Some(project_id) = value.pointer("/project_id").filter(|v| !v.is_null()) {
                anyhow::ensure!(
                    project_id.as_str() == Some(id.as_str()),
                    "legacy native project binding differs"
                );
            }
        }
        Owner::Schedule => {
            let session: Option<String> = conn.query_row(
                "SELECT session_id FROM heartbeat_schedules WHERE schedule_id=?1",
                [key1],
                |r| r.get(0),
            )?;
            anyhow::ensure!(
                session.is_none(),
                "legacy fresh schedule has a session owner"
            );
            let id = project(value, "/fresh_task/project_id")?;
            same(value, "/project_id", id)?;
        }
        Owner::Launch => {
            let (schedule, request, project_id, session): (String,String,String,Option<String>) = conn.query_row("SELECT schedule_id,request_id,project_id,session_id FROM heartbeat_task_launches WHERE occurrence_id=?1", [key1], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
            same(value, "/receipt/occurrence_id", key1)?;
            same(value, "/receipt/schedule_id", &schedule)?;
            same(value, "/receipt/request/request_id", &request)?;
            for path in [
                "/receipt/request/project_id",
                "/receipt/destination/project_id",
                "/receipt/binding/project_id",
                "/receipt/binding/fresh_task/project_id",
            ] {
                same(value, path, &project_id)?;
            }
            if let Some(session) = session {
                same(value, "/receipt/session_id", &session)?;
            }
            let destination: FreshTaskDestination = serde_json::from_value(
                value
                    .pointer("/receipt/destination")
                    .cloned()
                    .context("legacy launch has no destination")?,
            )?;
            let bound: FreshTaskDestination = serde_json::from_value(
                value
                    .pointer("/receipt/binding/fresh_task")
                    .cloned()
                    .context("legacy launch has no bound destination")?,
            )?;
            let request: TaskLaunchRequest = serde_json::from_value(
                value
                    .pointer("/receipt/request")
                    .cloned()
                    .context("legacy launch has no request")?,
            )?;
            anyhow::ensure!(
                destination == bound,
                "legacy scheduled destination binding differs"
            );
            anyhow::ensure!(
                request.invoking_session_id.is_none()
                    && request.git_ref == destination.pinned_commit
                    && request.default_ref == destination.default_ref,
                "legacy scheduled request source binding differs"
            );
        }
        Owner::Command => {
            let schedule: String = conn.query_row(
                "SELECT schedule_id FROM heartbeat_commands WHERE session_id=?1 AND request_id=?2",
                params![key1, key2],
                |r| r.get(0),
            )?;
            same(value, "/request_id", key2)?;
            same(value, "/schedule/schedule_id", &schedule)?;
            anyhow::ensure!(
                value
                    .pointer("/schedule/session_id")
                    .is_none_or(|v| v.is_null()),
                "legacy fresh command has a session-owned schedule"
            );
            for path in ["/occurrence", "/active_occurrence"] {
                if value.pointer(path).is_some_and(|v| !v.is_null()) {
                    same(value, &format!("{path}/schedule_id"), &schedule)?;
                }
            }
            let id = project(value, "/schedule/binding/fresh_task/project_id")?;
            anyhow::ensure!(
                key1 == format!("project:{id}"),
                "legacy fresh command owner scope differs"
            );
            same(value, "/schedule/binding/project_id", id)?;
        }
        Owner::Destination | Owner::DestinationBinding => {
            let (id, creator, destination_raw, binding_raw): (String,Option<String>,String,String) = conn.query_row("SELECT project_id,creator_session_id,destination_json,binding_json FROM heartbeat_fresh_destinations WHERE schedule_id=?1", [key1], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
            if matches!(owner, Owner::Destination) {
                same(value, "/project_id", &id)?;
            } else {
                same(value, "/project_id", &id)?;
                same(value, "/fresh_task/project_id", &id)?;
                let recorded = value
                    .pointer("/creator_session_id")
                    .and_then(serde_json::Value::as_str);
                anyhow::ensure!(
                    recorded == creator.as_deref(),
                    "legacy fresh destination creator differs"
                );
            }
            let (destination, destination_legacy, _) =
                parsed(&destination_raw, Owner::Destination)?;
            let (binding, binding_legacy, _) = parsed(&binding_raw, Owner::DestinationBinding)?;
            anyhow::ensure!(
                destination_legacy
                    && binding_legacy
                    && binding.pointer("/fresh_task") == Some(&destination),
                "legacy fresh destination copies disagree"
            );
            same(&binding, "/project_id", &id)?;
            same(&binding, "/fresh_task/project_id", &id)?;
            anyhow::ensure!(
                binding
                    .pointer("/creator_session_id")
                    .and_then(serde_json::Value::as_str)
                    == creator.as_deref(),
                "legacy fresh destination creator differs"
            );
        }
    }
    Ok(())
}

fn verify_shape(owner: Owner, value: &serde_json::Value) -> Result<()> {
    match owner {
        Owner::Task => {
            let _: TaskLaunchRequest = serde_json::from_value(value.clone())?;
        }
        Owner::Native => {
            let mut request = value.clone();
            request
                .as_object_mut()
                .context("legacy native request is not an object")?
                .remove("_nac_model_selection");
            let _: crate::task_launch_control::NativeTaskRequest = serde_json::from_value(request)?;
        }
        Owner::Schedule | Owner::DestinationBinding => {
            let _: HeartbeatBinding = serde_json::from_value(value.clone())?;
        }
        Owner::Launch => {
            let _: FreshTaskLaunchReceipt = serde_json::from_value(
                value
                    .pointer("/receipt")
                    .cloned()
                    .context("legacy launch has no receipt")?,
            )?;
        }
        Owner::Command => {
            let _: HeartbeatReceipt = serde_json::from_value(value.clone())?;
        }
        Owner::Destination => {
            let _: FreshTaskDestination = serde_json::from_value(value.clone())?;
        }
    }
    Ok(())
}

pub(super) fn decode<T: DeserializeOwned>(
    conn: &Connection,
    owner: Owner,
    key1: &str,
    key2: &str,
    raw: &str,
) -> Result<(T, bool)> {
    if !raw.contains(OLD) {
        return Ok((serde_json::from_str(raw)?, false));
    }
    let marked: Option<String> = conn.query_row("SELECT evidence_sha256 FROM task_model_v54_provenance WHERE owner=?1 AND key1=?2 AND key2=?3", params![owner.name(), key1, key2], |row|row.get(0)).optional()?;
    let Some(marked) = marked else {
        return Ok((serde_json::from_str(raw)?, false));
    };
    let (value, legacy, digest) = parsed(raw, owner)?;
    anyhow::ensure!(
        legacy && digest == marked,
        "legacy task model evidence changed"
    );
    Ok((serde_json::from_value(value)?, true))
}

/// Called inside the existing retirement transaction; no JSON is rewritten.
pub(super) fn migrate(conn: &Connection) -> Result<()> {
    create_schema(conn)?;
    capture_v54(conn)
}

fn capture_v54(conn: &Connection) -> Result<()> {
    for (owner, table, key1, key2, column) in [
        (
            Owner::Task,
            "task_launches",
            "request_id",
            "''",
            "request_json",
        ),
        (
            Owner::Native,
            "native_task_launches",
            "request_id",
            "''",
            "request_json",
        ),
        (
            Owner::Schedule,
            "heartbeat_schedules",
            "schedule_id",
            "''",
            "binding_json",
        ),
        (
            Owner::Launch,
            "heartbeat_task_launches",
            "occurrence_id",
            "''",
            "launch_json",
        ),
        (
            Owner::Command,
            "heartbeat_commands",
            "session_id",
            "request_id",
            "response_json",
        ),
        (
            Owner::Destination,
            "heartbeat_fresh_destinations",
            "schedule_id",
            "''",
            "destination_json",
        ),
        (
            Owner::DestinationBinding,
            "heartbeat_fresh_destinations",
            "schedule_id",
            "''",
            "binding_json",
        ),
    ] {
        let sql = format!("SELECT {key1},{key2},{column} FROM {table}");
        let mut query = conn.prepare(&sql)?;
        let mut rows = query.query([])?;
        while let Some(row) = rows.next()? {
            let key1: String = row.get(0)?;
            let key2: String = row.get(1)?;
            let raw: String = row.get(2)?;
            let (value, legacy, digest) = parsed(&raw, owner)?;
            verify_shape(owner, &value).context("malformed legacy task receipt")?;
            if (matches!(owner, Owner::Schedule)
                && value.pointer("/fresh_task").is_some_and(|v| !v.is_null()))
                || matches!(owner, Owner::Destination | Owner::DestinationBinding)
            {
                verify_schedule_destination(conn, &key1)?;
            }
            if legacy {
                verify_owner(conn, owner, &key1, &key2, &value)?;
                let identity = match owner {
                    Owner::Task | Owner::Native => Some(("/request_id", key1.as_str())),
                    Owner::Command => Some(("/request_id", key2.as_str())),
                    Owner::Launch => Some(("/receipt/occurrence_id", key1.as_str())),
                    _ => None,
                };
                if let Some((path, expected)) = identity {
                    anyhow::ensure!(
                        value.pointer(path).and_then(serde_json::Value::as_str) == Some(expected),
                        "legacy task receipt identity disagrees with its row"
                    );
                }
                if matches!(owner, Owner::Launch) {
                    let selection = value.pointer("/receipt/request/model_selection");
                    anyhow::ensure!(
                        selection.is_some()
                            && selection == value.pointer("/receipt/destination/model_selection")
                            && selection
                                == value.pointer("/receipt/binding/fresh_task/model_selection"),
                        "legacy scheduled task model evidence disagrees"
                    );
                }
                conn.execute("INSERT INTO task_model_v54_provenance(owner,key1,key2,evidence_sha256) VALUES(?1,?2,?3,?4)",params![owner.name(),key1,key2,digest])?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn capture_for_test(conn: &Connection) -> Result<()> {
    capture_v54(conn)
}

pub(super) fn create_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE task_model_v54_provenance (owner TEXT NOT NULL,key1 TEXT NOT NULL,key2 TEXT NOT NULL,evidence_sha256 TEXT NOT NULL,PRIMARY KEY(owner,key1,key2));
        CREATE TRIGGER task_model_v54_task_update AFTER UPDATE OF request_json ON task_launches WHEN OLD.request_json IS NOT NEW.request_json BEGIN DELETE FROM task_model_v54_provenance WHERE owner='task' AND key1=OLD.request_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_task_delete AFTER DELETE ON task_launches BEGIN DELETE FROM task_model_v54_provenance WHERE owner='task' AND key1=OLD.request_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_native_update AFTER UPDATE OF request_json ON native_task_launches WHEN OLD.request_json IS NOT NEW.request_json BEGIN DELETE FROM task_model_v54_provenance WHERE owner='native' AND key1=OLD.request_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_native_delete AFTER DELETE ON native_task_launches BEGIN DELETE FROM task_model_v54_provenance WHERE owner='native' AND key1=OLD.request_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_schedule_update AFTER UPDATE OF binding_json ON heartbeat_schedules WHEN CASE WHEN EXISTS(SELECT 1 FROM task_model_v54_provenance WHERE owner='schedule' AND key1=OLD.schedule_id AND key2='') THEN (json_extract(OLD.binding_json,'$.fresh_task') IS NOT json_extract(NEW.binding_json,'$.fresh_task') OR json_extract(OLD.binding_json,'$.project_id') IS NOT json_extract(NEW.binding_json,'$.project_id') OR json_extract(OLD.binding_json,'$.creator_session_id') IS NOT json_extract(NEW.binding_json,'$.creator_session_id')) ELSE 0 END BEGIN DELETE FROM task_model_v54_provenance WHERE owner='schedule' AND key1=OLD.schedule_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_schedule_delete AFTER DELETE ON heartbeat_schedules BEGIN DELETE FROM task_model_v54_provenance WHERE owner='schedule' AND key1=OLD.schedule_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_launch_update AFTER UPDATE OF launch_json ON heartbeat_task_launches WHEN CASE WHEN EXISTS(SELECT 1 FROM task_model_v54_provenance WHERE owner='launch' AND key1=OLD.occurrence_id AND key2='') THEN json_extract(OLD.launch_json,'$.receipt') IS NOT json_extract(NEW.launch_json,'$.receipt') ELSE 0 END BEGIN DELETE FROM task_model_v54_provenance WHERE owner='launch' AND key1=OLD.occurrence_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_launch_delete AFTER DELETE ON heartbeat_task_launches BEGIN DELETE FROM task_model_v54_provenance WHERE owner='launch' AND key1=OLD.occurrence_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_command_update AFTER UPDATE OF response_json,canonical_digest ON heartbeat_commands WHEN OLD.response_json IS NOT NEW.response_json OR OLD.canonical_digest IS NOT NEW.canonical_digest BEGIN DELETE FROM task_model_v54_provenance WHERE owner='command' AND key1=OLD.session_id AND key2=OLD.request_id; END;
        CREATE TRIGGER task_model_v54_command_delete AFTER DELETE ON heartbeat_commands BEGIN DELETE FROM task_model_v54_provenance WHERE owner='command' AND key1=OLD.session_id AND key2=OLD.request_id; END;
        CREATE TRIGGER task_model_v54_destination_update AFTER UPDATE OF destination_json ON heartbeat_fresh_destinations WHEN OLD.destination_json IS NOT NEW.destination_json BEGIN DELETE FROM task_model_v54_provenance WHERE owner='destination' AND key1=OLD.schedule_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_binding_update AFTER UPDATE OF binding_json ON heartbeat_fresh_destinations WHEN CASE WHEN EXISTS(SELECT 1 FROM task_model_v54_provenance WHERE owner='destination_binding' AND key1=OLD.schedule_id AND key2='') THEN (json_extract(OLD.binding_json,'$.fresh_task') IS NOT json_extract(NEW.binding_json,'$.fresh_task') OR json_extract(OLD.binding_json,'$.project_id') IS NOT json_extract(NEW.binding_json,'$.project_id') OR json_extract(OLD.binding_json,'$.creator_session_id') IS NOT json_extract(NEW.binding_json,'$.creator_session_id')) ELSE 0 END BEGIN DELETE FROM task_model_v54_provenance WHERE owner='destination_binding' AND key1=OLD.schedule_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_destination_delete AFTER DELETE ON heartbeat_fresh_destinations BEGIN DELETE FROM task_model_v54_provenance WHERE owner IN ('destination','destination_binding') AND key1=OLD.schedule_id AND key2=''; END;")?;
    conn.execute_batch("CREATE TRIGGER task_model_v54_task_owner AFTER UPDATE OF request_id,project_id,session_id,source_json,workspace_path ON task_launches WHEN OLD.request_id IS NOT NEW.request_id OR OLD.project_id IS NOT NEW.project_id OR OLD.session_id IS NOT NEW.session_id OR OLD.source_json IS NOT NEW.source_json OR OLD.workspace_path IS NOT NEW.workspace_path BEGIN DELETE FROM task_model_v54_provenance WHERE owner='task' AND key1=OLD.request_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_native_owner AFTER UPDATE OF request_id,project_id,caller_session_id,source_cwd,session_id,retained ON native_task_launches WHEN OLD.request_id IS NOT NEW.request_id OR OLD.project_id IS NOT NEW.project_id OR OLD.caller_session_id IS NOT NEW.caller_session_id OR OLD.source_cwd IS NOT NEW.source_cwd OR OLD.session_id IS NOT NEW.session_id OR OLD.retained IS NOT NEW.retained BEGIN DELETE FROM task_model_v54_provenance WHERE owner='native' AND key1=OLD.request_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_schedule_owner AFTER UPDATE OF schedule_id,session_id ON heartbeat_schedules WHEN OLD.schedule_id IS NOT NEW.schedule_id OR OLD.session_id IS NOT NEW.session_id BEGIN DELETE FROM task_model_v54_provenance WHERE owner='schedule' AND key1=OLD.schedule_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_launch_owner AFTER UPDATE OF occurrence_id,schedule_id,request_id,project_id,session_id ON heartbeat_task_launches WHEN OLD.occurrence_id IS NOT NEW.occurrence_id OR OLD.schedule_id IS NOT NEW.schedule_id OR OLD.request_id IS NOT NEW.request_id OR OLD.project_id IS NOT NEW.project_id OR OLD.session_id IS NOT NEW.session_id BEGIN DELETE FROM task_model_v54_provenance WHERE owner='launch' AND key1=OLD.occurrence_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_command_owner AFTER UPDATE OF session_id,request_id,schedule_id ON heartbeat_commands WHEN OLD.session_id IS NOT NEW.session_id OR OLD.request_id IS NOT NEW.request_id OR OLD.schedule_id IS NOT NEW.schedule_id BEGIN DELETE FROM task_model_v54_provenance WHERE owner='command' AND key1=OLD.session_id AND key2=OLD.request_id; END;
        CREATE TRIGGER task_model_v54_destination_owner AFTER UPDATE OF schedule_id,project_id,creator_session_id ON heartbeat_fresh_destinations WHEN OLD.schedule_id IS NOT NEW.schedule_id OR OLD.project_id IS NOT NEW.project_id OR OLD.creator_session_id IS NOT NEW.creator_session_id BEGIN DELETE FROM task_model_v54_provenance WHERE owner IN ('destination','destination_binding') AND key1=OLD.schedule_id AND key2=''; END;")?;
    conn.execute_batch("CREATE TRIGGER task_model_v54_schedule_cross_update AFTER UPDATE OF binding_json ON heartbeat_schedules WHEN CASE WHEN EXISTS(SELECT 1 FROM task_model_v54_provenance WHERE owner IN ('destination','destination_binding') AND key1=OLD.schedule_id AND key2='') THEN (json_extract(OLD.binding_json,'$.fresh_task') IS NOT json_extract(NEW.binding_json,'$.fresh_task') OR json_extract(OLD.binding_json,'$.project_id') IS NOT json_extract(NEW.binding_json,'$.project_id') OR json_extract(OLD.binding_json,'$.creator_session_id') IS NOT json_extract(NEW.binding_json,'$.creator_session_id')) ELSE 0 END BEGIN DELETE FROM task_model_v54_provenance WHERE owner IN ('destination','destination_binding') AND key1=OLD.schedule_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_schedule_cross_owner AFTER UPDATE OF schedule_id,session_id ON heartbeat_schedules WHEN OLD.schedule_id IS NOT NEW.schedule_id OR OLD.session_id IS NOT NEW.session_id BEGIN DELETE FROM task_model_v54_provenance WHERE owner IN ('destination','destination_binding') AND key1=OLD.schedule_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_schedule_cross_delete AFTER DELETE ON heartbeat_schedules BEGIN DELETE FROM task_model_v54_provenance WHERE owner IN ('destination','destination_binding') AND key1=OLD.schedule_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_destination_cross_update AFTER UPDATE OF destination_json,binding_json,project_id,creator_session_id,schedule_id ON heartbeat_fresh_destinations WHEN CASE WHEN EXISTS(SELECT 1 FROM task_model_v54_provenance WHERE owner IN ('schedule','destination','destination_binding') AND key1=OLD.schedule_id AND key2='') THEN (OLD.destination_json IS NOT NEW.destination_json OR OLD.project_id IS NOT NEW.project_id OR OLD.creator_session_id IS NOT NEW.creator_session_id OR OLD.schedule_id IS NOT NEW.schedule_id OR json_extract(OLD.binding_json,'$.fresh_task') IS NOT json_extract(NEW.binding_json,'$.fresh_task') OR json_extract(OLD.binding_json,'$.project_id') IS NOT json_extract(NEW.binding_json,'$.project_id') OR json_extract(OLD.binding_json,'$.creator_session_id') IS NOT json_extract(NEW.binding_json,'$.creator_session_id')) ELSE 0 END BEGIN DELETE FROM task_model_v54_provenance WHERE owner IN ('schedule','destination','destination_binding') AND key1=OLD.schedule_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_destination_cross_delete AFTER DELETE ON heartbeat_fresh_destinations BEGIN DELETE FROM task_model_v54_provenance WHERE owner='schedule' AND key1=OLD.schedule_id AND key2=''; END;")?;
    Ok(())
}

#[cfg(test)]
#[path = "legacy_task_model_tests.rs"]
mod tests;
