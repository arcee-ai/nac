//! Private comparison reader for the existing enrolled CREATE-v1 payload.
//! This is not an HTTP DTO, grant, schema writer or positive participant mint.
use anyhow::{ensure, Result};
use serde::de::{Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{model::ReasoningEffort, runtime::OptionalModelOption, sessions::SessionBehavior};

pub(super) struct Command {
    pub operation: Uuid,
    pub claim: u64,
    pub session: Uuid,
    pub canonical: Box<[u8]>,
    pub intent: [u8; 32],
    pub configuration: [u8; 32],
    pub model_revision: [u8; 32],
    pub command_digest: [u8; 32],
    pub target_revision: [u8; 32],
    pub target_kind: String,
    pub target: String,
    pub model: String,
    pub selected_model: Option<String>,
    pub effort: OptionalModelOption<ReasoningEffort>,
    pub behavior: SessionBehavior,
    pub first_chat: bool,
    pub first_chat_same_behavior: bool,
    pub environment: String,
    pub provider: String,
    pub organization: String,
    pub host: String,
    pub incarnation: String,
    pub owner_epoch: u64,
    pub key_generation: u64,
    pub release: String,
    pub schema: i64,
}

impl Command {
    pub(super) fn from_exchange(exchange: &nac_runtime_auth::CreateExchange) -> Result<Self> {
        exchange.check_current()?;
        let command = decode(exchange.payload())?;
        ensure!(
            command.operation == exchange.request_id(),
            "CREATE request differs"
        );
        exchange.check_current()?;
        Ok(command)
    }
}

fn object<'a>(
    value: &'a Value,
    required: &[&str],
    optional: &[&str],
) -> Result<&'a Map<String, Value>> {
    let object = value
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("CREATE object unavailable"))?;
    ensure!(
        required.iter().all(|key| object.contains_key(*key))
            && object
                .keys()
                .all(|key| required.contains(&key.as_str()) || optional.contains(&key.as_str())),
        "CREATE fields differ"
    );
    Ok(object)
}
fn string(value: &Value) -> Result<String> {
    let value = value
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("CREATE string unavailable"))?;
    ensure!(
        !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control),
        "CREATE reference invalid"
    );
    Ok(value.to_owned())
}
fn uuid(value: &Value) -> Result<Uuid> {
    let text = string(value)?;
    let value = Uuid::parse_str(&text)?;
    ensure!(
        !value.is_nil() && value.to_string() == text,
        "CREATE UUID invalid"
    );
    Ok(value)
}
fn positive(value: &Value) -> Result<u64> {
    value
        .as_i64()
        .filter(|value| *value > 0)
        .map(|value| value as u64)
        .ok_or_else(|| anyhow::anyhow!("CREATE positive generation unavailable"))
}
fn digest(value: &Value) -> Result<[u8; 32]> {
    let digest: [u8; 32] = serde_json::from_value(value.clone())?;
    ensure!(digest != [0; 32], "CREATE digest unavailable");
    Ok(digest)
}
fn hex(value: &[u8]) -> String {
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn nullable(value: &Value) -> Result<Option<String>> {
    if value.is_null() {
        Ok(None)
    } else {
        string(value).map(Some)
    }
}
fn flag(value: &Value) -> Result<bool> {
    value
        .as_bool()
        .ok_or_else(|| anyhow::anyhow!("CREATE choice unavailable"))
}

fn decode(bytes: &[u8]) -> Result<Command> {
    ensure!(
        !bytes.is_empty() && bytes.len() <= nac_runtime_auth::MAX_CREATE_BODY_BYTES,
        "CREATE payload unavailable"
    );
    let ClosedValue(value) = serde_json::from_slice(bytes)?;
    let outer = object(
        &value,
        &[
            "schema",
            "purpose",
            "request_id",
            "operation",
            "intent",
            "host",
            "request",
        ],
        &[],
    )?;
    ensure!(
        outer["schema"] == nac_runtime_auth::CREATE_PURPOSE
            && outer["purpose"] == nac_runtime_auth::CREATE_PURPOSE,
        "CREATE purpose differs"
    );
    let operation = object(
        &outer["operation"],
        &["id", "claim_sequence", "session_id"],
        &[],
    )?;
    let op = uuid(&operation["id"])?;
    ensure!(
        outer["request_id"] == op.to_string(),
        "CREATE correlation differs"
    );
    let intent = object(
        &outer["intent"],
        &["canonical", "sha256", "configuration_sha256"],
        &[],
    )?;
    let canonical = intent["canonical"]
        .as_array()
        .filter(|v| v.len() == 21)
        .ok_or_else(|| anyhow::anyhow!("CREATE canonical intent unavailable"))?;
    ensure!(
        canonical[0] == "native-session-operation-v3"
            && canonical[15] == serde_json::json!(["create"]),
        "CREATE action differs"
    );
    for index in [3, 5, 7, 9, 13] {
        uuid(&canonical[index])?;
    }
    for index in [4, 6, 8, 14] {
        ensure!(
            canonical[index].as_i64().is_some_and(|v| v >= 0),
            "CREATE generation invalid"
        );
    }
    let target = canonical[16]
        .as_array()
        .filter(|v| v.len() == 3)
        .ok_or_else(|| anyhow::anyhow!("CREATE target unavailable"))?;
    let kind = string(&target[0])?;
    ensure!(
        kind == "project" || kind == "location",
        "CREATE target kind differs"
    );
    let host = object(
        &outer["host"],
        &[
            "logical_host_id",
            "host_incarnation_id",
            "authority_epoch",
            "release_id",
            "schema_version",
            "if_match",
        ],
        &[],
    )?;
    let epoch = positive(&canonical[11])?;
    let etag = host["if_match"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("CREATE precondition unavailable"))?;
    ensure!(
        etag.len() == 66
            && etag.starts_with('"')
            && etag.ends_with('"')
            && etag[1..65]
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "CREATE precondition invalid"
    );
    let incarnation = string(&canonical[10])?;
    let expected_epoch = epoch.to_string();
    ensure!(
        !incarnation.chars().any(char::is_whitespace)
            && uuid(&host["logical_host_id"])? == uuid(&canonical[9])?
            && host["host_incarnation_id"] == incarnation
            && host["authority_epoch"].as_str() == Some(expected_epoch.as_str()),
        "CREATE host differs"
    );
    let request = object(
        &outer["request"],
        &[
            "project_id",
            "working_location_id",
            "model_config_id",
            "behavior",
            "first_chat",
            "first_chat_same_behavior",
        ],
        &["reasoning_effort"],
    )?;
    let project = nullable(&request["project_id"])?;
    let location = nullable(&request["working_location_id"])?;
    let target_id = string(&target[1])?;
    ensure!(
        match (&project, &location) {
            (Some(id), None) => kind == "project" && id == &target_id,
            (None, Some(id)) => kind == "location" && id == &target_id,
            _ => false,
        },
        "CREATE requested target differs"
    );
    let first = flag(&request["first_chat"])?;
    let same = flag(&request["first_chat_same_behavior"])?;
    ensure!(
        (!first || kind == "project") && (!same || first),
        "CREATE first-chat choice invalid"
    );
    let selected = nullable(&request["model_config_id"])?;
    let model = string(&canonical[17])?;
    ensure!(
        selected.as_ref().is_none_or(|id| id == &model),
        "CREATE model selector differs"
    );
    let effort = match request.get("reasoning_effort") {
        None => OptionalModelOption::Inherit,
        Some(Value::Null) => OptionalModelOption::Clear,
        Some(value) => OptionalModelOption::Value(serde_json::from_value(value.clone())?),
    };
    let configuration = digest(&canonical[19])?;
    let encoded = serde_json::to_vec(&intent["canonical"])?;
    let hash: [u8; 32] = Sha256::digest(&encoded).into();
    ensure!(
        intent["sha256"] == hex(&hash) && intent["configuration_sha256"] == hex(&configuration),
        "CREATE intent hash differs"
    );
    let schema = host["schema_version"]
        .as_i64()
        .filter(|v| *v >= 0)
        .ok_or_else(|| anyhow::anyhow!("CREATE schema unavailable"))?;
    Ok(Command {
        operation: op,
        claim: positive(&operation["claim_sequence"])?,
        session: uuid(&operation["session_id"])?,
        canonical: encoded.into_boxed_slice(),
        intent: hash,
        configuration,
        model_revision: digest(&canonical[18])?,
        command_digest: digest(&canonical[20])?,
        target_revision: digest(&target[2])?,
        target_kind: kind,
        target: target_id,
        model,
        selected_model: selected,
        effort,
        behavior: serde_json::from_value(request["behavior"].clone())?,
        first_chat: first,
        first_chat_same_behavior: same,
        environment: string(&canonical[1])?,
        provider: string(&canonical[2])?,
        organization: string(&canonical[5])?,
        host: uuid(&canonical[9])?.to_string(),
        incarnation,
        owner_epoch: epoch,
        key_generation: positive(&canonical[12])?,
        release: string(&host["release_id"])?,
        schema,
    })
}

// serde_json::Value alone discards duplicate object keys. This reader rejects
// them at every nesting level before any typed projection or canonical hash.
struct ClosedValue(Value);
impl<'de> Deserialize<'de> for ClosedValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Read;
        impl<'de> Visitor<'de> for Read {
            type Value = Value;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("bounded CREATE comparison data")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Value, E> {
                Ok(Value::Bool(v))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Value, E> {
                Ok(Value::Null)
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Value, E> {
                Ok(v.into())
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Value, E> {
                Ok(v.into())
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Value, E> {
                Ok(v.into())
            }
            fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Value, E> {
                Ok(v.into())
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Value, A::Error> {
                let mut values = Vec::new();
                while let Some(ClosedValue(value)) = sequence.next_element()? {
                    if values.len() >= 64 {
                        return Err(serde::de::Error::custom("CREATE array bound"));
                    }
                    values.push(value);
                }
                Ok(Value::Array(values))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut source: A) -> Result<Value, A::Error> {
                let mut values = Map::new();
                while let Some(key) = source.next_key::<String>()? {
                    if values.len() >= 16 || values.contains_key(&key) {
                        return Err(serde::de::Error::custom(
                            "CREATE duplicate or excessive fields",
                        ));
                    }
                    let ClosedValue(value) = source.next_value()?;
                    values.insert(key, value);
                }
                Ok(Value::Object(values))
            }
        }
        deserializer.deserialize_any(Read).map(Self)
    }
}

#[cfg(test)]
#[path = "create_participant_tests.rs"]
mod tests;
