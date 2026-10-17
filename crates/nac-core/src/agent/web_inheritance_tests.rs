use super::*;
use crate::sessions::{self, SessionBehavior};

struct Fixture {
    root: PathBuf,
    store: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("nac_web_inheritance_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        Self {
            store: root.join("store.db"),
            root,
        }
    }
    fn session(&self, id: &str, behavior: SessionBehavior) {
        let mut snapshot = sessions::new_snapshot(
            id.into(),
            self.root.clone(),
            "test".into(),
            "https://api.openai.com/v1".into(),
            crate::model::BackendKind::OpenAiResponses,
            None,
            None,
            None,
            vec![],
            None,
            Default::default(),
        );
        snapshot.behavior = behavior;
        sessions::create_session(&self.store, &snapshot).unwrap();
    }
    fn child(&self, parent: &str, child: &str, managed: bool) -> NativeWebCapabilities {
        self.session(
            child,
            if managed {
                SessionBehavior::Orchestrator
            } else {
                SessionBehavior::Direct
            },
        );
        if managed {
            crate::store::create_managed_orchestrator_relationship(
                &self.store,
                parent,
                child,
                "research",
            )
            .unwrap();
        } else {
            crate::store::create_traditional_child_relationship(
                &self.store,
                parent,
                child,
                crate::store::GENERAL_CHILD_PROFILE,
                "research",
            )
            .unwrap();
        }
        NativeWebCapabilities::new(
            if managed {
                AgentMode::Orchestrator
            } else {
                AgentMode::Direct
            },
            &self.store,
            Some(child),
        )
        .unwrap()
    }
    fn source(&self, id: &str, value: Arc<Mutex<Option<String>>>) -> Arc<CredentialSource> {
        let source: Arc<CredentialSource> = Arc::new(move || Ok(value.lock().unwrap().clone()));
        PARENT_SOURCES
            .lock()
            .unwrap()
            .insert((self.store.clone(), id.into()), Arc::clone(&source));
        source
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        PARENT_SOURCES
            .lock()
            .unwrap()
            .retain(|(store, _), _| store != &self.store);
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn generations_rebind_rotation_removal_reattachment_and_restart_without_storing_keys() {
    for behavior in [
        SessionBehavior::Direct,
        SessionBehavior::DirectWithOrchestrator,
    ] {
        let f = Fixture::new();
        f.session("parent", behavior);
        let mut child = f.child("parent", "child", false);
        let key = Arc::new(Mutex::new(Some("parent-canary-one".to_string())));
        let source = f.source("parent", key.clone());
        child.admit_generation().unwrap();
        assert_eq!(
            child.resolve_credential().unwrap().as_deref(),
            Some("parent-canary-one")
        );
        *key.lock().unwrap() = Some("parent-canary-two".to_string());
        // Steering and every model request keep the admitted generation.
        assert_eq!(
            child.resolve_credential().unwrap().as_deref(),
            Some("parent-canary-one")
        );
        child.admit_generation().unwrap();
        assert_eq!(
            child.resolve_credential().unwrap().as_deref(),
            Some("parent-canary-two")
        );
        *key.lock().unwrap() = None;
        child.admit_generation().unwrap();
        assert!(child.resolve_credential().unwrap().is_none());
        *key.lock().unwrap() = Some("parent-canary-three".to_string());
        drop(source);
        // Idle-agent eviction preserves the established process binding.
        child.admit_generation().unwrap();
        assert_eq!(
            child.resolve_credential().unwrap().as_deref(),
            Some("parent-canary-three")
        );
        // A new process has no registered parent binding.
        PARENT_SOURCES
            .lock()
            .unwrap()
            .remove(&(f.store.clone(), "parent".into()));
        child.admit_generation().unwrap();
        assert!(child.resolve_credential().unwrap().is_none());
        // A reattached child cannot discover the host's key on its own. The
        // recovered parent runtime must first re-establish its trusted source.
        let mut reattached =
            NativeWebCapabilities::new(AgentMode::Direct, &f.store, Some("child")).unwrap();
        reattached.admit_generation().unwrap();
        assert!(reattached.resolve_credential().unwrap().is_none());
        let _recovered_parent = f.source("parent", key);
        reattached.admit_generation().unwrap();
        assert_eq!(
            reattached.resolve_credential().unwrap().as_deref(),
            Some("parent-canary-three")
        );
        for entry in std::fs::read_dir(&f.root).unwrap() {
            let bytes = std::fs::read(entry.unwrap().path()).unwrap();
            assert!(!String::from_utf8_lossy(&bytes).contains("parent-canary"));
        }
    }
}

#[test]
fn parent_and_store_ownership_bind_traditional_and_managed_generations() {
    let f = Fixture::new();
    let other_host = Fixture::new();
    for fixture in [&f, &other_host] {
        fixture.session("parent-a", SessionBehavior::DirectWithOrchestrator);
        fixture.session("parent-b", SessionBehavior::Direct);
    }
    let a = Arc::new(Mutex::new(Some("owner-a-canary".to_string())));
    let b = Arc::new(Mutex::new(Some("owner-b-canary".to_string())));
    let _a = f.source("parent-a", a);
    let _b = f.source("parent-b", b);
    let _other = other_host.source(
        "parent-a",
        Arc::new(Mutex::new(Some("other-host-canary".into()))),
    );
    let mut child_a = f.child("parent-a", "child-a", false);
    let mut child_b = f.child("parent-b", "child-b", false);
    let mut orchestrator = f.child("parent-a", "orchestrator", true);
    for (child, expected) in [
        (&mut child_a, "owner-a-canary"),
        (&mut child_b, "owner-b-canary"),
        (&mut orchestrator, "owner-a-canary"),
    ] {
        child.admit_generation().unwrap();
        assert_eq!(
            child.resolve_credential().unwrap().as_deref(),
            Some(expected)
        );
    }
    let mut absent = other_host.child("parent-b", "child-b", false);
    absent.admit_generation().unwrap();
    assert!(absent.resolve_credential().unwrap().is_none());
    let ordinary = NativeWebCapabilities::new(AgentMode::Orchestrator, &f.store, None).unwrap();
    assert!(!ordinary.is_eligible());
    assert!(ordinary.resolve_credential().unwrap().is_none());
}

#[tokio::test]
async fn inherited_snapshot_keeps_policy_url_cancellation_backend_and_output_isolation() {
    use crate::agent::Agent;
    use crate::permissions::{PermissionEffect, PermissionRule};
    use crate::tools::execute_tool;
    use serde_json::json;

    let f = Fixture::new();
    f.session("parent", SessionBehavior::Direct);
    let child = f.child("parent", "child", false);
    let _source = f.source(
        "parent",
        Arc::new(Mutex::new(Some("inherited-policy-canary".into()))),
    );
    let mut agent = Agent::default(crate::model::ModelClient::new_for_test());
    agent.native_web_capabilities = child;
    let backend = agent.tool_runtime.backend.clone();
    agent.admit_native_web_generation().unwrap();
    let definitions = agent.refresh_model_request_capabilities().unwrap();
    assert!(definitions
        .iter()
        .any(|tool| tool.function.name == "web_fetch"));
    assert!(!serde_json::to_string(&definitions)
        .unwrap()
        .contains("inherited-policy-canary"));
    assert!(Arc::ptr_eq(&backend, &agent.tool_runtime.backend));
    let environment = agent
        .tool_runtime
        .command_environment_snapshot()
        .await
        .unwrap();
    assert!(environment.get(crate::model::EXA_API_KEY_ENV).is_none());
    assert_eq!(environment.redact("inherited-policy-canary"), "[REDACTED]");

    agent.tool_runtime.permission_rules = Arc::new(vec![PermissionRule::new(
        "web_search",
        "*",
        PermissionEffect::Deny,
    )]);
    let denied = execute_tool(
        "web_search",
        json!({"query":"native research"}),
        &agent.tool_runtime,
        &agent.client,
    )
    .await;
    assert!(denied.is_error);
    assert!(
        denied.content.to_string().to_lowercase().contains("denied"),
        "{}",
        denied.content
    );
    agent.tool_runtime.permission_rules = Arc::new(vec![PermissionRule::new(
        "web_search",
        "*",
        PermissionEffect::Ask,
    )]);
    let asked = execute_tool(
        "web_search",
        json!({"query":"approval"}),
        &agent.tool_runtime,
        &agent.client,
    )
    .await;
    assert!(asked.is_error);
    assert!(asked.content.to_string().contains("no approval broker"));
    let invalid = execute_tool(
        "web_fetch",
        json!({"url":"http://127.0.0.1/private"}),
        &agent.tool_runtime,
        &agent.client,
    )
    .await;
    assert!(invalid.is_error);
    assert!(invalid.content.to_string().contains("not allowed"));
    agent.tool_runtime.command_cancellation.cancel();
    let cancelled = execute_tool(
        "web_fetch",
        json!({"url":"https://www.rust-lang.org/learn"}),
        &agent.tool_runtime,
        &agent.client,
    )
    .await;
    assert!(cancelled.is_error);
    assert!(cancelled
        .content
        .to_string()
        .to_lowercase()
        .contains("cancel"));
}

#[test]
fn concurrent_parents_never_cross_bind_and_deleted_parents_cannot_regrant() {
    let f = Fixture::new();
    let mut children = Vec::new();
    let mut sources = Vec::new();
    for (parent, child, key) in [("a", "child-a", "canary-a"), ("b", "child-b", "canary-b")] {
        f.session(parent, SessionBehavior::Direct);
        sources.push(f.source(parent, Arc::new(Mutex::new(Some(key.into())))));
        children.push((f.child(parent, child, false), key));
    }
    std::thread::scope(|scope| {
        for (mut child, expected) in children {
            scope.spawn(move || {
                for _ in 0..8 {
                    child.admit_generation().unwrap();
                    assert_eq!(
                        child.resolve_credential().unwrap().as_deref(),
                        Some(expected)
                    );
                }
            });
        }
    });
    let mut child =
        NativeWebCapabilities::new(AgentMode::Direct, &f.store, Some("child-a")).unwrap();
    child.admit_generation().unwrap();
    assert!(sessions::delete_session(&f.store, "a").unwrap());
    child.admit_generation().unwrap();
    assert!(child.resolve_credential().unwrap().is_none());
}

#[test]
fn blank_unavailable_and_oversized_parent_sources_never_admit_a_credential() {
    let f = Fixture::new();
    f.session("parent", SessionBehavior::Direct);
    let mut child = f.child("parent", "child", false);
    let value = Arc::new(Mutex::new(Some("  ".into())));
    let _source = f.source("parent", value.clone());
    child.admit_generation().unwrap();
    assert!(child.resolve_credential().unwrap().is_none());
    *value.lock().unwrap() = Some("x".repeat(32 * 1024 + 1));
    assert!(child
        .admit_generation()
        .unwrap_err()
        .to_string()
        .contains("delegation bound"));
    assert!(child.resolve_credential().unwrap().is_none());
    let unavailable: Arc<CredentialSource> = Arc::new(|| anyhow::bail!("source unavailable"));
    PARENT_SOURCES
        .lock()
        .unwrap()
        .insert((f.store.clone(), "parent".into()), unavailable);
    assert!(child.admit_generation().is_err());
    assert!(child.resolve_credential().unwrap().is_none());
}
