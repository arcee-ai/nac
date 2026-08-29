use super::{
    direct_tool_definitions, kernel, worker_tool_definitions, worker_tool_registry, ReadTool,
};
use std::collections::HashSet;
use std::sync::Arc;

#[test]
fn every_worker_receives_complete_glob_and_grep_definitions_once() {
    let definitions = worker_tool_definitions(false);
    for name in ["glob", "grep"] {
        let matches: Vec<_> = definitions
            .iter()
            .filter(|definition| definition.function.name == name)
            .collect();
        assert_eq!(matches.len(), 1, "{name} must be defined exactly once");
        let schema = &matches[0].function.parameters;
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["additionalProperties"], false);
        assert!(schema["required"]
            .as_array()
            .expect("required array")
            .iter()
            .any(|value| value == "pattern"));
        assert_eq!(schema["properties"]["limit"]["maximum"], 1000);
        assert!(schema["properties"]["cursor"].is_object());
    }

    let grep = definitions
        .iter()
        .find(|definition| definition.function.name == "grep")
        .expect("grep definition");
    assert_eq!(
        grep.function.parameters["properties"]["case"]["enum"],
        serde_json::json!(["smart", "sensitive", "insensitive"])
    );
    for property in [
        "roots",
        "regex",
        "case",
        "globs",
        "context",
        "multiline",
        "gitignore",
        "hidden",
        "limit",
        "cursor",
    ] {
        assert!(
            grep.function.parameters["properties"][property].is_object(),
            "missing grep property {property}"
        );
    }
}

#[tokio::test]
async fn model_execution_cannot_invoke_a_tool_outside_its_capability_snapshot() {
    let mut runtime = super::test_runtime();
    runtime.allowed_tools = Some(Arc::new(HashSet::from(["read".to_string()])));
    let result = super::execute_tool(
        "thread",
        serde_json::json!({"name":"escape","action":"must not run"}),
        &runtime,
        &crate::model::ModelClient::new_for_test(),
    )
    .await;
    assert!(result.is_error);
    assert_eq!(
        result.content.as_text(),
        Some("Error: unknown tool 'thread' is not available to this agent")
    );
    assert!(runtime.active_threads.names().is_empty());

    runtime.web_credential = Some(Arc::new(super::web::ExaCredential::new(
        "snapshot-only-canary".to_string(),
    )));
    let hidden = super::execute_tool(
        "web_search",
        serde_json::json!({"query":"must not reach Exa"}),
        &runtime,
        &crate::model::ModelClient::new_for_test(),
    )
    .await;
    assert!(hidden.is_error);
    assert_eq!(
        hidden.content.as_text(),
        Some("Error: unknown tool 'web_search' is not available to this agent")
    );

    runtime.allowed_tools = Some(Arc::new(HashSet::from(["web_search".to_string()])));
    runtime.web_credential = None;
    let missing_snapshot_credential = super::execute_tool(
        "web_search",
        serde_json::json!({"query":"must not reach Exa"}),
        &runtime,
        &crate::model::ModelClient::new_for_test(),
    )
    .await;
    assert!(missing_snapshot_credential.is_error);
    assert_eq!(
        missing_snapshot_credential.content.as_text(),
        Some("Error: web_search is unavailable in this capability snapshot")
    );
}

#[test]
fn read_description_advertises_images_only_when_supported() {
    let description = |image_read| {
        worker_tool_definitions(image_read)
            .into_iter()
            .find(|definition| definition.function.name == "read")
            .unwrap()
            .function
            .description
    };
    assert!(description(true).contains("PNG"));
    assert!(!description(false).contains("image"));
}

#[test]
fn worker_registry_preserves_definition_order_and_declares_admission() {
    let registry = worker_tool_registry(false).unwrap();
    let snapshot = registry
        .snapshot(super::WORKER_TOOL_NAMES)
        .expect("complete worker capabilities");
    assert_eq!(
        snapshot
            .definitions()
            .into_iter()
            .map(|definition| definition.function.name)
            .collect::<Vec<_>>(),
        super::WORKER_TOOL_NAMES
    );
    let admissions = snapshot
        .descriptors_for_test()
        .into_iter()
        .map(|descriptor| (descriptor.definition.function.name, descriptor.admission))
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(admissions["read"], kernel::ToolAdmission::Parallel);
    assert_eq!(admissions["glob"], kernel::ToolAdmission::Parallel);
    assert_eq!(admissions["write"], kernel::ToolAdmission::Exclusive);
    assert_eq!(admissions["exec_command"], kernel::ToolAdmission::Exclusive);
}

