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
        let Some(object) = selection.as_object_mut() else {
            continue;
        };
        if !object.contains_key(OLD) {
            continue;
        }
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
        let sql = format!("SELECT {key1},{key2},{column} FROM {table} WHERE instr({column},?1)>0");
        let mut query = conn.prepare(&sql)?;
        let mut rows = query.query([format!("\"{OLD}\"")])?;
        while let Some(row) = rows.next()? {
            let key1: String = row.get(0)?;
            let key2: String = row.get(1)?;
            let raw: String = row.get(2)?;
            let (value, legacy, digest) = parsed(&raw, owner)?;
            if legacy {
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
        CREATE TRIGGER task_model_v54_schedule_update AFTER UPDATE OF binding_json ON heartbeat_schedules WHEN CASE WHEN EXISTS(SELECT 1 FROM task_model_v54_provenance WHERE owner='schedule' AND key1=OLD.schedule_id AND key2='') THEN json_extract(OLD.binding_json,'$.fresh_task') IS NOT json_extract(NEW.binding_json,'$.fresh_task') ELSE 0 END BEGIN DELETE FROM task_model_v54_provenance WHERE owner='schedule' AND key1=OLD.schedule_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_schedule_delete AFTER DELETE ON heartbeat_schedules BEGIN DELETE FROM task_model_v54_provenance WHERE owner='schedule' AND key1=OLD.schedule_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_launch_update AFTER UPDATE OF launch_json ON heartbeat_task_launches WHEN CASE WHEN EXISTS(SELECT 1 FROM task_model_v54_provenance WHERE owner='launch' AND key1=OLD.occurrence_id AND key2='') THEN json_extract(OLD.launch_json,'$.receipt') IS NOT json_extract(NEW.launch_json,'$.receipt') ELSE 0 END BEGIN DELETE FROM task_model_v54_provenance WHERE owner='launch' AND key1=OLD.occurrence_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_launch_delete AFTER DELETE ON heartbeat_task_launches BEGIN DELETE FROM task_model_v54_provenance WHERE owner='launch' AND key1=OLD.occurrence_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_command_update AFTER UPDATE OF response_json,canonical_digest ON heartbeat_commands WHEN OLD.response_json IS NOT NEW.response_json OR OLD.canonical_digest IS NOT NEW.canonical_digest BEGIN DELETE FROM task_model_v54_provenance WHERE owner='command' AND key1=OLD.session_id AND key2=OLD.request_id; END;
        CREATE TRIGGER task_model_v54_command_delete AFTER DELETE ON heartbeat_commands BEGIN DELETE FROM task_model_v54_provenance WHERE owner='command' AND key1=OLD.session_id AND key2=OLD.request_id; END;
        CREATE TRIGGER task_model_v54_destination_update AFTER UPDATE OF destination_json ON heartbeat_fresh_destinations WHEN OLD.destination_json IS NOT NEW.destination_json BEGIN DELETE FROM task_model_v54_provenance WHERE owner='destination' AND key1=OLD.schedule_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_binding_update AFTER UPDATE OF binding_json ON heartbeat_fresh_destinations WHEN CASE WHEN EXISTS(SELECT 1 FROM task_model_v54_provenance WHERE owner='destination_binding' AND key1=OLD.schedule_id AND key2='') THEN json_extract(OLD.binding_json,'$.fresh_task') IS NOT json_extract(NEW.binding_json,'$.fresh_task') ELSE 0 END BEGIN DELETE FROM task_model_v54_provenance WHERE owner='destination_binding' AND key1=OLD.schedule_id AND key2=''; END;
        CREATE TRIGGER task_model_v54_destination_delete AFTER DELETE ON heartbeat_fresh_destinations BEGIN DELETE FROM task_model_v54_provenance WHERE owner IN ('destination','destination_binding') AND key1=OLD.schedule_id AND key2=''; END;")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE task_launches(request_id TEXT PRIMARY KEY,request_json TEXT NOT NULL);
        CREATE TABLE native_task_launches(request_id TEXT PRIMARY KEY,request_json TEXT NOT NULL);
        CREATE TABLE heartbeat_schedules(schedule_id TEXT PRIMARY KEY,binding_json TEXT NOT NULL);
        CREATE TABLE heartbeat_task_launches(occurrence_id TEXT PRIMARY KEY,launch_json TEXT NOT NULL);
        CREATE TABLE heartbeat_commands(session_id TEXT,request_id TEXT,response_json TEXT NOT NULL,canonical_digest TEXT NOT NULL DEFAULT '',PRIMARY KEY(session_id,request_id));
        CREATE TABLE heartbeat_fresh_destinations(schedule_id TEXT PRIMARY KEY,destination_json TEXT NOT NULL,binding_json TEXT NOT NULL);").unwrap();
        create_schema(&conn).unwrap();
        conn
    }
    fn model(threshold: Option<u64>) -> serde_json::Value {
        serde_json::json!({"backend":"openai-responses","model":"gpt","base_url":"https://example.invalid","allow_insecure_http":false,"api_key_env":null,"reasoning_effort":null,"extra_headers":null,"orchestrator_compaction_threshold":threshold})
    }
    fn request(threshold: Option<u64>) -> String {
        serde_json::json!({"request_id":"request","project_id":"project","invoking_session_id":null,"model_selection":model(threshold),"git_ref":null,"default_ref":null,"title":"title","prompt":"literal orchestrator_compaction_threshold in user prose"}).to_string()
    }
    #[test]
    fn v54_marker_preserves_receipt_bytes_and_fences_current_records() {
        for threshold in [None, Some(8192)] {
            let conn = fixture();
            let raw = request(threshold);
            conn.execute("INSERT INTO task_launches VALUES('request',?1)", [&raw])
                .unwrap();
            assert!(decode::<TaskLaunchRequest>(&conn, Owner::Task, "request", "", &raw).is_err());
            capture_v54(&conn).unwrap();
            let (value, legacy) =
                decode::<TaskLaunchRequest>(&conn, Owner::Task, "request", "", &raw).unwrap();
            assert!(legacy);
            assert_eq!(
                value.model_selection.unwrap().compaction_threshold,
                threshold
            );
            assert_eq!(
                conn.query_row::<String, _, _>("SELECT request_json FROM task_launches", [], |r| r
                    .get(0))
                    .unwrap(),
                raw
            );
            // Public/current DTO decoding never accepts the retired name.
            assert!(serde_json::from_str::<TaskLaunchRequest>(&raw).is_err());
            let modified = raw.replace(
                "literal orchestrator_compaction_threshold",
                "changed literal",
            );
            conn.execute(
                "UPDATE task_launches SET request_json=?1 WHERE request_id='request'",
                [&modified],
            )
            .unwrap();
            assert!(
                decode::<TaskLaunchRequest>(&conn, Owner::Task, "request", "", &modified).is_err()
            );
            assert_eq!(
                conn.query_row::<i64, _, _>(
                    "SELECT count(*) FROM task_model_v54_provenance",
                    [],
                    |r| r.get(0)
                )
                .unwrap(),
                0
            );
        }
    }
    #[test]
    fn v54_marker_survives_unrelated_progress_and_rejects_model_rebinding() {
        let conn = fixture();
        let raw=serde_json::json!({"fresh_task":{"model_selection":model(Some(42))},"other":"unchanged"}).to_string();
        conn.execute(
            "INSERT INTO heartbeat_schedules VALUES('schedule',?1)",
            [&raw],
        )
        .unwrap();
        capture_v54(&conn).unwrap();
        conn.execute(
            "UPDATE heartbeat_schedules SET binding_json=json_set(binding_json,'$._attention',1)",
            [],
        )
        .unwrap();
        let raw: String = conn
            .query_row("SELECT binding_json FROM heartbeat_schedules", [], |r| {
                r.get(0)
            })
            .unwrap();
        let (_, legacy): (serde_json::Value, bool) =
            decode(&conn, Owner::Schedule, "schedule", "", &raw).unwrap();
        assert!(legacy);
        conn.execute("UPDATE heartbeat_schedules SET binding_json=json_set(binding_json,'$.fresh_task.model_selection.model','other')",[]).unwrap();
        let raw: String = conn
            .query_row("SELECT binding_json FROM heartbeat_schedules", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM task_model_v54_provenance",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            0
        );
        // Generic Value is permissive; strict public typed decoders reject the key.
        assert!(decode::<TaskLaunchRequest>(&conn, Owner::Schedule, "schedule", "", &raw).is_err());
    }
    #[test]
    fn duplicate_keys_collisions_and_invalid_legacy_shapes_fail_closed() {
        let conn = fixture();
        let both = request(None).replace(
            "\"orchestrator_compaction_threshold\":null",
            "\"orchestrator_compaction_threshold\":null,\"compaction_threshold\":null",
        );
        conn.execute("INSERT INTO task_launches VALUES('request',?1)", [&both])
            .unwrap();
        assert!(capture_v54(&conn).is_err());
        let duplicate = request(None).replace(
            "\"orchestrator_compaction_threshold\":null",
            "\"orchestrator_compaction_threshold\":null,\"orchestrator_compaction_threshold\":3",
        );
        conn.execute("UPDATE task_launches SET request_json=?1", [&duplicate])
            .unwrap();
        assert!(capture_v54(&conn).is_err());
        let invalid = request(None).replace(
            "\"orchestrator_compaction_threshold\":null",
            "\"orchestrator_compaction_threshold\":\"bad\"",
        );
        conn.execute("UPDATE task_launches SET request_json=?1", [&invalid])
            .unwrap();
        assert!(capture_v54(&conn).is_err());
    }

    #[test]
    fn legacy_receipt_identity_and_scheduled_model_copies_must_agree() {
        let conn = fixture();
        conn.execute(
            "INSERT INTO task_launches VALUES('other',?1)",
            [request(None)],
        )
        .unwrap();
        assert!(capture_v54(&conn).is_err());
        conn.execute("DELETE FROM task_launches", []).unwrap();
        let launch = serde_json::json!({"receipt":{"occurrence_id":"occurrence","request":{"model_selection":model(None)},"destination":{"model_selection":model(Some(7))},"binding":{"fresh_task":{"model_selection":model(None)}}}}).to_string();
        conn.execute(
            "INSERT INTO heartbeat_task_launches VALUES('occurrence',?1)",
            [launch],
        )
        .unwrap();
        assert!(capture_v54(&conn).is_err());
        conn.execute("DELETE FROM heartbeat_task_launches", [])
            .unwrap();
        let mut current = model(None);
        current.as_object_mut().unwrap().remove(OLD);
        current
            .as_object_mut()
            .unwrap()
            .insert(NEW.into(), serde_json::Value::Null);
        let mixed = serde_json::json!({"receipt":{"occurrence_id":"occurrence","request":{"model_selection":model(None)},"destination":{"model_selection":current},"binding":{"fresh_task":{"model_selection":model(None)}}}}).to_string();
        conn.execute(
            "INSERT INTO heartbeat_task_launches VALUES('occurrence',?1)",
            [mixed],
        )
        .unwrap();
        assert!(capture_v54(&conn).is_err());
    }

    #[test]
    fn malformed_later_evidence_rolls_back_all_prior_marks() {
        let conn = fixture();
        conn.execute(
            "INSERT INTO task_launches VALUES('request',?1)",
            [request(Some(8192))],
        )
        .unwrap();
        let invalid = request(None)
            .replace("\"model_selection\":", "\"_nac_model_selection\":")
            .replace(
                "\"orchestrator_compaction_threshold\":null",
                "\"orchestrator_compaction_threshold\":\"bad\"",
            );
        conn.execute(
            "INSERT INTO native_task_launches VALUES('bad',?1)",
            [invalid],
        )
        .unwrap();
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        assert!(capture_v54(&conn).is_err());
        conn.execute_batch("ROLLBACK").unwrap();
        assert_eq!(
            conn.query_row::<i64, _, _>(
                "SELECT count(*) FROM task_model_v54_provenance",
                [],
                |row| row.get(0)
            )
            .unwrap(),
            0
        );
    }
}
