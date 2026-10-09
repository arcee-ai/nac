use std::sync::atomic::{AtomicUsize, Ordering};

use serde::Deserialize;
use serde_json::json;

use super::*;
use crate::types::{FunctionDef, ToolContent};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CountInput {
    amount: usize,
}

struct CountTool {
    calls: Arc<AtomicUsize>,
    name: &'static str,
}

struct CancellationAwarePendingTool {
    calls: Arc<AtomicUsize>,
}

struct PublishedDuringCancellationTool;

impl NativeTool for PublishedDuringCancellationTool {
    type Input = CountInput;

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            def_type: "function".into(),
            function: FunctionDef {
                name: "publish".into(),
                description: "publish".into(),
                parameters: json!({"type":"object","properties":{"amount":{"type":"integer"}}}),
            },
        }
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Exclusive
    }

    fn timeout(
        &self,
        _input: &mut Value,
        requested: Option<std::time::Duration>,
    ) -> Result<ToolTimeout, ToolResult> {
        Ok(ToolTimeout {
            duration: requested.unwrap_or(DEFAULT_TOOL_TIMEOUT),
            disposition: ToolTimeoutDisposition::Settle,
            remote_outcome_uncertain: false,
        })
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        serde_json::from_value(input)
            .map_err(|error| ToolResult::text(format!("invalid input: {error}"), true))
    }

    fn permission_resources(
        &self,
        _input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(Vec::new())
    }

    fn execute<'a>(
        &'a self,
        _input: Self::Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            context.cancellation(services.runtime).cancelled().await;
            ToolResult::text(
                json!({"committed":true,"durability":"uncertain"}).to_string(),
                true,
            )
        })
    }
}

impl NativeTool for CancellationAwarePendingTool {
    type Input = CountInput;

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            def_type: "function".into(),
            function: FunctionDef {
                name: "pending".into(),
                description: "pending".into(),
                parameters: json!({"type":"object","properties":{"amount":{"type":"integer"}}}),
            },
        }
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        serde_json::from_value(input)
            .map_err(|error| ToolResult::text(format!("invalid input: {error}"), true))
    }

    fn permission_resources(
        &self,
        _input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(Vec::new())
    }

    fn execute<'a>(
        &'a self,
        _input: Self::Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            context.cancellation(services.runtime).cancelled().await;
            ToolResult::text("cancelled by deadline", true)
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PathInput {
    path: String,
}

struct PathTool {
    calls: Arc<AtomicUsize>,
}

impl NativeTool for PathTool {
    type Input = PathInput;

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            def_type: "function".into(),
            function: FunctionDef {
                name: "path".into(),
                description: "path".into(),
                parameters: json!({"type":"object"}),
            },
        }
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Exclusive
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        serde_json::from_value(input)
            .map_err(|error| ToolResult::text(format!("invalid input: {error}"), true))
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        let path = services
            .runtime
            .backend
            .resolve_path(&input.path)
            .map_err(|error| ToolResult::text(error.to_string(), true))?;
        Ok(vec![PermissionResource::new(
            "edit",
            path.display().to_string(),
        )])
    }

    fn bind_authorized_resources(
        &self,
        input: &mut Self::Input,
        resources: &[PermissionResource],
        _services: ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        let resource = resources
            .iter()
            .find(|resource| resource.action == "edit")
            .ok_or_else(|| ToolResult::text("authorized edit target missing", true))?;
        input.path.clone_from(&resource.resource);
        Ok(())
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        _services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move { ToolResult::text(input.path, false) })
    }
}

impl NativeTool for CountTool {
    type Input = CountInput;

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            def_type: "function".into(),
            function: FunctionDef {
                name: self.name.into(),
                description: "count".into(),
                parameters: json!({"type":"object"}),
            },
        }
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        serde_json::from_value(input)
            .map_err(|error| ToolResult::text(format!("invalid input: {error}"), true))
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        let resource = PermissionResource::new("count", input.amount.to_string());
        Ok(vec![if input.amount == usize::MAX {
            resource.with_hard_denial("native count denial")
        } else {
            resource
        }])
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        _services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            assert_eq!(context.call_id.as_deref(), Some("call-1"));
            self.calls.fetch_add(input.amount, Ordering::SeqCst);
            ToolResult {
                content: ToolContent::text("counted"),
                is_error: false,
            }
        })
    }
}