#[test]
fn exec_binding_rewrites_authorized_paths_and_workdir_into_the_invocation() {
    let mut input = serde_json::json!({
        "cmd": "rg needle outside-link/secret",
        "workdir": "/workspace-link"
    });
    let resources = vec![
        kernel::PermissionResource::new("execute", "command:[rg][needle][outside-link/secret]"),
        kernel::PermissionResource::new("execute_path", "/outside/secret"),
        kernel::PermissionResource::new("external_directory", "/outside/secret"),
        kernel::PermissionResource::new("execute_cwd", "/workspace"),
    ];

    super::terminal_tools::bind_exec_command_resources(&mut input, &resources).unwrap();

    assert_eq!(input["cmd"], "rg needle /outside/secret");
    assert_eq!(input["workdir"], "/workspace");
}

#[test]
fn direct_registries_preserve_exact_topology_capabilities() {
    let worker = worker_tool_definitions(false)
        .into_iter()
        .map(|definition| definition.function.name)
        .collect::<Vec<_>>();
    let direct = direct_tool_definitions(false)
        .into_iter()
        .map(|definition| definition.function.name)
        .collect::<Vec<_>>();
    let delegating = super::direct_with_orchestrator_tool_definitions(false)
        .into_iter()
        .map(|definition| definition.function.name)
        .collect::<Vec<_>>();
    let direct_web = super::direct_tool_definitions_with_web(false, true)
        .into_iter()
        .map(|definition| definition.function.name)
        .collect::<Vec<_>>();
    let delegating_web = super::direct_with_orchestrator_tool_definitions_with_web(false, true)
        .into_iter()
        .map(|definition| definition.function.name)
        .collect::<Vec<_>>();
    let running_assigned = super::running_assigned_direct_tool_definitions(false)
        .into_iter()
        .map(|definition| definition.function.name)
        .collect::<Vec<_>>();
    assert_eq!(worker, super::WORKER_TOOL_NAMES);
    assert_eq!(direct, super::DIRECT_TOOL_NAMES);
    assert_eq!(running_assigned, super::RUNNING_ASSIGNED_DIRECT_TOOL_NAMES);
    assert!(!running_assigned.iter().any(|name| name == "create_goal"));
    assert!(super::SPAWN_TOOL_NAMES
        .iter()
        .all(|name| !running_assigned.iter().any(|assigned| assigned == name)));
    assert_eq!(delegating, super::DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES);
    assert_eq!(&delegating[14..], super::ORCHESTRATOR_CONTROL_TOOL_NAMES);
    assert_eq!(&direct_web[..super::DIRECT_TOOL_NAMES.len()], &direct);
    assert_eq!(
        &direct_web[super::DIRECT_TOOL_NAMES.len()..],
        super::WEB_TOOL_NAMES
    );
    assert_eq!(
        &delegating_web[..super::DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES.len()],
        &delegating
    );
    assert_eq!(
        &delegating_web[super::DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES.len()..],
        super::WEB_TOOL_NAMES
    );

    let orchestrator = super::orchestrator_tool_definitions(None, None)
        .into_iter()
        .map(|definition| definition.function.name)
        .collect::<Vec<_>>();
    assert!(super::SPAWN_TOOL_NAMES
        .iter()
        .all(|name| !orchestrator.iter().any(|tool| tool == name)));
    assert!(orchestrator.iter().all(|name| !name.starts_with("session_")
        && !name.contains("subagent")
        && !name.starts_with("orchestrator_")));
    for file_tool in [
        "read",
        "write",
        "edit",
        "glob",
        "grep",
        "exec_command",
        "create_goal",
    ] {
        assert!(
            !orchestrator.iter().any(|name| name == file_tool),
            "NAC must not expose {file_tool}"
        );
    }
}

