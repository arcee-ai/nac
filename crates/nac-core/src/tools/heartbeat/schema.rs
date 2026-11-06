//! Provider-compatible nullable projections share the strict canonical codec.
use super::*;

pub(super) fn calendar(draft: bool) -> Value {
    let mut required = vec!["zone", "hour", "minute", "days"];
    if !draft {
        required.push("data_version");
    }
    let mut rule = json!({"type":"object","additionalProperties":false,"required":required,"properties":{
        "zone":{"type":"string","description":"Explicit IANA zone, such as America/Los_Angeles. Never infer the serving host zone."},
        "data_version":{"type":["string","null"],"description":"Pinned timezone-data version returned by preview_heartbeat. Preview may omit/null to select the current approved version; saved controls require it."},
        "hour":{"type":"integer","minimum":0,"maximum":23},"minute":{"type":"integer","minimum":0,"maximum":59},
        "days":{"type":"object","additionalProperties":false,"required":["kind"],"properties":{
            "kind":{"type":"string","enum":["daily","weekdays","weekly"]},
            "days":{"type":["array","null"],"minItems":1,"maxItems":7,"items":{"type":"integer","minimum":1,"maximum":7},"description":"Selected weekdays for kind=weekdays, Monday1..Sunday7; unique. Otherwise null/omitted."},
            "day":{"type":["integer","null"],"minimum":1,"maximum":7,"description":"One Monday1..Sunday7 day for kind=weekly. Otherwise null/omitted."}
        }}
    }});
    if !draft {
        rule["properties"]["data_version"]["type"] = json!("string");
    }
    rule
}

pub(super) fn control() -> Value {
    let mut rule = calendar(false);
    rule["type"] = json!(["object", "null"]);
    json!({"type":"object","additionalProperties":false,"required":["request_id","operation"],"properties":{
        "request_id":{"type":"string","description":"Fresh canonical UUID; retain for exact retries."},
        "operation":{"type":"object","additionalProperties":false,"required":["action"],"properties":{
            "action":{"type":"string","enum":["create","edit","pause","resume","stop","delete","run_now"]},
            "schedule_id":{"type":["string","null"]},"expected_version":{"type":["integer","null"],"minimum":1},
            "spec":{"type":["object","null"],"additionalProperties":false,"required":["name","instructions","end_condition"],"properties":{
                "name":{"type":"string","maxLength":120},"instructions":{"type":"string","maxLength":8000},
                "skills":{"type":"array","maxItems":8,"items":{"type":"string"}},
                "interval_ms":{"type":["integer","null"],"minimum":60000,"maximum":31536000000i64},"calendar":rule,
                "end_condition":{"type":"string","maxLength":1000},"goal_id":{"type":["string","null"]},
                "execution_timeout_ms":{"type":"integer","minimum":1000,"maximum":3600000,"default":300000},
                "max_occurrences":{"type":"integer","minimum":1,"maximum":100000,"default":1000},
                "token_allowance":{"type":["integer","null"],"minimum":1}
            }}
        }}
    }})
}

/// Strip only nullable unused keys advertised for strict providers. Unknown or
/// nonnull unsupported rule fields still reach deny_unknown_fields and reject.
pub(super) fn project_calendar(value: &mut Value) {
    if let Some(days) = value.get_mut("days").and_then(Value::as_object_mut) {
        for key in ["day", "days"] {
            if days.get(key).is_some_and(Value::is_null) {
                days.remove(key);
            }
        }
    }
}

pub(super) fn spec(mut value: Value) -> Result<store::HeartbeatSpec, ToolResult> {
    if let Some(rule) = value.get_mut("calendar") {
        project_calendar(rule);
    }
    decode(value)
}
