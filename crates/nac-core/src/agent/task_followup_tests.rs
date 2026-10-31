//! The actual model/tool loop sends guidance through owning session admission.
use super::transcript_log_tests::transcript_test_agent;
use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::store::{InboxStatus, TaskFollowupRequest};
use crate::task_followups::{TaskFollowupController, TaskFollowupFuture};

struct Controller {
    service: crate::session_service::SessionService,
    lose_first_ack: std::sync::atomic::AtomicBool,
}
impl TaskFollowupController for Controller {
    fn follow_up<'a>(&'a self, request: TaskFollowupRequest) -> TaskFollowupFuture<'a> {
        Box::pin(async move {
            let receipt = self.service.admit_task_followup(request).await?;
            if self
                .lose_first_ack
                .swap(false, std::sync::atomic::Ordering::SeqCst)
            {
                return Err(crate::store::TaskFollowupError::CommitUncertain.into());
            }
            Ok(receipt)
        })
    }
}

#[tokio::test]
async fn native_agent_followup_lost_tool_ack_replay_and_passive_receipt_deliver_one_successor() {
    let text = |text: &str| {
        serde_json::json!({"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":text}]}],"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}).to_string()
    };
    let args = serde_json::json!({"session_id":"target","request_id":"native-key","action":"auto","prompt":"Native exact guidance /compact $skill"});
    let tool = |id: &str, name: &str, args: serde_json::Value| {
        serde_json::json!({"status":"completed","output":[{"type":"function_call","call_id":id,"name":name,"arguments":args.to_string()}],"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}).to_string()
    };
    let target_server =
        ScriptedServer::start(vec![ScriptedResponse::json("200 OK", text("target done"))]);
    let (target, path) = crate::session_service::tests::test_direct_active_service(
        "native_followup",
        "target",
        ModelClient::new_for_test_server(target_server.base_url.clone()),
    );
    crate::store::insert_test_session(&path, "caller");
    let conn = crate::store::open_runtime_connection(&path).unwrap();
    conn.execute(
        "UPDATE sessions SET behavior='direct' WHERE session_id='caller'",
        [],
    )
    .unwrap();
    drop(conn);
    crate::task_followups::register_controller(
        path.clone(),
        Arc::new(Controller {
            service: target.service.clone(),
            lose_first_ack: std::sync::atomic::AtomicBool::new(true),
        }),
    );
    // Both attempts use the identical stable request despite a different tool call ID.
    let coordinator_server = ScriptedServer::start(vec![
        ScriptedResponse::json("200 OK", tool("first", "send_task_followup", args.clone())),
        ScriptedResponse::json("200 OK", tool("retry", "send_task_followup", args)),
        ScriptedResponse::json(
            "200 OK",
            tool(
                "inspect",
                "read_task_followup",
                serde_json::json!({"session_id":"target","request_id":"native-key"}),
            ),
        ),
        ScriptedResponse::json("200 OK", text("coordinator done")),
    ]);
    let mut coordinator = transcript_test_agent(
        ModelClient::new_for_test_server(coordinator_server.base_url.clone()),
        path.clone(),
        Some("caller"),
        AgentMode::Direct,
    );
    coordinator.tool_runtime.permission_rules =
        Arc::new(vec![crate::permissions::PermissionRule::new(
            "task_followup_auto",
            "session:target",
            crate::permissions::PermissionEffect::Allow,
        )]);
    let conn = crate::store::open_runtime_connection(&path).unwrap();
    conn.execute(
        "UPDATE sessions SET messages_json=?1 WHERE session_id='caller'",
        [serde_json::to_string(&coordinator.messages).unwrap()],
    )
    .unwrap();
    drop(conn);
    coordinator.configure_permission_broker(0);
    coordinator.set_steering_dispatch_id(Some(uuid::Uuid::new_v4().to_string()));
    assert_eq!(coordinator.send("Send this authorized guidance to target, retry with the same key after a lost acknowledgement, then inspect its receipt.").await.unwrap(),"coordinator done");
    tokio::time::timeout(Duration::from_secs(5), async {
        while target.service.has_active_operation() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let inbox = crate::store::list_session_inbox(&path, "target").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].status, InboxStatus::Delivered);
    let receipt = crate::store::inspect_task_followup_receipt(&path, "caller", "native-key")
        .unwrap()
        .unwrap();
    assert_eq!(receipt.delivered_run_id, inbox[0].delivered_run_id);
    let intent = crate::sessions::reviewable_intent(path.clone(), "target".into()).await;
    assert_eq!(intent, crate::sessions::ReviewIntent::NeverRecorded);
    assert_eq!(target_server.finish().len(), 1);
    let wire = coordinator_server.finish();
    assert_eq!(wire.len(), 4);
    let final_wire = String::from_utf8_lossy(&wire[3].body);
    assert!(final_wire.contains("native-key"));
    assert!(final_wire.contains("inbox_item_id"));
    assert_eq!(coordinator.messages.iter().filter(|m|matches!(m,Message::Tool{content,..} if content.as_text().is_some_and(|s|s.contains("\"replayed\":true")))).count(),2);
}