#[test]
fn launch_tools_use_strict_compatible_nullable_new_session_ids() {
    let definitions = super::direct_with_orchestrator_tool_definitions(false);
    for (tool_name, session_id) in [
        ("subagent", "child_session_id"),
        ("orchestrator_launch", "orchestrator_session_id"),
    ] {
        let parameters = &definitions
            .iter()
            .find(|definition| definition.function.name == tool_name)
            .unwrap_or_else(|| panic!("missing {tool_name} definition"))
            .function
            .parameters;
        let properties = parameters["properties"]
            .as_object()
            .expect("launch properties");
        let required = parameters["required"]
            .as_array()
            .expect("launch required fields")
            .iter()
            .map(|value| value.as_str().expect("required field name"))
            .collect::<HashSet<_>>();
        assert_eq!(
            required,
            properties
                .keys()
                .map(String::as_str)
                .collect::<HashSet<_>>(),
            "{tool_name} must mark every property required for Responses strict mode"
        );
        assert_eq!(
            parameters["properties"][session_id]["type"],
            serde_json::json!(["string", "null"]),
            "{tool_name} must encode a fresh launch as a nullable session ID"
        );
        assert_eq!(parameters["additionalProperties"], false);
    }
}

#[tokio::test]
async fn registered_read_supports_native_and_model_boundary_calls() {
    let directory = std::env::temp_dir().join(format!("nac-kernel-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("fixture.txt"), "native kernel\n").unwrap();
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = directory.clone();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &directory);
    let client = crate::model::ModelClient::new_for_test();
    let registry = worker_tool_registry(false).unwrap();
    let handle = registry.native_handle::<ReadTool>().unwrap();
    let context = kernel::ToolCallContext::default();
    let services = kernel::ToolServices {
        runtime: &runtime,
        client: &client,
    };

    let native = handle
        .invoke(
            crate::tools::read::ReadInput::new("fixture.txt"),
            services,
            &context,
        )
        .await;
    assert!(!native.is_error, "{}", native.content);
    assert!(native.content.contains("native kernel"));

    let prepared = registry
        .snapshot(["read"])
        .unwrap()
        .prepare("read", serde_json::json!({"path":"fixture.txt"}), services)
        .unwrap();
    let canonical_fixture = directory.canonicalize().unwrap().join("fixture.txt");
    assert_eq!(
        prepared.permission_resources(),
        &[
            kernel::PermissionResource::new("read", canonical_fixture.display().to_string())
                .with_save_resource(canonical_fixture.display().to_string())
        ]
    );
    let dynamic = prepared.invoke(services, &context).await;
    assert!(!dynamic.is_error, "{}", dynamic.content);
    assert!(dynamic.content.contains("native kernel"));
    let _ = std::fs::remove_dir_all(directory);
}

#[cfg(unix)]
#[tokio::test]
async fn approved_mutation_executes_against_the_bound_canonical_target() {
    use std::os::unix::fs::symlink;

    let root = std::env::temp_dir().join(format!(
        "nac-bound-authorized-target-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace = root.join("workspace");
    let first = root.join("first");
    let second = root.join("second");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&first).unwrap();
    std::fs::create_dir_all(&second).unwrap();
    let link = workspace.join("link");
    symlink(&first, &link).unwrap();

    let store_path = root.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session-a");
    let broker = Arc::new(crate::permissions::PermissionBroker::new(
        store_path.clone(),
        "session-a".to_string(),
        crate::permissions::PermissionBackend::Local,
        0,
        [crate::permissions::PermissionRule::new(
            "edit",
            "*",
            crate::permissions::PermissionEffect::Ask,
        )],
    ));
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = workspace.clone();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &workspace);
    runtime.store_path = store_path;
    runtime.session_id = Some("session-a".to_string());
    runtime.permission_broker = Some(Arc::clone(&broker));
    let client = crate::model::ModelClient::new_for_test();

    let call = super::execute_tool(
        "write",
        serde_json::json!({
            "path":"link/result.txt",
            "content":"bound\n",
            "expected_revision":null
        }),
        &runtime,
        &client,
    );
    let approve = async {
        loop {
            if let Some(request) = broker.pending().pop() {
                std::fs::remove_file(&link).unwrap();
                symlink(&second, &link).unwrap();
                broker
                    .reply(&request.id, crate::permissions::PermissionReply::Once)
                    .unwrap();
                break;
            }
            tokio::task::yield_now().await;
        }
    };
    let (result, ()) = tokio::join!(call, approve);
    assert!(!result.is_error, "{}", result.content);
    assert_eq!(
        std::fs::read_to_string(first.join("result.txt")).unwrap(),
        "bound\n"
    );
    assert!(!second.join("result.txt").exists());
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn approved_mutation_rejects_an_ancestor_swap_after_resource_binding() {
    use std::os::unix::fs::symlink;

    let root = std::env::temp_dir().join(format!(
        "nac-bound-authorized-swap-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace = root.join("workspace");
    let safe = workspace.join("safe");
    let git = workspace.join(".git");
    std::fs::create_dir_all(&safe).unwrap();
    std::fs::create_dir_all(&git).unwrap();
    let target = safe.canonicalize().unwrap().join("result.txt");
    let (entered, release) = crate::tools::mutation::gate_before_bound_local_open(target.clone());

    let store_path = root.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session-a");
    let broker = Arc::new(crate::permissions::PermissionBroker::new(
        store_path.clone(),
        "session-a".to_string(),
        crate::permissions::PermissionBackend::Local,
        0,
        [crate::permissions::PermissionRule::new(
            "edit",
            "*",
            crate::permissions::PermissionEffect::Ask,
        )],
    ));
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = workspace.clone();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &workspace);
    runtime.store_path = store_path;
    runtime.session_id = Some("session-a".to_string());
    runtime.permission_broker = Some(Arc::clone(&broker));
    let client = crate::model::ModelClient::new_for_test();

    let attack_broker = Arc::clone(&broker);
    let attack_workspace = workspace.clone();
    let attack_safe = safe.clone();
    let attack_git = git.clone();
    let attack = std::thread::spawn(move || {
        let request = loop {
            if let Some(request) = attack_broker.pending().pop() {
                break request;
            }
            std::thread::yield_now();
        };
        attack_broker
            .reply(&request.id, crate::permissions::PermissionReply::Once)
            .unwrap();
        entered.recv().unwrap();
        std::fs::rename(&attack_safe, attack_workspace.join("safe-before-swap")).unwrap();
        symlink(&attack_git, &attack_safe).unwrap();
        release.send(()).unwrap();
    });
    let result = super::execute_tool(
        "write",
        serde_json::json!({
            "path":"safe/result.txt",
            "content":"must not escape\n",
            "expected_revision":null
        }),
        &runtime,
        &client,
    )
    .await;
    attack.join().unwrap();
    assert!(result.is_error, "{}", result.content);
    assert!(!git.join("result.txt").exists());
    assert!(!workspace.join("safe-before-swap/result.txt").exists());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn prepared_builtin_calls_project_validated_correlated_permission_resources() {
    let directory =
        std::env::temp_dir().join(format!("nac-kernel-resources-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = directory.clone();
    runtime.store_path = directory.join("store.db");
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &directory);
    let client = crate::model::ModelClient::new_for_test();
    let services = kernel::ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let registry = worker_tool_registry(false).unwrap();
    let snapshot = registry.snapshot(super::WORKER_TOOL_NAMES).unwrap();

    let write = snapshot
        .prepare(
            "write",
            serde_json::json!({
                "path":".git/config",
                "content":"unsafe",
                "expected_revision":null
            }),
            services,
        )
        .unwrap();
    assert_eq!(write.permission_resources()[0].action, "edit");
    assert!(write.permission_resources()[0].hard_denial.is_some());

    let shell = snapshot
        .prepare(
            "exec_command",
            serde_json::json!({"cmd":"git status --short && cargo test -p nac-core"}),
            services,
        )
        .unwrap();
    assert_eq!(
        shell
            .permission_resources()
            .iter()
            .map(|resource| resource.resource.clone())
            .collect::<Vec<_>>(),
        vec![
            "command:[git][status][--short]".to_string(),
            "command:[git][status][--short]".to_string(),
            "command:[cargo][test][-p][nac-core]".to_string(),
            "command:[cargo][test][-p][nac-core]".to_string(),
            directory.canonicalize().unwrap().display().to_string(),
        ]
    );

    let invalid = snapshot
        .prepare(
            "glob",
            serde_json::json!({"pattern":"*", "root": 7}),
            services,
        )
        .err()
        .expect("invalid permission-relevant root must fail before authorization");
    assert!(invalid.is_error);
    for (tool, input) in [
        (
            "write",
            serde_json::json!({"path":"file", "expected_revision":null}),
        ),
        (
            "edit",
            serde_json::json!({"path":"file", "expected_revision":"rev", "edits":[]}),
        ),
        ("glob", serde_json::json!({"pattern":"", "root":"."})),
        (
            "grep",
            serde_json::json!({"pattern":"needle", "roots":[], "context":101}),
        ),
        (
            "exec_command",
            serde_json::json!({"cmd":"git status", "tty":"yes"}),
        ),
        (
            "write_stdin",
            serde_json::json!({"session_id":"shell-test", "retain":"yes"}),
        ),
        (
            "write_stdin",
            serde_json::json!({
                "session_id":"shell-test",
                "chars":"answer<RET>",
                "retain":true
            }),
        ),
        (
            "read_command_output",
            serde_json::json!({"output_id":"output", "limit":0}),
        ),
    ] {
        let error = snapshot
            .prepare(tool, input, services)
            .err()
            .unwrap_or_else(|| panic!("{tool} must fully decode before authorization"));
        assert!(error.is_error, "{tool}: {}", error.content);
    }

    for (tool, input) in [
        (
            "exec_command",
            serde_json::json!({"cmd":"git status", "unknown":true}),
        ),
        (
            "write_stdin",
            serde_json::json!({"session_id":"shell-test", "unknown":true}),
        ),
        (
            "read_command_output",
            serde_json::json!({"output_id":"output", "unknown":true}),
        ),
    ] {
        let error = snapshot
            .prepare(tool, input, services)
            .err()
            .unwrap_or_else(|| panic!("{tool} must reject unknown input before authorization"));
        assert!(error.is_error, "{tool}: {}", error.content);
    }

    let observe = snapshot
        .prepare(
            "write_stdin",
            serde_json::json!({"session_id":"shell-test", "chars":""}),
            services,
        )
        .unwrap();
    assert_eq!(observe.permission_resources()[0].action, "terminal_observe");
    let input = snapshot
        .prepare(
            "write_stdin",
            serde_json::json!({"session_id":"shell-test", "chars":"help<RET>"}),
            services,
        )
        .unwrap();
    assert_eq!(input.permission_resources()[0].action, "terminal_input");
    assert!(input.permission_resources()[0].hard_denial.is_some());
    let retain = snapshot
        .prepare(
            "write_stdin",
            serde_json::json!({
                "session_id":"shell-test",
                "chars":"",
                "retain":true
            }),
            services,
        )
        .unwrap();
    assert_eq!(retain.permission_resources()[0].action, "terminal_retain");
    assert!(retain.permission_resources()[0].hard_denial.is_none());
    let interactive_shell = snapshot
        .prepare(
            "exec_command",
            serde_json::json!({"cmd":"bash", "tty":true}),
            services,
        )
        .unwrap();
    assert!(interactive_shell
        .permission_resources()
        .iter()
        .any(|resource| resource.hard_denial.is_some()));
    let bounded_pty = snapshot
        .prepare(
            "exec_command",
            serde_json::json!({"cmd":"cargo test", "tty":true}),
            services,
        )
        .unwrap();
    assert!(bounded_pty
        .permission_resources()
        .iter()
        .any(|resource| resource.hard_denial.is_some()));
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn brokerless_worker_model_calls_still_enforce_native_hard_denials() {
    let directory =
        std::env::temp_dir().join(format!("nac-worker-hard-denial-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = directory.clone();
    runtime.store_path = directory.join("store.db");
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &directory);
    assert!(runtime.permission_broker.is_none());
    let client = crate::model::ModelClient::new_for_test();
    let services = kernel::ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let registry = worker_tool_registry(false).unwrap();
    let snapshot = registry.snapshot(super::WORKER_TOOL_NAMES).unwrap();
    let context = kernel::ToolCallContext {
        call_id: Some("call-worker-denied".to_string()),
        thread_name: Some("worker".to_string()),
    };

    for (tool, input, denial) in [
        (
            "write_stdin",
            serde_json::json!({"session_id":"shell-test", "chars":"help<RET>"}),
            "nonempty terminal input is unavailable to brokerless workers",
        ),
        (
            "exec_command",
            serde_json::json!({"cmd":"bash", "tty":true}),
            "interactive opaque commands and broad interpreters are unavailable to brokerless workers",
        ),
    ] {
        let result = snapshot.invoke(tool, input, services, &context).await;
        assert!(result.is_error, "{tool} unexpectedly executed");
        assert!(
            result.content.to_string().contains(denial),
            "{tool}: {}",
            result.content
        );
    }
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn direct_terminal_input_requires_once_only_approval_for_the_exact_handle() {
    let root = std::env::temp_dir().join(format!(
        "nac-direct-terminal-input-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let store_path = root.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "session-a");
    let broker = Arc::new(crate::permissions::PermissionBroker::new(
        store_path.clone(),
        "session-a".to_string(),
        crate::permissions::PermissionBackend::Local,
        0,
        [
            crate::permissions::PermissionRule::new(
                "execute",
                "*",
                crate::permissions::PermissionEffect::Allow,
            ),
            crate::permissions::PermissionRule::new(
                "execute_opaque",
                "*",
                crate::permissions::PermissionEffect::Allow,
            ),
        ],
    ));
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = root.clone();
    runtime.store_path = store_path;
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &root);
    runtime.session_id = Some("session-a".to_string());
    runtime.permission_broker = Some(Arc::clone(&broker));
    let client = crate::model::ModelClient::new_for_test();
    let services = kernel::ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let registry = worker_tool_registry(false).unwrap();
    let snapshot = registry.snapshot(super::WORKER_TOOL_NAMES).unwrap();
    let context = kernel::ToolCallContext {
        call_id: Some("call-terminal-input".to_string()),
        thread_name: None,
    };

    let started = snapshot
        .invoke(
            "exec_command",
            serde_json::json!({
                "cmd":"read value; printf 'got:%s\\n' \"$value\"",
                "tty":true,
                "yield_time_ms":50
            }),
            services,
            &context,
        )
        .await;
    assert!(!started.is_error, "{}", started.content);
    let started: serde_json::Value =
        serde_json::from_str(started.content.as_text().unwrap()).unwrap();
    let handle = started["session_name"].as_str().unwrap().to_string();

    let input = snapshot.invoke(
        "write_stdin",
        serde_json::json!({
            "session_id":handle,
            "chars":"answer<RET>",
            "yield_time_ms":2_000
        }),
        services,
        &context,
    );
    let approve = async {
        loop {
            if let Some(request) = broker.pending().pop() {
                assert_eq!(request.resources.len(), 1);
                assert_eq!(request.resources[0].action, "terminal_input");
                assert_eq!(request.resources[0].resource, handle);
                assert!(request.resources[0].display.contains("local backend"));
                assert!(request.resources[0].display.contains("\"answer<RET>\""));
                assert!(request.resources[0].save_resource.is_none());
                broker
                    .reply(&request.id, crate::permissions::PermissionReply::Always)
                    .unwrap();
                break;
            }
            tokio::task::yield_now().await;
        }
    };
    let (continued, ()) = tokio::join!(input, approve);
    assert!(!continued.is_error, "{}", continued.content);
    assert!(continued.content.to_string().contains("got:answer"));
    assert!(broker.grants().unwrap().is_empty());
    runtime.terminal_manager.remove_all().await.unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn brokerless_opaque_redirect_cannot_mutate_git_through_a_symlink() {
    use std::os::unix::fs::symlink;

    let root = std::env::temp_dir().join(format!(
        "nac-worker-opaque-redirect-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(root.join(".git")).unwrap();
    std::fs::write(root.join(".git/config"), "original\n").unwrap();
    symlink(root.join(".git/config"), root.join("config-link")).unwrap();
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = root.clone();
    runtime.store_path = root.join("store.db");
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &root);
    assert!(runtime.permission_broker.is_none());
    let client = crate::model::ModelClient::new_for_test();
    let services = kernel::ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let registry = worker_tool_registry(false).unwrap();
    let snapshot = registry.snapshot(super::WORKER_TOOL_NAMES).unwrap();
    let result = snapshot
        .invoke(
            "exec_command",
            serde_json::json!({"cmd":"printf pwned > config-link"}),
            services,
            &kernel::ToolCallContext::default(),
        )
        .await;
    assert!(result.is_error, "opaque redirect unexpectedly executed");
    assert!(result.content.to_string().contains("redirection"));
    assert_eq!(
        std::fs::read_to_string(root.join(".git/config")).unwrap(),
        "original\n"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn brokerless_direct_shell_path_fails_before_process_side_effects() {
    let root = std::env::temp_dir().join(format!(
        "nac-worker-shell-path-denial-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(root.join("safe")).unwrap();
    let target = root.join("safe/config");
    std::fs::write(&target, "original\n").unwrap();
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = root.clone();
    runtime.store_path = root.join("store.db");
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &root);
    let client = crate::model::ModelClient::new_for_test();
    let services = kernel::ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let registry = worker_tool_registry(false).unwrap();
    let result = registry
        .snapshot(super::WORKER_TOOL_NAMES)
        .unwrap()
        .invoke(
            "exec_command",
            serde_json::json!({"cmd":"rm safe/config"}),
            services,
            &kernel::ToolCallContext::default(),
        )
        .await;
    assert!(result.is_error, "direct shell path unexpectedly executed");
    assert!(result
        .content
        .to_string()
        .contains("concurrent ancestor replacement"));
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "original\n");
    let _ = std::fs::remove_dir_all(root);
}
