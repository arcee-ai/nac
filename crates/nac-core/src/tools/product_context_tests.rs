use super::product_context::*;
use crate::permissions::{PermissionEffect, PermissionRule};
use crate::product_context::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

struct Port(AtomicUsize);
impl ProductContextPort for Port {
    fn read(&self) -> ProductContextFuture<'_, ProductContext> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Err(anyhow::anyhow!("credential-canary")) })
    }
    fn resolve(
        &self,
        _: ProductDestination,
        _: String,
    ) -> ProductContextFuture<'_, ProductNavigationResolution> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Err(anyhow::anyhow!("credential-canary")) })
    }
}

#[tokio::test]
async fn product_tools_use_prepared_policy_and_never_echo_private_errors() {
    let mut runtime = crate::tools::test_runtime();
    runtime.session_id = Some("bound-session".into());
    let port = Arc::new(Port(AtomicUsize::new(0)));
    runtime.product_context = Some(port.clone());
    let client = crate::model::ModelClient::new_for_test();
    for action in ["product_context_read", "product_destination_read"] {
        runtime.permission_rules = Arc::new(vec![PermissionRule::new(
            action,
            "*",
            PermissionEffect::Deny,
        )]);
        let (name, input) = if action == "product_context_read" {
            ("get_product_context", serde_json::json!({}))
        } else {
            (
                "resolve_product_destination",
                serde_json::json!({"destination":"mcp-settings", "expected_build_id":"build"}),
            )
        };
        let denied = crate::tools::execute_tool(name, input.clone(), &runtime, &client).await;
        assert!(denied.is_error);
        assert_eq!(port.0.load(Ordering::SeqCst), 0);
        runtime.permission_rules = Arc::new(vec![PermissionRule::new(
            action,
            "*",
            PermissionEffect::Ask,
        )]);
        let ask = crate::tools::execute_tool(name, input.clone(), &runtime, &client).await;
        assert!(ask.is_error);
        assert_eq!(port.0.load(Ordering::SeqCst), 0);
        runtime.permission_rules = Arc::new(Vec::new());
        let error = crate::tools::execute_tool(name, input, &runtime, &client).await;
        assert!(error.is_error);
        assert!(!error.content.to_string().contains("credential-canary"));
        assert_eq!(port.0.swap(0, Ordering::SeqCst), 1);
    }
}

#[test]
fn product_tools_cannot_deserialize_another_session_or_arbitrary_control() {
    use crate::tools::kernel::NativeTool;
    assert!(ReadTool
        .decode(serde_json::json!({"session_id":"other-owner"}))
        .is_err());
    assert!(ResolveTool
        .decode(serde_json::json!({"destination":"nac://execute", "expected_build_id":"build"}))
        .is_err());
    assert!(ResolveTool.decode(serde_json::json!({"destination":"mcp-settings", "expected_build_id":"build", "session_id":"other-owner"})).is_err());
    let mut runtime = crate::tools::test_runtime();
    runtime.session_id = Some("current".into());
    let client = crate::model::ModelClient::new_for_test();
    let resources = ReadTool
        .permission_resources(
            &ReadInput {},
            crate::tools::kernel::ToolServices {
                runtime: &runtime,
                client: &client,
            },
        )
        .unwrap();
    assert_eq!(resources[0].resource, "current");
    assert!(resources[0].hard_denial.is_some());
}
