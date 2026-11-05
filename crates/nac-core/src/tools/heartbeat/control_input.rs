//! The advertised flat operation has nullable optional fields. Project only
//! the selected action; strict providers may send every declared optional key.
use super::*;
use crate::store::HeartbeatSpec;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireControl {
    request_id: String,
    operation: WireOperation,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireOperation {
    action: Action,
    schedule_id: Option<String>,
    expected_version: Option<i64>,
    spec: Option<HeartbeatSpec>,
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Action {
    Create,
    Edit,
    Pause,
    Resume,
    Stop,
    Delete,
    RunNow,
}

pub(super) fn project(value: Value) -> Result<ControlInput, ToolResult> {
    let wire: WireControl = decode(value)?;
    let selected = wire.operation;
    let operation = match selected.action {
        Action::Create => HeartbeatAction::Create {
            spec: selected.spec.ok_or_else(|| error("create requires spec"))?,
        },
        action => {
            let schedule_id = selected
                .schedule_id
                .filter(|id| !id.is_empty())
                .ok_or_else(|| error("this action requires schedule_id"))?;
            let expected_version = selected
                .expected_version
                .filter(|v| *v >= 1)
                .ok_or_else(|| error("this action requires a positive expected_version"))?;
            match action {
                Action::Edit => HeartbeatAction::Edit {
                    schedule_id,
                    expected_version,
                    spec: selected.spec.ok_or_else(|| error("edit requires spec"))?,
                },
                Action::Pause => HeartbeatAction::Pause {
                    schedule_id,
                    expected_version,
                },
                Action::Resume => HeartbeatAction::Resume {
                    schedule_id,
                    expected_version,
                },
                Action::Stop => HeartbeatAction::Stop {
                    schedule_id,
                    expected_version,
                },
                Action::Delete => HeartbeatAction::Delete {
                    schedule_id,
                    expected_version,
                },
                Action::RunNow => HeartbeatAction::RunNow {
                    schedule_id,
                    expected_version,
                },
                Action::Create => unreachable!(),
            }
        }
    };
    if let HeartbeatAction::Create { spec } | HeartbeatAction::Edit { spec, .. } = &operation {
        spec.validate().map_err(error)?;
    }
    Ok(ControlInput {
        request_id: wire.request_id,
        operation,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn spec() -> Value {
        json!({"name":"Check","instructions":"Observe job","skills":[],"interval_ms":60000,"end_condition":"Ready","goal_id":null,"token_allowance":null,"execution_timeout_ms":300000,"max_occurrences":1000})
    }
    #[test]
    fn heartbeat_native_flat_wire_matches_nullable_optional_fields_for_every_action() {
        let definition = HeartbeatControlTool::native().definition();
        let properties = &definition.function.parameters["properties"]["operation"]["properties"];
        for key in ["schedule_id", "expected_version", "spec"] {
            assert!(
                properties[key]["type"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("null")),
                "{key}"
            );
        }
        for action in [
            "create", "edit", "pause", "resume", "stop", "delete", "run_now",
        ] {
            // Provider-shaped all-keys input: unused placeholders are typed,
            // nullable and never become part of the selected durable command.
            let value = json!({"request_id":uuid::Uuid::new_v4().to_string(),"operation":{"action":action,"schedule_id":if action=="create"{Value::Null}else{json!("saved-schedule")},"expected_version":if action=="create"{Value::Null}else{json!(3)},"spec":if action=="create"||action=="edit"{spec()}else{Value::Null}}});
            let projected = project(value.clone()).unwrap();
            assert_eq!(
                serde_json::to_value(&projected.operation).unwrap()["action"],
                action
            );
            let mut with_unused = value;
            with_unused["operation"]["schedule_id"] = json!("unused-or-target");
            with_unused["operation"]["expected_version"] = json!(3);
            with_unused["operation"]["spec"] = spec();
            assert!(project(with_unused).is_ok());
        }
    }
    #[test]
    fn heartbeat_native_projection_requires_selected_fields_and_rejects_unknown_authority() {
        for operation in [
            json!({"action":"create","spec":null}),
            json!({"action":"edit","schedule_id":"saved","expected_version":1,"spec":null}),
            json!({"action":"run_now","schedule_id":null,"expected_version":null}),
            json!({"action":"pause","schedule_id":"saved","expected_version":0}),
            json!({"action":"delete","schedule_id":"saved","expected_version":1,"human":true}),
        ] {
            assert!(project(
                json!({"request_id":uuid::Uuid::new_v4().to_string(),"operation":operation})
            )
            .is_err());
        }
    }
}

#[cfg(test)]
mod execution_scope_tests {
    use super::*;
    use crate::tools::goal::{CreateGoalTool, UpdateGoalTool};
    use crate::tools::subagent::SubagentTool;
    #[test]
    fn heartbeat_execution_cannot_create_goals_or_chats_or_mutate_another_goal() {
        let mut runtime = crate::tools::test_runtime();
        let client = crate::model::ModelClient::new_for_test();
        runtime.heartbeat_execution = true;
        runtime.heartbeat_goal_id = Some("bound-goal".into());
        let create = CreateGoalTool
            .decode(json!({"objective":"Unauthorized new goal","token_budget":null}))
            .unwrap();
        let update = UpdateGoalTool
            .decode(json!({"goal_id":"other-goal","status":"complete"}))
            .unwrap();
        let child=SubagentTool.decode(json!({"profile":"general","description":"New child check","prompt":"Check job","child_session_id":null,"background":true})).unwrap();
        let services = ToolServices {
            runtime: &runtime,
            client: &client,
        };
        assert!(CreateGoalTool
            .permission_resources(&create, services)
            .unwrap()[0]
            .hard_denial
            .is_some());
        assert!(UpdateGoalTool
            .permission_resources(&update, services)
            .unwrap()[0]
            .hard_denial
            .is_some());
        assert!(
            SubagentTool.permission_resources(&child, services).unwrap()[0]
                .hard_denial
                .is_some()
        );
        let bound = UpdateGoalTool
            .decode(json!({"goal_id":"bound-goal","status":"complete"}))
            .unwrap();
        assert!(UpdateGoalTool
            .permission_resources(&bound, services)
            .unwrap()[0]
            .hard_denial
            .is_none());
        runtime.heartbeat_execution = false;
        let services = ToolServices {
            runtime: &runtime,
            client: &client,
        };
        assert!(CreateGoalTool
            .permission_resources(&create, services)
            .unwrap()[0]
            .hard_denial
            .is_none());
        assert!(
            SubagentTool.permission_resources(&child, services).unwrap()[0]
                .hard_denial
                .is_none()
        );
    }
}