#[test]
fn rejects_duplicate_names_and_native_types() {
    let calls = Arc::new(AtomicUsize::new(0));
    let duplicate_name = ToolRegistry::builder()
        .register(CountTool {
            calls: Arc::clone(&calls),
            name: "same",
        })
        .register(CountTool {
            calls: Arc::clone(&calls),
            name: "same",
        })
        .finish()
        .err()
        .expect("duplicate name");
    assert_eq!(
        duplicate_name,
        ToolRegistryError::DuplicateName("same".into())
    );

    let duplicate_type = ToolRegistry::builder()
        .register(CountTool {
            calls: Arc::clone(&calls),
            name: "first",
        })
        .register(CountTool {
            calls,
            name: "second",
        })
        .finish()
        .err()
        .expect("duplicate native type");
    assert!(matches!(
        duplicate_type,
        ToolRegistryError::DuplicateNativeType(_)
    ));
}

#[tokio::test]
async fn timeout_envelope_is_advertised_stripped_and_enforced() {
    let calls = Arc::new(AtomicUsize::new(0));
    let registry = ToolRegistry::builder()
        .register(CancellationAwarePendingTool {
            calls: Arc::clone(&calls),
        })
        .finish()
        .unwrap();
    let snapshot = registry.snapshot(["pending"]).unwrap();
    let definition = &snapshot.definitions()[0];
    assert_eq!(
        definition.function.parameters["properties"]["_nac"]["properties"]["timeout_ms"]["minimum"],
        1
    );
    assert_eq!(
        definition.function.parameters["properties"]["_nac"]["properties"]["timeout_ms"]["maximum"],
        3_600_000
    );

    let runtime = crate::tools::test_runtime();
    let client = crate::model::ModelClient::new_for_test();
    let result = snapshot
        .invoke(
            "pending",
            json!({"amount":1,"_nac":{"timeout_ms":5}}),
            ToolServices {
                runtime: &runtime,
                client: &client,
            },
            &ToolCallContext::default(),
        )
        .await;
    assert!(result.is_error);
    let value: Value = serde_json::from_str(result.content.as_text().unwrap()).unwrap();
    assert_eq!(value["_nac"]["status"], "timed_out");
    assert_eq!(value["_nac"]["timeout_ms"], 5);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn invalid_timeout_envelopes_fail_before_native_work() {
    let calls = Arc::new(AtomicUsize::new(0));
    let registry = ToolRegistry::builder()
        .register(CountTool {
            calls: Arc::clone(&calls),
            name: "count",
        })
        .finish()
        .unwrap();
    let snapshot = registry.snapshot(["count"]).unwrap();
    let runtime = crate::tools::test_runtime();
    let client = crate::model::ModelClient::new_for_test();
    for envelope in [
        json!({}),
        json!({"timeout_ms":0}),
        json!({"timeout_ms":1.5}),
        json!({"other":1}),
    ] {
        let result = snapshot
            .invoke(
                "count",
                json!({"amount":1,"_nac":envelope}),
                ToolServices {
                    runtime: &runtime,
                    client: &client,
                },
                &ToolCallContext::default(),
            )
            .await;
        assert!(
            result.is_error,
            "invalid envelope unexpectedly ran: {}",
            result.content
        );
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    let result = snapshot
        .invoke(
            "count",
            json!({"amount":1,"_nac":null}),
            ToolServices {
                runtime: &runtime,
                client: &client,
            },
            &ToolCallContext {
                call_id: Some("call-1".to_string()),
                ..Default::default()
            },
        )
        .await;
    assert!(
        !result.is_error,
        "nullable strict envelope: {}",
        result.content
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn deadline_reports_a_publication_that_settled_after_cancellation() {
    let registry = ToolRegistry::builder()
        .register(PublishedDuringCancellationTool)
        .finish()
        .unwrap();
    let snapshot = registry.snapshot(["publish"]).unwrap();
    let runtime = crate::tools::test_runtime();
    let client = crate::model::ModelClient::new_for_test();
    let result = snapshot
        .invoke(
            "publish",
            json!({"amount":1,"_nac":{"timeout_ms":5}}),
            ToolServices {
                runtime: &runtime,
                client: &client,
            },
            &ToolCallContext::default(),
        )
        .await;
    assert!(result.is_error, "durability uncertainty remains an error");
    let value: Value = serde_json::from_str(result.content.as_text().unwrap()).unwrap();
    assert_eq!(value["committed"], true);
    assert!(
        value.get("_nac").is_none(),
        "published result must win the deadline race"
    );
}

#[tokio::test]
async fn permission_wait_does_not_consume_the_execution_budget() {
    let calls = Arc::new(AtomicUsize::new(0));
    let registry = ToolRegistry::builder()
        .register(CountTool {
            calls: Arc::clone(&calls),
            name: "count",
        })
        .finish()
        .unwrap();
    let snapshot = registry.snapshot(["count"]).unwrap();
    let directory =
        std::env::temp_dir().join(format!("nac-kernel-deadline-auth-{}", uuid::Uuid::new_v4()));
    let store_path = directory.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session-a");
    let broker = Arc::new(crate::permissions::PermissionBroker::new(
        store_path.clone(),
        "session-a".to_string(),
        crate::permissions::PermissionBackend::Local,
        0,
        [crate::permissions::PermissionRule::new(
            "count",
            "*",
            crate::permissions::PermissionEffect::Ask,
        )],
    ));
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = store_path;
    runtime.session_id = Some("session-a".to_string());
    runtime.permission_broker = Some(Arc::clone(&broker));
    let client = crate::model::ModelClient::new_for_test();
    let services = ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let context = ToolCallContext {
        call_id: Some("call-1".to_string()),
        ..Default::default()
    };

    let invoke = snapshot.invoke(
        "count",
        json!({"amount":1,"_nac":{"timeout_ms":1}}),
        services,
        &context,
    );
    let approve = async {
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        loop {
            if let Some(request) = broker.pending().pop() {
                broker
                    .reply(&request.id, crate::permissions::PermissionReply::Once)
                    .unwrap();
                break;
            }
            tokio::task::yield_now().await;
        }
    };
    let (result, ()) = tokio::join!(invoke, approve);
    assert!(!result.is_error, "{}", result.content);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let _ = std::fs::remove_dir_all(directory);
}

#[test]
fn capability_selection_is_ordered_strict_and_filterable() {
    struct OtherTool(CountTool);
    impl NativeTool for OtherTool {
        type Input = CountInput;
        fn definition(&self) -> ToolDefinition {
            self.0.definition()
        }
        fn admission(&self) -> ToolAdmission {
            ToolAdmission::Exclusive
        }
        fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
            self.0.decode(input)
        }
        fn permission_resources(
            &self,
            input: &Self::Input,
            services: ToolServices<'_>,
        ) -> Result<Vec<PermissionResource>, ToolResult> {
            self.0.permission_resources(input, services)
        }
        fn execute<'a>(
            &'a self,
            input: Self::Input,
            services: ToolServices<'a>,
            context: &'a ToolCallContext,
        ) -> BoxFuture<'a, ToolResult> {
            self.0.execute(input, services, context)
        }
    }

    let calls = Arc::new(AtomicUsize::new(0));
    let registry = ToolRegistry::builder()
        .register(CountTool {
            calls: Arc::clone(&calls),
            name: "parallel",
        })
        .register(OtherTool(CountTool {
            calls,
            name: "exclusive",
        }))
        .finish()
        .unwrap();

    let ordered = registry.snapshot(["exclusive", "parallel"]).unwrap();
    assert_eq!(
        ordered
            .definitions()
            .into_iter()
            .map(|definition| definition.function.name)
            .collect::<Vec<_>>(),
        ["exclusive", "parallel"]
    );
    assert!(matches!(
        registry.snapshot(["parallel", "parallel"]),
        Err(ToolRegistryError::DuplicateCapability(name)) if name == "parallel"
    ));
    assert!(matches!(
        registry.snapshot(["missing"]),
        Err(ToolRegistryError::UnknownCapability(name)) if name == "missing"
    ));
    let visible =
        registry.snapshot_where(|descriptor| descriptor.admission == ToolAdmission::Parallel);
    assert_eq!(visible.definitions().len(), 1);
    assert_eq!(visible.definitions()[0].function.name, "parallel");
}

#[tokio::test]
async fn prepared_calls_validate_before_invocation_and_keep_identity() {
    let calls = Arc::new(AtomicUsize::new(0));
    let registry = ToolRegistry::builder()
        .register(CountTool {
            calls: Arc::clone(&calls),
            name: "count",
        })
        .finish()
        .unwrap();
    let snapshot = registry.snapshot(["count"]).unwrap();

    let runtime = crate::tools::test_runtime();
    let client = crate::model::ModelClient::new_for_test();
    let services = ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let invalid = snapshot
        .prepare("count", json!({"amount": 1, "extra": true}), services)
        .err()
        .expect("invalid input");
    assert!(invalid.is_error);
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    let prepared = snapshot
        .prepare("count", json!({"amount": 2}), services)
        .unwrap();
    assert_eq!(
        prepared.permission_resources(),
        &[PermissionResource::new("count", "2")]
    );
    let result = prepared
        .invoke(
            services,
            &ToolCallContext {
                call_id: Some("call-1".into()),
                thread_name: None,
                ..Default::default()
            },
        )
        .await;
    assert!(!result.is_error);
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn native_hard_denial_blocks_brokerless_model_invocation() {
    let calls = Arc::new(AtomicUsize::new(0));
    let registry = ToolRegistry::builder()
        .register(CountTool {
            calls: Arc::clone(&calls),
            name: "count",
        })
        .finish()
        .unwrap();
    let snapshot = registry.snapshot(["count"]).unwrap();
    let runtime = crate::tools::test_runtime();
    assert!(runtime.permission_broker.is_none());
    let client = crate::model::ModelClient::new_for_test();
    let result = snapshot
        .invoke(
            "count",
            json!({"amount": usize::MAX}),
            ToolServices {
                runtime: &runtime,
                client: &client,
            },
            &ToolCallContext {
                call_id: Some("call-1".into()),
                thread_name: Some("worker".into()),
                ..Default::default()
            },
        )
        .await;

    assert!(result.is_error);
    assert!(result.content.to_string().contains("native count denial"));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[cfg(unix)]
#[tokio::test]
async fn brokerless_model_invocation_canonicalizes_denies_and_binds_paths() {
    use std::os::unix::fs::symlink;

    let root = std::env::temp_dir().join(format!(
        "nac-kernel-brokerless-canonical-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace = root.join("workspace");
    let safe = workspace.join("safe");
    std::fs::create_dir_all(workspace.join(".git")).unwrap();
    std::fs::create_dir_all(&safe).unwrap();
    symlink(workspace.join(".git"), workspace.join("git-alias")).unwrap();
    symlink(&safe, workspace.join("safe-alias")).unwrap();

    let calls = Arc::new(AtomicUsize::new(0));
    let registry = ToolRegistry::builder()
        .register(PathTool {
            calls: Arc::clone(&calls),
        })
        .finish()
        .unwrap();
    let snapshot = registry.snapshot(["path"]).unwrap();
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = workspace.clone();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &workspace);
    assert!(runtime.permission_broker.is_none());
    let client = crate::model::ModelClient::new_for_test();
    let services = ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let context = ToolCallContext::default();

    let denied = snapshot
        .invoke(
            "path",
            json!({"path":"git-alias/config"}),
            services,
            &context,
        )
        .await;
    assert!(denied.is_error, "{}", denied.content);
    assert!(denied.content.to_string().contains("Git metadata"));
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    let allowed = snapshot
        .invoke(
            "path",
            json!({"path":"safe-alias/file"}),
            services,
            &context,
        )
        .await;
    assert!(!allowed.is_error, "{}", allowed.content);
    assert_eq!(
        allowed.content.to_string(),
        safe.canonicalize()
            .unwrap()
            .join("file")
            .display()
            .to_string()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn direct_broker_authorizes_between_prepare_and_side_effects() {
    let calls = Arc::new(AtomicUsize::new(0));
    let registry = ToolRegistry::builder()
        .register(CountTool {
            calls: Arc::clone(&calls),
            name: "count",
        })
        .finish()
        .unwrap();
    let snapshot = registry.snapshot(["count"]).unwrap();
    let directory =
        std::env::temp_dir().join(format!("nac-kernel-permission-{}", uuid::Uuid::new_v4()));
    let store_path = directory.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session-a");
    let broker = Arc::new(crate::permissions::PermissionBroker::new(
        store_path.clone(),
        "session-a".to_string(),
        crate::permissions::PermissionBackend::Local,
        0,
        [crate::permissions::PermissionRule::new(
            "count",
            "*",
            crate::permissions::PermissionEffect::Ask,
        )],
    ));
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = store_path;
    runtime.session_id = Some("session-a".to_string());
    runtime.permission_broker = Some(Arc::clone(&broker));
    let client = crate::model::ModelClient::new_for_test();
    let services = ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let context = ToolCallContext {
        call_id: Some("call-1".to_string()),
        thread_name: None,
        ..Default::default()
    };

    let headless = snapshot
        .invoke("count", json!({"amount": 2}), services, &context)
        .await;
    assert!(headless.is_error);
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let invoke = snapshot.invoke("count", json!({"amount": 2}), services, &context);
    let reply = async {
        loop {
            if let Some(request) = broker.pending().pop() {
                broker
                    .reply(&request.id, crate::permissions::PermissionReply::Once)
                    .unwrap();
                break;
            }
            tokio::task::yield_now().await;
        }
    };
    let (approved, ()) = tokio::join!(invoke, reply);
    assert!(!approved.is_error, "{}", approved.content);
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    let _ = std::fs::remove_dir_all(directory);
}

fn user_command_fixture(
    label: &str,
    rules: Vec<crate::permissions::PermissionRule>,
) -> (
    std::path::PathBuf,
    std::path::PathBuf,
    ToolRuntime,
    Arc<crate::permissions::PermissionBroker>,
) {
    let directory =
        std::env::temp_dir().join(format!("nac-kernel-{label}-{}", uuid::Uuid::new_v4()));
    let workspace = directory.join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let store_path = directory.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session-a");
    let broker = Arc::new(crate::permissions::PermissionBroker::new(
        store_path.clone(),
        "session-a".to_string(),
        crate::permissions::PermissionBackend::Local,
        0,
        rules,
    ));
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = workspace.clone();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &workspace);
    runtime.store_path = store_path;
    runtime.session_id = Some("session-a".to_string());
    runtime.permission_broker = Some(Arc::clone(&broker));
    (directory, workspace, runtime, broker)
}

#[cfg(unix)]
#[tokio::test]
async fn submitted_user_command_lifts_ask_but_keeps_hard_and_configured_denials() {
    use crate::permissions::{PermissionEffect, PermissionRule};

    let (directory, _workspace, runtime, broker) = user_command_fixture(
        "user-command",
        vec![
            PermissionRule::new("execute", "*", PermissionEffect::Ask),
            PermissionRule::new(
                "execute",
                "command:[printf][denied]*",
                PermissionEffect::Deny,
            ),
        ],
    );
    let client = crate::model::ModelClient::new_for_test();

    let ran = crate::session_service::invoke_submitted_command(
        "printf user-ran",
        5_000,
        &runtime,
        &client,
    )
    .await
    .unwrap();
    assert!(!ran.is_error, "{}", ran.content);
    assert!(ran.content.to_string().contains("user-ran"));

    let hard = crate::session_service::invoke_submitted_command(
        "LD_PRELOAD=./payload.so printf hard-ran",
        5_000,
        &runtime,
        &client,
    )
    .await;
    assert!(matches!(hard, Err(ToolInvocationRejection::HardDenial(_))));

    let configured =
        crate::session_service::invoke_submitted_command("printf denied", 5_000, &runtime, &client)
            .await;
    assert!(
        matches!(&configured, Err(ToolInvocationRejection::Denied(reason)) if reason.contains("configured")),
        "{configured:?}"
    );
    assert!(broker.pending().is_empty());
    assert!(broker.grants().unwrap().is_empty());
    let _ = std::fs::remove_dir_all(directory);
}

#[cfg(unix)]
#[tokio::test]
async fn model_arguments_cannot_assert_user_command_authority() {
    let (directory, _workspace, runtime, broker) = user_command_fixture(
        "model-authority",
        vec![crate::permissions::PermissionRule::new(
            "execute",
            "*",
            crate::permissions::PermissionEffect::Ask,
        )],
    );
    let client = crate::model::ModelClient::new_for_test();
    let services = ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let context = ToolCallContext::default();
    assert!(matches!(context.authority, InvocationAuthority::Model));
    let snapshot = crate::tools::exec_command_snapshot();

    for input in [
        json!({"cmd": "printf model-ran", "authority": "submitted_user_command"}),
        json!({"cmd": "printf model-ran", "_nac": {"authority": "user"}}),
        json!({"cmd": "printf model-ran", "_nac": {"timeout_ms": 5_000}}),
    ] {
        let result = snapshot
            .invoke("exec_command", input, services, &context)
            .await;
        assert!(result.is_error, "{}", result.content);
        assert!(!result.content.to_string().contains("model-ran"));
    }
    let headless = snapshot
        .invoke(
            "exec_command",
            json!({"cmd": "printf model-ran"}),
            services,
            &context,
        )
        .await;
    assert!(
        headless.content.to_string().contains("no interactive"),
        "{}",
        headless.content
    );
    assert!(broker.pending().is_empty());
    assert!(broker.grants().unwrap().is_empty());
    let _ = std::fs::remove_dir_all(directory);
}
